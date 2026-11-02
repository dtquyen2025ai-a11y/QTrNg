import type { PoolClient } from 'pg';
import { one, q, tx } from './db.ts';
import { bad, forbidden, notFound } from './errors.ts';
import { vnDay, periodKey } from './time.ts';
import { addItem, grant, bumpMetric, checkAchievements, activeMultiplier } from './economy.ts';
import { expForLevel, isNameAllowed, DAILY_GIFT, GIFT_MIN_LEVEL, GIFT_SEN_DAILY_LIMIT, filterText } from '../../shared/content.ts';
import { players, serverOnline, sendToChar, broadcastRoom, type Look } from './presence.ts';
import { pool } from './db.ts';

const HAIRS = ['cao_trọc', 'búi', 'ngắn', 'dài', 'tết'];
const SKINS = ['#f1d3b3', '#e2b58e', '#c98f62', '#9a6643'];

export async function listServers() {
  const rows = await q<any>('SELECT id, code, name, capacity, is_open FROM servers ORDER BY id');
  return rows.map((s) => ({ ...s, online: serverOnline(s.id) }));
}

export async function getCharacter(userId: number, serverId: number) {
  return one<any>('SELECT * FROM characters WHERE user_id=$1 AND server_id=$2', [userId, serverId]);
}

export async function myCharacters(userId: number) {
  return q<any>(`SELECT c.id, c.server_id, c.dharma_name, s.level FROM characters c JOIN character_stats s ON s.character_id=c.id WHERE c.user_id=$1`, [userId]);
}

export async function createCharacter(userId: number, body: any) {
  const serverId = Number(body.serverId);
  const srv = await one<any>('SELECT * FROM servers WHERE id=$1', [serverId]);
  if (!srv || !srv.is_open) throw bad('Máy chủ không tồn tại hoặc đang đóng.');
  const name = String(body.dharmaName || '').trim().replace(/\s+/g, ' ');
  if (!/^[\p{L} ]{2,20}$/u.test(name)) throw bad('Pháp danh gồm 2–20 chữ cái (có dấu), không chứa số hay ký hiệu.');
  if (!isNameAllowed(name)) throw bad('Pháp danh chứa từ không phù hợp.');
  const gender = body.gender === 'nu' ? 'nu' : body.gender === 'nam' ? 'nam' : null;
  if (!gender) throw bad('Hãy chọn giới tính nhân vật.');
  if (!HAIRS.includes(body.hair)) throw bad('Kiểu tóc không hợp lệ.');
  if (!SKINS.includes(body.skin)) throw bad('Màu da không hợp lệ.');
  const robeColor = typeof body.robeColor === 'string' && /^#[0-9a-f]{6}$/i.test(body.robeColor) ? body.robeColor : null;

  return tx(async (db) => {
    if (await one('SELECT 1 FROM characters WHERE user_id=$1 AND server_id=$2', [userId, serverId], db)) throw bad('Bạn đã có nhân vật trên máy chủ này.');
    if (await one('SELECT 1 FROM characters WHERE lower(dharma_name)=lower($1)', [name], db)) throw bad('Pháp danh này đã có người dùng.', 'name_taken');
    const temple = await one<any>(`SELECT id, zones FROM temples WHERE code='tam_an'`, [], db);
    const c = await one<any>(
      `INSERT INTO characters (user_id, server_id, dharma_name, gender, hair, skin, temple_id, equipment, pos_x, pos_z)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, 0, 40) RETURNING *`,
      [userId, serverId, name, gender, body.hair, body.skin, temple.id, JSON.stringify({ robe: 'ao_lam', robeColor })], db);
    await q('INSERT INTO character_stats (character_id) VALUES ($1)', [c.id], db);
    await q(`INSERT INTO currencies (character_id, code, balance) VALUES ($1,'merit',0),($1,'sen',50),($1,'ngoc',0)`, [c.id], db);
    await q(`INSERT INTO transactions (character_id, kind, currency, delta, balance_after, ref) VALUES ($1,'starter','sen',50,50,'new_character')`, [c.id], db);
    await addItem(db, c.id, 'ao_lam', 1, 'starter', 'new_character');
    return c;
  }).catch((e) => {
    if (e.code === '23505') throw bad('Pháp danh này đã có người dùng.', 'name_taken');
    throw e;
  });
}

export async function lookOf(c: any): Promise<Look> {
  const eq = c.equipment || {};
  return { gender: c.gender, hair: c.hair, skin: c.skin, robe: eq.robe || null, accessory: eq.accessory || null, bead: eq.bead || null };
}

/** Trạng thái đầy đủ khi vào game (kèm quà đăng nhập ngày). */
export async function fullState(charId: number) {
  const c = await one<any>(`SELECT c.*, t.code AS temple_code, t.name AS temple_name, t.zones, s.name AS server_name
                            FROM characters c JOIN temples t ON t.id=c.temple_id JOIN servers s ON s.id=c.server_id WHERE c.id=$1`, [charId]);
  if (!c) throw notFound('Không tìm thấy nhân vật.');
  const [stats, cur, inv, missions, ach, stamps, ev, items] = await Promise.all([
    one<any>('SELECT * FROM character_stats WHERE character_id=$1', [charId]),
    q<any>('SELECT code, balance FROM currencies WHERE character_id=$1', [charId]),
    q<any>(`SELECT i.code, i.name, i.category, i.description, i.data, inv.quantity FROM inventory inv JOIN items i ON i.id=inv.item_id
            WHERE inv.character_id=$1 AND inv.quantity>0 ORDER BY i.category, i.id`, [charId]),
    missionList(charId),
    q<any>(`SELECT a.code, a.name, a.description, a.points, a.title, a.threshold, a.stat, ca.unlocked_at
            FROM achievements a LEFT JOIN character_achievements ca ON ca.achievement_id=a.id AND ca.character_id=$1 ORDER BY a.id`, [charId]),
    q<any>('SELECT temple_id, zone_code FROM pilgrimage_progress WHERE character_id=$1', [charId]),
    (async () => { const c2 = await pool.connect(); try { return await activeMultiplier(c2); } finally { c2.release(); } })(),
    q<any>('SELECT code, data FROM items WHERE category IN (\'robe\',\'item\',\'decor\',\'special\')'),
  ]);
  const wallet: Record<string, number> = { merit: 0, sen: 0, ngoc: 0 };
  for (const r of cur) wallet[r.code] = r.balance;
  const titles = ach.filter((a) => a.unlocked_at && a.title).map((a) => a.title);
  const itemData = Object.fromEntries(items.map((i) => [i.code, i.data]));
  return {
    character: {
      id: c.id, dharmaName: c.dharma_name, gender: c.gender, hair: c.hair, skin: c.skin, equipment: c.equipment,
      title: c.title_code, serverId: c.server_id, serverName: c.server_name,
      temple: { id: c.temple_id, code: c.temple_code, name: c.temple_name, zones: c.zones },
      pos: { x: c.pos_x, z: c.pos_z, ry: c.rot_y }, createdAt: c.created_at,
    },
    stats: { ...stats, expNeeded: expForLevel(stats.level) },
    wallet, inventory: inv, missions, achievements: ach, titles, stamps,
    event: ev.name ? { name: ev.name, multiplier: ev.mult } : null,
    itemData,
    today: vnDay(),
  };
}

export async function enterGame(charId: number) {
  const { dailyCheckIn } = await import('./economy.ts');
  const daily = await dailyCheckIn(charId, DAILY_GIFT);
  const state = await fullState(charId);
  return { ...state, dailyGift: daily };
}

export async function missionList(charId: number) {
  const s = await one<any>('SELECT level FROM character_stats WHERE character_id=$1', [charId]);
  const ms = await q<any>(`SELECT * FROM missions WHERE is_active AND (starts_at IS NULL OR starts_at <= now()) AND (ends_at IS NULL OR ends_at > now())
                           ORDER BY sort, id`);
  const prog = await q<any>('SELECT mission_id, period_key, progress, claimed_at FROM mission_progress WHERE character_id=$1', [charId]);
  const map = new Map(prog.map((p) => [`${p.mission_id}|${p.period_key}`, p]));
  return ms.map((m) => {
    const p = map.get(`${m.id}|${periodKey(m.reset)}`);
    return {
      id: m.id, code: m.code, name: m.name, description: m.description, period: m.period, reset: m.reset,
      target: m.target, progress: p?.progress || 0, claimed: !!p?.claimed_at, locked: m.min_level > s.level, minLevel: m.min_level,
      reward: { merit: m.reward_merit, exp: m.reward_exp, sen: m.reward_sen, ngoc: m.reward_ngoc, item: m.reward_item, itemQty: m.reward_item_qty },
      endsAt: m.ends_at,
    };
  });
}

// ---------- Cửa hàng & túi đồ ----------
export async function shopItems() {
  return q<any>(`SELECT code, name, category, description, price_sen, price_ngoc, data, stackable, min_level
                 FROM items WHERE is_active AND (price_sen IS NOT NULL OR price_ngoc IS NOT NULL) ORDER BY category, COALESCE(price_sen, price_ngoc*1000)`);
}

export async function buy(charId: number, code: string, qty: number) {
  if (!Number.isInteger(qty) || qty < 1 || qty > 99) throw bad('Số lượng không hợp lệ (1–99).');
  return tx(async (db) => {
    const it = await one<any>('SELECT * FROM items WHERE code=$1 AND is_active', [code], db);
    if (!it || (it.price_sen == null && it.price_ngoc == null)) throw notFound('Vật phẩm không bán.');
    const s = await one<any>('SELECT level FROM character_stats WHERE character_id=$1 FOR UPDATE', [charId], db);
    if (s.level < it.min_level) throw bad(`Cần đạt cấp ${it.min_level} để mua ${it.name}.`);
    if (!it.stackable) {
      if (qty !== 1) throw bad('Vật phẩm này chỉ mua 1 lần.');
      const own = await one<any>('SELECT quantity FROM inventory WHERE character_id=$1 AND item_id=$2', [charId, it.id], db);
      if (own && own.quantity > 0) throw bad('Bạn đã có vật phẩm này.');
    }
    const ref = `shop:${code}x${qty}`;
    if (it.price_sen != null) await grant(db, charId, { sen: -it.price_sen * qty }, 'shop', ref);
    else await grant(db, charId, { ngoc: -it.price_ngoc * qty }, 'shop', ref);
    await addItem(db, charId, code, qty, 'shop', ref);
    return { ok: true, message: `Đã mua ${qty > 1 ? qty + ' ' : ''}${it.name}.` };
  });
}

export async function equip(charId: number, slot: string, code: string | null) {
  if (!['robe', 'accessory', 'bead'].includes(slot)) throw bad('Ô trang bị không hợp lệ.');
  return tx(async (db) => {
    const c = await one<any>('SELECT * FROM characters WHERE id=$1 FOR UPDATE', [charId], db);
    const eq = { ...(c.equipment || {}) };
    if (code) {
      const it = await one<any>(`SELECT i.code, i.name, i.data FROM inventory inv JOIN items i ON i.id=inv.item_id
                                 WHERE inv.character_id=$1 AND i.code=$2 AND inv.quantity>0`, [charId, code], db);
      if (!it) throw bad('Bạn chưa sở hữu vật phẩm này.');
      if (it.data?.slot !== slot) throw bad('Vật phẩm không dùng cho ô này.');
      eq[slot] = code;
    } else {
      if (slot === 'robe') throw bad('Nhân vật luôn cần mặc áo tràng.');
      delete eq[slot];
    }
    await q('UPDATE characters SET equipment=$2 WHERE id=$1', [charId, JSON.stringify(eq)], db);
    const look = await lookOf({ ...c, equipment: eq });
    const p = players.get(charId);
    if (p) { p.look = look; broadcastRoom(p.serverId, p.templeId, { t: 'look', id: charId, look }); }
    return { ok: true, equipment: eq };
  });
}

export async function setTitle(charId: number, title: string | null) {
  if (title) {
    const ok = await one(`SELECT 1 FROM character_achievements ca JOIN achievements a ON a.id=ca.achievement_id
                          WHERE ca.character_id=$1 AND a.title=$2`, [charId, title]);
    if (!ok) throw bad('Bạn chưa mở khóa danh hiệu này.');
  }
  await q('UPDATE characters SET title_code=$2 WHERE id=$1', [charId, title]);
  const p = players.get(charId);
  if (p) { p.title = title; broadcastRoom(p.serverId, p.templeId, { t: 'title', id: charId, title }); }
  return { ok: true, title };
}

export async function history(charId: number) {
  const [acts, txs] = await Promise.all([
    q<any>(`SELECT h.activity_code, a.name, h.amount, h.rewarded, h.merit, h.exp, h.sen, h.created_at
            FROM activity_history h JOIN activities a ON a.code=h.activity_code WHERE character_id=$1 ORDER BY h.id DESC LIMIT 60`, [charId]),
    q<any>(`SELECT t.kind, t.currency, i.name AS item_name, t.delta, t.balance_after, t.ref, t.created_at
            FROM transactions t LEFT JOIN items i ON i.id=t.item_id WHERE character_id=$1 AND t.currency <> 'exp' ORDER BY t.id DESC LIMIT 80`, [charId]),
  ]);
  return { activities: acts, transactions: txs };
}

// ---------- Hành hương ----------
export async function temples(charId: number) {
  const s = await one<any>('SELECT level FROM character_stats WHERE character_id=$1', [charId]);
  const rows = await q<any>('SELECT * FROM temples WHERE is_active ORDER BY min_level, id');
  const stamps = await q<any>('SELECT temple_id, zone_code, stamped_at FROM pilgrimage_progress WHERE character_id=$1', [charId]);
  return rows.map((t) => ({
    id: t.id, code: t.code, name: t.name, region: t.region, description: t.description, history: t.history,
    minLevel: t.min_level, unlocked: s.level >= t.min_level, mapX: t.map_x, mapY: t.map_y,
    zones: t.zones.map((z: any) => ({ ...z, stamped: stamps.some((st) => st.temple_id === t.id && st.zone_code === z.code) })),
  }));
}

export async function travel(charId: number, templeCode: string) {
  const t = await one<any>('SELECT * FROM temples WHERE code=$1 AND is_active', [templeCode]);
  if (!t) throw notFound('Ngôi chùa không tồn tại.');
  const s = await one<any>('SELECT level FROM character_stats WHERE character_id=$1', [charId]);
  if (s.level < t.min_level) throw bad(`Cần đạt cấp ${t.min_level} để hành hương đến ${t.name}.`);
  await q('UPDATE characters SET temple_id=$2, pos_x=0, pos_z=40, rot_y=0 WHERE id=$1', [charId, t.id]);
  return { ok: true, temple: { id: t.id, code: t.code, name: t.name } };
}

// ---------- Cộng đồng ----------
async function relation(a: number, b: number) {
  return one<any>('SELECT status FROM friends WHERE character_id=$1 AND friend_id=$2', [a, b]);
}
export async function isBlockedEither(a: number, b: number) {
  const r = await one(`SELECT 1 FROM friends WHERE status='blocked' AND ((character_id=$1 AND friend_id=$2) OR (character_id=$2 AND friend_id=$1))`, [a, b]);
  return !!r;
}

async function sameServer(a: number, b: number) {
  const r = await q<any>('SELECT id, server_id, dharma_name FROM characters WHERE id = ANY($1)', [[a, b]]);
  if (r.length < 2) throw notFound('Không tìm thấy người chơi.');
  if (r[0].server_id !== r[1].server_id) throw bad('Người chơi ở máy chủ khác.');
  return r.find((x) => x.id === b);
}

export async function friendRequest(me: number, target: number) {
  if (me === target) throw bad('Không thể kết bạn với chính mình.');
  const t = await sameServer(me, target);
  if (await isBlockedEither(me, target)) throw bad('Không thể gửi lời mời tới người chơi này.');
  const mine = await relation(me, target);
  if (mine?.status === 'accepted') throw bad('Hai bạn đã là bạn bè.');
  const theirs = await relation(target, me);
  if (theirs?.status === 'pending') return friendRespond(me, target, true);
  await q(`INSERT INTO friends (character_id, friend_id, status) VALUES ($1,$2,'pending') ON CONFLICT DO NOTHING`, [me, target]);
  const meName = (await one<any>('SELECT dharma_name FROM characters WHERE id=$1', [me])).dharma_name;
  sendToChar(target, { t: 'friend_request', from: { id: me, name: meName } });
  return { ok: true, message: `Đã gửi lời mời kết bạn tới ${t.dharma_name}.` };
}

export async function friendRespond(me: number, from: number, accept: boolean) {
  return tx(async (db) => {
    const r = await one<any>(`SELECT 1 FROM friends WHERE character_id=$1 AND friend_id=$2 AND status='pending' FOR UPDATE`, [from, me], db);
    if (!r) throw notFound('Lời mời không còn.');
    if (!accept) {
      await q('DELETE FROM friends WHERE character_id=$1 AND friend_id=$2', [from, me], db);
      return { ok: true, message: 'Đã từ chối lời mời.' };
    }
    await q(`UPDATE friends SET status='accepted' WHERE character_id=$1 AND friend_id=$2`, [from, me], db);
    await q(`INSERT INTO friends (character_id, friend_id, status) VALUES ($1,$2,'accepted')
             ON CONFLICT (character_id, friend_id) DO UPDATE SET status='accepted'`, [me, from], db);
    await bumpMetric(db, me, 'friend', 1);
    await bumpMetric(db, from, 'friend', 1);
    const meName = (await one<any>('SELECT dharma_name FROM characters WHERE id=$1', [me], db)).dharma_name;
    sendToChar(from, { t: 'toast', text: `${meName} đã nhận lời kết bạn.` });
    return { ok: true, message: 'Hai bạn đã trở thành bạn bè.' };
  });
}

export async function unfriend(me: number, other: number) {
  await q(`DELETE FROM friends WHERE status<>'blocked' AND ((character_id=$1 AND friend_id=$2) OR (character_id=$2 AND friend_id=$1))`, [me, other]);
  return { ok: true };
}

export async function block(me: number, other: number) {
  if (me === other) throw bad('Không thể chặn chính mình.');
  await tx(async (db) => {
    await q(`DELETE FROM friends WHERE (character_id=$1 AND friend_id=$2) OR (character_id=$2 AND friend_id=$1)`, [me, other], db);
    await q(`INSERT INTO friends (character_id, friend_id, status) VALUES ($1,$2,'blocked')`, [me, other], db);
  });
  players.get(me)?.blocked.add(other);
  return { ok: true, message: 'Đã chặn. Bạn sẽ không nhận tin nhắn, lời mời hay quà từ người này.' };
}
export async function unblock(me: number, other: number) {
  await q(`DELETE FROM friends WHERE character_id=$1 AND friend_id=$2 AND status='blocked'`, [me, other]);
  players.get(me)?.blocked.delete(other);
  return { ok: true };
}

export async function social(me: number) {
  const rows = await q<any>(`
    SELECT f.character_id, f.friend_id, f.status, c.id, c.dharma_name, s.level
    FROM friends f JOIN characters c ON c.id = CASE WHEN f.character_id=$1 THEN f.friend_id ELSE f.character_id END
    JOIN character_stats s ON s.character_id=c.id
    WHERE f.character_id=$1 OR (f.friend_id=$1 AND f.status='pending')`, [me]);
  type F = { id: number; name: string; level: number; online: boolean };
  const friends: F[] = [], incoming: F[] = [], outgoing: F[] = [], blocked: F[] = [];
  for (const r of rows) {
    const item = { id: r.id, name: r.dharma_name, level: r.level, online: players.has(r.id) };
    if (r.status === 'accepted' && r.character_id === me) friends.push(item);
    else if (r.status === 'pending' && r.friend_id === me) incoming.push(item);
    else if (r.status === 'pending' && r.character_id === me) outgoing.push(item);
    else if (r.status === 'blocked' && r.character_id === me) blocked.push(item);
  }
  return { friends, incoming, outgoing, blocked };
}

export async function searchPlayers(me: number, query: string) {
  const s = query.trim();
  if (s.length < 2) return [];
  const srv = await one<any>('SELECT server_id FROM characters WHERE id=$1', [me]);
  const rows = await q<any>(`SELECT c.id, c.dharma_name, s.level, c.title_code FROM characters c JOIN character_stats s ON s.character_id=c.id
                             WHERE c.server_id=$1 AND c.id<>$2 AND c.dharma_name ILIKE $3 ORDER BY s.level DESC LIMIT 20`,
    [srv.server_id, me, '%' + s.replace(/[%_]/g, '') + '%']);
  return rows.map((r) => ({ id: r.id, name: r.dharma_name, level: r.level, title: r.title_code, online: players.has(r.id) }));
}

export async function sendGift(me: number, body: any) {
  const to = Number(body.toId);
  const sen = Math.floor(Number(body.sen || 0));
  const itemCode = body.itemCode ? String(body.itemCode) : null;
  const qty = itemCode ? Math.floor(Number(body.qty || 1)) : 0;
  const note = filterText(String(body.note || '').slice(0, 80)).text;
  if (sen < 0 || qty < 0 || (!sen && !itemCode)) throw bad('Hãy chọn Sen hoặc vật phẩm để tặng.');
  if (itemCode && (qty < 1 || qty > 20)) throw bad('Số lượng vật phẩm 1–20.');
  return tx(async (db) => {
    const st = await one<any>('SELECT level FROM character_stats WHERE character_id=$1 FOR UPDATE', [me], db);
    if (st.level < GIFT_MIN_LEVEL) throw bad(`Cần đạt cấp ${GIFT_MIN_LEVEL} để tặng quà.`);
    const fr = await one(`SELECT 1 FROM friends WHERE character_id=$1 AND friend_id=$2 AND status='accepted'`, [me, to], db);
    if (!fr) throw bad('Chỉ có thể tặng quà cho bạn bè.');
    if (sen) {
      const sent = await one<any>(`SELECT COALESCE(SUM(sen),0)::int AS n FROM gifts WHERE sender_id=$1 AND created_at >= ($2::date)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'`, [me, vnDay()], db);
      if (sent.n + sen > GIFT_SEN_DAILY_LIMIT) throw bad(`Mỗi ngày tặng tối đa ${GIFT_SEN_DAILY_LIMIT} Sen (hôm nay còn ${GIFT_SEN_DAILY_LIMIT - sent.n}).`);
    }
    let itemId: number | null = null, itemName = '';
    if (itemCode) {
      const it = await one<any>('SELECT id, name, giftable FROM items WHERE code=$1', [itemCode], db);
      if (!it || !it.giftable) throw bad('Vật phẩm này không thể tặng.');
      itemId = it.id; itemName = it.name;
    }
    const ref = `gift:${me}->${to}`;
    if (sen) { await grant(db, me, { sen: -sen }, 'gift_out', ref); await grant(db, to, { sen }, 'gift_in', ref); }
    if (itemCode) { await addItem(db, me, itemCode, -qty, 'gift_out', ref); await addItem(db, to, itemCode, qty, 'gift_in', ref); }
    await q('INSERT INTO gifts (sender_id, recipient_id, sen, item_id, item_qty, note) VALUES ($1,$2,$3,$4,$5,$6)', [me, to, sen, itemId, qty, note], db);
    await q('UPDATE character_stats SET gifts_sent=gifts_sent+1 WHERE character_id=$1', [me], db);
    await bumpMetric(db, me, 'gift', 1);
    const ach = await checkAchievements(db, me);
    const meName = (await one<any>('SELECT dharma_name FROM characters WHERE id=$1', [me], db)).dharma_name;
    const what = [sen ? `${sen} Sen` : '', itemCode ? `${qty} ${itemName}` : ''].filter(Boolean).join(' và ');
    sendToChar(to, { t: 'gift', from: meName, text: `${meName} tặng bạn ${what}${note ? ': “' + note + '”' : ''}` });
    return { ok: true, message: `Đã tặng ${what}.`, achievements: ach };
  });
}

export async function report(me: number, body: any) {
  const target = Number(body.targetId);
  const reason = String(body.reason || '').trim().slice(0, 300);
  if (!reason) throw bad('Hãy ghi lý do báo cáo.');
  if (target === me) throw bad('Không thể tự báo cáo.');
  const t = await one('SELECT 1 FROM characters WHERE id=$1', [target]);
  if (!t) throw notFound('Không tìm thấy người chơi.');
  const recent = await one<any>(`SELECT count(*)::int AS n FROM reports WHERE reporter_id=$1 AND created_at > now() - interval '1 hour'`, [me]);
  if (recent.n >= 10) throw bad('Bạn đã gửi nhiều báo cáo. Vui lòng đợi.');
  const messageId = body.messageId ? Number(body.messageId) : null;
  await q('INSERT INTO reports (reporter_id, target_id, message_id, reason) VALUES ($1,$2,$3,$4)', [me, target, messageId, reason]);
  return { ok: true, message: 'Đã gửi báo cáo. Đội ngũ quản trị sẽ xem xét.' };
}

export async function leaderboard(me: number, type: string) {
  const srv = await one<any>('SELECT server_id FROM characters WHERE id=$1', [me]);
  const sql: Record<string, string> = {
    merit: `SELECT c.id, c.dharma_name, c.title_code, s.level, cu.balance AS value FROM characters c
            JOIN character_stats s ON s.character_id=c.id JOIN currencies cu ON cu.character_id=c.id AND cu.code='merit'
            WHERE c.server_id=$1 ORDER BY cu.balance DESC, c.id LIMIT 50`,
    level: `SELECT c.id, c.dharma_name, c.title_code, s.level, s.level AS value FROM characters c
            JOIN character_stats s ON s.character_id=c.id WHERE c.server_id=$1 ORDER BY s.level DESC, s.exp DESC, c.id LIMIT 50`,
    meditation: `SELECT c.id, c.dharma_name, c.title_code, s.level, s.meditation_minutes AS value FROM characters c
            JOIN character_stats s ON s.character_id=c.id WHERE c.server_id=$1 ORDER BY s.meditation_minutes DESC, c.id LIMIT 50`,
  };
  if (!sql[type]) throw bad('Bảng xếp hạng không hợp lệ.');
  const rows = await q<any>(sql[type], [srv.server_id]);
  return rows.map((r, i) => ({ rank: i + 1, id: r.id, name: r.dharma_name, title: r.title_code, level: r.level, value: r.value, me: r.id === me }));
}

export async function recentLanterns(serverId: number, templeId: number) {
  return q<any>(`SELECT l.id, l.wish, l.created_at, c.dharma_name AS name FROM lanterns l JOIN characters c ON c.id=l.character_id
                 WHERE l.server_id=$1 AND l.temple_id=$2 AND l.created_at > now() - interval '3 hours' ORDER BY l.id DESC LIMIT 30`, [serverId, templeId]);
}

export async function recentChat(me: number) {
  const c = await one<any>('SELECT server_id FROM characters WHERE id=$1', [me]);
  const pub = await q<any>(`SELECT m.id, m.sender_id, c.dharma_name AS name, m.body, m.created_at FROM messages m JOIN characters c ON c.id=m.sender_id
                            WHERE m.server_id=$1 AND m.recipient_id IS NULL AND NOT m.is_hidden ORDER BY m.id DESC LIMIT 30`, [c.server_id]);
  const priv = await q<any>(`SELECT m.id, m.sender_id, m.recipient_id, cs.dharma_name AS name, cr.dharma_name AS to_name, m.body, m.created_at
                             FROM messages m JOIN characters cs ON cs.id=m.sender_id JOIN characters cr ON cr.id=m.recipient_id
                             WHERE (m.sender_id=$1 OR m.recipient_id=$1) AND NOT m.is_hidden ORDER BY m.id DESC LIMIT 50`, [me]);
  const blocked = await q<any>(`SELECT friend_id FROM friends WHERE character_id=$1 AND status='blocked'`, [me]);
  const bl = new Set(blocked.map((b) => b.friend_id));
  return { public: pub.filter((m) => !bl.has(m.sender_id)).reverse(), private: priv.filter((m) => !bl.has(m.sender_id)).reverse() };
}

export async function requireOwnChar(db: PoolClient | null, userId: number, charId: number) {
  const c = await one<any>('SELECT id FROM characters WHERE id=$1 AND user_id=$2', [charId, userId]);
  if (!c) throw forbidden('Nhân vật không thuộc tài khoản của bạn.');
}
