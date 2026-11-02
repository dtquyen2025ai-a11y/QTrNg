// Lõi kinh tế game. MỌI thay đổi tài nguyên đi qua file này, trong transaction có khóa dòng.
import type { PoolClient } from 'pg';
import { one, q, tx } from './db.ts';
import { bad, notFound, tooMany } from './errors.ts';
import { vnDay, periodKey } from './time.ts';
import {
  expForLevel, COOP_BONUS, COOP_MIN_PLAYERS, SUTRAS, MEDITATION_OPTIONS, inAnyZone, type Zone,
} from '../../shared/content.ts';
import { players, noteCoop } from './presence.ts';

export interface Gains { merit: number; exp: number; sen: number; ngoc: number }
export interface Outcome {
  ok: true;
  rewarded: boolean;
  message: string;
  gains: Gains;
  levelUps: number[];
  achievements: { code: string; name: string; title: string | null }[];
  coop: number;
  extra?: Record<string, unknown>;
}

// ---------- Cache định nghĩa ----------
let activityCache: { at: number; map: Map<string, any> } | null = null;
export async function activities(): Promise<Map<string, any>> {
  if (activityCache && Date.now() - activityCache.at < 30_000) return activityCache.map;
  const rows = await q('SELECT * FROM activities');
  activityCache = { at: Date.now(), map: new Map(rows.map((r) => [r.code, r])) };
  return activityCache.map;
}
export function invalidateCaches() { activityCache = null; }

export async function activeMultiplier(db: PoolClient): Promise<{ mult: number; name: string | null }> {
  const r = await one<any>(
    `SELECT name, merit_multiplier FROM game_events WHERE is_active AND now() BETWEEN starts_at AND ends_at
     ORDER BY merit_multiplier DESC LIMIT 1`, [], db);
  return r ? { mult: Number(r.merit_multiplier), name: r.name } : { mult: 1, name: null };
}

// ---------- Tài nguyên ----------
async function addCurrency(db: PoolClient, charId: number, code: 'merit' | 'sen' | 'ngoc', delta: number, kind: string, ref: string | null) {
  if (!delta) return;
  // Trừ: UPDATE có điều kiện (CHECK của INSERT chạy trước ON CONFLICT nên không dùng upsert cho số âm)
  const r = delta < 0
    ? await one<any>(`UPDATE currencies SET balance = balance + $3 WHERE character_id=$1 AND code=$2 AND balance + $3 >= 0 RETURNING balance`, [charId, code, delta], db)
    : await one<any>(`INSERT INTO currencies (character_id, code, balance) VALUES ($1,$2,$3)
                      ON CONFLICT (character_id, code) DO UPDATE SET balance = currencies.balance + EXCLUDED.balance RETURNING balance`, [charId, code, delta], db);
  if (!r) throw bad(code === 'ngoc' ? 'Không đủ Ngọc.' : code === 'sen' ? 'Không đủ Sen.' : 'Không đủ công đức.', 'insufficient');
  await q(`INSERT INTO transactions (character_id, kind, currency, delta, balance_after, ref) VALUES ($1,$2,$3,$4,$5,$6)`,
    [charId, kind, code, delta, r.balance, ref], db);
}

export async function addItem(db: PoolClient, charId: number, itemCode: string, qty: number, kind: string, ref: string | null) {
  const item = await one<any>('SELECT id, name, stackable FROM items WHERE code=$1', [itemCode], db);
  if (!item) throw notFound('Vật phẩm không tồn tại.');
  const r = qty < 0
    ? await one<any>(`UPDATE inventory SET quantity = quantity + $3 WHERE character_id=$1 AND item_id=$2 AND quantity + $3 >= 0 RETURNING quantity`, [charId, item.id, qty], db)
    : await one<any>(`INSERT INTO inventory (character_id, item_id, quantity) VALUES ($1,$2,$3)
                      ON CONFLICT (character_id, item_id) DO UPDATE SET quantity = inventory.quantity + EXCLUDED.quantity RETURNING quantity`, [charId, item.id, qty], db);
  if (!r) throw bad(`Bạn không còn ${item.name}.`, 'insufficient_item');
  await q(`INSERT INTO transactions (character_id, kind, currency, item_id, delta, balance_after, ref) VALUES ($1,$2,'item',$3,$4,$5,$6)`,
    [charId, kind, item.id, qty, r!.quantity, ref], db);
  return r!.quantity as number;
}

/** Cộng thưởng + xử lý lên cấp + thành tựu cấp độ. Trả về danh sách cấp mới đạt. */
export async function grant(db: PoolClient, charId: number, g: Partial<Gains>, kind: string, ref: string | null): Promise<{ levelUps: number[]; achievements: Outcome['achievements'] }> {
  await addCurrency(db, charId, 'merit', g.merit || 0, kind, ref);
  await addCurrency(db, charId, 'sen', g.sen || 0, kind, ref);
  await addCurrency(db, charId, 'ngoc', g.ngoc || 0, kind, ref);
  const levelUps: number[] = [];
  let achievements: Outcome['achievements'] = [];
  if (g.exp) {
    const s = await one<any>('SELECT level, exp FROM character_stats WHERE character_id=$1 FOR UPDATE', [charId], db);
    let level = s.level, exp = s.exp + g.exp;
    while (exp >= expForLevel(level)) {
      exp -= expForLevel(level);
      level++;
      levelUps.push(level);
    }
    await q('UPDATE character_stats SET level=$2, exp=$3 WHERE character_id=$1', [charId, level, exp], db);
    await q(`INSERT INTO transactions (character_id, kind, currency, delta, balance_after, ref) VALUES ($1,$2,'exp',$3,$4,$5)`,
      [charId, kind, g.exp, exp, ref], db);
    for (const L of levelUps) {
      await addCurrency(db, charId, 'sen', 10 * L, 'level_up', `level:${L}`);
      if (L % 5 === 0) await addCurrency(db, charId, 'ngoc', 1, 'level_up', `level:${L}`);
    }
    if (levelUps.length) {
      await setMetric(db, charId, 'level', level);
      achievements = await checkAchievements(db, charId);
      const p = players.get(charId);
      if (p) p.level = level;
    }
  }
  return { levelUps, achievements };
}

// ---------- Nhiệm vụ ----------
async function missionsFor(db: PoolClient, metric: string, level: number) {
  return q<any>(`SELECT * FROM missions WHERE is_active AND metric=$1 AND min_level <= $2
                 AND (starts_at IS NULL OR starts_at <= now()) AND (ends_at IS NULL OR ends_at > now())`, [metric, level], db);
}
export async function bumpMetric(db: PoolClient, charId: number, metric: string, amount: number) {
  if (amount <= 0) return;
  const s = await one<any>('SELECT level FROM character_stats WHERE character_id=$1', [charId], db);
  for (const m of await missionsFor(db, metric, s.level)) {
    await q(`INSERT INTO mission_progress (character_id, mission_id, period_key, progress) VALUES ($1,$2,$3,LEAST($4::int,$5::int))
             ON CONFLICT (character_id, mission_id, period_key)
             DO UPDATE SET progress = LEAST(mission_progress.progress + $4::int, $5::int)`,
      [charId, m.id, periodKey(m.reset), amount, m.target], db);
  }
}
export async function setMetric(db: PoolClient, charId: number, metric: string, value: number) {
  const s = await one<any>('SELECT level FROM character_stats WHERE character_id=$1', [charId], db);
  for (const m of await missionsFor(db, metric, s.level)) {
    await q(`INSERT INTO mission_progress (character_id, mission_id, period_key, progress) VALUES ($1,$2,$3,LEAST($4::int,$5::int))
             ON CONFLICT (character_id, mission_id, period_key)
             DO UPDATE SET progress = GREATEST(mission_progress.progress, LEAST($4::int,$5::int))`,
      [charId, m.id, periodKey(m.reset), value, m.target], db);
  }
}

export async function claimMission(charId: number, missionId: number) {
  return tx(async (db) => {
    const m = await one<any>('SELECT * FROM missions WHERE id=$1 AND is_active', [missionId], db);
    if (!m) throw notFound('Nhiệm vụ không tồn tại.');
    const pk = periodKey(m.reset);
    const p = await one<any>('SELECT * FROM mission_progress WHERE character_id=$1 AND mission_id=$2 AND period_key=$3 FOR UPDATE',
      [charId, m.id, pk], db);
    if (!p || p.progress < m.target) throw bad('Nhiệm vụ chưa hoàn thành.', 'not_complete');
    if (p.claimed_at) throw bad('Bạn đã nhận thưởng nhiệm vụ này.', 'already_claimed');
    await q('UPDATE mission_progress SET claimed_at=now() WHERE character_id=$1 AND mission_id=$2 AND period_key=$3', [charId, m.id, pk], db);
    const ref = `mission:${m.code}:${pk}`;
    const g = await grant(db, charId, { merit: m.reward_merit, exp: m.reward_exp, sen: m.reward_sen, ngoc: m.reward_ngoc }, 'mission', ref);
    if (m.reward_item && m.reward_item_qty > 0) await addItem(db, charId, m.reward_item, m.reward_item_qty, 'mission', ref);
    return {
      ok: true, rewarded: true, message: `Nhận thưởng "${m.name}"`,
      gains: { merit: m.reward_merit, exp: m.reward_exp, sen: m.reward_sen, ngoc: m.reward_ngoc },
      item: m.reward_item ? { code: m.reward_item, qty: m.reward_item_qty } : null,
      levelUps: g.levelUps, achievements: g.achievements,
    };
  });
}

// ---------- Thành tựu ----------
export async function checkAchievements(db: PoolClient, charId: number): Promise<Outcome['achievements']> {
  const s = await one<any>('SELECT * FROM character_stats WHERE character_id=$1', [charId], db);
  const list = await q<any>(`SELECT a.* FROM achievements a WHERE NOT EXISTS
     (SELECT 1 FROM character_achievements ca WHERE ca.character_id=$1 AND ca.achievement_id=a.id)`, [charId], db);
  const out: Outcome['achievements'] = [];
  for (const a of list) {
    const v = Number(s[a.stat] ?? 0);
    if (v < Number(a.threshold)) continue;
    const ins = await one('INSERT INTO character_achievements (character_id, achievement_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING 1', [charId, a.id], db);
    if (!ins) continue;
    await q('UPDATE character_stats SET achievement_points = achievement_points + $2 WHERE character_id=$1', [charId, a.points], db);
    if (a.reward_ngoc) await addCurrency(db, charId, 'ngoc', a.reward_ngoc, 'achievement', `ach:${a.code}`);
    out.push({ code: a.code, name: a.name, title: a.title });
  }
  return out;
}

// ---------- Hoạt động ----------
interface Ctx { charId: number; serverId: number; templeId: number; x: number; z: number; zones: Zone[] }

export async function charContext(db: PoolClient, charId: number): Promise<Ctx> {
  const c = await one<any>(`SELECT c.id, c.server_id, c.temple_id, c.pos_x, c.pos_z, t.zones
                            FROM characters c JOIN temples t ON t.id=c.temple_id WHERE c.id=$1`, [charId], db);
  if (!c) throw notFound('Không tìm thấy nhân vật.');
  const live = players.get(charId);
  // Vị trí do server xác thực qua WebSocket được ưu tiên
  const x = live && live.templeId === c.temple_id ? live.x : c.pos_x;
  const z = live && live.templeId === c.temple_id ? live.z : c.pos_z;
  return { charId, serverId: c.server_id, templeId: c.temple_id, x, z, zones: c.zones };
}

function zoneNames(ctx: Ctx, codes: string[]) {
  return codes.map((c) => ctx.zones.find((z) => z.code === c)?.name || c).join(' hoặc ');
}

async function usedToday(db: PoolClient, charId: number, code: string): Promise<number> {
  const r = await one<any>(`SELECT COALESCE(SUM(amount),0)::int AS n FROM activity_history
                            WHERE character_id=$1 AND activity_code=$2 AND day=$3 AND rewarded`, [charId, code, vnDay()], db);
  return r.n;
}
async function lastAt(db: PoolClient, charId: number, code: string): Promise<number> {
  const r = await one<any>(`SELECT max(created_at) AS t FROM activity_history WHERE character_id=$1 AND activity_code=$2 AND day >= $3::date - 1`,
    [charId, code, vnDay()], db);
  return r?.t ? new Date(r.t).getTime() : 0;
}

const STAT_COL: Record<string, string> = {
  prostrate: 'prostrations', chant: 'chants', incense: 'offerings', candle: 'offerings', flower: 'offerings', lantern: 'lanterns',
};
const METRIC: Record<string, string> = {
  prostrate: 'prostrate', bead: 'bead_round', meditate: 'meditate_min', chant: 'chant',
  incense: 'offering', candle: 'offering', flower: 'offering', bell: 'bell', lantern: 'lantern', explore: 'explore',
};

/**
 * Thực hiện một hoạt động có thưởng.
 * amount: số lần (mặc định 1) hoặc số phút với thiền.
 */
async function perform(db: PoolClient, ctx: Ctx, code: string, amount: number, meta: Record<string, unknown>, opts: { skipZone?: boolean; skipInterval?: boolean } = {}): Promise<Outcome> {
  const act = (await activities()).get(code);
  if (!act || !act.is_active) throw bad('Hoạt động đang tạm đóng.');
  await one('SELECT 1 FROM character_stats WHERE character_id=$1 FOR UPDATE', [ctx.charId], db); // tuần tự hóa theo nhân vật

  if (act.zone && !opts.skipZone) {
    const codes = String(act.zone).split(',');
    if (!inAnyZone(ctx.zones, codes, ctx.x, ctx.z)) throw bad(`Hãy đến ${zoneNames(ctx, codes)} để ${act.name.toLowerCase()}.`, 'wrong_zone');
  }
  if (act.min_interval_ms && !opts.skipInterval) {
    const wait = act.min_interval_ms - (Date.now() - (await lastAt(db, ctx.charId, code)));
    if (wait > 0) throw tooMany(wait > 5000 ? `${act.name} lại sau ${Math.ceil(wait / 1000)} giây.` : 'Chậm lại một chút, tâm an thì động tác mới trọn.');
  }
  if (act.consumes_item) await addItem(db, ctx.charId, act.consumes_item, -1, 'activity', code);

  const used = await usedToday(db, ctx.charId, code);
  const rewardAmount = Math.max(0, Math.min(amount, act.daily_cap - used));
  const rewarded = rewardAmount > 0;

  let coopCount = 0, merit = 0, exp = 0, sen = 0;
  let eventName: string | null = null;
  if (rewarded) {
    coopCount = noteCoop(ctx.serverId, ctx.templeId, ctx.charId);
    const ev = await activeMultiplier(db);
    eventName = ev.name;
    const coopMult = coopCount >= COOP_MIN_PLAYERS ? 1 + COOP_BONUS : 1;
    merit = Math.round(act.merit * rewardAmount * ev.mult * coopMult);
    exp = act.exp * rewardAmount;
    sen = act.sen * rewardAmount;
  }
  await q(`INSERT INTO activity_history (character_id, activity_code, amount, rewarded, merit, exp, sen, meta, day)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [ctx.charId, code, rewarded ? rewardAmount : amount, rewarded, merit, exp, sen, JSON.stringify(meta), vnDay()], db);

  const col = STAT_COL[code];
  if (col) await q(`UPDATE character_stats SET ${col} = ${col} + $2 WHERE character_id=$1`, [ctx.charId, amount], db);

  let levelUps: number[] = [], ach: Outcome['achievements'] = [];
  if (rewarded) {
    const g = await grant(db, ctx.charId, { merit, exp, sen }, 'activity', code);
    levelUps = g.levelUps; ach = g.achievements;
  }
  if (METRIC[code]) await bumpMetric(db, ctx.charId, METRIC[code], amount);
  if (rewarded && coopCount >= COOP_MIN_PLAYERS) await bumpMetric(db, ctx.charId, 'coop', 1);
  ach = ach.concat(await checkAchievements(db, ctx.charId));

  let message = rewarded ? `${act.name}: +${merit} công đức` : `${act.name} hoàn tất. Hôm nay đã đạt giới hạn nhận thưởng cho hoạt động này.`;
  if (rewarded && coopCount >= COOP_MIN_PLAYERS) message += ` (cộng tu ${coopCount} người +20%)`;
  if (rewarded && eventName) message += ` · ${eventName}`;
  return { ok: true, rewarded, message, gains: { merit, exp, sen, ngoc: 0 }, levelUps, achievements: ach, coop: coopCount };
}

export async function doSimple(charId: number, code: string, meta: Record<string, unknown> = {}): Promise<Outcome> {
  if (!['prostrate', 'incense', 'candle', 'flower', 'bell'].includes(code)) throw bad('Hoạt động không hợp lệ.');
  return tx(async (db) => perform(db, await charContext(db, charId), code, 1, meta));
}

/** Lần hạt theo lô. Server kiểm tra nhịp: mỗi hạt ≥ 250ms. Thưởng khi tròn 108. */
export async function doBeads(charId: number, count: number): Promise<Outcome & { progress: number; rounds: number }> {
  if (!Number.isInteger(count) || count < 1 || count > 30) throw bad('Số hạt không hợp lệ.');
  return tx(async (db) => {
    const ctx = await charContext(db, charId);
    const s = await one<any>('SELECT bead_progress, bead_rounds, last_bead_at FROM character_stats WHERE character_id=$1 FOR UPDATE', [charId], db);
    const now = Date.now();
    const last = s.last_bead_at ? new Date(s.last_bead_at).getTime() : 0;
    const allowed = last ? Math.floor((now - last) / 250) + 1 : 30;
    if (count > allowed) throw tooMany('Lần hạt quá nhanh. Hãy lần chậm rãi theo hơi thở.');
    let progress = s.bead_progress + count;
    let completed = 0;
    while (progress >= 108) { progress -= 108; completed++; }
    await q('UPDATE character_stats SET bead_progress=$2, bead_rounds=bead_rounds+$3, last_bead_at=now() WHERE character_id=$1',
      [charId, progress, completed], db);
    let out: Outcome = { ok: true, rewarded: false, message: '', gains: { merit: 0, exp: 0, sen: 0, ngoc: 0 }, levelUps: [], achievements: [], coop: 0 };
    if (completed) out = await perform(db, ctx, 'bead', completed, { rounds: completed }, { skipInterval: true });
    return { ...out, progress, rounds: s.bead_rounds + completed };
  });
}

// ---------- Phiên đo thời gian: thiền, tụng kinh ----------
export async function startSession(charId: number, kind: 'meditate' | 'chant', ref: string | null, plannedSec: number) {
  return tx(async (db) => {
    const ctx = await charContext(db, charId);
    const act = (await activities()).get(kind);
    const codes = String(act.zone).split(',');
    if (!inAnyZone(ctx.zones, codes, ctx.x, ctx.z)) throw bad(`Hãy đến ${zoneNames(ctx, codes)} để ${act.name.toLowerCase()}.`, 'wrong_zone');
    await q(`INSERT INTO activity_sessions (character_id, kind, ref, planned, started_at) VALUES ($1,$2,$3,$4, now())
             ON CONFLICT (character_id, kind) DO UPDATE SET ref=$3, planned=$4, started_at=now()`, [charId, kind, ref, plannedSec], db);
    return { ok: true, kind, ref, planned: plannedSec, startedAt: new Date().toISOString() };
  });
}

export async function startMeditation(charId: number, minutes: number) {
  if (!MEDITATION_OPTIONS.includes(minutes)) throw bad('Thời lượng thiền không hợp lệ.');
  return startSession(charId, 'meditate', null, minutes * 60);
}
export async function startChant(charId: number, sutraCode: string) {
  const s = SUTRAS.find((x) => x.code === sutraCode);
  if (!s) throw bad('Bài kinh không tồn tại.');
  return startSession(charId, 'chant', s.code, s.minSeconds);
}

export async function finishMeditation(charId: number) {
  return tx(async (db) => {
    const ses = await one<any>(`SELECT *, EXTRACT(EPOCH FROM (now()-started_at))::float AS elapsed FROM activity_sessions
                                WHERE character_id=$1 AND kind='meditate' FOR UPDATE`, [charId], db);
    if (!ses) throw bad('Bạn chưa bắt đầu thiền.');
    await q(`DELETE FROM activity_sessions WHERE character_id=$1 AND kind='meditate'`, [charId], db);
    const elapsed = Math.min(ses.elapsed, ses.planned * 1.02);
    const minutes = Math.floor((elapsed + 1) / 60);
    if (minutes < 1) return { ok: true, rewarded: false, message: 'Buổi thiền dưới 1 phút nên chưa được ghi nhận.', gains: { merit: 0, exp: 0, sen: 0, ngoc: 0 }, levelUps: [], achievements: [], coop: 0, minutes: 0 };
    await q('UPDATE character_stats SET meditation_minutes = meditation_minutes + $2 WHERE character_id=$1', [charId, minutes], db);
    const ctx = await charContext(db, charId);
    const out = await perform(db, ctx, 'meditate', minutes, { planned: ses.planned / 60, elapsed: Math.round(ses.elapsed) }, { skipZone: true });
    const full = ses.elapsed >= ses.planned * 0.98;
    out.message = `${full ? 'Viên mãn' : 'Xả thiền sớm'} · ${minutes} phút. ` + out.message;
    return { ...out, minutes };
  });
}

export async function finishChant(charId: number) {
  return tx(async (db) => {
    const ses = await one<any>(`SELECT *, EXTRACT(EPOCH FROM (now()-started_at))::float AS elapsed FROM activity_sessions
                                WHERE character_id=$1 AND kind='chant' FOR UPDATE`, [charId], db);
    if (!ses) throw bad('Bạn chưa bắt đầu tụng kinh.');
    if (ses.elapsed < ses.planned) {
      throw bad(`Hãy tụng chậm rãi trọn bài (tối thiểu ${ses.planned} giây, mới ${Math.floor(ses.elapsed)} giây).`, 'too_fast');
    }
    await q(`DELETE FROM activity_sessions WHERE character_id=$1 AND kind='chant'`, [charId], db);
    const ctx = await charContext(db, charId);
    return perform(db, ctx, 'chant', 1, { sutra: ses.ref }, { skipZone: true });
  });
}

// ---------- Hoa đăng ----------
export async function releaseLantern(charId: number, wish: string) {
  return tx(async (db) => {
    const ctx = await charContext(db, charId);
    const out = await perform(db, ctx, 'lantern', 1, { len: wish.length });
    const row = await one<any>(`INSERT INTO lanterns (character_id, server_id, temple_id, wish) VALUES ($1,$2,$3,$4) RETURNING id, created_at`,
      [charId, ctx.serverId, ctx.templeId, wish], db);
    return { ...out, lantern: { id: row.id, wish, createdAt: row.created_at }, serverId: ctx.serverId, templeId: ctx.templeId };
  });
}

// ---------- Khám phá: dấu mộc hành hương ----------
export async function stampZone(charId: number, templeId: number, zoneCode: string, x: number, z: number) {
  return tx(async (db) => {
    const t = await one<any>('SELECT zones FROM temples WHERE id=$1', [templeId], db);
    const zn = (t?.zones as Zone[] | undefined)?.find((zz) => zz.code === zoneCode);
    if (!zn || (x - zn.x) ** 2 + (z - zn.z) ** 2 > zn.r * zn.r) return null;
    const ins = await one('INSERT INTO pilgrimage_progress (character_id, temple_id, zone_code) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING 1',
      [charId, templeId, zoneCode], db);
    if (!ins) return null;
    const ctx = await charContext(db, charId);
    const out = await perform(db, ctx, 'explore', 1, { temple: templeId, zone: zoneCode }, { skipZone: true, skipInterval: true });
    out.message = `Nhận dấu mộc "${zn.name}". ` + out.message;
    return out;
  });
}

// ---------- Quà đăng nhập & ngày hoạt động ----------
export async function dailyCheckIn(charId: number, gift: Record<string, number>) {
  return tx(async (db) => {
    const today = vnDay();
    const c = await one<any>('SELECT last_daily_gift FROM characters WHERE id=$1 FOR UPDATE', [charId], db);
    if (c.last_daily_gift === today) return null;
    await q('UPDATE characters SET last_daily_gift=$2 WHERE id=$1', [charId, today], db);
    await q('UPDATE character_stats SET days_active = days_active + 1, last_active_date=$2 WHERE character_id=$1', [charId, today], db);
    for (const [code, qty] of Object.entries(gift)) await addItem(db, charId, code, qty, 'daily_gift', today);
    await bumpMetric(db, charId, 'active_day', 1);
    const ach = await checkAchievements(db, charId);
    return { gift, achievements: ach };
  });
}
