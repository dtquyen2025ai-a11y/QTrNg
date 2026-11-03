import { VN_TZ } from '../../shared/content.ts';

const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: VN_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

/** Ngày theo giờ Việt Nam: 'YYYY-MM-DD' */
export function vnDay(d = new Date()): string {
  return dayFmt.format(d);
}

/** Tuần ISO theo giờ Việt Nam: '2026-W45' */
export function vnWeek(d = new Date()): string {
  const [y, m, day] = vnDay(d).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, day));
  const dow = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dow);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function periodKey(reset: string, d = new Date()): string {
  if (reset === 'daily') return vnDay(d);
  if (reset === 'weekly') return vnWeek(d);
  return 'once';
}
