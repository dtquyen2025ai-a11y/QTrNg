// Đổi dương lịch -> âm lịch Việt Nam (múi giờ +7).
// Cài đặt theo thuật toán thiên văn công khai của Hồ Ngọc Đức (tính điểm sóc và trung khí).

const PI = Math.PI;

function jdFromDate(dd: number, mm: number, yy: number): number {
  const a = Math.floor((14 - mm) / 12);
  const y = yy + 4800 - a;
  const m = mm + 12 * a - 3;
  let jd = dd + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;
  if (jd < 2299161) jd = dd + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - 32083;
  return jd;
}

function newMoon(k: number): number {
  const T = k / 1236.85, T2 = T * T, T3 = T2 * T, dr = PI / 180;
  let jd1 = 2415020.75933 + 29.53058868 * k + 0.0001178 * T2 - 0.000000155 * T3;
  jd1 += 0.00033 * Math.sin((166.56 + 132.87 * T - 0.009173 * T2) * dr);
  const M = 359.2242 + 29.10535608 * k - 0.0000333 * T2 - 0.00000347 * T3;
  const Mpr = 306.0253 + 385.81691806 * k + 0.0107306 * T2 + 0.00001236 * T3;
  const F = 21.2964 + 390.67050646 * k - 0.0016528 * T2 - 0.00000239 * T3;
  let c1 = (0.1734 - 0.000393 * T) * Math.sin(M * dr) + 0.0021 * Math.sin(2 * dr * M);
  c1 = c1 - 0.4068 * Math.sin(Mpr * dr) + 0.0161 * Math.sin(dr * 2 * Mpr);
  c1 = c1 - 0.0004 * Math.sin(dr * 3 * Mpr);
  c1 = c1 + 0.0104 * Math.sin(dr * 2 * F) - 0.0051 * Math.sin(dr * (M + Mpr));
  c1 = c1 - 0.0074 * Math.sin(dr * (M - Mpr)) + 0.0004 * Math.sin(dr * (2 * F + M));
  c1 = c1 - 0.0004 * Math.sin(dr * (2 * F - M)) - 0.0006 * Math.sin(dr * (2 * F + Mpr));
  c1 = c1 + 0.001 * Math.sin(dr * (2 * F - Mpr)) + 0.0005 * Math.sin(dr * (2 * Mpr + M));
  const deltat = T < -11
    ? 0.001 + 0.000839 * T + 0.0002261 * T2 - 0.00000845 * T3 - 0.000000081 * T * T3
    : -0.000278 + 0.000265 * T + 0.000262 * T2;
  return jd1 + c1 - deltat;
}

const newMoonDay = (k: number, tz: number) => Math.floor(newMoon(k) + 0.5 + tz / 24);

function sunLongitude(jdn: number): number {
  const T = (jdn - 2451545.0) / 36525, T2 = T * T, dr = PI / 180;
  const M = 357.5291 + 35999.0503 * T - 0.0001559 * T2 - 0.00000048 * T * T2;
  const L0 = 280.46645 + 36000.76983 * T + 0.0003032 * T2;
  let DL = (1.9146 - 0.004817 * T - 0.000014 * T2) * Math.sin(dr * M);
  DL += (0.019993 - 0.000101 * T) * Math.sin(dr * 2 * M) + 0.00029 * Math.sin(dr * 3 * M);
  let L = (L0 + DL) * dr;
  L = L - PI * 2 * Math.floor(L / (PI * 2));
  return L;
}
const sunLongitudeSector = (dayNumber: number, tz: number) => Math.floor((sunLongitude(dayNumber - 0.5 - tz / 24) / PI) * 6);

function lunarMonth11(yy: number, tz: number): number {
  const off = jdFromDate(31, 12, yy) - 2415021;
  const k = Math.floor(off / 29.530588853);
  let nm = newMoonDay(k, tz);
  if (sunLongitudeSector(nm, tz) >= 9) nm = newMoonDay(k - 1, tz);
  return nm;
}

function leapMonthOffset(a11: number, tz: number): number {
  const k = Math.floor((a11 - 2415021.076998695) / 29.530588853 + 0.5);
  let last: number, i = 1;
  let arc = sunLongitudeSector(newMoonDay(k + i, tz), tz);
  do { last = arc; i++; arc = sunLongitudeSector(newMoonDay(k + i, tz), tz); } while (arc !== last && i < 14);
  return i - 1;
}

export interface LunarDate { day: number; month: number; year: number; leap: boolean }

export function solarToLunar(dd: number, mm: number, yy: number, tz = 7): LunarDate {
  const dayNumber = jdFromDate(dd, mm, yy);
  const k = Math.floor((dayNumber - 2415021.076998695) / 29.530588853);
  let monthStart = newMoonDay(k + 1, tz);
  if (monthStart > dayNumber) monthStart = newMoonDay(k, tz);
  let a11 = lunarMonth11(yy, tz), b11 = a11, lunarYear: number;
  if (a11 >= monthStart) { lunarYear = yy; a11 = lunarMonth11(yy - 1, tz); }
  else { lunarYear = yy + 1; b11 = lunarMonth11(yy + 1, tz); }
  const day = dayNumber - monthStart + 1;
  const diff = Math.floor((monthStart - a11) / 29);
  let leap = false, month = diff + 11;
  if (b11 - a11 > 365) {
    const lm = leapMonthOffset(a11, tz);
    if (diff >= lm) { month = diff + 10; if (diff === lm) leap = true; }
  }
  if (month > 12) month -= 12;
  if (month >= 11 && diff < 4) lunarYear -= 1;
  return { day, month, year: lunarYear, leap };
}

/** Âm lịch của một thời điểm, theo giờ Việt Nam */
export function lunarOf(d = new Date()): LunarDate {
  const vn = new Date(d.getTime() + 7 * 3600_000);
  return solarToLunar(vn.getUTCDate(), vn.getUTCMonth() + 1, vn.getUTCFullYear());
}

const MONTH_NAMES = ['Giêng', 'Hai', 'Ba', 'Tư', 'Năm', 'Sáu', 'Bảy', 'Tám', 'Chín', 'Mười', 'Mười Một', 'Chạp'];
export function lunarLabel(l: LunarDate): string {
  const dayName = l.day === 15 ? 'Rằm' : l.day <= 10 ? `Mùng ${l.day}` : `Ngày ${l.day}`;
  return `${dayName} tháng ${MONTH_NAMES[l.month - 1]}${l.leap ? ' (nhuận)' : ''}`;
}
/** Ngày Rằm hoặc mùng Một */
export const isHolyDay = (l: LunarDate) => l.day === 1 || l.day === 15;
