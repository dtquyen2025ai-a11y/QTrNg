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
  private legL = new THREE.Group(); private legR = new THREE.Group();
  private robeSkirt!: THREE.Mesh;
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
  private blend = { crouch: 0, bow: 0, sit: 0, hands: 0, swing: 0, reach: 0 };
  speed = 0;

  constructor(look: LookData, items: ItemData) {
    const r = this.root;
    r.add(this.body);
    // Chân
    for (const [leg, x] of [[this.legL, -0.12], [this.legR, 0.12]] as const) {
      leg.position.set(x, 0.75, 0);
      const l = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.55, 4, 8), m('#3a2f28'));
      l.position.y = -0.38; leg.add(l);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.07, 0.24), m('#2a211c'));
      foot.position.set(0, -0.72, 0.05); leg.add(foot);
      this.body.add(leg);
    }
    // Áo tràng (vạt dưới loe)
    const skirtPts = [[0.2, 1.05], [0.26, 0.8], [0.34, 0.4], [0.4, 0.12], [0.41, 0.08]].map(([x, y]) => new THREE.Vector2(x, y));
    this.robeSkirt = new THREE.Mesh(new THREE.LatheGeometry(skirtPts, 18), this.robeMat);
    this.robeSkirt.castShadow = true;
    this.body.add(this.robeSkirt);
    // Thân trên
    this.torso.position.y = 1.0;
    this.body.add(this.torso);
    const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.21, 0.36, 4, 12), this.robeMat);
    chest.position.y = 0.28; chest.scale.z = 0.78; chest.castShadow = true;
    this.torso.add(chest);
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.025, 6, 16), this.trimMat);
    collar.position.set(0, 0.55, 0.02); collar.rotation.x = Math.PI / 2.3;
    this.torso.add(collar);
    const sash = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.03, 6, 20), this.trimMat);
    sash.position.y = 0.06; sash.rotation.x = Math.PI / 2; sash.scale.y = 0.78;
    this.torso.add(sash);
    // Tay (vai -> khuỷu -> bàn tay)
    for (const [arm, fore, s] of [[this.armL, this.foreL, -1], [this.armR, this.foreR, 1]] as const) {
      arm.position.set(s * 0.27, 0.5, 0);
      const up = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.24, 4, 8), this.robeMat);
      up.position.y = -0.16; arm.add(up);
      fore.position.y = -0.34;
      const lo = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.22, 4, 8), this.robeMat); // tay áo rộng
      lo.position.y = -0.14; fore.add(lo);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), this.skinMat);
      hand.position.y = -0.3; fore.add(hand);
      if (s > 0) fore.add(this.handSlot);
      arm.add(fore);
      this.torso.add(arm);
    }
    // Đầu
    this.head.position.y = 0.72;
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 14), this.skinMat);
    face.castShadow = true; this.head.add(face);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.12, 8), this.skinMat);
    neck.position.y = -0.17; this.head.add(neck);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 4), m('#1a1410'));
      eye.position.set(s * 0.06, 0.02, 0.155); eye.scale.y = 0.5; this.head.add(eye);
    }
    this.head.add(this.hairGroup);
    this.torso.add(this.head);
    // Chuỗi hạt quanh cổ
    this.beads = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.022, 6, 24), m('#6b3f22', 0.5));
    this.beads.position.set(0, 0.4, 0.06); this.beads.rotation.x = Math.PI / 2.6; this.beads.visible = false;
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
      l.scale.y = 1.3; l.position.set(0, -0.42, 0.08); this.handSlot.add(l);
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
    s.scale.set(2.4, 0.6, 1); s.position.y = 2.25; s.renderOrder = 10;
    this.root.add(s); this.label = s;
  }

  setAnim(a: string) {
    if (a !== this.anim) { this.anim = a; this.animT = 0; }
  }

  update(dt: number) {
    this.animT += dt;
    const t = this.animT;
    const target = { crouch: 0, bow: 0, sit: 0, hands: 0, swing: 0, reach: 0 };
    switch (this.anim) {
      case 'walk': case 'run': target.swing = this.anim === 'run' ? 1 : 0.65; break;
      case 'prostrate': {
        // Chu kỳ 2,5 giây: chắp tay -> quỳ -> cúi lạy -> đứng dậy
        const p = t % 2.5;
        target.hands = 1;
        target.crouch = p < 0.4 ? 0 : p < 1.0 ? (p - 0.4) / 0.6 : p < 1.9 ? 1 : Math.max(0, 1 - (p - 1.9) / 0.6);
        target.bow = p < 0.9 ? 0 : p < 1.3 ? (p - 0.9) / 0.4 : p < 1.7 ? 1 : Math.max(0, 1 - (p - 1.7) / 0.3);
        break;
      }
      case 'meditate': target.sit = 1; target.hands = 0.4; break;
      case 'chant': target.crouch = 1; target.hands = 1; target.bow = 0.08 + Math.sin(t * 2) * 0.03; break;
      case 'bead': target.hands = 0.7; break;
      case 'offer': target.reach = Math.min(1, t * 2); target.bow = Math.min(0.25, t * 0.4); break;
      case 'bell': target.reach = 0.6 + Math.sin(t * 6) * 0.4; break;
    }
    const k = Math.min(1, dt * (this.anim === 'prostrate' ? 14 : 7));
    for (const key of Object.keys(target) as (keyof typeof target)[]) this.blend[key] += (target[key] - this.blend[key]) * k;
    const b = this.blend;
    // Thân: quỳ hạ thấp, ngồi thiền hạ thấp hơn
    this.body.position.y = -0.42 * b.crouch - 0.62 * b.sit;
    this.torso.rotation.x = 1.15 * b.bow;
    this.robeSkirt.scale.y = 1 - 0.35 * b.crouch - 0.5 * b.sit;
    this.robeSkirt.scale.x = this.robeSkirt.scale.z = 1 + 0.35 * b.sit;
    // Chân: đi bộ / quỳ / xếp bằng
    const step = Math.sin(t * (this.anim === 'run' ? 11 : 8)) * 0.6 * b.swing;
    this.legL.rotation.x = step - 1.4 * b.crouch - 1.5 * b.sit;
    this.legR.rotation.x = -step - 1.4 * b.crouch - 1.5 * b.sit;
    this.legL.rotation.z = -0.9 * b.sit; this.legR.rotation.z = 0.9 * b.sit;
    // Tay
    const armSwing = -step * 0.8;
    const join = b.hands;
    this.armL.rotation.set(armSwing * (1 - join) - 0.9 * join - 1.2 * b.reach, 0, 0.12 + 0.35 * join);
    this.armR.rotation.set(-armSwing * (1 - join) - 0.9 * join - 1.2 * b.reach, 0, -0.12 - 0.35 * join);
    this.foreL.rotation.set(-1.4 * join - 0.3 * b.reach, 0, 0);
    this.foreR.rotation.set(-1.4 * join - 0.3 * b.reach + (this.anim === 'bead' ? Math.sin(t * 9) * 0.15 : 0), 0, 0);
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
