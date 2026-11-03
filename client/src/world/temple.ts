// Dựng ngôi chùa 3D hoàn toàn bằng mã (không dùng mô hình bên ngoài).
import * as THREE from 'three';
import { HALL, CHANT_HALL, GATE_Z, POND, LAKE, URN, BELL, MEDITATION, BOUNDS, type Theme } from './layout.ts';

const mats = new Map<string, THREE.Material>();
function mat(color: number, opts: { rough?: number; metal?: number; emissive?: number; side?: THREE.Side; key?: string; transparent?: boolean; opacity?: number } = {}) {
  const key = opts.key ?? `${color}|${opts.rough}|${opts.metal}|${opts.emissive}|${opts.side}|${opts.opacity}`;
  let m = mats.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color, roughness: opts.rough ?? 0.85, metalness: opts.metal ?? 0, side: opts.side ?? THREE.FrontSide,
      emissive: opts.emissive ?? 0x000000, transparent: opts.transparent ?? false, opacity: opts.opacity ?? 1,
    });
    mats.set(key, m);
  }
  return m;
}
export const GOLD = () => mat(0xc9a046, { rough: 0.35, metal: 0.65, key: 'gold' });
const BRONZE = () => mat(0x7a5a2e, { rough: 0.45, metal: 0.6, key: 'bronze' });
const WOOD = () => mat(0x6b4228, { rough: 0.8, key: 'wood' });
const STONE = () => mat(0x9a958a, { rough: 0.95, key: 'stone' });

function box(w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0, shadow = true) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  mesh.castShadow = shadow; mesh.receiveShadow = true;
  return mesh;
}
function cyl(rt: number, rb: number, h: number, m: THREE.Material, x = 0, y = 0, z = 0, seg = 12) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}

/** Mái chùa cong, bốn góc đầu đao vểnh lên */
export function roof(w: number, d: number, h: number, curl: number, m: THREE.Material, edge: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const N = 28;
  const geo = new THREE.PlaneGeometry(w, d, N, N);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const hw = w / 2, hd = d / 2, ridge = Math.max(0, hw - hd);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const dx = Math.max(0, Math.abs(x) - ridge) / hd, dz = Math.abs(z) / hd;
    const t = Math.min(1, Math.max(dx, dz));
    const u = Math.abs(x) / hw, v = Math.abs(z) / hd;
    const y = h * Math.pow(1 - t, 1.55) + curl * Math.pow(u * v, 5) + curl * 0.25 * Math.pow(Math.max(u, v), 8);
    pos.setY(i, y);
  }
  geo.computeVertexNormals();
  const top = new THREE.Mesh(geo, m);
  top.castShadow = true; top.receiveShadow = true;
  g.add(top);
  // Mặt dưới mái (màu gỗ) để nhìn từ dưới không bị trống
  const under = new THREE.Mesh(geo.clone(), mat(0x4a2c1c, { side: THREE.BackSide, key: 'roof-under' }));
  under.position.y = -0.08;
  g.add(under);
  // Bờ nóc + hai đầu cong + "lưỡng long chầu nguyệt" cách điệu
  if (ridge > 0.3) {
    const beam = box(ridge * 2 + 0.6, 0.35, 0.35, edge, 0, h + 0.12, 0);
    g.add(beam);
    for (const s of [-1, 1]) {
      const tor = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.12, 6, 12, Math.PI), edge);
      tor.position.set(s * (ridge + 0.3), h + 0.55, 0);
      tor.rotation.z = s > 0 ? -Math.PI / 2 : Math.PI / 2;
      g.add(tor);
    }
    const pearl = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10), GOLD());
    pearl.position.set(0, h + 0.65, 0);
    g.add(pearl);
  }
  // Đầu đao ở 4 góc
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.9, 6), edge);
    tip.position.set(sx * hw * 0.98, curl * 1.1 + 0.25, sz * hd * 0.98);
    tip.rotation.z = -sx * 0.5; tip.rotation.x = sz * 0.5;
    g.add(tip);
  }
  return g;
}

export function textSign(text: string, w: number, h: number, bg = '#7a1f12', fg = '#f2c14e'): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = 512; c.height = Math.round(512 * (h / w));
  const x = c.getContext('2d')!;
  x.fillStyle = bg; x.fillRect(0, 0, c.width, c.height);
  x.strokeStyle = fg; x.lineWidth = 8; x.strokeRect(10, 10, c.width - 20, c.height - 20);
  x.fillStyle = fg; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = `700 ${Math.floor(c.height * 0.48)}px "Playfair Display", Georgia, serif`;
  x.fillText(text, c.width / 2, c.height / 2 + 4);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }));
  return m;
}

function rng(seed: number) {
  return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
}

export interface TempleRefs {
  group: THREE.Group;
  candles: THREE.Mesh[];       // ngọn lửa nến (ẩn khi chưa thắp)
  flowerVases: THREE.Group[];  // bình hoa (hiện hoa khi dâng)
  urnTop: THREE.Vector3;       // điểm cắm hương
  bell: THREE.Object3D;
  water: THREE.Mesh[];
  lanternLights: THREE.Mesh[]; // đèn lồng sáng ban đêm
  lotus: THREE.Object3D[];
  buddhaHalo: THREE.Mesh;
}

export function buildTemple(theme: Theme, templeName: string): TempleRefs {
  const g = new THREE.Group();
  g.userData.theme = theme.code;
  const roofM = mat(theme.roof, { rough: 0.7 });
  const edgeM = mat(theme.roofEdge, { rough: 0.7 });
  const wallM = mat(theme.wall, { rough: 0.9 });
  const pillarM = mat(theme.pillar, { rough: 0.55 });
  const trimM = mat(theme.trim, { rough: 0.45, metal: 0.3 });
  const refs: TempleRefs = { group: g, candles: [], flowerVases: [], urnTop: new THREE.Vector3(URN.x, 2.1, URN.z), bell: new THREE.Group(), water: [], lanternLights: [], lotus: [], buddhaHalo: null as any };
  const R = rng(theme.code.length * 7919 + 13);

  // ---------- Mặt đất ----------
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), mat(theme.ground, { rough: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
  g.add(ground);
  const inner = new THREE.Mesh(new THREE.PlaneGeometry(BOUNDS.x1 - BOUNDS.x0 + 2, BOUNDS.z1 - BOUNDS.z0 + 2), mat(theme.grass, { rough: 1 }));
  inner.rotation.x = -Math.PI / 2; inner.position.set(0, 0.01, (BOUNDS.z0 + BOUNDS.z1) / 2); inner.receiveShadow = true;
  g.add(inner);
  const pathM = mat(theme.path, { rough: 0.95 });
  const flat = (w: number, d: number, x: number, z: number, m = pathM, y = 0.03) => {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, d), m);
    p.rotation.x = -Math.PI / 2; p.position.set(x, y, z); p.receiveShadow = true; g.add(p); return p;
  };
  // Sân gạch + lối đi
  flat(22, 38, 0, 11, mat(0xa86a4a, { rough: 0.95, key: 'brick' }), 0.025);
  flat(4, 12, 0, 38);
  flat(16, 2.4, -9, 6);   // tới gác chuông
  flat(14, 2.4, -17, -6); // tới ao sen
  flat(14, 2.4, 15, 6);   // tới hồ hoa đăng
  flat(2.4, 18, -24, 12); // tới khu thiền
  flat(2.4, 14, 22, -9);  // tới giảng đường
  flat(10, 2.4, 16, -2);

  // ---------- Tường bao ----------
  const wallLow = mat(0xd8c9a8, { rough: 0.95, key: 'lowwall' });
  g.add(box(30.5, 1.4, 0.6, wallLow, -22.85, 0.7, GATE_Z));
  g.add(box(30.5, 1.4, 0.6, wallLow, 22.85, 0.7, GATE_Z));
  g.add(box(0.6, 1.4, 66, wallLow, BOUNDS.x0 - 0.5, 0.7, 1));
  g.add(box(0.6, 1.4, 66, wallLow, BOUNDS.x1 + 0.5, 0.7, 1));
  g.add(box(77, 1.4, 0.6, wallLow, 0, 0.7, BOUNDS.z0 - 0.5));

  // ---------- Cổng tam quan ----------
  const gate = new THREE.Group();
  gate.position.set(0, 0, GATE_Z);
  for (const x of [-7.6, -5.2, -2.4, 2.4, 5.2, 7.6]) {
    const big = Math.abs(x) === 2.4;
    gate.add(cyl(0.38, 0.42, big ? 5.4 : 4.2, pillarM, x, big ? 2.7 : 2.1, 0));
    gate.add(box(1, 0.5, 1, STONE(), x, 0.25, 0));
  }
  gate.add(box(5.6, 0.5, 0.7, pillarM, 0, 5.1, 0));
  gate.add(box(3.4, 0.4, 0.6, pillarM, -3.8, 3.9, 0));
  gate.add(box(3.4, 0.4, 0.6, pillarM, 3.8, 3.9, 0));
  const r1 = roof(7.6, 3.4, 1.5, 0.7, roofM, edgeM); r1.position.set(0, 5.35, 0); gate.add(r1);
  const r2 = roof(4.6, 3, 1.1, 0.5, roofM, edgeM); r2.position.set(-3.8, 4.1, 0); gate.add(r2);
  const r3 = roof(4.6, 3, 1.1, 0.5, roofM, edgeM); r3.position.set(3.8, 4.1, 0); gate.add(r3);
  const sign = textSign(templeName.toUpperCase(), 3.6, 0.8); sign.position.set(0, 4.55, 0.36); gate.add(sign);
  const signB = sign.clone(); signB.rotation.y = Math.PI; signB.position.z = -0.36; gate.add(signB);
  g.add(gate);
  // Bia đá giới thiệu
  const stele = new THREE.Group();
  stele.add(box(1.4, 2, 0.35, STONE(), 0, 1.3, 0));
  stele.add(box(1.8, 0.3, 0.6, STONE(), 0, 0.15, 0));
  const turtle = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 8), STONE()); turtle.scale.set(1.2, 0.45, 1.5); turtle.position.y = 0.3; stele.add(turtle);
  stele.position.set(-4.5, 0, 30); stele.rotation.y = 0.35;
  g.add(stele);

  // ---------- Lư hương ----------
  const urn = new THREE.Group();
  urn.position.set(URN.x, 0, URN.z);
  urn.add(box(2.2, 0.6, 2.2, STONE(), 0, 0.3, 0));
  const urnPts = [[0, 0], [0.55, 0.05], [0.85, 0.35], [0.95, 0.7], [0.8, 1.0], [0.9, 1.1], [0.85, 1.15], [0, 1.15]].map(([x, y]) => new THREE.Vector2(x, y));
  const urnBody = new THREE.Mesh(new THREE.LatheGeometry(urnPts, 20), BRONZE()); urnBody.position.y = 0.75; urnBody.castShadow = true; urn.add(urnBody);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    urn.add(cyl(0.08, 0.12, 0.5, BRONZE(), Math.cos(a) * 0.6, 0.75, Math.sin(a) * 0.6, 6));
  }
  const ash = new THREE.Mesh(new THREE.CircleGeometry(0.82, 20), mat(0x8c8580, { key: 'ash' })); ash.rotation.x = -Math.PI / 2; ash.position.y = 1.85; urn.add(ash);
  g.add(urn);

  // ---------- Gác chuông ----------
  const bt = new THREE.Group(); bt.position.set(BELL.x, 0, BELL.z);
  bt.add(box(4.6, 0.4, 4.6, STONE(), 0, 0.2, 0));
  for (const [dx, dz] of [[-1.8, -1.8], [1.8, -1.8], [-1.8, 1.8], [1.8, 1.8]]) bt.add(cyl(0.22, 0.26, 4.6, pillarM, dx, 2.5, dz));
  bt.add(box(4.2, 0.3, 0.3, pillarM, 0, 4.4, 0));
  const btRoof = roof(6, 6, 1.8, 0.7, roofM, edgeM); btRoof.position.y = 4.8; bt.add(btRoof);
  const bellPivot = new THREE.Group(); bellPivot.position.y = 4.3;
  const bellPts = [[0, 0], [0.25, 0.02], [0.45, -0.25], [0.55, -0.9], [0.68, -1.45], [0.72, -1.55], [0, -1.55]].map(([x, y]) => new THREE.Vector2(x, y));
  const bellMesh = new THREE.Mesh(new THREE.LatheGeometry(bellPts, 24), BRONZE()); bellMesh.castShadow = true;
  bellPivot.add(bellMesh);
  bt.add(bellPivot);
  refs.bell = bellPivot;
  const log = cyl(0.12, 0.12, 2, WOOD(), 1.1, 3.2, 0, 8); log.rotation.z = Math.PI / 2; bt.add(log);
  g.add(bt);

  // ---------- Chánh điện ----------
  const H = HALL, hall = new THREE.Group();
  hall.position.set(H.cx, 0, H.cz);
  hall.add(box(H.w + 3, 0.6, H.d + 4, STONE(), 0, 0.3, 1));
  // bậc thềm
  hall.add(box(H.doorW + 2, 0.3, 1.2, STONE(), 0, 0.15, H.d / 2 + 3.4));
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(H.w, H.d), mat(0x8a3a24, { rough: 0.6, key: 'hallfloor' }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = 0.62; floor.receiveShadow = true; hall.add(floor);
  const wallH = 5.2;
  hall.add(box(H.w, wallH, 0.6, wallM, 0, wallH / 2 + 0.6, -H.d / 2 - 0.3));
  hall.add(box(0.6, wallH, H.d, wallM, -H.w / 2 - 0.3, wallH / 2 + 0.6, 0));
  hall.add(box(0.6, wallH, H.d, wallM, H.w / 2 + 0.3, wallH / 2 + 0.6, 0));
  const sideW = (H.w - H.doorW) / 2;
  hall.add(box(sideW, wallH, 0.6, wallM, -(H.doorW / 2 + sideW / 2), wallH / 2 + 0.6, H.d / 2 - 0.3));
  hall.add(box(sideW, wallH, 0.6, wallM, H.doorW / 2 + sideW / 2, wallH / 2 + 0.6, H.d / 2 - 0.3));
  hall.add(box(H.doorW, 1.4, 0.6, wallM, 0, wallH - 0.1, H.d / 2 - 0.3));
  // cửa bức bàn (khung gỗ đỏ) hai bên lối vào
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {
    const p = box(1.5, 3.6, 0.1, mat(0x7a2414, { rough: 0.5, key: 'door' }), s * (H.doorW / 2 + 0.9 + i * 1.6), 2.5, H.d / 2 + 0.02, false);
    hall.add(p);
    hall.add(box(1.2, 0.08, 0.12, trimM, s * (H.doorW / 2 + 0.9 + i * 1.6), 3.2, H.d / 2 + 0.06, false));
  }
  // cột trong & hiên
  for (const x of [-6, 6]) for (const z of [-12, -18]) hall.add(cyl(0.38, 0.42, wallH, pillarM, x - H.cx, wallH / 2 + 0.6, z - H.cz));
  for (const x of [-10, -4, 4, 10]) hall.add(cyl(0.32, 0.36, wallH, pillarM, x, wallH / 2 + 0.6, -6.2 - H.cz));
  // trần
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(H.w, H.d), mat(0x5a3020, { key: 'ceiling', side: THREE.DoubleSide }));
  ceiling.rotation.x = Math.PI / 2; ceiling.position.y = wallH + 0.6; hall.add(ceiling);
  // hai tầng mái
  const hr1 = roof(H.w + 5, H.d + 6, 2.6, 1.2, roofM, edgeM); hr1.position.set(0, wallH + 0.5, 1); hall.add(hr1);
  hall.add(box(H.w - 6, 2, H.d - 6, wallM, 0, wallH + 2.6, 0));
  const hr2 = roof(H.w - 2, H.d - 2, 2.6, 1.0, roofM, edgeM); hr2.position.set(0, wallH + 3.4, 0); hall.add(hr2);
  const hsign = textSign('ĐẠI HÙNG BẢO ĐIỆN', 5.2, 0.9); hsign.position.set(0, wallH + 0.15, H.d / 2 + 0.02); hall.add(hsign);
  g.add(hall);

  // Bệ thờ & tượng Phật (toạ độ thế giới)
  const altar = new THREE.Group();
  altar.add(box(10, 1.2, 4, mat(0x7a2414, { rough: 0.5, key: 'door' }), 0, 1.2, -21.4));
  altar.add(box(10.2, 0.15, 4.2, trimM, 0, 1.85, -21.4));
  altar.add(box(6, 1.1, 2.6, mat(0x7a2414, { rough: 0.5, key: 'door' }), 0, 2.4, -22));
  altar.add(box(6.2, 0.12, 2.8, trimM, 0, 2.98, -22));
  // bàn lễ phía trước
  altar.add(box(6.4, 0.9, 1.4, mat(0x6b2a18, { key: 'table' }), 0, 1.05, -19.9));
  altar.add(box(6.6, 0.1, 1.5, trimM, 0, 1.52, -19.9));
  // Tượng Phật
  const buddha = new THREE.Group();
  buddha.position.set(0, 3.05, -22.2);
  const lotusSeat = new THREE.Group();
  for (let ring = 0; ring < 2; ring++) for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + ring * 0.26;
    const petal = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), GOLD());
    petal.scale.set(0.6, 1, 0.35);
    petal.position.set(Math.cos(a) * (1.05 - ring * 0.2), 0.3 + ring * 0.2, Math.sin(a) * (1.05 - ring * 0.2));
    petal.rotation.y = -a; petal.rotation.z = 0.5;
    lotusSeat.add(petal);
  }
  buddha.add(lotusSeat);
  const legs = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), GOLD()); legs.scale.set(1.15, 0.38, 0.8); legs.position.y = 0.75; buddha.add(legs);
  const bodyPts = [[0, 0], [0.75, 0], [0.8, 0.5], [0.68, 1.1], [0.5, 1.45], [0.3, 1.55], [0, 1.55]].map(([x, y]) => new THREE.Vector2(x, y));
  const body = new THREE.Mesh(new THREE.LatheGeometry(bodyPts, 20), GOLD()); body.position.y = 0.8; body.scale.z = 0.75; buddha.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 20, 16), GOLD()); head.position.y = 2.75; buddha.add(head);
  const ush = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), GOLD()); ush.position.y = 3.17; buddha.add(ush);
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.3, 4, 8), GOLD()); ear.position.set(s * 0.42, 2.65, 0); buddha.add(ear);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.75, 4, 8), GOLD()); arm.position.set(s * 0.72, 1.75, 0.1); arm.rotation.z = s * 0.35; buddha.add(arm);
  }
  const hands = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8), GOLD()); hands.scale.set(1.2, 0.5, 0.8); hands.position.set(0, 1.15, 0.55); buddha.add(hands);
  const halo = new THREE.Mesh(new THREE.CircleGeometry(1.4, 40), new THREE.MeshStandardMaterial({ color: 0xf6d27a, emissive: 0xc9973a, emissiveIntensity: 0.6, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
  halo.position.set(0, 2.7, -0.55); buddha.add(halo);
  refs.buddhaHalo = halo;
  const haloRing = new THREE.Mesh(new THREE.TorusGeometry(1.45, 0.06, 6, 48), GOLD()); haloRing.position.copy(halo.position); buddha.add(haloRing);
  altar.add(buddha);
  // Nến & bình hoa trên bàn lễ
  for (const x of [-2.6, -2.0]) {
    altar.add(cyl(0.12, 0.14, 0.15, BRONZE(), x, 1.65, -19.8, 10));
    altar.add(cyl(0.07, 0.07, 0.5, mat(0xf3eadc, { key: 'wax' }), x, 1.95, -19.8, 8));
    const flame = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffb347 }));
    flame.scale.y = 1.8; flame.position.set(x, 2.3, -19.8); flame.visible = false;
    altar.add(flame); refs.candles.push(flame);
  }
  for (const x of [2.0, 2.6]) {
    const vase = new THREE.Group(); vase.position.set(x, 1.57, -19.8);
    const vpts = [[0, 0], [0.12, 0], [0.16, 0.12], [0.1, 0.32], [0.13, 0.42], [0, 0.42]].map(([a, b]) => new THREE.Vector2(a, b));
    vase.add(new THREE.Mesh(new THREE.LatheGeometry(vpts, 12), mat(0x3f6e8f, { rough: 0.3, key: 'porcelain' })));
    const bouquet = new THREE.Group(); bouquet.visible = false;
    for (let i = 0; i < 4; i++) {
      const stem = cyl(0.012, 0.012, 0.5, mat(0x3f7a3a, { key: 'stem' }), (i - 1.5) * 0.05, 0.62, 0, 4);
      const bloom = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.14, 6), mat(0xf2a7bb, { key: 'lotuspink' }));
      bloom.position.set((i - 1.5) * 0.05, 0.92, 0); bloom.rotation.x = Math.PI;
      bouquet.add(stem, bloom);
    }
    vase.add(bouquet);
    altar.add(vase); refs.flowerVases.push(bouquet);
  }
  // Bồ đoàn
  const matM = mat(0xc28a2c, { rough: 0.9, key: 'mat' });
  for (let r = 0; r < 3; r++) for (let i = -3; i <= 3; i++) {
    const m = cyl(0.42, 0.45, 0.16, matM, i * 1.6, 0.7, -15.5 + r * 2, 16);
    altar.add(m);
  }
  // Đèn trong điện
  const lampM = new THREE.MeshStandardMaterial({ color: 0xd04a2a, emissive: 0xff7a3a, emissiveIntensity: 0.15 });
  for (const x of [-6, 6]) {
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.8, 10), lampM);
    l.position.set(x, 4.6, -15); altar.add(l); refs.lanternLights.push(l);
  }
  g.add(altar);

  // ---------- Ao sen ----------
  const water = (r: number, x: number, z: number, color: number) => {
    const geo = new THREE.CircleGeometry(r, 48, 0, Math.PI * 2);
    const w = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.15, metalness: 0.2, transparent: true, opacity: 0.88 }));
    w.rotation.x = -Math.PI / 2; w.position.set(x, 0.08, z);
    refs.water.push(w); g.add(w);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(r + 0.15, 0.28, 6, 48), STONE());
    rim.rotation.x = Math.PI / 2; rim.position.set(x, 0.12, z); rim.receiveShadow = true; g.add(rim);
    return w;
  };
  water(POND.r, POND.x, POND.z, theme.water);
  const padM = mat(0x3f7a3a, { rough: 0.8, key: 'pad', side: THREE.DoubleSide });
  const pinkM = mat(0xf0a0b8, { rough: 0.6, key: 'lotus' });
  const whiteM = mat(0xf6efe6, { rough: 0.6, key: 'lotusw' });
  for (let i = 0; i < 26; i++) {
    const a = R() * Math.PI * 2, d = Math.sqrt(R()) * (POND.r - 0.8);
    const x = POND.x + Math.cos(a) * d, z = POND.z + Math.sin(a) * d;
    const pad = new THREE.Mesh(new THREE.CircleGeometry(0.35 + R() * 0.35, 12, 0.3, Math.PI * 1.85), padM);
    pad.rotation.x = -Math.PI / 2; pad.rotation.z = R() * 6; pad.position.set(x, 0.12, z);
    g.add(pad);
    if (R() < 0.45) {
      const fl = new THREE.Group();
      for (let k = 0; k < 8; k++) {
        const pet = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 4), R() < 0.3 ? whiteM : pinkM);
        pet.scale.set(0.5, 1.2, 0.3);
        const ang = (k / 8) * Math.PI * 2;
        pet.position.set(Math.cos(ang) * 0.1, 0.12, Math.sin(ang) * 0.1);
        pet.rotation.set(Math.sin(ang) * 0.6, 0, -Math.cos(ang) * 0.6);
        fl.add(pet);
      }
      fl.add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 8), mat(0xe8c040, { key: 'pistil' })));
      fl.position.set(x + 0.1, 0.18, z);
      g.add(fl); refs.lotus.push(fl);
    }
  }

  // ---------- Hồ hoa đăng ----------
  water(LAKE.r, LAKE.x, LAKE.z, theme.water);
  const dock = box(3.2, 0.2, 1.4, WOOD(), LAKE.x - LAKE.r + 1.2, 0.3, LAKE.z);
  g.add(dock);

  // ---------- Khu thiền ----------
  const med = new THREE.Group(); med.position.set(MEDITATION.x, 0, MEDITATION.z);
  med.add(new THREE.Mesh(new THREE.CircleGeometry(4.5, 32), mat(0x8c7a5a, { key: 'medfloor' })).rotateX(-Math.PI / 2).translateZ(0.04));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    med.add(cyl(0.42, 0.45, 0.16, matM, Math.cos(a) * 2.4, 0.1, Math.sin(a) * 2.4, 16));
  }
  const stoneLamp = new THREE.Group();
  stoneLamp.add(cyl(0.2, 0.3, 1, STONE(), 0, 0.5, 0, 8));
  const lampBox = box(0.6, 0.5, 0.6, mat(0xa8a090, { emissive: 0xffa040, key: 'stonelamp' }), 0, 1.25, 0, false);
  stoneLamp.add(lampBox); refs.lanternLights.push(lampBox);
  stoneLamp.add(new THREE.Mesh(new THREE.ConeGeometry(0.6, 0.5, 4), STONE()).translateY(1.75));
  med.add(stoneLamp);
  // Rặng trúc bao quanh (chừa lối vào phía Nam)
  const bambooM = mat(0x7f9a4a, { key: 'bamboo' });
  for (let i = 0; i < 70; i++) {
    const a = R() * Math.PI * 2;
    if (Math.abs(a - Math.PI / 2) < 0.6) continue; // lối vào
    const d = 5.3 + R() * 1.6, h = 5 + R() * 3.5;
    const b = cyl(0.07, 0.09, h, bambooM, Math.cos(a) * d, h / 2, Math.sin(a) * d, 5);
    b.rotation.z = (R() - 0.5) * 0.12; med.add(b);
    if (R() < 0.6) {
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.7, 6, 4), mat(0x5f8a3a, { key: 'bambooleaf' }));
      leaf.scale.set(1, 0.4, 1); leaf.position.set(Math.cos(a) * d, h - 0.3, Math.sin(a) * d); med.add(leaf);
    }
  }
  g.add(med);

  // ---------- Giảng đường ----------
  const C = CHANT_HALL, ch = new THREE.Group(); ch.position.set(C.cx, 0, C.cz);
  ch.add(box(C.w + 1.4, 0.5, C.d + 1.4, STONE(), 0, 0.25, 0));
  ch.add(box(C.w, 4, 0.5, wallM, 0, 2.5, -C.d / 2 - 0.25));
  ch.add(box(0.5, 4, C.d - 2, wallM, -C.w / 2 - 0.25, 2.5, -1));
  ch.add(box(0.5, 4, C.d - 2, wallM, C.w / 2 + 0.25, 2.5, -1));
  for (const x of [-C.w / 2, C.w / 2, -C.w / 6, C.w / 6]) ch.add(cyl(0.25, 0.28, 4, pillarM, x, 2.5, C.d / 2 - 0.3));
  const cr = roof(C.w + 3, C.d + 3, 2.2, 0.8, roofM, edgeM); cr.position.y = 4.4; ch.add(cr);
  ch.add(box(1.2, 1, 0.7, WOOD(), 0, 1, -2));
  const book = box(0.8, 0.08, 0.55, mat(0xe9dfc8, { key: 'paper' }), 0, 1.55, -2); book.rotation.x = -0.3; ch.add(book);
  for (let i = -2; i <= 2; i++) ch.add(cyl(0.4, 0.43, 0.15, matM, i * 1.5, 0.58, 0.5, 14));
  const mo = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 10), mat(0xa5561f, { rough: 0.5, key: 'mo' })); mo.scale.set(1, 0.75, 1); mo.position.set(1.4, 0.8, -2); ch.add(mo);
  const csign = textSign('GIẢNG ĐƯỜNG', 3, 0.6); csign.position.set(0, 4.2, C.d / 2 - 0.05); ch.add(csign);
  g.add(ch);

  // ---------- Đèn lồng dọc lối đi ----------
  const lanternM = new THREE.MeshStandardMaterial({ color: 0xc8402a, emissive: 0xff8a3a, emissiveIntensity: 0.1, roughness: 0.6 });
  for (const z of [26, 18, 10, -2]) for (const x of [-3.2, 3.2]) {
    const post = new THREE.Group(); post.position.set(x, 0, z);
    post.add(cyl(0.08, 0.1, 2.6, WOOD(), 0, 1.3, 0, 6));
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 10), lanternM); l.scale.y = 1.25; l.position.y = 2.75;
    post.add(l); refs.lanternLights.push(l);
    g.add(post);
  }

  // ---------- Cây ----------
  const trunkM = mat(0x5a3d26, { key: 'trunk' });
  const leafM = mat(theme.tree === 'pine' ? 0x2f5a3a : theme.tree === 'palm' ? 0x4f8a3a : 0x3f6e32, { rough: 0.9, key: 'leaf-' + theme.tree });
  const tree = (x: number, z: number, s: number) => {
    const t = new THREE.Group(); t.position.set(x, 0, z); t.scale.setScalar(s);
    if (theme.tree === 'pine') {
      t.add(cyl(0.18, 0.26, 2, trunkM, 0, 1, 0, 6));
      for (let i = 0; i < 4; i++) { const c = new THREE.Mesh(new THREE.ConeGeometry(1.8 - i * 0.35, 1.8, 8), leafM); c.position.y = 2 + i * 1.05; c.castShadow = true; t.add(c); }
    } else if (theme.tree === 'palm') {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.22, 5, 6), trunkM); trunk.position.set(0.3, 2.5, 0); trunk.rotation.z = -0.12; trunk.castShadow = true; t.add(trunk);
      for (let i = 0; i < 7; i++) {
        const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.35, 2.6, 4), leafM);
        const a = (i / 7) * Math.PI * 2;
        leaf.position.set(0.6 + Math.cos(a) * 1, 4.9, Math.sin(a) * 1);
        leaf.rotation.set(Math.sin(a) * 1.1, 0, -Math.cos(a) * 1.1);
        leaf.scale.z = 0.25; t.add(leaf);
      }
    } else {
      t.add(cyl(0.3, 0.5, 2.6, trunkM, 0, 1.3, 0, 7));
      for (let i = 0; i < 5; i++) {
        const c = new THREE.Mesh(new THREE.IcosahedronGeometry(1.4 + R() * 0.6, 0), leafM);
        c.position.set((R() - 0.5) * 2.2, 3.1 + R() * 1.2, (R() - 0.5) * 2.2); c.castShadow = true; t.add(c);
      }
    }
    g.add(t);
  };
  const spots: [number, number][] = [];
  for (let i = 0; i < 200 && spots.length < 46; i++) {
    const x = BOUNDS.x0 + 1 + R() * (BOUNDS.x1 - BOUNDS.x0 - 2), z = BOUNDS.z0 + 1 + R() * (GATE_Z - BOUNDS.z0 - 3);
    const near = (cx: number, cz: number, r: number) => (x - cx) ** 2 + (z - cz) ** 2 < r * r;
    if (Math.abs(x) < 14 && z > -27 && z < GATE_Z) continue;          // sân & chánh điện
    if (near(POND.x, POND.z, POND.r + 3) || near(LAKE.x, LAKE.z, LAKE.r + 3) || near(MEDITATION.x, MEDITATION.z, 8)) continue;
    if (x > 14 && x < 30 && z < -13 && z > -27) continue;              // giảng đường
    if (near(BELL.x, BELL.z, 5)) continue;
    if (Math.abs(z - 6) < 2 || Math.abs(z + 6) < 2 || Math.abs(x + 24) < 2 || Math.abs(x - 22) < 2) continue; // lối đi
    if (spots.some(([sx, sz]) => (sx - x) ** 2 + (sz - z) ** 2 < 16)) continue;
    spots.push([x, z]);
  }
  for (const [x, z] of spots) tree(x, z, 0.85 + R() * 0.5);
  // Hàng cây ngoài cổng
  for (const s of [-1, 1]) for (let i = 0; i < 4; i++) tree(s * (6 + i * 7), GATE_Z + 6 + (i % 2) * 2, 0.9);

  // ---------- Cảnh xa ----------
  if (theme.mountains) {
    const mM = mat(0x5f6f62, { rough: 1, key: 'mount' }), mM2 = mat(0x7d8b84, { rough: 1, key: 'mount2' });
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2, d = 95 + R() * 40, h = 30 + R() * 45;
      const m = new THREE.Mesh(new THREE.ConeGeometry(18 + R() * 16, h, 7), i % 2 ? mM : mM2);
      m.position.set(Math.cos(a) * d, h / 2 - 2, Math.sin(a) * d); g.add(m);
    }
  } else if (!theme.sea) {
    // ruộng lúa & đồi thấp
    const field = mat(0x9db45a, { rough: 1, key: 'field' });
    for (let i = 0; i < 10; i++) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(30, 18), field);
      p.rotation.x = -Math.PI / 2; p.position.set(-120 + i * 26, 0.005, 70 + (i % 3) * 20); g.add(p);
    }
    const hill = mat(0x6f8a50, { rough: 1, key: 'hill' });
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2, d = 140;
      const h = new THREE.Mesh(new THREE.SphereGeometry(25 + R() * 15, 12, 8), hill);
      h.scale.y = 0.35; h.position.set(Math.cos(a) * d, 0, Math.sin(a) * d); g.add(h);
    }
  }
  if (theme.sea) {
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(400, 160), new THREE.MeshStandardMaterial({ color: 0x2f7fa0, roughness: 0.2, metalness: 0.2 }));
    sea.rotation.x = -Math.PI / 2; sea.position.set(0, 0.04, -115); g.add(sea); refs.water.push(sea);
    const sea2 = sea.clone(); sea2.rotation.z = Math.PI / 2; sea2.position.set(125, 0.04, 0); g.add(sea2);
  }
  return refs;
}
