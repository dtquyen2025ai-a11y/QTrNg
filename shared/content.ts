// Nội dung & quy tắc dùng chung cho client và server.
// Server là nguồn sự thật cho mọi phần thưởng; client chỉ dùng để hiển thị.

export const VN_TZ = 'Asia/Ho_Chi_Minh';

/** EXP cần để lên từ cấp L lên L+1 */
export function expForLevel(level: number): number {
  return Math.round(60 * Math.pow(level, 1.5));
}

export const MAX_SPEED = 9;          // m/s, server cho phép dung sai
export const WORLD_BOUND = 46;       // |x|,|z| tối đa
export const COOP_WINDOW_MS = 60_000;
export const COOP_MIN_PLAYERS = 3;
export const COOP_BONUS = 0.2;
export const GIFT_SEN_DAILY_LIMIT = 200;
export const GIFT_MIN_LEVEL = 3;
export const MEDITATION_OPTIONS = [5, 10, 15, 30]; // phút
export const DAILY_GIFT: Record<string, number> = { huong: 3, nen: 2, hoa: 2, hoa_dang: 1 };

export interface Sutra {
  code: string;
  name: string;
  minSeconds: number;   // thời gian tối thiểu server chấp nhận
  note: string;
  lines: string[];
}

// Văn bản: Tâm Kinh phiên âm Hán Việt (kinh văn cổ, thuộc phạm vi công cộng);
// kệ hồi hướng truyền thống; các bài còn lại do dự án tự soạn.
export const SUTRAS: Sutra[] = [
  {
    code: 'tam_kinh',
    name: 'Bát Nhã Tâm Kinh (âm Hán Việt)',
    minSeconds: 90,
    note: 'Kinh văn cổ, phiên âm Hán Việt.',
    lines: [
      'Ma Ha Bát Nhã Ba La Mật Đa Tâm Kinh',
      'Quán Tự Tại Bồ Tát hành thâm Bát Nhã Ba La Mật Đa thời,',
      'chiếu kiến ngũ uẩn giai không, độ nhất thiết khổ ách.',
      'Xá Lợi Tử, sắc bất dị không, không bất dị sắc,',
      'sắc tức thị không, không tức thị sắc,',
      'thọ tưởng hành thức diệc phục như thị.',
      'Xá Lợi Tử, thị chư pháp không tướng,',
      'bất sanh bất diệt, bất cấu bất tịnh, bất tăng bất giảm.',
      'Thị cố không trung vô sắc, vô thọ tưởng hành thức,',
      'vô nhãn nhĩ tỷ thiệt thân ý, vô sắc thanh hương vị xúc pháp,',
      'vô nhãn giới nãi chí vô ý thức giới,',
      'vô vô minh diệc vô vô minh tận,',
      'nãi chí vô lão tử diệc vô lão tử tận,',
      'vô khổ tập diệt đạo, vô trí diệc vô đắc, dĩ vô sở đắc cố.',
      'Bồ Đề Tát Đỏa y Bát Nhã Ba La Mật Đa cố,',
      'tâm vô quái ngại, vô quái ngại cố, vô hữu khủng bố,',
      'viễn ly điên đảo mộng tưởng, cứu cánh Niết Bàn.',
      'Tam thế chư Phật y Bát Nhã Ba La Mật Đa cố,',
      'đắc A Nậu Đa La Tam Miệu Tam Bồ Đề.',
      'Cố tri Bát Nhã Ba La Mật Đa thị đại thần chú, thị đại minh chú,',
      'thị vô thượng chú, thị vô đẳng đẳng chú,',
      'năng trừ nhất thiết khổ, chân thật bất hư.',
      'Cố thuyết Bát Nhã Ba La Mật Đa chú, tức thuyết chú viết:',
      'Yết đế yết đế, ba la yết đế, ba la tăng yết đế, Bồ đề tát bà ha.',
    ],
  },
  {
    code: 'niem_phat',
    name: 'Niệm hồng danh',
    minSeconds: 45,
    note: 'Bài niệm ngắn do Tâm An Online soạn để tập trung tâm ý.',
    lines: [
      'Nam Mô Bổn Sư Thích Ca Mâu Ni Phật.',
      'Nam Mô A Di Đà Phật.',
      'Nam Mô Đại Bi Quán Thế Âm Bồ Tát.',
      'Nam Mô Đại Trí Văn Thù Sư Lợi Bồ Tát.',
      'Nam Mô Đại Hạnh Phổ Hiền Bồ Tát.',
      'Nam Mô Địa Tạng Vương Bồ Tát.',
      'Nam Mô Dược Sư Lưu Ly Quang Vương Phật.',
      'Nam Mô Đương Lai Hạ Sanh Di Lặc Tôn Phật.',
    ],
  },
  {
    code: 'nguyen_binh_an',
    name: 'Lời nguyện bình an',
    minSeconds: 40,
    note: 'Bài nguyện do Tâm An Online soạn.',
    lines: [
      'Hôm nay con ngồi đây, thân an, tâm lắng.',
      'Con nguyện sống chậm lại, lắng nghe nhiều hơn.',
      'Con nguyện nói lời tử tế, làm việc lương thiện.',
      'Con nguyện cha mẹ, người thân được khỏe mạnh, bình an.',
      'Con nguyện những người đang khổ đau sớm vơi nhẹ.',
      'Con nguyện biết đủ, biết ơn những gì đang có.',
      'Xin cho mỗi bước chân con đi đều an lành.',
    ],
  },
  {
    code: 'hoi_huong',
    name: 'Kệ hồi hướng',
    minSeconds: 25,
    note: 'Kệ hồi hướng truyền thống.',
    lines: [
      'Nguyện đem công đức này,',
      'Hướng về khắp tất cả,',
      'Đệ tử và chúng sanh,',
      'Đều trọn thành Phật đạo.',
    ],
  },
];

export interface Zone { code: string; name: string; x: number; z: number; r: number }

export function zoneAt(zones: Zone[], x: number, z: number): Zone | null {
  for (const zn of zones) if ((x - zn.x) ** 2 + (z - zn.z) ** 2 <= zn.r * zn.r) return zn;
  return null;
}
export function inAnyZone(zones: Zone[], codes: string[], x: number, z: number): boolean {
  return zones.some((zn) => codes.includes(zn.code) && (x - zn.x) ** 2 + (z - zn.z) ** 2 <= zn.r * zn.r);
}

// Bộ lọc từ ngữ cơ bản (admin có thể mở rộng sau). So khớp không dấu.
const BANNED = ['dm', 'dcm', 'dmm', 'dit me', 'vcl', 'vkl', 'clm', 'cmm', 'fuck', 'shit', 'bitch', 'ngu vai', 'oc cho', 'thang cho', 'do ngu'];
export function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
}
export function filterText(s: string): { text: string; flagged: boolean } {
  const words = s.split(/(\s+)/);
  let flagged = false;
  const plainAll = stripAccents(s);
  const out = words.map((w) => {
    const p = stripAccents(w).replace(/[^a-z0-9]/g, '');
    if (p && BANNED.includes(p)) { flagged = true; return '*'.repeat(w.length); }
    return w;
  }).join('');
  for (const b of BANNED) if (b.includes(' ') && plainAll.includes(b)) flagged = true;
  return { text: out, flagged };
}
export function isNameAllowed(name: string): boolean {
  const p = stripAccents(name);
  return !BANNED.some((b) => p.split(/\s+/).includes(b) || (b.includes(' ') && p.includes(b)));
}
