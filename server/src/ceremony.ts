// Đại lễ cộng tu: lịch cố định theo giờ VN + đại lễ đột xuất do admin tổ chức.
// Server lấy mẫu vị trí người chơi (do server xác thực) để biết ai có mặt trong Chánh điện.
import { one, q } from './db.ts';
import { players, send } from './presence.ts';
import { rewardCeremony } from './economy.ts';
import {
  CEREMONY_HOURS, CEREMONY_HOLY_EXTRA_HOUR, CEREMONY_HOLY_MULT, CEREMONY_ATTEND_RATIO, CEREMONY_ANNOUNCE_MIN,
  ceremonySeconds, inAnyZone, type Zone,
} from '../../shared/content.ts';
import { lunarOf, lunarLabel, isHolyDay } from '../../shared/lunar.ts';

interface Running {
  id: number; kind: 'scheduled' | 'adhoc'; startAt: number; endAt: number;
  mult: number; lunar: string | null;
  samples: number; attend: Map<number, number>;
}

const opts = { sampleMs: 5000, durationMs: ceremonySeconds() * 1000, enabled: true, scheduled: true };
let current: Running | null = null;
let adhoc: number[] = [];                 // thời điểm bắt đầu các lễ đột xuất
const announced = new Set<string>();
let lastSample = 0;
let timer: NodeJS.Timeout | null = null;
const zoneCache = new Map<number, Zone[]>();

/** Dùng cho kiểm thử: rút ngắn thời lượng và chu kỳ lấy mẫu */
export function configureCeremony(o: Partial<typeof opts>) { Object.assign(opts, o); }

const HOUR = 3600_000;
/** Các mốc lễ theo lịch trong ngày VN chứa thời điểm `t` và ngày kế tiếp */
function scheduledAround(t: number): { at: number; mult: number; lunar: string | null }[] {
  const out: { at: number; mult: number; lunar: string | null }[] = [];
  const vn = new Date(t + 7 * HOUR);
  const dayStartUtc = Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate()) - 7 * HOUR;
  for (let d = 0; d < 2; d++) {
    const day0 = dayStartUtc + d * 24 * HOUR;
    const l = lunarOf(new Date(day0 + 12 * HOUR));
    const holy = isHolyDay(l);
    const hours = holy ? [...CEREMONY_HOURS, CEREMONY_HOLY_EXTRA_HOUR].sort((a, b) => a - b) : CEREMONY_HOURS;
    for (const h of hours) out.push({ at: day0 + h * HOUR, mult: holy ? CEREMONY_HOLY_MULT : 1, lunar: holy ? lunarLabel(l) : null });
  }
  return out;
}

/** Lễ kế tiếp (hoặc đang diễn ra) */
export function nextCeremony(now = Date.now()) {
  const list = [
    ...(opts.scheduled ? scheduledAround(now) : []).map((s) => ({ ...s, kind: 'scheduled' as const })),
    ...adhoc.map((at) => ({ at, mult: isHolyDay(lunarOf(new Date(at))) ? CEREMONY_HOLY_MULT : 1, lunar: null, kind: 'adhoc' as const })),
  ].filter((s) => s.at + opts.durationMs > now).sort((a, b) => a.at - b.at);
  return list[0] || null;
}

export function ceremonyState(now = Date.now()) {
  const l = lunarOf(new Date(now));
  const nx = current ? null : nextCeremony(now);
  return {
    serverNow: now,
    lunar: { ...l, label: lunarLabel(l), holy: isHolyDay(l) },
    current: current ? { id: current.id, startAt: current.startAt, endAt: current.endAt, mult: current.mult, lunar: current.lunar, durationMs: opts.durationMs } : null,
    next: nx ? { startAt: nx.at, mult: nx.mult, kind: nx.kind } : null,
  };
}

/** Admin tổ chức đại lễ đột xuất sau `minutes` phút */
export async function scheduleAdhoc(minutes: number, adminId: number) {
  const at = Date.now() + Math.max(0, minutes) * 60_000;
  if (current) throw new Error('Đang có đại lễ diễn ra.');
  adhoc.push(at);
  adhoc.sort((a, b) => a - b);
  await q('INSERT INTO admin_logs (admin_id, action, target, detail) VALUES ($1,$2,$3,$4)',
    [adminId, 'schedule_ceremony', 'ceremony', JSON.stringify({ startsAt: new Date(at).toISOString() })]);
  broadcastAll({ t: 'ceremony_state', s: ceremonyState() });
  return { startAt: at };
}

function broadcastAll(msg: unknown) { for (const p of players.values()) send(p, msg); }

async function zonesOf(templeId: number): Promise<Zone[]> {
  let z = zoneCache.get(templeId);
  if (!z) { z = ((await one<any>('SELECT zones FROM temples WHERE id=$1', [templeId]))?.zones || []) as Zone[]; zoneCache.set(templeId, z); }
  return z;
}

async function start(s: { at: number; mult: number; lunar: string | null; kind: 'scheduled' | 'adhoc' }) {
  const row = await one<any>(`INSERT INTO ceremonies (kind, starts_at, ends_at, lunar_label, multiplier) VALUES ($1,$2,$3,$4,$5)
                              ON CONFLICT (kind, starts_at) DO UPDATE SET finished = ceremonies.finished RETURNING id, finished`,
    [s.kind, new Date(s.at).toISOString(), new Date(s.at + opts.durationMs).toISOString(), s.lunar, s.mult]);
  if (row.finished) return; // đã xử lý (vd. server khởi động lại sau khi lễ kết thúc)
  current = { id: row.id, kind: s.kind, startAt: s.at, endAt: s.at + opts.durationMs, mult: s.mult, lunar: s.lunar, samples: 0, attend: new Map() };
  if (s.kind === 'adhoc') adhoc = adhoc.filter((a) => a !== s.at);
  lastSample = 0;
  broadcastAll({ t: 'ceremony_state', s: ceremonyState() });
}

async function sample() {
  const c = current!;
  c.samples++;
  let present = 0;
  for (const p of players.values()) {
    if (inAnyZone(await zonesOf(p.templeId), ['main_hall'], p.x, p.z)) {
      c.attend.set(p.charId, (c.attend.get(p.charId) || 0) + 1);
      present++;
    }
  }
  broadcastAll({ t: 'ceremony_tick', present, serverNow: Date.now() });
}

async function finish() {
  const c = current!;
  current = null;
  const need = Math.max(1, Math.ceil(c.samples * CEREMONY_ATTEND_RATIO));
  const qualified = [...c.attend].filter(([, n]) => n >= need);
  const crowd = 1 + Math.min(0.4, 0.02 * Math.max(0, qualified.length - 1));
  await q('UPDATE ceremonies SET participants=$2, finished=TRUE WHERE id=$1', [c.id, qualified.length]);
  for (const [charId, n] of c.attend) {
    const presence = c.samples ? n / c.samples : 0;
    if (n >= need) {
      try {
        const result = await rewardCeremony(charId, c.id, presence, c.mult * crowd);
        send(players.get(charId), { t: 'ceremony_result', result, participants: qualified.length });
      } catch (e) { console.error('[ceremony] thưởng lỗi', charId, e); }
    } else {
      await q('INSERT INTO ceremony_attendance (ceremony_id, character_id, presence, rewarded) VALUES ($1,$2,$3,FALSE) ON CONFLICT DO NOTHING', [c.id, charId, presence]);
      send(players.get(charId), { t: 'ceremony_missed', presence, need: CEREMONY_ATTEND_RATIO });
    }
  }
  broadcastAll({ t: 'ceremony_state', s: ceremonyState() });
}

let busy = false;
async function tick() {
  if (busy || !opts.enabled) return;
  busy = true;
  try {
    const now = Date.now();
    if (current) {
      if (now - lastSample >= opts.sampleMs) { lastSample = now; await sample(); }
      if (now >= current.endAt) await finish();
      return;
    }
    const nx = nextCeremony(now);
    if (!nx) return;
    if (now >= nx.at) { await start(nx); return; }
    for (const m of CEREMONY_ANNOUNCE_MIN) {
      const key = `${nx.at}|${m}`;
      if (nx.at - now <= m * 60_000 && !announced.has(key)) {
        announced.add(key);
        broadcastAll({ t: 'toast', text: `Còn ${m} phút nữa bắt đầu đại lễ${nx.mult > 1 ? ` (công đức x${nx.mult})` : ''}. Mời đạo hữu vào Chánh điện.` });
        broadcastAll({ t: 'ceremony_state', s: ceremonyState(now) });
      }
    }
  } catch (e) {
    console.error('[ceremony]', e);
  } finally {
    busy = false;
  }
}

export function startCeremonyScheduler(intervalMs = 1000) {
  if (!timer) timer = setInterval(tick, intervalMs);
  return () => { if (timer) clearInterval(timer); timer = null; };
}

export async function recentCeremonies() {
  return q<any>(`SELECT id, kind, starts_at, ends_at, lunar_label, multiplier, participants, finished FROM ceremonies ORDER BY starts_at DESC LIMIT 50`);
}
