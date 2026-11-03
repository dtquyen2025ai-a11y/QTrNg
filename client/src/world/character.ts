// Nhân vật 3D dựng từ khối cơ bản + hoạt ảnh thủ tục (procedural animation).
import * as THREE from 'three';

export interface LookData {
  gender: string; hair: string; skin: string;
  robe: string | null; accessory: string | null; bead: string | null;
  robeColor?: string | null;
}
export type ItemData = Record<string, { slot?: string; color?: string; trim?: string; kind?: string }>;

export const HAIRS: { code: string; name: string }[] = [
  { code: 'cao_trọc', name: 'Cạo trọc' }, { code: 'búi', name: 'Búi tóc' }, { code: 'ngắn', name: 'Tóc ngắn' },
  { code: 'dài', name: 'Tóc dài' }, { code: 'tết', name: 'Tóc tết' },
];
export const SKINS = ['#f1d3b3', '#e2b58e', '#c98f62', '#9a6643'];

function m(color: THREE.ColorRepresentation, rough = 0.8, emissive: THREE.ColorRepresentation = 0x000000) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, emissive });
}

export class Avatar {
  root = new THREE.Group();
  private body = new THREE.Group();     // nâng/hạ khi quỳ, ngồi
  private torso = new THREE.Group();    // cúi người
  private head = new THREE.Group();
  private armL = new THREE.Group(); private armR = new THREE.Group();
  private foreL = new THREE.Group(); private foreR = new THREE.Group();
  private doll!: THREE.Mesh;
  private robeMat = m('#4f6d8f', 0.85);
  private trimMat = m('#d9b45a', 0.5);
  private skinMat = m('#e2b58e', 0.7);
  private hairMat = m('#1e1612', 0.6);
  private hairGroup = new THREE.Group();
  private accessory = new THREE.Group();
  private handSlot = new THREE.Group();
  private beads: THREE.Mesh;
  private label: THREE.Sprite | null = null;
  anim = 'idle';
  private animT = 0;
  private blend = { bow: 0, hands: 0, swing: 0, reach: 0 };
  speed = 0;

  constructor(look: LookData, items: ItemData) {
    this.root.add(this.body);
    // Thân lật đật: đáy tròn, phình dưới, thon dần lên vai; áo tràng phủ kín (không lộ chân)
    const prof = [[0, 0.0], [0.17, 0.02], [0.31, 0.08], [0.4, 0.18], [0.45, 0.32], [0.45, 0.46], [0.41, 0.63], [0.34, 0.81],
      [0.28, 0.95], [0.25, 1.05], [0.21, 1.14], [0.13, 1.21], [0, 1.23]].map(([x, y]) => new THREE.Vector2(x, y));
    this.doll = new THREE.Mesh(new THREE.LatheGeometry(prof, 28), this.robeMat);
    this.doll.castShadow = true;
    this.body.add(this.doll);
    // Viền gấu áo, dây thắt lưng, cổ áo
    const band = (r: number, y: number, tube: number) => {
      const t = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 6, 32), this.trimMat);
      t.rotation.x = Math.PI / 2; t.position.y = y; this.doll.add(t); return t;
    };
    band(0.395, 0.17, 0.028);
    band(0.335, 0.86, 0.03);
    const collar = band(0.15, 1.17, 0.03); collar.rotation.x = Math.PI / 2.2; collar.position.z = 0.03;
    // Vạt áo chéo trước ngực
    const lapel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.42, 0.02), this.trimMat);
    lapel.position.set(0.05, 1.0, 0.27); lapel.rotation.set(-0.35, 0, -0.5); this.doll.add(lapel);
    // Phần thân trên (vai, tay, đầu)
    this.torso.position.y = 1.0;
    this.body.add(this.torso);
    for (const [arm, fore, s] of [[this.armL, this.foreL, -1], [this.armR, this.foreR, 1]] as const) {
      arm.position.set(s * 0.26, 0.1, 0);
      const up = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.16, 4, 10), this.robeMat);
      up.position.y = -0.12; arm.add(up);
      fore.position.y = -0.25;
      const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.2, 12), this.robeMat); // tay áo rộng
      sleeve.position.y = -0.09; fore.add(sleeve);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), this.skinMat);
      hand.position.y = -0.22; fore.add(hand);
      if (s > 0) fore.add(this.handSlot);
      arm.add(fore);
      this.torso.add(arm);
    }
    // Đầu to, tròn
    this.head.position.y = 0.42;
    this.head.scale.setScalar(1.3);
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.17, 20, 16), this.skinMat);
    face.castShadow = true; this.head.add(face);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.017, 6, 4), m('#1a1410'));
      eye.position.set(s * 0.058, 0.015, 0.158); eye.scale.y = 0.55; this.head.add(eye);
      const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), m('#e88a7a', 0.9));
      cheek.position.set(s * 0.095, -0.045, 0.13); cheek.scale.z = 0.4; this.head.add(cheek);
    }
    const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.005, 4, 10, Math.PI), m('#8a3a2a'));
    mouth.position.set(0, -0.06, 0.162); mouth.rotation.z = Math.PI; this.head.add(mouth);
    this.head.add(this.hairGroup);
    this.torso.add(this.head);
    // Chuỗi hạt quanh cổ
    this.beads = new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.024, 6, 28), m('#6b3f22', 0.5));
    this.beads.position.set(0, 0.12, 0.05); this.beads.rotation.x = Math.PI / 2.5; this.beads.visible = false;
    this.torso.add(this.beads);
    this.root.add(this.accessory);
    this.setLook(look, items);
  }

  setLook(look: LookData, items: ItemData) {
    this.skinMat.color.set(look.skin);
    const robe = look.robe ? items[look.robe] : null;
    this.robeMat.color.set(robe?.color || look.robeColor || '#4f6d8f');
    this.trimMat.color.set(robe?.trim || '#d9b45a');
    // Tóc
    this.hairGroup.clear();
    const hm = this.hairMat;
    const cap = () => { const c = new THREE.Mesh(new THREE.SphereGeometry(0.178, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), hm); c.rotation.x = -0.25; return c; };
    switch (look.hair) {
      case 'búi': { this.hairGroup.add(cap()); const b = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), hm); b.position.set(0, 0.12, -0.14); this.hairGroup.add(b); break; }
      case 'ngắn': this.hairGroup.add(cap()); break;
      case 'dài': { this.hairGroup.add(cap()); const l = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.75), hm); l.scale.set(1.02, 1.6, 0.55); l.position.set(0, -0.05, -0.08); this.hairGroup.add(l); break; }
      case 'tết': { this.hairGroup.add(cap()); for (let i = 0; i < 4; i++) { const k = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 5), hm); k.position.set(0, -0.08 - i * 0.08, -0.17 - i * 0.01); this.hairGroup.add(k); } break; }
      default: { const s = new THREE.Mesh(new THREE.SphereGeometry(0.172, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), m(look.skin, 0.5)); s.rotation.x = -0.2; this.hairGroup.add(s); }
    }
    // Chuỗi hạt
    const bead = look.bead ? items[look.bead] : null;
    this.beads.visible = !!bead;
    if (bead?.color) (this.beads.material as THREE.MeshStandardMaterial).color.set(bead.color);
    // Phụ kiện
    this.accessory.clear();
    this.handSlot.clear();
    this.accessory.userData = {};
    const acc = look.accessory ? items[look.accessory] : null;
    if (acc?.kind === 'lantern') {
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), new THREE.MeshStandardMaterial({ color: 0xd04a2a, emissive: 0xff8a3a, emissiveIntensity: 1.2 }));
      l.scale.y = 1.3; l.position.set(0, -0.33, 0.08); this.handSlot.add(l);
    } else if (acc?.kind === 'umbrella') {
      const u = new THREE.Group();
      const top = new THREE.Mesh(new THREE.ConeGeometry(0.75, 0.3, 16, 1, true), new THREE.MeshStandardMaterial({ color: 0xc9772a, side: THREE.DoubleSide, roughness: 0.7 }));
      top.position.y = 2.25; u.add(top);
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.1, 4), m('#5a3d26'));
      stick.position.set(0, 1.75, 0); u.add(stick);
      u.position.set(0.18, 0, 0.1); this.accessory.add(u);
    } else if (acc?.kind === 'aura') {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.7, 32), new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; this.accessory.add(ring);
      for (let i = 0; i < 8; i++) {
        const p = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 4), new THREE.MeshBasicMaterial({ color: 0xf6c0d0, transparent: true, opacity: 0.8 }));
        const a = (i / 8) * Math.PI * 2; p.scale.set(0.6, 0.3, 1.4); p.position.set(Math.cos(a) * 0.58, 0.05, Math.sin(a) * 0.58); p.rotation.y = -a;
        this.accessory.add(p);
      }
      this.accessory.userData.spin = true;
    }
  }

  setLabel(name: string, level: number, title: string | null, self = false) {
    if (this.label) { this.root.remove(this.label); (this.label.material as THREE.SpriteMaterial).map?.dispose(); }
    const c = document.createElement('canvas'); c.width = 512; c.height = 128;
    const x = c.getContext('2d')!;
    x.textAlign = 'center';
    if (title) {
      x.font = '600 30px "Be Vietnam Pro", system-ui, sans-serif'; x.fillStyle = '#f2c14e';
      x.strokeStyle = 'rgba(20,10,5,.85)'; x.lineWidth = 6; x.strokeText(title, 256, 42); x.fillText(title, 256, 42);
    }
    x.font = '700 40px "Be Vietnam Pro", system-ui, sans-serif';
    const text = `${name} · ${level}`;
    x.strokeStyle = 'rgba(20,10,5,.9)'; x.lineWidth = 8; x.strokeText(text, 256, 95);
    x.fillStyle = self ? '#ffe7a8' : '#fff7e6'; x.fillText(text, 256, 95);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    s.scale.set(2.4, 0.6, 1); s.position.y = 2.15; s.renderOrder = 10;
    this.root.add(s); this.label = s;
  }

  setAnim(a: string) {
    if (a !== this.anim) { this.anim = a; this.animT = 0; }
  }

  update(dt: number) {
    this.animT += dt;
    const t = this.animT;
    const target = { bow: 0, hands: 0, swing: 0, reach: 0 };
    switch (this.anim) {
      case 'walk': case 'run': target.swing = this.anim === 'run' ? 1 : 0.65; break;
      case 'place': target.hands = 1; break;   // vào chỗ: đứng thẳng, chắp tay
      case 'prostrate': {
        // Chu kỳ 2,5 giây trên bồ đoàn: chắp tay -> cúi rạp -> giữ -> ngẩng lên
        const p = t % 2.5;
        target.hands = 1;
        target.bow = p < 0.5 ? p / 0.5 * 0.2 : p < 1.1 ? 0.2 + (p - 0.5) / 0.6 * 0.8 : p < 1.7 ? 1 : Math.max(0, 1 - (p - 1.7) / 0.7);
        break;
      }
      case 'meditate': target.hands = 0.4; break;
      case 'chant': target.hands = 1; target.bow = 0.08 + Math.sin(t * 2) * 0.03; break;
      case 'bead': target.hands = 0.7; break;
      case 'offer': target.reach = Math.min(1, t * 2); target.bow = Math.min(0.25, t * 0.4); break;
      case 'bell': target.reach = 0.6 + Math.sin(t * 6) * 0.4; break;
    }
    const k = Math.min(1, dt * (this.anim === 'prostrate' ? 12 : 7));
    for (const key of Object.keys(target) as (keyof typeof target)[]) this.blend[key] += (target[key] - this.blend[key]) * k;
    const b = this.blend;
    // Lật đật: lắc lư quanh đáy tròn khi đi, nghiêng cả thân khi cúi lạy
    const rock = Math.sin(t * (this.anim === 'run' ? 11 : 8));
    this.body.rotation.z = rock * 0.14 * b.swing + Math.sin(t * 1.3) * 0.015 * (1 - b.swing);
    this.body.rotation.x = 0.9 * b.bow + Math.abs(rock) * 0.05 * b.swing;
    // Thân giữ nguyên chiều cao; chỉ nảy nhẹ khi đi
    this.body.position.y = Math.abs(rock) * 0.035 * b.swing;
    // Tay
    const armSwing = -rock * 0.5 * b.swing;
    const join = b.hands;
    this.armL.rotation.set(armSwing * (1 - join) - 1.0 * join - 1.2 * b.reach, 0, 0.18 + 0.3 * join);
    this.armR.rotation.set(-armSwing * (1 - join) - 1.0 * join - 1.2 * b.reach, 0, -0.18 - 0.3 * join);
    this.foreL.rotation.set(-1.3 * join - 0.3 * b.reach, 0, 0);
    this.foreR.rotation.set(-1.3 * join - 0.3 * b.reach + (this.anim === 'bead' ? Math.sin(t * 9) * 0.15 : 0), 0, 0);
    // Thở
    const breath = this.anim === 'meditate' ? Math.sin(t * (Math.PI * 2 / 10)) * 0.03 : Math.sin(t * 1.6) * 0.008;
    this.torso.scale.set(1 + breath, 1 + breath * 0.5, 1 + breath);
    this.head.rotation.x = this.anim === 'meditate' ? 0.15 : 0;
    if (this.accessory.userData.spin) this.accessory.rotation.y += dt * 0.6;
  }

  dispose() {
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    });
  }
}
