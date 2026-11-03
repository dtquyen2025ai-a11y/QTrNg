// Bố cục bản đồ dùng chung cho 3 chùa (khớp toạ độ khu vực trong DB).
// Trục: x sang phải (Đông), z về phía cổng (Nam), y lên trên.

export interface Box { x0: number; x1: number; z0: number; z1: number }
export interface Circle { x: number; z: number; r: number }

export const SPAWN = { x: 0, z: 40 };
export const BOUNDS = { x0: -38, x1: 38, z0: -32, z1: 44 };

export const HALL = { cx: 0, cz: -16, w: 24, d: 16, doorW: 8 };          // Chánh điện
export const CHANT_HALL = { cx: 22, cz: -20, w: 10, d: 8 };               // Giảng đường
export const GATE_Z = 34;
export const POND = { x: -24, z: -6, r: 6.5 };                              // Ao sen
export const LAKE = { x: 25, z: 6, r: 7.5 };                                // Hồ hoa đăng
export const URN = { x: 0, z: 5 };
export const BELL = { x: -16, z: 6 };
export const MEDITATION = { x: -24, z: 22 };

const T = 0.6; // độ dày tường

export function colliders(): { boxes: Box[]; circles: Circle[] } {
  const h = HALL, x0 = h.cx - h.w / 2, x1 = h.cx + h.w / 2, z0 = h.cz - h.d / 2, z1 = h.cz + h.d / 2;
  const c = CHANT_HALL, cx0 = c.cx - c.w / 2, cx1 = c.cx + c.w / 2, cz0 = c.cz - c.d / 2;
  const boxes: Box[] = [
    // Chánh điện: tường sau, hai bên, mặt trước chừa cửa
    { x0, x1, z0: z0 - T, z1: z0 },
    { x0: x0 - T, x1: x0, z0, z1 },
    { x0: x1, x1: x1 + T, z0, z1 },
    { x0, x1: -h.doorW / 2, z0: z1 - T, z1 },
    { x0: h.doorW / 2, x1, z0: z1 - T, z1 },
    // Bệ thờ
    { x0: -5, x1: 5, z0: -23.4, z1: -19.4 },
    // Giảng đường: tường sau và hai bên (mặt trước để mở)
    { x0: cx0, x1: cx1, z0: cz0 - T, z1: cz0 },
    { x0: cx0 - T, x1: cx0, z0: cz0, z1: c.cz + c.d / 2 - 2 },
    { x0: cx1, x1: cx1 + T, z0: cz0, z1: c.cz + c.d / 2 - 2 },
    // Tường bao quanh cổng tam quan (chừa 3 lối đi)
    { x0: -38, x1: -7.6, z0: GATE_Z - 0.5, z1: GATE_Z + 0.5 },
    { x0: 7.6, x1: 38, z0: GATE_Z - 0.5, z1: GATE_Z + 0.5 },
  ];
  const circles: Circle[] = [
    POND, LAKE,
    { x: URN.x, z: URN.z, r: 1.3 },
    // Cột cổng tam quan
    { x: -2.4, z: GATE_Z, r: 0.5 }, { x: 2.4, z: GATE_Z, r: 0.5 },
    { x: -5.2, z: GATE_Z, r: 0.5 }, { x: 5.2, z: GATE_Z, r: 0.5 },
    { x: -7.6, z: GATE_Z, r: 0.6 }, { x: 7.6, z: GATE_Z, r: 0.6 },
    // Cột gác chuông
    ...[[-1.8, -1.8], [1.8, -1.8], [-1.8, 1.8], [1.8, 1.8]].map(([dx, dz]) => ({ x: BELL.x + dx, z: BELL.z + dz, r: 0.35 })),
    // Cột chánh điện
    ...[-6, 6].flatMap((x) => [-12, -18].map((z) => ({ x, z, r: 0.45 }))),
    // Cột hiên chánh điện
    ...[-10, -4, 4, 10].map((x) => ({ x, z: -6.2, r: 0.4 })),
  ];
  return { boxes, circles };
}

/** Đẩy vị trí ra khỏi vật cản */
export function resolve(x: number, z: number, radius: number, col: ReturnType<typeof colliders>): [number, number] {
  for (let iter = 0; iter < 2; iter++) {
    for (const b of col.boxes) {
      const cx = Math.max(b.x0, Math.min(x, b.x1)), cz = Math.max(b.z0, Math.min(z, b.z1));
      const dx = x - cx, dz = z - cz, d2 = dx * dx + dz * dz;
      if (d2 < radius * radius) {
        if (d2 > 1e-6) { const d = Math.sqrt(d2), k = (radius - d) / d; x += dx * k; z += dz * k; }
        else {
          // tâm nằm trong hộp: đẩy theo cạnh gần nhất
          const opts = [[b.x0 - radius - x, 0], [b.x1 + radius - x, 0], [0, b.z0 - radius - z], [0, b.z1 + radius - z]];
          opts.sort((a, c) => Math.abs(a[0] + a[1]) - Math.abs(c[0] + c[1]));
          x += opts[0][0]; z += opts[0][1];
        }
      }
    }
    for (const c of col.circles) {
      const dx = x - c.x, dz = z - c.z, d = Math.hypot(dx, dz), min = c.r + radius;
      if (d < min) {
        // đứng đúng tâm vật cản: đẩy sang phải để trượt vòng qua
        const ux = d > 1e-6 ? dx / d : 1, uz = d > 1e-6 ? dz / d : 0;
        x = c.x + ux * min; z = c.z + uz * min;
      }
    }
  }
  x = Math.max(BOUNDS.x0, Math.min(BOUNDS.x1, x));
  z = Math.max(BOUNDS.z0, Math.min(BOUNDS.z1, z));
  return [x, z];
}

export interface Theme {
  code: string;
  ground: number; grass: number; path: number; wall: number; roof: number; roofEdge: number; pillar: number; trim: number;
  water: number; skyDay: number; skyDusk: number; skyNight: number; fogNear: number; fogFar: number;
  tree: 'banyan' | 'pine' | 'palm';
  mountains: boolean; sea: boolean; mist: boolean;
}

export const THEMES: Record<string, Theme> = {
  tam_an: {
    code: 'tam_an', ground: 0x8a9a5b, grass: 0x6f8f45, path: 0xb9a58a, wall: 0xe8d9b8, roof: 0x9a3b22, roofEdge: 0x6e2414,
    pillar: 0x8e2a1a, trim: 0xc9973a, water: 0x3f7a7a, skyDay: 0x9cc8e6, skyDusk: 0xe9a46a, skyNight: 0x0e1631,
    fogNear: 60, fogFar: 170, tree: 'banyan', mountains: false, sea: false, mist: false,
  },
  van_son: {
    code: 'van_son', ground: 0x6f7a62, grass: 0x55704a, path: 0x9d9a90, wall: 0xd9d0bd, roof: 0x4d4a48, roofEdge: 0x2f2d2c,
    pillar: 0x6e2a1c, trim: 0xb08a4a, water: 0x4d7f86, skyDay: 0xb9c9d3, skyDusk: 0xc99a85, skyNight: 0x10162a,
    fogNear: 18, fogFar: 95, tree: 'pine', mountains: true, sea: false, mist: true,
  },
  hai_nguyet: {
    code: 'hai_nguyet', ground: 0xd8c79e, grass: 0x8fa35a, path: 0xe6d8b6, wall: 0xf0d79a, roof: 0x8f3a24, roofEdge: 0x5e2213,
    pillar: 0x8a2b1a, trim: 0xd8a64a, water: 0x2f7fa0, skyDay: 0x8fd0f0, skyDusk: 0xf2a46a, skyNight: 0x0b1838,
    fogNear: 70, fogFar: 200, tree: 'palm', mountains: false, sea: true, mist: false,
  },
};

export interface Interactable {
  id: string; label: string; x: number; z: number; r: number;
  action: 'act' | 'panel'; code: string;
}

export const INTERACTABLES: Interactable[] = [
  { id: 'urn', label: 'Thắp hương', x: URN.x, z: URN.z, r: 3.2, action: 'act', code: 'incense' },
  { id: 'bell', label: 'Thỉnh chuông', x: BELL.x, z: BELL.z, r: 3.6, action: 'act', code: 'bell' },
  { id: 'candle', label: 'Thắp nến', x: -2.6, z: -18, r: 2.2, action: 'act', code: 'candle' },
  { id: 'flower', label: 'Dâng hoa', x: 2.6, z: -18, r: 2.2, action: 'act', code: 'flower' },
  { id: 'lake', label: 'Thả hoa đăng', x: LAKE.x, z: LAKE.z, r: LAKE.r + 2.6, action: 'panel', code: 'lantern' },
  { id: 'meditation', label: 'Ngồi thiền', x: MEDITATION.x, z: MEDITATION.z, r: 5, action: 'panel', code: 'meditate' },
  { id: 'chant', label: 'Tụng kinh', x: CHANT_HALL.cx, z: CHANT_HALL.cz, r: 5.5, action: 'panel', code: 'chant' },
  { id: 'stele', label: 'Đọc bia', x: -4.5, z: 30, r: 2.2, action: 'panel', code: 'stele' },
];
