// Kiểm thử tích hợp trên PostgreSQL thật (database chua_test).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres@localhost:5432/chua_test';
process.env.ADMIN_USERNAME = 'root';
process.env.ADMIN_PASSWORD = 'root-pass-123';

const { pool } = await import('../src/db.ts');
const { migrate } = await import('../src/migrate.ts');
const { createApp } = await import('../src/app.ts');
const { attachRealtime } = await import('../src/realtime.ts');
const { setMailer } = await import('../src/mailer.ts');
const outbox: { to: string; subject: string; text: string }[] = [];
setMailer(async (m) => { outbox.push(m); });
const http = await import('node:http');

let base = '';
let server: import('node:http').Server;

async function api(path: string, opts: { method?: string; body?: unknown; token?: string } = {}) {
  const r = await fetch(base + '/api' + path, {
    method: opts.method || (opts.body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...(opts.token ? { authorization: 'Bearer ' + opts.token } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data: any = await r.json();
  return { status: r.status, data };
}

let n = 0;
async function newPlayer(name: string) {
  const username = `u${Date.now().toString(36)}${n++}`;
  const reg = await api('/auth/register', { body: { username, email: `${username}@example.com`, password: 'matkhau123' } });
  assert.equal(reg.status, 200, JSON.stringify(reg.data));
  const servers = (await api('/servers')).data;
  const ch = await api('/characters', { token: reg.data.token, body: { serverId: servers[0].id, dharmaName: name, gender: 'nu', hair: 'búi', skin: '#e2b58e' } });
  assert.equal(ch.status, 200, JSON.stringify(ch.data));
  return { token: reg.data.token as string, cid: ch.data.id as number, username, email: `${username}@example.com`, userId: reg.data.user.id as number };
}
const at = (cid: number, x: number, z: number) => pool.query('UPDATE characters SET pos_x=$2, pos_z=$3 WHERE id=$1', [cid, x, z]);
const wallet = async (cid: number) => Object.fromEntries((await pool.query('SELECT code, balance FROM currencies WHERE character_id=$1', [cid])).rows.map((r) => [r.code, Number(r.balance)]));

function connect(token: string, cid: number): Promise<{ ws: WebSocket; msgs: any[]; wait: (pred: (m: any) => boolean, ms?: number) => Promise<any> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(base.replace('http', 'ws') + `/ws?token=${token}&char=${cid}`);
    const msgs: any[] = [];
    const waiters: { pred: (m: any) => boolean; res: (m: any) => void }[] = [];
    ws.on('message', (d) => {
      const m = JSON.parse(String(d));
      msgs.push(m);
      for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.res(m); }
    });
    const wait = (pred: (m: any) => boolean, ms = 3000) => new Promise<any>((res, rej) => {
      const found = msgs.find(pred);
      if (found) return res(found);
      const t = setTimeout(() => rej(new Error('Hết thời gian chờ tin nhắn WS; đã nhận: ' + msgs.map((x) => x.t).join(','))), ms);
      waiters.push({ pred, res: (m) => { clearTimeout(t); res(m); } });
    });
    ws.on('open', () => resolve({ ws, msgs, wait }));
    ws.on('error', reject);
  });
}

/** Ngồi/quỳ trên một bồ đoàn qua kết nối realtime (dấu mộc được đánh sẵn để không lẫn phần thưởng) */
async function seat(token: string, cid: number, matId: string, kind: 'sit' | 'kneel') {
  const { MATS } = await import('../../shared/content.ts');
  const mat = MATS.find((m) => m.id === matId)!;
  await at(cid, mat.x, mat.z + 0.5);
  await pool.query(`INSERT INTO pilgrimage_progress (character_id, temple_id, zone_code)
                    SELECT $1, t.id, z->>'code' FROM temples t, jsonb_array_elements(t.zones) z WHERE t.code='tam_an' ON CONFLICT DO NOTHING`, [cid]);
  const c = await connect(token, cid);
  await c.wait((m) => m.t === 'welcome');
  c.ws.send(JSON.stringify({ t: 'pose', kind, mat: matId }));
  const ok = await c.wait((m) => m.t === 'pose_ok' && m.kind === kind);
  assert.equal(ok.mat, matId);
  return c;
}

before(async () => {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(false);
  server = http.createServer(createApp());
  attachRealtime(server);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  server.closeAllConnections?.();
  await new Promise((r) => server.close(r));
  await pool.end();
  setTimeout(() => process.exit(0), 50).unref();
});

test('đăng ký cần email hợp lệ, không trùng', async () => {
  const u = 'mail' + Date.now().toString(36);
  assert.equal((await api('/auth/register', { body: { username: u, password: 'matkhau123' } })).data.code, 'bad_email');
  assert.equal((await api('/auth/register', { body: { username: u, email: 'abc', password: 'matkhau123' } })).data.code, 'bad_email');
  assert.equal((await api('/auth/register', { body: { username: u, email: `${u}@example.com`, password: 'matkhau123' } })).status, 200);
  const dup = await api('/auth/register', { body: { username: u + 'x', email: `${u.toUpperCase()}@EXAMPLE.com`, password: 'matkhau123' } });
  assert.equal(dup.data.code, 'email_taken');
});

test('quên mật khẩu: gửi mã qua email, mã đúng mới đặt lại được, dùng một lần, thu hồi phiên cũ', async () => {
  const p = await newPlayer('Minh Tâm');
  outbox.length = 0;
  const generic = (await api('/auth/forgot', { body: { email: 'khong-ton-tai@example.com' } })).data.message;
  assert.equal(outbox.length, 0, 'email không tồn tại thì không gửi thư');
  const f = await api('/auth/forgot', { body: { email: p.email.toUpperCase() } });
  assert.equal(f.status, 200);
  assert.equal(f.data.message, generic, 'thông báo giống hệt nhau để không lộ email nào đã đăng ký');
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].to, p.email);
  const code = outbox[0].text.match(/\b(\d{6})\b/)![1];
  // Yêu cầu lại ngay lập tức: không gửi thêm (chống spam hộp thư)
  await api('/auth/forgot', { body: { email: p.email } });
  assert.equal(outbox.length, 1);
  const wrongCode = code === '000000' ? '111111' : '000000';
  assert.equal((await api('/auth/reset', { body: { email: p.email, code: wrongCode, newPassword: 'matkhaumoi1' } })).data.code, 'bad_code');
  const ok = await api('/auth/reset', { body: { email: p.email, code, newPassword: 'matkhaumoi1' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.ok(ok.data.token);
  assert.equal((await api('/me', { token: p.token })).status, 401, 'phiên cũ bị thu hồi');
  assert.equal((await api('/auth/login', { body: { username: p.username, password: 'matkhau123' } })).status, 401);
  assert.equal((await api('/auth/login', { body: { username: p.username, password: 'matkhaumoi1' } })).status, 200);
  assert.equal((await api('/auth/reset', { body: { email: p.email, code, newPassword: 'matkhaumoi2' } })).data.code, 'bad_code', 'mã chỉ dùng được một lần');
});

test('quên mật khẩu: mã hết hạn hoặc sai quá 5 lần thì không dùng được', async () => {
  const p = await newPlayer('Quên Mật');
  outbox.length = 0;
  await api('/auth/forgot', { body: { email: p.email } });
  const code = outbox[0].text.match(/\b(\d{6})\b/)![1];
  const wrong = code === '000000' ? '111111' : '000000';
  await pool.query(`UPDATE password_resets SET attempts=5 WHERE user_id=$1`, [p.userId]);
  assert.equal((await api('/auth/reset', { body: { email: p.email, code, newPassword: 'matkhaumoi1' } })).data.code, 'bad_code', 'đã sai 5 lần thì khoá mã');
  await pool.query(`UPDATE password_resets SET attempts=0, expires_at=now() - interval '1 minute' WHERE user_id=$1`, [p.userId]);
  assert.equal((await api('/auth/reset', { body: { email: p.email, code, newPassword: 'matkhaumoi1' } })).data.code, 'bad_code', 'mã hết hạn');
  void wrong;
  // Đổi email khôi phục cần đúng mật khẩu
  assert.equal((await api('/me/email', { token: p.token, body: { email: 'moi@example.com', password: 'sai-mat-khau' } })).status, 401);
  assert.equal((await api('/me/email', { token: p.token, body: { email: 'moi' + p.username + '@example.com', password: 'matkhau123' } })).status, 200);
  assert.equal((await api('/me', { token: p.token })).data.user.email, 'moi' + p.username + '@example.com');
});

test('pháp danh trùng và không hợp lệ bị từ chối', async () => {
  const a = await newPlayer('Diệu Hạnh');
  const reg = await api('/auth/register', { body: { username: 'trungten' + Date.now().toString(36), email: 'trungten' + Date.now().toString(36) + '@example.com', password: 'matkhau123' } });
  const dup = await api('/characters', { token: reg.data.token, body: { serverId: 1, dharmaName: 'diệu hạnh', gender: 'nu', hair: 'búi', skin: '#e2b58e' } });
  assert.equal(dup.status, 400);
  const badName = await api('/characters', { token: reg.data.token, body: { serverId: 1, dharmaName: 'abc123', gender: 'nu', hair: 'búi', skin: '#e2b58e' } });
  assert.equal(badName.status, 400);
  assert.ok(a.cid);
});

test('vào game nhận quà đăng nhập một lần mỗi ngày', async () => {
  const p = await newPlayer('Quảng Đức');
  const e1 = await api(`/c/${p.cid}/enter`, { token: p.token, body: {} });
  assert.deepEqual(e1.data.dailyGift.gift, { huong: 3, nen: 2, hoa: 2, hoa_dang: 1 });
  assert.equal(e1.data.inventory.find((i: any) => i.code === 'huong').quantity, 3);
  const e2 = await api(`/c/${p.cid}/enter`, { token: p.token, body: {} });
  assert.equal(e2.data.dailyGift, null);
  assert.equal(e2.data.wallet.sen, 50);
});

test('không dùng được nhân vật của người khác', async () => {
  const a = await newPlayer('An Lạc');
  const b = await newPlayer('Bảo Châu');
  assert.equal((await api(`/c/${a.cid}/state`, { token: b.token })).status, 403);
});

test('lạy Phật: phải ở chánh điện, có nhịp tối thiểu, cộng thưởng do server tính', async () => {
  const p = await newPlayer('Tâm Thiện');
  await api(`/c/${p.cid}/enter`, { token: p.token, body: {} });
  // Chưa quỳ trên bồ đoàn: bị từ chối, dù đứng trong Chánh điện
  await at(p.cid, 0, -12);
  const wrong = await api(`/c/${p.cid}/act/prostrate`, { token: p.token, body: {} });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.data.code, 'need_pose');
  const c = await seat(p.token, p.cid, 'h13', 'kneel');
  const ok = await api(`/c/${p.cid}/act/prostrate`, { token: p.token, body: {} });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.rewarded, true);
  assert.equal(ok.data.gains.merit, 1);
  const fast = await api(`/c/${p.cid}/act/prostrate`, { token: p.token, body: {} });
  assert.equal(fast.status, 429);
  assert.equal((await wallet(p.cid)).merit, 1);
  // client không thể tự gửi số công đức
  const hack = await api(`/c/${p.cid}/act/prostrate`, { token: p.token, body: { merit: 99999 } });
  assert.equal(hack.status, 429);
  assert.equal((await wallet(p.cid)).merit, 1);
  c.ws.close();
});

test('bồ đoàn: ngồi không lạy được, bồ đoàn có người thì không ngồi được, đi khỏi thì tự đứng dậy', async () => {
  const a = await newPlayer('Ngồi Trước');
  const b = await newPlayer('Đến Sau');
  const ca = await seat(a.token, a.cid, 'h03', 'sit');
  let cb: Awaited<ReturnType<typeof connect>> | null = null;
  try {
  await pool.query(`DELETE FROM activity_history WHERE character_id=$1`, [a.cid]);
  const sitPro = await api(`/c/${a.cid}/act/prostrate`, { token: a.token, body: {} });
  assert.equal(sitPro.data.code, 'need_pose', 'ngồi thì không lạy được, phải quỳ');
  // B tới đúng bồ đoàn đó
  await at(b.cid, 0, -15);
  cb = await connect(b.token, b.cid);
  await cb.wait((m) => m.t === 'welcome');
  cb.ws.send(JSON.stringify({ t: 'pose', kind: 'kneel', mat: 'h03' }));
  const busy = await cb.wait((m) => m.t === 'toast' && m.text.includes('đã có người'));
  assert.ok(busy);
  // Bồ đoàn ở quá xa
  cb.ws.send(JSON.stringify({ t: 'pose', kind: 'kneel', mat: 'm0' }));
  assert.ok(await cb.wait((m) => m.t === 'toast' && m.text.includes('gần bồ đoàn')));
  // A đứng lên đi chỗ khác thì mất tư thế
  ca.ws.send(JSON.stringify({ t: 'move', x: 0.6, z: -14.8, ry: 0, a: 'walk' }));
  assert.ok(await ca.wait((m) => m.t === 'pose_ok' && m.kind === null));
  assert.equal((await api(`/c/${a.cid}/meditate/start`, { token: a.token, body: { minutes: 5 } })).data.code, 'need_pose');
  } finally { ca.ws.close(); cb?.ws.close(); }
});

test('giới hạn ngày: vượt trần vẫn ghi lịch sử nhưng không cộng thưởng', async () => {
  const p = await newPlayer('Thiện Tâm');
  await api(`/c/${p.cid}/enter`, { token: p.token, body: {} });
  await at(p.cid, -16, 6);
  await pool.query(`INSERT INTO activity_history (character_id, activity_code, amount, rewarded, day, created_at)
                    SELECT $1, 'bell', 30, TRUE, $2, now() - interval '1 hour'`, [p.cid, new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date())]);
  const r = await api(`/c/${p.cid}/act/bell`, { token: p.token, body: {} });
  assert.equal(r.status, 200);
  assert.equal(r.data.rewarded, false);
  assert.equal((await wallet(p.cid)).merit, 0);
});

test('thắp hương tiêu vật phẩm và có thời gian hồi', async () => {
  const p = await newPlayer('Hương Nghiêm');
  await api(`/c/${p.cid}/enter`, { token: p.token, body: {} });
  await at(p.cid, 0, 5);
  const r = await api(`/c/${p.cid}/act/incense`, { token: p.token, body: {} });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const inv = (await pool.query(`SELECT quantity FROM inventory i JOIN items it ON it.id=i.item_id WHERE character_id=$1 AND it.code='huong'`, [p.cid])).rows[0];
  assert.equal(inv.quantity, 2);
  assert.equal((await api(`/c/${p.cid}/act/incense`, { token: p.token, body: {} })).status, 429);
});

test('lần hạt: chặn lần quá nhanh, thưởng khi tròn 108 hạt', async () => {
  const p = await newPlayer('Trì Niệm');
  await api(`/c/${p.cid}/enter`, { token: p.token, body: {} });
  assert.equal((await api(`/c/${p.cid}/beads`, { token: p.token, body: { count: 30 } })).status, 200);
  const tooFast = await api(`/c/${p.cid}/beads`, { token: p.token, body: { count: 30 } });
  assert.equal(tooFast.status, 429);
  // Mô phỏng thời gian trôi: lùi mốc lần hạt cuối
  await pool.query(`UPDATE character_stats SET last_bead_at = now() - interval '30 seconds', bead_progress=100 WHERE character_id=$1`, [p.cid]);
  const done = await api(`/c/${p.cid}/beads`, { token: p.token, body: { count: 10 } });
  assert.equal(done.status, 200);
  assert.equal(done.data.progress, 2);
  assert.equal(done.data.rounds, 1);
  assert.equal(done.data.gains.merit, 10);
  assert.equal(done.data.gains.sen, 5);
});

test('thiền: đo thời gian thực trên server, xả thiền sớm chỉ tính phút đã ngồi', async () => {
  const p = await newPlayer('Tĩnh Lặng');
  await api(`/c/${p.cid}/enter`, { token: p.token, body: {} });
  const c = await seat(p.token, p.cid, 'm0', 'sit');
  assert.equal((await api(`/c/${p.cid}/meditate/start`, { token: p.token, body: { minutes: 7 } })).status, 400);
  assert.equal((await api(`/c/${p.cid}/meditate/start`, { token: p.token, body: { minutes: 10 } })).status, 200);
  const early = await api(`/c/${p.cid}/meditate/finish`, { token: p.token, body: {} });
  assert.equal(early.data.rewarded, false);
  await api(`/c/${p.cid}/meditate/start`, { token: p.token, body: { minutes: 10 } });
  await pool.query(`UPDATE activity_sessions SET started_at = now() - interval '3 minutes 10 seconds' WHERE character_id=$1`, [p.cid]);
  const part = await api(`/c/${p.cid}/meditate/finish`, { token: p.token, body: {} });
  assert.equal(part.data.minutes, 3);
  assert.equal(part.data.gains.merit, 6);
  // Không thể khai khống: dù để phiên rất lâu, tối đa = thời lượng đã chọn
  await api(`/c/${p.cid}/meditate/start`, { token: p.token, body: { minutes: 5 } });
  await pool.query(`UPDATE activity_sessions SET started_at = now() - interval '5 hours' WHERE character_id=$1`, [p.cid]);
  const capped = await api(`/c/${p.cid}/meditate/finish`, { token: p.token, body: {} });
  assert.equal(capped.data.minutes, 5);
  c.ws.close();
});

test('tụng kinh: phải đủ thời lượng tối thiểu', async () => {
  const p = await newPlayer('Trì Kinh');
  await api(`/c/${p.cid}/enter`, { token: p.token, body: {} });
  const c = await seat(p.token, p.cid, 'c2', 'sit');
  assert.equal((await api(`/c/${p.cid}/chant/start`, { token: p.token, body: { code: 'hoi_huong' } })).status, 200);
  const fast = await api(`/c/${p.cid}/chant/finish`, { token: p.token, body: {} });
  assert.equal(fast.status, 400);
  await pool.query(`UPDATE activity_sessions SET started_at = now() - interval '30 seconds' WHERE character_id=$1`, [p.cid]);
  const ok = await api(`/c/${p.cid}/chant/finish`, { token: p.token, body: {} });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.gains.merit, 15);
  c.ws.close();
});

test('nhiệm vụ: chưa đủ thì không nhận, đủ thì nhận một lần', async () => {
  const p = await newPlayer('Nhẫn Nhục');
  await api(`/c/${p.cid}/enter`, { token: p.token, body: {} });
  const ms = (await api(`/c/${p.cid}/missions`, { token: p.token })).data;
  const bell = ms.find((m: any) => m.code === 'd_bell');
  assert.equal((await api(`/c/${p.cid}/missions/${bell.id}/claim`, { token: p.token, body: {} })).status, 400);
  await at(p.cid, -16, 6);
  for (let i = 0; i < 3; i++) {
    await pool.query(`DELETE FROM activity_history WHERE character_id=$1 AND activity_code='bell'`, [p.cid]);
    assert.equal((await api(`/c/${p.cid}/act/bell`, { token: p.token, body: {} })).status, 200);
  }
  const before = await wallet(p.cid);
  const claim = await api(`/c/${p.cid}/missions/${bell.id}/claim`, { token: p.token, body: {} });
  assert.equal(claim.status, 200, JSON.stringify(claim.data));
  assert.equal((await wallet(p.cid)).sen, before.sen + 5);
  assert.equal((await api(`/c/${p.cid}/missions/${bell.id}/claim`, { token: p.token, body: {} })).status, 400);
});

test('lên cấp: cộng Sen thưởng, ghi sổ giao dịch', async () => {
  const p = await newPlayer('Tinh Tấn');
  await api(`/c/${p.cid}/enter`, { token: p.token, body: {} });
  const c = await seat(p.token, p.cid, 'c1', 'kneel');
  await api(`/c/${p.cid}/chant/start`, { token: p.token, body: { code: 'hoi_huong' } });
  await pool.query(`UPDATE activity_sessions SET started_at = now() - interval '30 seconds' WHERE character_id=$1`, [p.cid]);
  await pool.query(`UPDATE character_stats SET exp=50 WHERE character_id=$1`, [p.cid]);
  const r = await api(`/c/${p.cid}/chant/finish`, { token: p.token, body: {} });
  assert.deepEqual(r.data.levelUps, [2]);
  const tx = (await pool.query(`SELECT * FROM transactions WHERE character_id=$1 AND kind='level_up'`, [p.cid])).rows;
  assert.equal(Number(tx[0].delta), 20);
  c.ws.close();
});

test('cửa hàng: thiếu Sen bị từ chối, đủ Sen mua được, không mua trùng áo', async () => {
  const p = await newPlayer('Mua Sắm');
  await api(`/c/${p.cid}/enter`, { token: p.token, body: {} });
  const poor = await api(`/c/${p.cid}/shop/buy`, { token: p.token, body: { code: 'ao_nau' } });
  assert.equal(poor.status, 400);
  assert.equal((await wallet(p.cid)).sen, 50);
  const ok = await api(`/c/${p.cid}/shop/buy`, { token: p.token, body: { code: 'huong', qty: 4 } });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal((await wallet(p.cid)).sen, 30);
  await pool.query(`UPDATE currencies SET balance=500 WHERE character_id=$1 AND code='sen'`, [p.cid]);
  assert.equal((await api(`/c/${p.cid}/shop/buy`, { token: p.token, body: { code: 'ao_nau' } })).status, 200);
  assert.equal((await api(`/c/${p.cid}/shop/buy`, { token: p.token, body: { code: 'ao_nau' } })).status, 400);
  assert.equal((await api(`/c/${p.cid}/equip`, { token: p.token, body: { slot: 'robe', code: 'ao_nau' } })).status, 200);
  assert.equal((await api(`/c/${p.cid}/equip`, { token: p.token, body: { slot: 'robe', code: 'ao_vang' } })).status, 400);
});

test('bạn bè và tặng quà: cần là bạn, đủ cấp, có giới hạn ngày', async () => {
  const a = await newPlayer('Từ Bi');
  const b = await newPlayer('Hỷ Xả');
  await api(`/c/${a.cid}/enter`, { token: a.token, body: {} });
  assert.equal((await api(`/c/${a.cid}/gifts`, { token: a.token, body: { toId: b.cid, sen: 10 } })).status, 400);
  assert.equal((await api(`/c/${a.cid}/friends/request`, { token: a.token, body: { id: b.cid } })).status, 200);
  assert.equal((await api(`/c/${b.cid}/friends/respond`, { token: b.token, body: { id: a.cid, accept: true } })).status, 200);
  const lowLevel = await api(`/c/${a.cid}/gifts`, { token: a.token, body: { toId: b.cid, sen: 10 } });
  assert.equal(lowLevel.status, 400);
  assert.match(lowLevel.data.error, /cấp 3/);
  await pool.query(`UPDATE character_stats SET level=3 WHERE character_id=$1`, [a.cid]);
  await pool.query(`UPDATE currencies SET balance=1000 WHERE character_id=$1 AND code='sen'`, [a.cid]);
  const g1 = await api(`/c/${a.cid}/gifts`, { token: a.token, body: { toId: b.cid, sen: 150, itemCode: 'huong', qty: 1 } });
  assert.equal(g1.status, 200, JSON.stringify(g1.data));
  assert.equal((await wallet(b.cid)).sen, 200);
  const over = await api(`/c/${a.cid}/gifts`, { token: a.token, body: { toId: b.cid, sen: 60 } });
  assert.equal(over.status, 400);
  // chặn: hủy kết bạn, không tặng được nữa
  await api(`/c/${b.cid}/block/${a.cid}`, { token: b.token, body: {} });
  assert.equal((await api(`/c/${a.cid}/gifts`, { token: a.token, body: { toId: b.cid, sen: 1 } })).status, 400);
});

test('multiplayer: hai người thấy nhau, đồng bộ vị trí, chặn dịch chuyển, chat có lọc từ', async () => {
  const a = await newPlayer('Viên Giác');
  const b = await newPlayer('Viên Minh');
  const ca = await connect(a.token, a.cid);
  await ca.wait((m) => m.t === 'welcome');
  const cb = await connect(b.token, b.cid);
  const wb = await cb.wait((m) => m.t === 'welcome');
  assert.ok(wb.players.some((p: any) => p.id === a.cid), 'B thấy A khi vào phòng');
  await ca.wait((m) => m.t === 'join' && m.p.id === b.cid);

  ca.ws.send(JSON.stringify({ t: 'move', x: 1, z: 39, ry: 0.5, a: 'walk' }));
  const st = await cb.wait((m) => m.t === 's' && m.p.some((r: any) => r[0] === a.cid && r[1] === 1));
  assert.ok(st);

  ca.ws.send(JSON.stringify({ t: 'move', x: 0, z: -14, ry: 0, a: 'walk' }));
  const corr = await ca.wait((m) => m.t === 'correct');
  assert.equal(corr.z, 39);

  cb.ws.send(JSON.stringify({ t: 'chat', body: 'chào đạo hữu vcl' }));
  const chat = await ca.wait((m) => m.t === 'chat' && m.from.id === b.cid);
  assert.equal(chat.body, 'chào đạo hữu ***');

  cb.ws.send(JSON.stringify({ t: 'chat', body: 'tin riêng', to: a.cid }));
  const pm = await ca.wait((m) => m.t === 'pm');
  assert.equal(pm.body, 'tin riêng');

  cb.ws.close();
  await ca.wait((m) => m.t === 'leave' && m.id === b.cid);
  ca.ws.close();
});

test('đi vào khu vực tự nhận dấu mộc hành hương', async () => {
  const a = await newPlayer('Hành Hương');
  const c = await connect(a.token, a.cid);
  const w = await c.wait((m) => m.t === 'welcome');
  assert.ok(w);
  const st = await c.wait((m) => m.t === 'stamp' && m.zone === 'gate');
  assert.equal(st.result.gains.merit, 5);
  c.ws.close();
  const n = (await pool.query('SELECT count(*)::int n FROM pilgrimage_progress WHERE character_id=$1', [a.cid])).rows[0].n;
  assert.equal(n, 1);
});

test('admin: phân quyền, điều chỉnh tài nguyên có nhật ký, khóa tài khoản', async () => {
  const p = await newPlayer('Bị Khóa');
  assert.equal((await api('/admin/stats', { token: p.token })).status, 403);
  const root = (await api('/auth/login', { body: { username: 'root', password: 'root-pass-123' } })).data.token;
  assert.equal((await api('/admin/stats', { token: root })).status, 200);
  assert.equal((await api(`/admin/characters/${p.cid}/adjust`, { token: root, body: { currency: 'sen', delta: 25 } })).status, 400, 'bắt buộc có lý do');
  assert.equal((await api(`/admin/characters/${p.cid}/adjust`, { token: root, body: { currency: 'sen', delta: 25, reason: 'bồi thường lỗi' } })).status, 200);
  assert.equal((await wallet(p.cid)).sen, 75);
  const logs = (await api('/admin/logs', { token: root })).data;
  assert.equal(logs[0].action, 'adjust');
  // moderator không được điều chỉnh tài nguyên
  await api(`/admin/users/${p.userId}/role`, { token: root, body: { role: 'moderator' } });
  const mod = (await api('/auth/login', { body: { username: p.username, password: 'matkhau123' } })).data.token;
  assert.equal((await api(`/admin/characters/${p.cid}/adjust`, { token: mod, body: { currency: 'sen', delta: 1, reason: 'x' } })).status, 403);
  await api(`/admin/users/${p.userId}/role`, { token: root, body: { role: 'player' } });
  assert.equal((await api(`/admin/users/${p.userId}/ban`, { token: root, body: { ban: true, reason: 'spam' } })).status, 200);
  const login = await api('/auth/login', { body: { username: p.username, password: 'matkhau123' } });
  assert.equal(login.status, 403);
  assert.match(login.data.error, /spam/);
});

test('sự kiện nhân công đức do admin cấu hình được áp dụng', async () => {
  const root = (await api('/auth/login', { body: { username: 'root', password: 'root-pass-123' } })).data.token;
  const ev = await api('/admin/events', { token: root, body: { name: 'Rằm thử nghiệm', merit_multiplier: 2, starts_at: new Date(Date.now() - 60000).toISOString(), ends_at: new Date(Date.now() + 60000).toISOString(), is_active: true } });
  assert.equal(ev.status, 200, JSON.stringify(ev.data));
  const p = await newPlayer('Rằm Tháng');
  const c = await seat(p.token, p.cid, 'h20', 'kneel');
  const r = await api(`/c/${p.cid}/act/prostrate`, { token: p.token, body: {} });
  assert.equal(r.data.gains.merit, 2);
  c.ws.close();
  await api(`/admin/events/${ev.data.id}`, { method: 'PATCH', token: root, body: { is_active: false } });
});

test('âm lịch: đối chiếu các ngày lễ đã biết', async () => {
  const { solarToLunar } = await import('../../shared/lunar.ts');
  const cases: [number, number, number, number, number][] = [
    [29, 1, 2025, 1, 1], [17, 2, 2026, 1, 1], [10, 2, 2024, 1, 1], [6, 10, 2025, 15, 8], [25, 9, 2026, 15, 8], [6, 9, 2025, 15, 7],
  ];
  for (const [d, m, y, ld, lm] of cases) {
    const l = solarToLunar(d, m, y);
    assert.deepEqual([l.day, l.month], [ld, lm], `${d}/${m}/${y}`);
  }
});

test('đại lễ: người ở Chánh điện đủ thời lượng được thưởng, người ở ngoài thì không', async () => {
  const { configureCeremony, startCeremonyScheduler } = await import('../src/ceremony.ts');
  const { lunarOf, isHolyDay } = await import('../../shared/lunar.ts');
  configureCeremony({ sampleMs: 100, durationMs: 1500, scheduled: false });
  const stop = startCeremonyScheduler(50);
  try {
    const inside = await newPlayer('Dự Lễ Trong');
    const outside = await newPlayer('Dự Lễ Ngoài');
    const standing = await newPlayer('Đứng Trong Điện');
    const ci = await seat(inside.token, inside.cid, 'h16', 'kneel');
    assert.ok(ci.msgs.find((m) => m.t === 'welcome').ceremony.lunar.label, 'welcome có thông tin âm lịch');
    const co = await connect(outside.token, outside.cid);
    await co.wait((m) => m.t === 'welcome');
    // Người đứng trong Chánh điện nhưng không ngồi/quỳ trên bồ đoàn: không được ghi nhận
    await at(standing.cid, 3, -9);
    const cs = await connect(standing.token, standing.cid);
    await cs.wait((m) => m.t === 'welcome');
    const root = (await api('/auth/login', { body: { username: 'root', password: 'root-pass-123' } })).data.token;
    const before = (await wallet(inside.cid)).merit;
    // Người chơi thường không được tổ chức lễ
    assert.equal((await api('/admin/ceremonies', { token: inside.token, body: { minutes: 0 } })).status, 403);
    assert.equal((await api('/admin/ceremonies', { token: root, body: { minutes: 0 } })).status, 200);
    await ci.wait((m) => m.t === 'ceremony_state' && m.s.current, 3000);
    const res = await ci.wait((m) => m.t === 'ceremony_result', 5000);
    const mult = isHolyDay(lunarOf()) ? 2 : 1;
    assert.equal(res.result.gains.merit, Math.round(30 * mult));
    assert.equal(res.participants, 1);
    assert.equal((await wallet(inside.cid)).merit, before + res.result.gains.merit);
    // Người không vào Chánh điện: không có bản ghi tham dự, không nhận thưởng
    const outMerit = (await wallet(outside.cid)).merit;
    assert.ok(!co.msgs.some((m) => m.t === 'ceremony_result'));
    const rows = (await pool.query('SELECT character_id, rewarded FROM ceremony_attendance')).rows;
    assert.ok(rows.some((r) => Number(r.character_id) === inside.cid && r.rewarded));
    assert.ok(!rows.some((r) => Number(r.character_id) === outside.cid));
    assert.ok(!rows.some((r) => Number(r.character_id) === standing.cid), 'đứng trong điện mà không ngồi/quỳ thì không được ghi nhận');
    assert.ok(!cs.msgs.some((m) => m.t === 'ceremony_result'));
    cs.ws.close();
    assert.equal(outMerit, 5, 'chỉ có 5 công đức từ dấu mộc cổng');
    const ms = (await api(`/c/${inside.cid}/missions`, { token: inside.token })).data;
    assert.equal(ms.find((m: any) => m.code === 'd_ceremony').progress, 1);
    ci.ws.close(); co.ws.close();
  } finally {
    stop();
  }
});
