import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { verifyToken } from './auth.ts';
import { one, q } from './db.ts';
import { players, roomPlayers, broadcastRoom, send, sendToChar, serverOnline, type Player } from './presence.ts';
import { lookOf, recentLanterns, isBlockedEither } from './game.ts';
import { stampZone, bumpMetric } from './economy.ts';
import { tx } from './db.ts';
import { MAX_SPEED, WORLD_BOUND, filterText, zoneAt, type Zone } from '../../shared/content.ts';

const TICK_MS = 100;
const SAVE_MS = 10_000;
const ANIMS = new Set(['idle', 'walk', 'run', 'prostrate', 'meditate', 'chant', 'bead', 'offer', 'bell']);

const templeZones = new Map<number, Zone[]>();
async function zonesOf(templeId: number): Promise<Zone[]> {
  let z = templeZones.get(templeId);
  if (!z) {
    const t = await one<any>('SELECT zones FROM temples WHERE id=$1', [templeId]);
    z = (t?.zones || []) as Zone[];
    templeZones.set(templeId, z);
  }
  return z;
}
export function clearZoneCache() { templeZones.clear(); }

function publicView(p: Player) {
  return { id: p.charId, name: p.name, level: p.level, title: p.title, look: p.look, x: p.x, z: p.z, ry: p.ry, anim: p.anim };
}

async function savePos(p: Player) {
  await q('UPDATE characters SET pos_x=$2, pos_z=$3, rot_y=$4 WHERE id=$1', [p.charId, p.x, p.z, p.ry]).catch(() => {});
}

export function attachRealtime(server: Server) {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });

  wss.on('connection', (ws: WebSocket, req) => {
    let me: Player | null = null;
    let alive = true;
    ws.on('pong', () => { alive = true; });
    const hb = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
    }, 20_000);

    const url = new URL(req.url || '', 'http://x');
    const token = url.searchParams.get('token') || '';
    const charId = Number(url.searchParams.get('char'));

    (async () => {
      const user = await verifyToken(token);
      const c = await one<any>(`SELECT c.*, s.level, u.muted_until FROM characters c JOIN character_stats s ON s.character_id=c.id
                                JOIN users u ON u.id=c.user_id WHERE c.id=$1 AND c.user_id=$2`, [charId, user.id]);
      if (!c) throw new Error('Nhân vật không hợp lệ.');
      const old = players.get(c.id);
      if (old) { send(old, { t: 'kicked', reason: 'Tài khoản vừa đăng nhập ở nơi khác.' }); old.ws.close(); }
      const stamps = await q<any>('SELECT zone_code FROM pilgrimage_progress WHERE character_id=$1 AND temple_id=$2', [c.id, c.temple_id]);
      const blocked = await q<any>(`SELECT friend_id FROM friends WHERE character_id=$1 AND status='blocked'`, [c.id]);
      me = {
        charId: c.id, userId: user.id, serverId: c.server_id, templeId: c.temple_id, name: c.dharma_name, level: c.level,
        title: c.title_code, look: await lookOf(c), x: c.pos_x, z: c.pos_z, ry: c.rot_y, anim: 'idle',
        lastMoveAt: Date.now(), dirty: true, ws, chatTimes: [], lastChat: '',
        stamped: new Set(stamps.map((s) => s.zone_code)), blocked: new Set(blocked.map((b) => b.friend_id)),
      };
      players.set(c.id, me);
      const others = roomPlayers(me.serverId, me.templeId).filter((p) => p.charId !== me!.charId);
      send(me, {
        t: 'welcome', you: publicView(me), players: others.map(publicView),
        lanterns: await recentLanterns(me.serverId, me.templeId), online: serverOnline(me.serverId),
      });
      broadcastRoom(me.serverId, me.templeId, { t: 'join', p: publicView(me) }, me.charId);
      checkZone(me);
    })().catch((e) => {
      ws.send(JSON.stringify({ t: 'error', text: e.message || 'Không thể kết nối.' }));
      ws.close();
    });

    ws.on('message', (raw) => {
      if (!me) return;
      let m: any;
      try { m = JSON.parse(String(raw)); } catch { return; }
      handle(me, m).catch((e) => send(me!, { t: 'toast', text: e.message || 'Có lỗi xảy ra.' }));
    });

    ws.on('close', () => {
      clearInterval(hb);
      if (!me) return;
      if (players.get(me.charId) === me) {
        players.delete(me.charId);
        broadcastRoom(me.serverId, me.templeId, { t: 'leave', id: me.charId });
        savePos(me);
      }
    });
  });

  // Gửi trạng thái theo phòng 10 lần/giây (chỉ những ai thay đổi)
  setInterval(() => {
    const rooms = new Map<string, Player[]>();
    for (const p of players.values()) {
      const k = `${p.serverId}:${p.templeId}`;
      if (!rooms.has(k)) rooms.set(k, []);
      rooms.get(k)!.push(p);
    }
    for (const list of rooms.values()) {
      const changed = list.filter((p) => p.dirty);
      if (!changed.length) continue;
      const msg = JSON.stringify({ t: 's', p: changed.map((p) => [p.charId, +p.x.toFixed(2), +p.z.toFixed(2), +p.ry.toFixed(2), p.anim]) });
      for (const p of changed) p.dirty = false;
      for (const p of list) if (p.ws.readyState === 1) p.ws.send(msg);
    }
  }, TICK_MS);

  setInterval(() => { for (const p of players.values()) savePos(p); }, SAVE_MS);

  // Số người online theo máy chủ
  setInterval(() => {
    for (const p of players.values()) send(p, { t: 'online', n: serverOnline(p.serverId) });
  }, 15_000);

  return wss;
}

async function checkZone(p: Player) {
  const zones = await zonesOf(p.templeId);
  const zn = zoneAt(zones, p.x, p.z);
  if (!zn || p.stamped.has(zn.code)) return;
  p.stamped.add(zn.code);
  const out = await stampZone(p.charId, p.templeId, zn.code, p.x, p.z);
  if (out) send(p, { t: 'stamp', zone: zn.code, result: out });
}

async function handle(p: Player, m: any) {
  switch (m.t) {
    case 'move': {
      const x = Number(m.x), z = Number(m.z), ry = Number(m.ry);
      if (![x, z, ry].every(Number.isFinite)) return;
      const now = Date.now();
      const dt = Math.min(2, Math.max(0.05, (now - p.lastMoveAt) / 1000));
      const dist = Math.hypot(x - p.x, z - p.z);
      p.lastMoveAt = now;
      // Chống dịch chuyển: vượt tốc độ cho phép -> kéo về vị trí hợp lệ
      if (dist > MAX_SPEED * dt * 1.5 + 1.5 || Math.abs(x) > WORLD_BOUND || Math.abs(z) > WORLD_BOUND) {
        send(p, { t: 'correct', x: p.x, z: p.z });
        return;
      }
      p.x = x; p.z = z; p.ry = ry;
      if (typeof m.a === 'string' && ANIMS.has(m.a)) p.anim = m.a;
      p.dirty = true;
      checkZone(p).catch(() => {});
      return;
    }
    case 'anim': {
      if (typeof m.a === 'string' && ANIMS.has(m.a)) { p.anim = m.a; p.dirty = true; }
      return;
    }
    case 'chat': return chat(p, m);
    case 'ping': return send(p, { t: 'pong', at: m.at });
  }
}

async function chat(p: Player, m: any) {
  const raw = String(m.body || '').replace(/\s+/g, ' ').trim();
  if (!raw) return;
  if (raw.length > 200) return send(p, { t: 'toast', text: 'Tin nhắn tối đa 200 ký tự.' });
  const u = await one<any>('SELECT muted_until FROM users WHERE id=$1', [p.userId]);
  if (u?.muted_until && new Date(u.muted_until) > new Date()) {
    return send(p, { t: 'toast', text: `Bạn đang bị tạm cấm chat tới ${new Date(u.muted_until).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}.` });
  }
  const now = Date.now();
  p.chatTimes = p.chatTimes.filter((t) => now - t < 10_000);
  if (p.chatTimes.length >= 5) return send(p, { t: 'toast', text: 'Bạn gửi tin quá nhanh. Hãy đợi vài giây.' });
  if (raw === p.lastChat) return send(p, { t: 'toast', text: 'Không gửi lặp lại cùng một tin nhắn.' });
  p.chatTimes.push(now);
  p.lastChat = raw;
  const { text } = filterText(raw);
  const to = m.to ? Number(m.to) : null;

  if (to) {
    const target = await one<any>('SELECT id, dharma_name, server_id FROM characters WHERE id=$1', [to]);
    if (!target || target.server_id !== p.serverId) return send(p, { t: 'toast', text: 'Không tìm thấy người nhận trên máy chủ này.' });
    if (await isBlockedEither(p.charId, to)) return send(p, { t: 'toast', text: 'Không thể nhắn tin cho người chơi này.' });
    const row = await one<any>('INSERT INTO messages (server_id, temple_id, sender_id, recipient_id, body) VALUES ($1,$2,$3,$4,$5) RETURNING id, created_at',
      [p.serverId, p.templeId, p.charId, to, text]);
    const msg = { t: 'pm', id: row.id, from: { id: p.charId, name: p.name }, to: { id: to, name: target.dharma_name }, body: text, at: row.created_at };
    sendToChar(to, msg);
    send(p, msg);
    return;
  }
  const row = await one<any>('INSERT INTO messages (server_id, temple_id, sender_id, body) VALUES ($1,$2,$3,$4) RETURNING id, created_at',
    [p.serverId, p.templeId, p.charId, text]);
  const msg = { t: 'chat', id: row.id, from: { id: p.charId, name: p.name, title: p.title }, body: text, at: row.created_at };
  // Kênh chung: toàn máy chủ, bỏ qua người đã chặn người gửi
  for (const o of players.values()) {
    if (o.serverId === p.serverId && !o.blocked.has(p.charId)) send(o, msg);
  }
  await tx((db) => bumpMetric(db, p.charId, 'chat', 1));
}
