// BẢN DÙNG THỬ OFFLINE: máy chủ giả lập chạy trong trình duyệt, dữ liệu lưu trên máy người chơi.
// Theo cùng luật với server thật (server/src/economy.ts) nhưng không có người chơi khác.
// Chỉ được đưa vào bản build khi VITE_DEMO=1.
import seed from './seed.json';
import {
  expForLevel, SUTRAS, MEDITATION_OPTIONS, DAILY_GIFT, COOP_BONUS, filterText, isNameAllowed, inAnyZone, zoneAt,
  ceremonySeconds, CEREMONY_ATTEND_RATIO, CEREMONY_HOURS, CEREMONY_HOLY_EXTRA_HOUR, CEREMONY_HOLY_MULT, MATS, MAT_REACH, POSE_RULES, poseAllows, type Zone, type SeatKind,
} from '../../../shared/content.ts';
import { lunarOf, lunarLabel, isHolyDay } from '../../../shared/lunar.ts';

const KEY = 'tam-an.demo.v1';
const S: any = seed;
const items: any[] = S.items, missions: any[] = S.missions, achievements: any[] = S.achievements, temples: any[] = S.temples;
const acts = new Map<string, any>(S.activities.map((a: any) => [a.code, a]));
const itemBy = (code: string) => items.find((i) => i.code === code);

class DemoError extends Error { status: number; code: string; constructor(status: number, msg: string, code = 'error') { super(msg); this.status = status; this.code = code; } }
const bad = (m: string, c = 'bad_request') => new DemoError(400, m, c);

// ---------- Thời gian (giờ VN) ----------
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' });
const vnDay = (d = new Date()) => dayFmt.format(d);
function vnWeek(d = new Date()) {
  const [y, m, day] = vnDay(d).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, day)); const dow = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - dow);
  const ys = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${String(Math.ceil(((t.getTime() - ys.getTime()) / 86400000 + 1) / 7)).padStart(2, '0')}`;
}
const periodKey = (reset: string) => (reset === 'daily' ? vnDay() : reset === 'weekly' ? vnWeek() : 'once');

// ---------- Lưu trữ ----------
interface DB { users: Record<string, { password: string; email: string; reset?: { code: string; exp: number; tries: number } }>; chars: Record<string, any> }
let db: DB = { users: {}, chars: {} };
try { db = JSON.parse(localStorage.getItem(KEY) || 'null') || db; } catch { /* bộ nhớ trình duyệt bị chặn: chơi tạm trong phiên */ }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* bỏ qua */ } };


// ---------- Nhân vật hiện tại ----------
let currentUser = '';
const C = () => { const c = db.chars[currentUser]; if (!c) throw new DemoError(404, 'Không tìm thấy nhân vật.'); return c; };
export const livePos = { x: 0, z: 40 };   // vị trí do "máy chủ" ghi nhận qua kết nối realtime giả lập
let seat: { kind: SeatKind; mat: string } | null = null;
function needPose(rule: string) { if (POSE_RULES[rule] && !poseAllows(rule, seat)) throw bad(POSE_RULES[rule].hint, 'need_pose'); }

/** Vào chỗ trên bồ đoàn (kind = null: rời chỗ) */
export function pose(kind: SeatKind | null, matId?: string): any {
  if (!kind) { seat = null; return { t: 'pose_ok', kind: null }; }
  const mat = MATS.find((m) => m.id === matId);
  if (!mat) return { t: 'toast', text: 'Bồ đoàn không hợp lệ.' };
  if (Math.hypot(livePos.x - mat.x, livePos.z - mat.z) > MAT_REACH) return { t: 'toast', text: 'Hãy đến gần bồ đoàn hơn.' };
  seat = { kind, mat: mat.id }; livePos.x = mat.x; livePos.z = mat.z;
  return { t: 'pose_ok', kind, mat: mat.id, x: mat.x, z: mat.z, ry: Math.atan2(mat.faceX - mat.x, mat.faceZ - mat.z) };
}

function templeOf(c: any) { return temples.find((t) => t.id === c.templeId) || temples[0]; }

// ---------- Kinh tế ----------
function log(c: any, kind: string, currency: string, delta: number, after: number, itemName?: string) {
  c.tx.unshift({ kind, currency, delta, balance_after: after, item_name: itemName || null, created_at: new Date().toISOString() });
  c.tx.length = Math.min(c.tx.length, 100);
}
function addCur(c: any, code: 'merit' | 'sen' | 'ngoc', d: number, kind: string) {
  if (!d) return;
  if (c.wallet[code] + d < 0) throw bad(code === 'ngoc' ? 'Không đủ Ngọc.' : 'Không đủ Sen.', 'insufficient');
  c.wallet[code] += d; log(c, kind, code, d, c.wallet[code]);
}
function addItem(c: any, code: string, q: number, kind: string) {
  const it = itemBy(code); const cur = c.inv[code] || 0;
  if (cur + q < 0) throw bad(`Bạn không còn ${it.name}.`, 'insufficient_item');
  c.inv[code] = cur + q; log(c, kind, 'item', q, c.inv[code], it.name);
}
function bump(c: any, metric: string, amount: number, set = false) {
  for (const m of missions) {
    if (!m.is_active || m.metric !== metric || m.min_level > c.stats.level) continue;
    const k = `${m.id}|${periodKey(m.reset)}`;
    const p = c.mp[k] || (c.mp[k] = { progress: 0, claimed: false });
    p.progress = set ? Math.max(p.progress, Math.min(amount, m.target)) : Math.min(p.progress + amount, m.target);
  }
}
function checkAch(c: any) {
  const out: any[] = [];
  for (const a of achievements) {
    if (c.ach[a.code]) continue;
    const v = a.stat === 'level' ? c.stats.level : c.stats[a.stat] || 0;
    if (v >= Number(a.threshold)) {
      c.ach[a.code] = new Date().toISOString(); c.stats.achievement_points += a.points;
      if (a.reward_ngoc) addCur(c, 'ngoc', a.reward_ngoc, 'achievement');
      out.push({ code: a.code, name: a.name, title: a.title });
    }
  }
  return out;
}
function grant(c: any, g: { merit?: number; exp?: number; sen?: number; ngoc?: number }, kind: string) {
  addCur(c, 'merit', g.merit || 0, kind); addCur(c, 'sen', g.sen || 0, kind); addCur(c, 'ngoc', g.ngoc || 0, kind);
  const levelUps: number[] = [];
  if (g.exp) {
    c.stats.exp += g.exp;
    while (c.stats.exp >= expForLevel(c.stats.level)) { c.stats.exp -= expForLevel(c.stats.level); c.stats.level++; levelUps.push(c.stats.level); }
    for (const L of levelUps) { addCur(c, 'sen', 10 * L, 'level_up'); if (L % 5 === 0) addCur(c, 'ngoc', 1, 'level_up'); }
    if (levelUps.length) bump(c, 'level', c.stats.level, true);
  }
  return levelUps;
}
const STAT: Record<string, string> = { prostrate: 'prostrations', chant: 'chants', incense: 'offerings', candle: 'offerings', flower: 'offerings', lantern: 'lanterns', ceremony: 'ceremonies' };
const METRIC: Record<string, string> = { prostrate: 'prostrate', bead: 'bead_round', meditate: 'meditate_min', chant: 'chant', incense: 'offering', candle: 'offering', flower: 'offering', bell: 'bell', lantern: 'lantern', explore: 'explore', ceremony: 'ceremony' };

function perform(code: string, amount: number, o: { skipZone?: boolean; skipInterval?: boolean; bonus?: number } = {}) {
  const c = C(), act = acts.get(code), zones: Zone[] = templeOf(c).zones;
  if (act.zone && !o.skipZone) {
    const codes = String(act.zone).split(',');
    if (!inAnyZone(zones, codes, livePos.x, livePos.z)) throw bad(`Hãy đến ${codes.map((z) => zones.find((x) => x.code === z)?.name).join(' hoặc ')} để ${act.name.toLowerCase()}.`, 'wrong_zone');
  }
  if (act.min_interval_ms && !o.skipInterval) {
    const wait = act.min_interval_ms - (Date.now() - (c.lastAt[code] || 0));
    if (wait > 0) throw new DemoError(429, wait > 5000 ? `${act.name} lại sau ${Math.ceil(wait / 1000)} giây.` : 'Chậm lại một chút, tâm an thì động tác mới trọn.', 'rate_limited');
  }
  if (act.consumes_item) addItem(c, act.consumes_item, -1, 'activity');
  c.lastAt[code] = Date.now();
  const uk = `${vnDay()}|${code}`;
  const used = c.used[uk] || 0;
  const rew = Math.max(0, Math.min(amount, act.daily_cap - used));
  let merit = 0, exp = 0, sen = 0, levelUps: number[] = [];
  if (rew > 0) {
    c.used[uk] = used + rew;
    merit = Math.round(act.merit * rew * (o.bonus ?? 1)); exp = act.exp * rew; sen = act.sen * rew;
    levelUps = grant(c, { merit, exp, sen }, 'activity');
  }
  c.acts.unshift({ activity_code: code, name: act.name, amount, rewarded: rew > 0, merit, created_at: new Date().toISOString() });
  c.acts.length = Math.min(c.acts.length, 60);
  if (STAT[code]) c.stats[STAT[code]] = (c.stats[STAT[code]] || 0) + amount;
  if (METRIC[code]) bump(c, METRIC[code], amount);
  const achievementsOut = checkAch(c);
  save();
  return {
    ok: true, rewarded: rew > 0, coop: 0, levelUps, achievements: achievementsOut,
    gains: { merit, exp, sen, ngoc: 0 },
    message: rew > 0 ? `${act.name}: +${merit} công đức` : `${act.name} hoàn tất. Hôm nay đã đạt giới hạn nhận thưởng cho hoạt động này.`,
  };
}

// ---------- Trạng thái đầy đủ ----------
function state() {
  const c = C(), t = templeOf(c);
  const inv = Object.entries(c.inv).filter(([, q]) => (q as number) > 0).map(([code, quantity]) => {
    const it = itemBy(code); return { code, name: it.name, category: it.category, description: it.description, data: it.data, quantity };
  });
  const ach = achievements.map((a) => ({ code: a.code, name: a.name, description: a.description, points: a.points, title: a.title, threshold: a.threshold, stat: a.stat, unlocked_at: c.ach[a.code] || null }));
  return {
    character: {
      id: 1, dharmaName: c.name, gender: c.gender, hair: c.hair, skin: c.skin, equipment: c.equipment, title: c.title,
      serverId: 1, serverName: 'Bản dùng thử (offline)', temple: { id: t.id, code: t.code, name: t.name, zones: t.zones },
      pos: { x: c.pos.x, z: c.pos.z, ry: 0 }, createdAt: c.createdAt,
    },
    stats: { ...c.stats, expNeeded: expForLevel(c.stats.level) },
    wallet: { ...c.wallet }, inventory: inv, missions: missionList(), achievements: ach,
    titles: ach.filter((a) => a.unlocked_at && a.title).map((a) => a.title),
    stamps: Object.keys(c.stamps).map((k) => ({ temple_id: Number(k.split('|')[0]), zone_code: k.split('|')[1] })),
    event: null, itemData: Object.fromEntries(items.map((i) => [i.code, i.data])), today: vnDay(),
  };
}
function missionList() {
  const c = C();
  return missions.filter((m) => m.is_active).map((m) => {
    const p = c.mp[`${m.id}|${periodKey(m.reset)}`];
    return {
      id: m.id, code: m.code, name: m.name, description: m.description, period: m.period, reset: m.reset, target: m.target,
      progress: p?.progress || 0, claimed: !!p?.claimed, locked: m.min_level > c.stats.level, minLevel: m.min_level,
      reward: { merit: m.reward_merit, exp: m.reward_exp, sen: m.reward_sen, ngoc: m.reward_ngoc, item: m.reward_item, itemQty: m.reward_item_qty }, endsAt: m.ends_at,
    };
  });
}

// ---------- Đại lễ (bản thử: thêm một buổi mẫu 1 phút sau khi vào chùa) ----------
const CER_MS = ceremonySeconds() * 1000;
let demoCeremonyAt = 0;
export const cer = { current: null as null | { id: number; startAt: number; endAt: number; mult: number; samples: number; present: number } };
function scheduled(now: number) {
  const out: { at: number; mult: number }[] = [];
  const vn = new Date(now + 7 * 3600e3);
  const d0 = Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate()) - 7 * 3600e3;
  for (let d = 0; d < 2; d++) {
    const day = d0 + d * 86400e3, holy = isHolyDay(lunarOf(new Date(day + 12 * 3600e3)));
    for (const h of holy ? [...CEREMONY_HOURS, CEREMONY_HOLY_EXTRA_HOUR] : CEREMONY_HOURS) out.push({ at: day + h * 3600e3, mult: holy ? CEREMONY_HOLY_MULT : 1 });
  }
  if (demoCeremonyAt) out.push({ at: demoCeremonyAt, mult: 1 });
  return out.filter((s) => s.at + CER_MS > now).sort((a, b) => a.at - b.at);
}
export function ceremonyState() {
  const now = Date.now(), l = lunarOf(), nx = cer.current ? null : scheduled(now)[0];
  return {
    serverNow: now, lunar: { ...l, label: lunarLabel(l), holy: isHolyDay(l) },
    current: cer.current ? { id: cer.current.id, startAt: cer.current.startAt, endAt: cer.current.endAt, mult: cer.current.mult, lunar: null, durationMs: CER_MS } : null,
    next: nx ? { startAt: nx.at, mult: nx.mult, kind: 'scheduled' } : null,
  };
}
type Emit = (m: any) => void;
let ceremonyTimer = 0;
export function startCeremonyLoop(emit: Emit) {
  clearInterval(ceremonyTimer);
  if (!demoCeremonyAt || demoCeremonyAt + CER_MS < Date.now()) {
    demoCeremonyAt = Date.now() + 60_000;
    setTimeout(() => emit({ t: 'toast', text: 'Bản dùng thử: một buổi đại lễ mẫu sẽ bắt đầu sau 1 phút. Mời vào Chánh điện (phím L để xem).' }), 4000);
  }
  let lastSample = 0;
  const announced = new Set<number>();
  ceremonyTimer = window.setInterval(() => {
    const now = Date.now();
    if (cer.current) {
      if (now - lastSample >= 5000) {
        lastSample = now; cer.current.samples++;
        const z = templeOf(C()).zones;
        const here = poseAllows('ceremony', seat) && inAnyZone(z, ['main_hall'], livePos.x, livePos.z);
        if (here) cer.current.present++;
        emit({ t: 'ceremony_tick', present: here ? 1 : 0, serverNow: now });
      }
      if (now >= cer.current.endAt) {
        const c = cer.current; cer.current = null;
        const ratio = c.samples ? c.present / c.samples : 0;
        if (c.present && ratio >= CEREMONY_ATTEND_RATIO) {
          const r = perform('ceremony', 1, { skipZone: true, skipInterval: true, bonus: c.mult });
          r.message = r.rewarded ? `Viên mãn đại lễ: +${r.gains.merit} công đức, +${r.gains.sen} Sen` : 'Đại lễ viên mãn. Hôm nay bạn đã nhận đủ thưởng đại lễ.';
          emit({ t: 'ceremony_result', result: r, participants: 1 });
        } else if (c.present) emit({ t: 'ceremony_missed', presence: ratio, need: CEREMONY_ATTEND_RATIO });
        emit({ t: 'ceremony_state', s: ceremonyState() });
      }
      return;
    }
    const nx = scheduled(now)[0];
    if (!nx) return;
    if (now >= nx.at) {
      cer.current = { id: nx.at, startAt: nx.at, endAt: nx.at + CER_MS, mult: nx.mult, samples: 0, present: 0 };
      lastSample = 0;
      emit({ t: 'ceremony_state', s: ceremonyState() });
    } else if (nx.at - now <= 60_000 && !announced.has(nx.at)) {
      announced.add(nx.at);
      emit({ t: 'ceremony_state', s: ceremonyState() });
    }
  }, 500);
}

// ---------- Dấu mộc khi đi vào khu vực ----------
let lastPosSave = 0;
export function onMove(x: number, z: number): any[] {
  const out: any[] = [];
  if (seat && Math.hypot(x - livePos.x, z - livePos.z) > 0.25) { seat = null; out.push({ t: 'pose_ok', kind: null }); }
  livePos.x = x; livePos.z = z;
  const st = stampAt(x, z);
  if (st) out.push({ t: 'stamp', ...st });
  return out;
}
function stampAt(x: number, z: number): any | null {
  const c = db.chars[currentUser]; if (!c) return null;
  c.pos = { x, z };
  if (Date.now() - lastPosSave > 3000) { lastPosSave = Date.now(); save(); }
  const t = templeOf(c), zn = zoneAt(t.zones, x, z);
  if (!zn || c.stamps[`${t.id}|${zn.code}`]) return null;
  c.stamps[`${t.id}|${zn.code}`] = new Date().toISOString();
  const r = perform('explore', 1, { skipZone: true, skipInterval: true });
  r.message = `Nhận dấu mộc "${zn.name}". ` + r.message;
  return { zone: zn.code, result: r };
}
export function welcome() {
  const c = C();
  seat = null;
  livePos.x = c.pos.x; livePos.z = c.pos.z;
  return {
    t: 'welcome', you: { id: 1, name: c.name, level: c.stats.level, title: c.title, look: {}, x: c.pos.x, z: c.pos.z, ry: 0, anim: 'idle' },
    players: [], online: 1, ceremony: ceremonyState(),
    lanterns: c.lanterns.filter((l: any) => Date.now() - new Date(l.created_at).getTime() < 3 * 3600e3).map((l: any) => ({ ...l, name: c.name })),
  };
}
export function chatEcho(body: string) {
  return { t: 'chat', id: Date.now(), from: { id: 1, name: C().name, title: C().title }, body: filterText(body.slice(0, 200)).text, at: new Date().toISOString() };
}

// ---------- Định tuyến API ----------
const OFFLINE_SOCIAL = 'Bản dùng thử offline chỉ có một người chơi. Tính năng này hoạt động khi chơi trên máy chủ thật.';
export async function demoApi(method: string, path: string, body: any): Promise<any> {
  await new Promise((r) => setTimeout(r, 60));
  const [p, query] = path.split('?');
  const b = body || {};
  // Tài khoản
  const emailOk = (e: unknown) => { const x = String(e || '').trim().toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(x)) throw bad('Email không hợp lệ.', 'bad_email'); return x; };
  const byEmail = (e: string) => Object.keys(db.users).find((k) => db.users[k].email === e);
  if (p === '/auth/register') {
    const u = String(b.username || '').trim().toLowerCase();
    if (!/^[a-z0-9_.]{3,24}$/.test(u)) throw bad('Tên đăng nhập gồm 3–24 ký tự: chữ thường không dấu, số, dấu chấm hoặc gạch dưới.');
    const email = emailOk(b.email);
    if (typeof b.password !== 'string' || b.password.length < 8) throw bad('Mật khẩu cần từ 8 đến 72 ký tự.');
    if (db.users[u]) throw bad('Tên đăng nhập đã có người dùng.');
    if (byEmail(email)) throw bad('Email này đã được dùng cho tài khoản khác.');
    db.users[u] = { password: b.password, email }; save(); currentUser = u;
    return { token: 'demo:' + u, user: { id: 1, username: u, role: 'player' } };
  }
  if (p === '/auth/login') {
    const u = String(b.username || '').trim().toLowerCase();
    if (!db.users[u] || db.users[u].password !== b.password) throw new DemoError(401, 'Sai tên đăng nhập hoặc mật khẩu.');
    currentUser = u; return { token: 'demo:' + u, user: { id: 1, username: u, role: 'player' } };
  }
  if (p === '/auth/forgot') {
    const email = emailOk(b.email), u = byEmail(email);
    if (!u) return { ok: true, message: 'Nếu email này đã đăng ký, mã đặt lại mật khẩu sẽ được gửi tới. (Bản dùng thử: không tìm thấy email này trên máy.)' };
    const code = String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
    db.users[u].reset = { code, exp: Date.now() + 15 * 60_000, tries: 0 }; save();
    return { ok: true, message: `Bản dùng thử offline không gửi được email thật. Trên bản chính thức, mã sẽ được gửi vào ${email}. Mã của bạn: ${code}` };
  }
  if (p === '/auth/reset') {
    const email = emailOk(b.email), u = byEmail(email), r = u ? db.users[u].reset : null;
    if (!u || !r || r.exp < Date.now() || r.tries >= 5) throw bad('Mã không đúng hoặc đã hết hạn. Hãy yêu cầu mã mới.', 'bad_code');
    if (r.code !== String(b.code || '').trim()) { r.tries++; save(); throw bad('Mã không đúng hoặc đã hết hạn. Hãy yêu cầu mã mới.', 'bad_code'); }
    if (typeof b.newPassword !== 'string' || b.newPassword.length < 8) throw bad('Mật khẩu cần từ 8 đến 72 ký tự.');
    db.users[u].password = b.newPassword; delete db.users[u].reset; save(); currentUser = u;
    return { token: 'demo:' + u, user: { id: 1, username: u, role: 'player' } };
  }
  if (p === '/me/email') {
    const usr = db.users[currentUser];
    if (!usr || usr.password !== b.password) throw new DemoError(401, 'Mật khẩu không đúng.');
    const email = emailOk(b.email);
    const other = byEmail(email); if (other && other !== currentUser) throw bad('Email này đã được dùng cho tài khoản khác.');
    usr.email = email; save(); return { ok: true, email };
  }
  if (p === '/servers') return [{ id: 1, code: 'demo', name: 'Bản dùng thử (offline, trên máy bạn)', capacity: 1, is_open: true, online: currentUser ? 1 : 0 }];
  if (p === '/ceremony') return ceremonyState();
  if (p === '/me') {
    if (!currentUser || !db.users[currentUser]) throw new DemoError(401, 'Phiên đăng nhập đã hết hạn.');
    const c = db.chars[currentUser];
    return { user: { id: 1, username: currentUser, role: 'player', email: db.users[currentUser].email || null }, characters: c ? [{ id: 1, server_id: 1, dharma_name: c.name, level: c.stats.level }] : [] };
  }
  if (p === '/characters') {
    const name = String(b.dharmaName || '').trim().replace(/\s+/g, ' ');
    if (!/^[\p{L} ]{2,20}$/u.test(name)) throw bad('Pháp danh gồm 2–20 chữ cái (có dấu), không chứa số hay ký hiệu.');
    if (!isNameAllowed(name)) throw bad('Pháp danh chứa từ không phù hợp.');
    db.chars[currentUser] = {
      name, gender: b.gender, hair: b.hair, skin: b.skin, equipment: { robe: 'ao_lam', robeColor: b.robeColor }, title: null,
      templeId: temples[0].id, pos: { x: 0, z: 40 }, createdAt: new Date().toISOString(), lastGift: null,
      stats: { level: 1, exp: 0, achievement_points: 0, prostrations: 0, bead_rounds: 0, bead_progress: 0, meditation_minutes: 0, chants: 0, offerings: 0, lanterns: 0, gifts_sent: 0, days_active: 0, ceremonies: 0 },
      wallet: { merit: 0, sen: 50, ngoc: 0 }, inv: { ao_lam: 1 }, mp: {}, ach: {}, stamps: {}, used: {}, lastAt: {}, acts: [], tx: [], lanterns: [], sessions: {}, lastBead: 0,
    };
    save(); return { id: 1 };
  }
  const m = p.match(/^\/c\/\d+(\/.*)$/);
  if (!m) throw new DemoError(404, 'API không tồn tại.');
  const r = m[1], c = C();
  if (r === '/enter') {
    let dailyGift: any = null;
    if (c.lastGift !== vnDay()) {
      c.lastGift = vnDay(); c.stats.days_active++;
      for (const [code, q] of Object.entries(DAILY_GIFT)) addItem(c, code, q, 'daily_gift');
      bump(c, 'active_day', 1); dailyGift = { gift: DAILY_GIFT, achievements: checkAch(c) }; save();
    }
    return { ...state(), dailyGift };
  }
  if (r === '/state') return state();
  if (r === '/missions') return missionList();
  const claim = r.match(/^\/missions\/(\d+)\/claim$/);
  if (claim) {
    const ms = missions.find((x) => x.id === Number(claim[1])); const pr = c.mp[`${ms.id}|${periodKey(ms.reset)}`];
    if (!pr || pr.progress < ms.target) throw bad('Nhiệm vụ chưa hoàn thành.');
    if (pr.claimed) throw bad('Bạn đã nhận thưởng nhiệm vụ này.');
    pr.claimed = true;
    const levelUps = grant(c, { merit: ms.reward_merit, exp: ms.reward_exp, sen: ms.reward_sen, ngoc: ms.reward_ngoc }, 'mission');
    if (ms.reward_item && ms.reward_item_qty) addItem(c, ms.reward_item, ms.reward_item_qty, 'mission');
    const a = checkAch(c); save();
    return { ok: true, rewarded: true, message: `Nhận thưởng "${ms.name}"`, levelUps, achievements: a };
  }
  const act = r.match(/^\/act\/(\w+)$/);
  if (act) {
    if (!['prostrate', 'incense', 'candle', 'flower', 'bell'].includes(act[1])) throw bad('Hoạt động không hợp lệ.');
    needPose(act[1]);
    const out = perform(act[1], 1); fxHook?.(act[1]); return out;
  }
  if (r === '/beads') {
    const n = Number(b.count);
    const allowed = c.lastBead ? Math.floor((Date.now() - c.lastBead) / 250) + 1 : 30;
    if (!Number.isInteger(n) || n < 1 || n > 30) throw bad('Số hạt không hợp lệ.');
    if (n > allowed) throw new DemoError(429, 'Lần hạt quá nhanh. Hãy lần chậm rãi theo hơi thở.');
    c.lastBead = Date.now();
    let progress = c.stats.bead_progress + n, done = 0;
    while (progress >= 108) { progress -= 108; done++; }
    c.stats.bead_progress = progress; c.stats.bead_rounds += done;
    let out: any = { ok: true, rewarded: false, message: '', gains: { merit: 0, exp: 0, sen: 0, ngoc: 0 }, levelUps: [], achievements: [] };
    if (done) out = perform('bead', done, { skipInterval: true });
    save(); return { ...out, progress, rounds: c.stats.bead_rounds };
  }
  if (r === '/meditate/start' || r === '/chant/start') {
    const kind = r.startsWith('/meditate') ? 'meditate' : 'chant';
    needPose(kind);
    let planned: number;
    if (kind === 'meditate') { if (!MEDITATION_OPTIONS.includes(Number(b.minutes))) throw bad('Thời lượng thiền không hợp lệ.'); planned = Number(b.minutes) * 60; }
    else { const s = SUTRAS.find((x) => x.code === b.code); if (!s) throw bad('Bài kinh không tồn tại.'); planned = s.minSeconds; }
    const a = acts.get(kind), codes = String(a.zone).split(','), zones = templeOf(c).zones;
    if (!inAnyZone(zones, codes, livePos.x, livePos.z)) throw bad(`Hãy đến ${codes.map((z) => zones.find((x: Zone) => x.code === z)?.name).join(' hoặc ')} để ${a.name.toLowerCase()}.`);
    c.sessions[kind] = { start: Date.now(), planned }; save();
    return { ok: true };
  }
  if (r === '/meditate/finish') {
    const ses = c.sessions.meditate; if (!ses) throw bad('Bạn chưa bắt đầu thiền.');
    delete c.sessions.meditate;
    const el = Math.min((Date.now() - ses.start) / 1000, ses.planned * 1.02), minutes = Math.floor((el + 1) / 60);
    if (minutes < 1) { save(); return { ok: true, rewarded: false, message: 'Buổi thiền dưới 1 phút nên chưa được ghi nhận.', gains: { merit: 0, exp: 0, sen: 0, ngoc: 0 }, levelUps: [], achievements: [], minutes: 0 }; }
    c.stats.meditation_minutes += minutes;
    const out = perform('meditate', minutes, { skipZone: true });
    out.message = `${el >= ses.planned * 0.98 ? 'Viên mãn' : 'Xả thiền sớm'} · ${minutes} phút. ` + out.message;
    return { ...out, minutes };
  }
  if (r === '/chant/finish') {
    const ses = c.sessions.chant; if (!ses) throw bad('Bạn chưa bắt đầu tụng kinh.');
    const el = (Date.now() - ses.start) / 1000;
    if (el < ses.planned) throw bad(`Hãy tụng chậm rãi trọn bài (tối thiểu ${ses.planned} giây, mới ${Math.floor(el)} giây).`);
    delete c.sessions.chant;
    return perform('chant', 1, { skipZone: true });
  }
  if (r === '/lantern') {
    const raw = String(b.wish || '').replace(/\s+/g, ' ').trim();
    if (raw.length < 2 || raw.length > 80) throw bad('Lời nguyện từ 2 đến 80 ký tự.');
    const out = perform('lantern', 1);
    const lantern = { id: Date.now(), wish: filterText(raw).text, created_at: new Date().toISOString() };
    c.lanterns.unshift(lantern); c.lanterns.length = Math.min(c.lanterns.length, 30); save();
    return { ...out, lantern };
  }
  if (r === '/shop') return items.filter((i) => i.is_active && (i.price_sen != null || i.price_ngoc != null));
  if (r === '/shop/buy') {
    const it = itemBy(String(b.code)), qty = Number(b.qty || 1);
    if (!it) throw bad('Vật phẩm không bán.');
    if (c.stats.level < it.min_level) throw bad(`Cần đạt cấp ${it.min_level} để mua ${it.name}.`);
    if (!it.stackable && (c.inv[it.code] || 0) > 0) throw bad('Bạn đã có vật phẩm này.');
    if (it.price_sen != null) addCur(c, 'sen', -it.price_sen * qty, 'shop'); else addCur(c, 'ngoc', -it.price_ngoc * qty, 'shop');
    addItem(c, it.code, qty, 'shop'); save();
    return { ok: true, message: `Đã mua ${qty > 1 ? qty + ' ' : ''}${it.name}.` };
  }
  if (r === '/equip') {
    const slot = String(b.slot);
    if (b.code) {
      const it = itemBy(b.code);
      if (!it || !(c.inv[b.code] > 0)) throw bad('Bạn chưa sở hữu vật phẩm này.');
      if (it.data?.slot !== slot) throw bad('Vật phẩm không dùng cho ô này.');
      c.equipment[slot] = b.code;
    } else { if (slot === 'robe') throw bad('Nhân vật luôn cần mặc áo tràng.'); delete c.equipment[slot]; }
    save(); return { ok: true, equipment: c.equipment };
  }
  if (r === '/title') { c.title = b.title || null; save(); return { ok: true, title: c.title }; }
  if (r === '/history') return { activities: c.acts, transactions: c.tx.filter((t: any) => t.currency !== 'exp') };
  if (r === '/temples') return temples.map((t) => ({
    id: t.id, code: t.code, name: t.name, region: t.region, description: t.description, history: t.history, minLevel: t.min_level,
    unlocked: c.stats.level >= t.min_level, mapX: t.map_x, mapY: t.map_y, zones: t.zones.map((z: Zone) => ({ ...z, stamped: !!c.stamps[`${t.id}|${z.code}`] })),
  }));
  if (r === '/travel') {
    const t = temples.find((x) => x.code === b.code);
    if (c.stats.level < t.min_level) throw bad(`Cần đạt cấp ${t.min_level} để hành hương đến ${t.name}.`);
    c.templeId = t.id; c.pos = { x: 0, z: 40 }; save(); return { ok: true, temple: { id: t.id, code: t.code, name: t.name } };
  }
  if (r === '/social') return { friends: [], incoming: [], outgoing: [], blocked: [] };
  if (r.startsWith('/players')) return [];
  if (r === '/leaderboard') {
    const type = new URLSearchParams(query).get('type') || 'merit';
    const value = type === 'merit' ? c.wallet.merit : type === 'level' ? c.stats.level : c.stats.meditation_minutes;
    return [{ rank: 1, id: 1, name: c.name, title: c.title, level: c.stats.level, value, me: true }];
  }
  if (r === '/chat') return { public: [], private: [] };
  if (r === '/reports') return { ok: true, message: 'Đã ghi nhận (bản dùng thử không gửi báo cáo đi đâu).' };
  if (r.startsWith('/friends') || r.startsWith('/gifts') || r.startsWith('/block')) throw bad(OFFLINE_SOCIAL);
  void method; void COOP_BONUS;
  throw new DemoError(404, 'API không tồn tại.');
}

let fxHook: ((kind: string) => void) | null = null;
export function setFxHook(fn: ((kind: string) => void) | null) { fxHook = fn; }
export function setDemoUser(token: string | null) { currentUser = token?.startsWith('demo:') ? token.slice(5) : ''; }
export { DemoError };
