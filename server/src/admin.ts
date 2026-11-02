import { Router } from 'express';
import { requireAuth, requireRole, ROLE_RANK, type Role } from './auth.ts';
import { one, q, tx } from './db.ts';
import { bad, forbidden, notFound } from './errors.ts';
import { grant, addItem, invalidateCaches } from './economy.ts';
import { players, sendToChar, serverOnline } from './presence.ts';
import { clearZoneCache } from './realtime.ts';
import { vnDay } from './time.ts';

async function log(adminId: number, action: string, target: string | null, detail: unknown) {
  await q('INSERT INTO admin_logs (admin_id, action, target, detail) VALUES ($1,$2,$3,$4)', [adminId, action, target, JSON.stringify(detail ?? {})]);
}

function pick<T extends Record<string, unknown>>(body: any, fields: Record<string, 'int' | 'num' | 'str' | 'bool' | 'json' | 'date' | 'strnull'>): Partial<T> {
  const out: any = {};
  for (const [k, type] of Object.entries(fields)) {
    if (!(k in body)) continue;
    const v = body[k];
    if (type === 'int') { if (v === null || v === '') { out[k] = null; continue; } const n = Number(v); if (!Number.isInteger(n)) throw bad(`${k} phải là số nguyên.`); out[k] = n; }
    else if (type === 'num') { const n = Number(v); if (!Number.isFinite(n)) throw bad(`${k} phải là số.`); out[k] = n; }
    else if (type === 'bool') out[k] = !!v;
    else if (type === 'json') out[k] = JSON.stringify(typeof v === 'string' ? JSON.parse(v) : v);
    else if (type === 'date') out[k] = v ? new Date(v).toISOString() : null;
    else if (type === 'strnull') out[k] = v === '' || v == null ? null : String(v);
    else out[k] = String(v);
  }
  return out;
}

async function update(table: string, id: number, data: Record<string, unknown>) {
  const keys = Object.keys(data);
  if (!keys.length) throw bad('Không có trường nào để cập nhật.');
  const sets = keys.map((k, i) => `${k}=$${i + 2}`).join(', ');
  const r = await one(`UPDATE ${table} SET ${sets} WHERE id=$1 RETURNING *`, [id, ...keys.map((k) => data[k])]);
  if (!r) throw notFound();
  return r;
}

export function adminRouter() {
  const r = Router();
  r.use(requireAuth, requireRole('support'));

  r.get('/me', (req, res) => res.json({ user: req.user }));

  // ----- Tổng quan -----
  r.get('/stats', async (_req, res) => {
    const today = vnDay();
    const [users, chars, actsToday, activeToday, openReports, perServer, byActivity] = await Promise.all([
      one<any>('SELECT count(*)::int n FROM users'),
      one<any>('SELECT count(*)::int n FROM characters'),
      one<any>('SELECT count(*)::int n FROM activity_history WHERE day=$1', [today]),
      one<any>('SELECT count(DISTINCT character_id)::int n FROM activity_history WHERE day=$1', [today]),
      one<any>(`SELECT count(*)::int n FROM reports WHERE status='open'`),
      q<any>('SELECT id, name FROM servers ORDER BY id'),
      q<any>(`SELECT a.name, count(*)::int n FROM activity_history h JOIN activities a ON a.code=h.activity_code WHERE day=$1 GROUP BY a.name ORDER BY n DESC`, [today]),
    ]);
    res.json({
      users: users.n, characters: chars.n, activitiesToday: actsToday.n, activeToday: activeToday.n, openReports: openReports.n,
      online: players.size, servers: perServer.map((s) => ({ ...s, online: serverOnline(s.id) })), byActivity,
    });
  });

  r.get('/online', async (_req, res) => {
    res.json([...players.values()].map((p) => ({ id: p.charId, name: p.name, level: p.level, serverId: p.serverId, templeId: p.templeId, x: +p.x.toFixed(1), z: +p.z.toFixed(1), anim: p.anim })));
  });

  // ----- Người chơi -----
  r.get('/players', async (req, res) => {
    const s = String(req.query.q || '').trim();
    const rows = await q<any>(`
      SELECT u.id AS user_id, u.username, u.role, u.is_banned, u.ban_reason, u.muted_until, u.created_at, u.last_login_at,
             c.id AS char_id, c.dharma_name, c.server_id, st.level,
             (SELECT balance FROM currencies WHERE character_id=c.id AND code='merit') AS merit,
             (SELECT balance FROM currencies WHERE character_id=c.id AND code='sen') AS sen,
             (SELECT balance FROM currencies WHERE character_id=c.id AND code='ngoc') AS ngoc
      FROM users u LEFT JOIN characters c ON c.user_id=u.id LEFT JOIN character_stats st ON st.character_id=c.id
      WHERE ($1 = '' OR u.username ILIKE $2 OR c.dharma_name ILIKE $2)
      ORDER BY u.id DESC LIMIT 100`, [s, '%' + s + '%']);
    res.json(rows.map((x) => ({ ...x, online: x.char_id ? players.has(x.char_id) : false })));
  });

  r.get('/characters/:id', async (req, res) => {
    const id = Number(req.params.id);
    const c = await one<any>(`SELECT c.*, u.username, st.* FROM characters c JOIN users u ON u.id=c.user_id JOIN character_stats st ON st.character_id=c.id WHERE c.id=$1`, [id]);
    if (!c) throw notFound();
    const [wallet, inv, txs, acts] = await Promise.all([
      q('SELECT code, balance FROM currencies WHERE character_id=$1', [id]),
      q('SELECT i.code, i.name, inv.quantity FROM inventory inv JOIN items i ON i.id=inv.item_id WHERE character_id=$1', [id]),
      q(`SELECT t.*, i.name AS item_name FROM transactions t LEFT JOIN items i ON i.id=t.item_id WHERE character_id=$1 ORDER BY t.id DESC LIMIT 50`, [id]),
      q(`SELECT activity_code, amount, rewarded, merit, created_at FROM activity_history WHERE character_id=$1 ORDER BY id DESC LIMIT 50`, [id]),
    ]);
    res.json({ character: c, wallet, inventory: inv, transactions: txs, activities: acts });
  });

  r.post('/users/:id/ban', requireRole('moderator'), async (req, res) => {
    const id = Number(req.params.id);
    const ban = !!req.body.ban;
    const reason = String(req.body.reason || '').slice(0, 200) || null;
    const target = await one<any>('SELECT role FROM users WHERE id=$1', [id]);
    if (!target) throw notFound();
    if (ROLE_RANK[target.role as Role] >= ROLE_RANK[req.user!.role]) throw forbidden('Không thể khóa tài khoản có quyền ngang hoặc cao hơn.');
    await q('UPDATE users SET is_banned=$2, ban_reason=$3, token_version=token_version+$4 WHERE id=$1', [id, ban, ban ? reason : null, ban ? 1 : 0]);
    if (ban) for (const p of players.values()) if (p.userId === id) { sendToChar(p.charId, { t: 'kicked', reason: 'Tài khoản đã bị khóa.' }); p.ws.close(); }
    await log(req.user!.id, ban ? 'ban' : 'unban', `user:${id}`, { reason });
    res.json({ ok: true });
  });

  r.post('/users/:id/mute', requireRole('moderator'), async (req, res) => {
    const id = Number(req.params.id);
    const minutes = Math.max(0, Math.min(60 * 24 * 30, Number(req.body.minutes || 0)));
    await q(`UPDATE users SET muted_until = CASE WHEN $2::int > 0 THEN now() + ($2::int * interval '1 minute') ELSE NULL END WHERE id=$1`, [id, minutes]);
    await log(req.user!.id, minutes ? 'mute' : 'unmute', `user:${id}`, { minutes });
    res.json({ ok: true });
  });

  r.post('/users/:id/role', requireRole('super_admin'), async (req, res) => {
    const id = Number(req.params.id);
    const role = String(req.body.role);
    if (!(role in ROLE_RANK)) throw bad('Vai trò không hợp lệ.');
    if (id === req.user!.id) throw bad('Không thể tự đổi vai trò của mình.');
    await q('UPDATE users SET role=$2, token_version=token_version+1 WHERE id=$1', [id, role]);
    await log(req.user!.id, 'set_role', `user:${id}`, { role });
    res.json({ ok: true });
  });

  r.post('/characters/:id/adjust', requireRole('game_admin'), async (req, res) => {
    const id = Number(req.params.id);
    const reason = String(req.body.reason || '').trim();
    if (!reason) throw bad('Cần ghi lý do điều chỉnh.');
    const currency = String(req.body.currency || '');
    const delta = Math.trunc(Number(req.body.delta));
    if (!delta) throw bad('Số lượng điều chỉnh phải khác 0.');
    await tx(async (db) => {
      const ref = `admin:${req.user!.id}:${reason.slice(0, 60)}`;
      if (currency === 'item') await addItem(db, id, String(req.body.itemCode), delta, 'admin', ref);
      else if (['sen', 'ngoc', 'merit', 'exp'].includes(currency)) await grant(db, id, { [currency]: delta }, 'admin', ref);
      else throw bad('Loại tài nguyên không hợp lệ.');
    });
    await log(req.user!.id, 'adjust', `char:${id}`, { currency, delta, itemCode: req.body.itemCode, reason });
    sendToChar(id, { t: 'refresh' });
    res.json({ ok: true });
  });

  // ----- Cấu hình game (game_admin) -----
  const crud = (path: string, table: string, fields: Parameters<typeof pick>[1], order = 'id', after?: () => void) => {
    r.get(`/${path}`, async (_req, res) => res.json(await q(`SELECT * FROM ${table} ORDER BY ${order}`)));
    r.patch(`/${path}/:id`, requireRole('game_admin'), async (req, res) => {
      const data = pick(req.body, fields);
      const row = await update(table, Number(req.params.id), data);
      await log(req.user!.id, `update_${table}`, `${table}:${req.params.id}`, data);
      after?.();
      res.json(row);
    });
    r.post(`/${path}`, requireRole('game_admin'), async (req, res) => {
      const data = pick(req.body, fields) as Record<string, unknown>;
      const keys = Object.keys(data);
      if (!keys.length) throw bad('Thiếu dữ liệu.');
      const row = await one(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING *`, keys.map((k) => data[k]))
        .catch((e) => { throw bad(e.message); });
      await log(req.user!.id, `create_${table}`, `${table}:${(row as any).id}`, data);
      after?.();
      res.json(row);
    });
  };
  crud('servers', 'servers', { code: 'str', name: 'str', capacity: 'int', is_open: 'bool' });
  crud('missions', 'missions', {
    code: 'str', name: 'str', description: 'str', period: 'str', reset: 'str', metric: 'str', target: 'int',
    reward_merit: 'int', reward_exp: 'int', reward_sen: 'int', reward_ngoc: 'int', reward_item: 'strnull', reward_item_qty: 'int',
    min_level: 'int', starts_at: 'date', ends_at: 'date', sort: 'int', is_active: 'bool',
  }, 'sort, id');
  crud('items', 'items', {
    code: 'str', name: 'str', category: 'str', description: 'str', price_sen: 'int', price_ngoc: 'int', data: 'json',
    stackable: 'bool', giftable: 'bool', min_level: 'int', is_active: 'bool',
  });
  crud('events', 'game_events', { name: 'str', description: 'str', merit_multiplier: 'num', starts_at: 'date', ends_at: 'date', is_active: 'bool' }, 'starts_at DESC');
  crud('temples', 'temples', {
    code: 'str', name: 'str', region: 'str', description: 'str', history: 'str', min_level: 'int', map_x: 'num', map_y: 'num', zones: 'json', is_active: 'bool',
  }, 'id', clearZoneCache);

  r.get('/activities', async (_req, res) => res.json(await q('SELECT * FROM activities ORDER BY code')));
  r.patch('/activities/:code', requireRole('game_admin'), async (req, res) => {
    const data = pick(req.body, { merit: 'int', exp: 'int', sen: 'int', min_interval_ms: 'int', daily_cap: 'int', is_active: 'bool' }) as Record<string, unknown>;
    const keys = Object.keys(data);
    if (!keys.length) throw bad('Không có trường nào để cập nhật.');
    const row = await one(`UPDATE activities SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(', ')} WHERE code=$1 RETURNING *`, [req.params.code, ...keys.map((k) => data[k])]);
    if (!row) throw notFound();
    invalidateCaches();
    await log(req.user!.id, 'update_activity', `activity:${req.params.code}`, data);
    res.json(row);
  });

  // ----- Giao dịch, báo cáo, tin nhắn, nhật ký -----
  r.get('/transactions', async (req, res) => {
    const cid = req.query.char ? Number(req.query.char) : null;
    res.json(await q(`SELECT t.*, c.dharma_name, i.name AS item_name FROM transactions t JOIN characters c ON c.id=t.character_id
                      LEFT JOIN items i ON i.id=t.item_id WHERE ($1::bigint IS NULL OR t.character_id=$1) ORDER BY t.id DESC LIMIT 200`, [cid]));
  });

  r.get('/reports', async (req, res) => {
    const status = String(req.query.status || 'open');
    res.json(await q(`SELECT r.*, rc.dharma_name AS reporter, tc.dharma_name AS target, tc.user_id AS target_user_id, m.body AS message
                      FROM reports r JOIN characters rc ON rc.id=r.reporter_id JOIN characters tc ON tc.id=r.target_id
                      LEFT JOIN messages m ON m.id=r.message_id WHERE ($1='all' OR r.status=$1) ORDER BY r.id DESC LIMIT 200`, [status]));
  });
  r.post('/reports/:id', requireRole('moderator'), async (req, res) => {
    const status = String(req.body.status);
    if (!['resolved', 'dismissed', 'open'].includes(status)) throw bad('Trạng thái không hợp lệ.');
    await q('UPDATE reports SET status=$2, handled_by=$3 WHERE id=$1', [Number(req.params.id), status, req.user!.id]);
    if (req.body.hideMessage) {
      const rep = await one<any>('SELECT message_id FROM reports WHERE id=$1', [Number(req.params.id)]);
      if (rep?.message_id) await q('UPDATE messages SET is_hidden=TRUE WHERE id=$1', [rep.message_id]);
    }
    await log(req.user!.id, 'report_' + status, `report:${req.params.id}`, { hideMessage: !!req.body.hideMessage });
    res.json({ ok: true });
  });

  r.get('/messages', requireRole('moderator'), async (req, res) => {
    const cid = req.query.char ? Number(req.query.char) : null;
    res.json(await q(`SELECT m.*, c.dharma_name AS sender FROM messages m JOIN characters c ON c.id=m.sender_id
                      WHERE ($1::bigint IS NULL OR m.sender_id=$1) ORDER BY m.id DESC LIMIT 200`, [cid]));
  });

  r.get('/logs', requireRole('game_admin'), async (_req, res) => {
    res.json(await q(`SELECT l.*, u.username FROM admin_logs l JOIN users u ON u.id=l.admin_id ORDER BY l.id DESC LIMIT 300`));
  });

  return r;
}
