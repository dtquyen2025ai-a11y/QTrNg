// Engine 3D: renderer, camera, điều khiển, va chạm, người chơi khác, hiệu ứng, ngày/đêm.
import * as THREE from 'three';
import { buildTemple, type TempleRefs } from './temple.ts';
import { Avatar, type LookData, type ItemData } from './character.ts';
import { THEMES, colliders, resolve, INTERACTABLES, LAKE, type Interactable } from './layout.ts';
import { MATS, type Mat, type SeatKind } from '../../../shared/content.ts';

export interface RemoteInfo { id: number; name: string; level: number; title: string | null; look: LookData; x: number; z: number; ry: number; anim: string }

interface Remote { info: RemoteInfo; avatar: Avatar; tx: number; tz: number; tr: number }

const WALK = 4.2, RUN = 6.8, RADIUS = 0.38;

export class World {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  refs: TempleRefs;
  me: Avatar;
  pos = new THREE.Vector3();
  ry = 0;
  yaw = 0;              // camera phía sau (Nam), nhìn vào chùa (Bắc)
  pitch = 0.32;
  dist = 7.5;
  locked = false;       // khoá di chuyển khi đang ngồi/quỳ hoặc thiền/tụng
  anim = 'idle';
  seat: { kind: SeatKind; mat: string } | null = null;   // tư thế do server xác nhận
  private activityPose: string | null = null;
  private nearMat: Mat | null = null;
  onNearMat: (m: Mat | null) => void = () => {};
  onBlockedMove: () => void = () => {};
  private oneShotUntil = 0;
  private keys = new Set<string>();
  private joy = { x: 0, y: 0 };
  private remotes = new Map<number, Remote>();
  private col = colliders();
  private timer = new THREE.Timer();
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private skyMat: THREE.ShaderMaterial;
  private stars: THREE.Points;
  private moon: THREE.Mesh;
  private hallLight: THREE.PointLight;
  private smoke: { mesh: THREE.Mesh; vel: THREE.Vector3; life: number; max: number }[] = [];
  private smokeMat = new THREE.MeshBasicMaterial({ color: 0xd8d2c8, transparent: true, opacity: 0.35, depthWrite: false });
  private smokeGeo = new THREE.SphereGeometry(0.12, 6, 5);
  private incenseUntil = 0;
  private sticks = new THREE.Group();
  private candleUntil = 0;
  private flowerUntil = 0;
  private bellSwing = 0;
  private lanterns: { g: THREE.Group; born: number; angle: number; rad: number }[] = [];
  private petals: THREE.InstancedMesh;
  private petalData: { x: number; y: number; z: number; vy: number; ph: number }[] = [];
  private fireflies: THREE.Points;
  private nearest: Interactable | null = null;
  private raycaster = new THREE.Raycaster();
  private disposed = false;
  private items: ItemData;
  // ?gio=20 trên URL để xem thử cảnh theo giờ (chỉ ảnh hưởng hiển thị phía người xem)
  timeOverride: number | null = (() => { const v = new URLSearchParams(location.search).get('gio'); return v != null && v !== '' && !isNaN(+v) ? +v % 24 : null; })();
  onNearest: (i: Interactable | null) => void = () => {};
  onMove: (x: number, z: number, ry: number, anim: string) => void = () => {};
  onPickPlayer: (id: number) => void = () => {};

  constructor(private container: HTMLElement, templeCode: string, templeName: string, myInfo: RemoteInfo, items: ItemData) {
    this.items = items;
    const theme = THEMES[templeCode] || THEMES.tam_an;
    const mobile = matchMedia('(pointer: coarse)').matches;
    this.renderer = new THREE.WebGLRenderer({ antialias: !mobile, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.5 : 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 500);
    this.scene.fog = new THREE.Fog(theme.skyDay, theme.fogNear, theme.fogFar);

    // Bầu trời dạng vòm gradient
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color(theme.skyDay) }, bottom: { value: new THREE.Color(0xf3e6cf) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = clamp(vP.y*1.6+0.15,0.0,1.0); gl_FragColor = vec4(mix(bottom, top, h),1.0); }',
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 24, 12), this.skyMat);
    sky.renderOrder = -1;
    this.scene.add(sky);
    const sg = new THREE.BufferGeometry();
    const sp: number[] = [];
    for (let i = 0; i < 600; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * 1.2 + 0.15;
      sp.push(Math.cos(a) * Math.cos(e) * 280, Math.sin(e) * 280, Math.sin(a) * Math.cos(e) * 280);
    }
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false }));
    this.scene.add(this.stars);
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(8, 20, 16), new THREE.MeshBasicMaterial({ color: 0xfff4d6, fog: false }));
    this.scene.add(this.moon);

    this.hemi = new THREE.HemisphereLight(0xfff2dc, 0x5a4a32, 0.9);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff0d6, 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
    const sc = this.sun.shadow.camera as THREE.OrthographicCamera;
    sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 10; sc.far = 160;
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun, this.sun.target);
    this.hallLight = new THREE.PointLight(0xffb36b, 0, 22, 1.6);
    this.hallLight.position.set(0, 4, -17);
    this.scene.add(this.hallLight);

    this.refs = buildTemple(theme, templeName);
    this.scene.add(this.refs.group);
    this.refs.group.add(this.sticks);

    // Cánh hoa rơi
    this.petals = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.09, 0.06), new THREE.MeshBasicMaterial({ color: theme.code === 'van_son' ? 0xf4f0e8 : 0xf6c6d4, side: THREE.DoubleSide }), 90);
    for (let i = 0; i < 90; i++) this.petalData.push({ x: (Math.random() - 0.5) * 70, y: Math.random() * 10, z: (Math.random() - 0.5) * 60, vy: 0.3 + Math.random() * 0.4, ph: Math.random() * 6 });
    this.scene.add(this.petals);
    // Đom đóm quanh ao sen (ban đêm)
    const fg = new THREE.BufferGeometry(); const fp: number[] = [];
    for (let i = 0; i < 40; i++) fp.push(-24 + (Math.random() - 0.5) * 18, 0.5 + Math.random() * 2, -6 + (Math.random() - 0.5) * 18);
    fg.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3));
    this.fireflies = new THREE.Points(fg, new THREE.PointsMaterial({ color: 0xfff08a, size: 0.12, transparent: true, opacity: 0 }));
    this.scene.add(this.fireflies);

    // Nhân vật của mình
    this.me = new Avatar(myInfo.look, items);
    this.me.setLabel(myInfo.name, myInfo.level, myInfo.title, true);
    this.pos.set(myInfo.x, 0, myInfo.z);
    this.ry = myInfo.ry;
    this.me.root.position.copy(this.pos);
    this.scene.add(this.me.root);

    this.bindInput();
    window.addEventListener('resize', this.onResize);
    this.renderer.setAnimationLoop(this.loop);
  }

  private onResize = () => {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  // ---------- Điều khiển ----------
  private bindInput() {
    const el = this.renderer.domElement;
    const isTyping = () => { const a = document.activeElement; return !!a && ['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName); };
    window.addEventListener('keydown', (e) => { if (!isTyping()) this.keys.add(e.code); });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    // Chuột: kéo để xoay camera, cuộn để zoom, bấm vào người chơi để xem
    let dragging = false, moved = 0, lx = 0, ly = 0;
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') return;
      dragging = true; moved = 0; lx = e.clientX; ly = e.clientY; el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!dragging || e.pointerType === 'touch') return;
      const dx = e.clientX - lx, dy = e.clientY - ly; lx = e.clientX; ly = e.clientY; moved += Math.abs(dx) + Math.abs(dy);
      this.yaw -= dx * 0.005; this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.004, -0.1, 1.25);
    });
    el.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'touch') return;
      dragging = false;
      if (moved < 5) this.pick(e.clientX, e.clientY);
    });
    el.addEventListener('wheel', (e) => { e.preventDefault(); this.dist = THREE.MathUtils.clamp(this.dist + e.deltaY * 0.01, 2.5, 18); }, { passive: false });
    // Cảm ứng: vuốt để xoay, chụm 2 ngón để zoom, chạm để chọn người chơi
    const touches = new Map<number, { x: number; y: number; sx: number; sy: number; t: number }>();
    let pinch = 0;
    el.addEventListener('touchstart', (e) => {
      for (const t of Array.from(e.changedTouches)) touches.set(t.identifier, { x: t.clientX, y: t.clientY, sx: t.clientX, sy: t.clientY, t: performance.now() });
      if (touches.size === 2) { const [a, b] = [...touches.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
    }, { passive: true });
    el.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of Array.from(e.changedTouches)) {
        const p = touches.get(t.identifier); if (!p) continue;
        if (touches.size === 1) {
          this.yaw -= (t.clientX - p.x) * 0.007;
          this.pitch = THREE.MathUtils.clamp(this.pitch + (t.clientY - p.y) * 0.005, -0.1, 1.25);
        }
        p.x = t.clientX; p.y = t.clientY;
      }
      if (touches.size === 2) {
        const [a, b] = [...touches.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
        this.dist = THREE.MathUtils.clamp(this.dist - (d - pinch) * 0.03, 2.5, 18); pinch = d;
      }
    }, { passive: false });
    el.addEventListener('touchend', (e) => {
      for (const t of Array.from(e.changedTouches)) {
        const p = touches.get(t.identifier);
        if (p && touches.size === 1 && Math.hypot(t.clientX - p.sx, t.clientY - p.sy) < 8 && performance.now() - p.t < 300) this.pick(t.clientX, t.clientY);
        touches.delete(t.identifier);
      }
    });
  }

  setJoystick(x: number, y: number) { this.joy.x = x; this.joy.y = y; }

  private pick(cx: number, cy: number) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.raycaster.setFromCamera(new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), this.camera);
    let best: { id: number; d: number } | null = null;
    for (const [id, rm] of this.remotes) {
      const hits = this.raycaster.intersectObject(rm.avatar.root, true);
      if (hits.length && (!best || hits[0].distance < best.d)) best = { id, d: hits[0].distance };
    }
    if (best) this.onPickPlayer(best.id);
  }

  // ---------- Người chơi khác ----------
  addRemote(info: RemoteInfo) {
    if (this.remotes.has(info.id)) this.removeRemote(info.id);
    const avatar = new Avatar(info.look, this.items);
    avatar.setLabel(info.name, info.level, info.title);
    avatar.root.position.set(info.x, 0, info.z);
    avatar.root.rotation.y = info.ry;
    avatar.setAnim(info.anim);
    this.scene.add(avatar.root);
    this.remotes.set(info.id, { info, avatar, tx: info.x, tz: info.z, tr: info.ry });
  }
  /** Bồ đoàn đã có người khác ngồi (theo vị trí và hoạt ảnh người chơi khác) */
  private matTaken(id: string) {
    const m = MATS.find((x) => x.id === id)!;
    for (const r of this.remotes.values()) {
      if (['sit', 'kneel', 'prostrate', 'meditate', 'chant'].includes(r.info.anim) && Math.hypot(r.tx - m.x, r.tz - m.z) < 0.3) return true;
    }
    return false;
  }
  removeRemote(id: number) {
    const r = this.remotes.get(id); if (!r) return;
    this.scene.remove(r.avatar.root); r.avatar.dispose(); this.remotes.delete(id);
  }
  updateRemote(id: number, x: number, z: number, ry: number, anim: string) {
    const r = this.remotes.get(id); if (!r) return;
    r.tx = x; r.tz = z; r.tr = ry; r.info.x = x; r.info.z = z; r.info.anim = anim;
    r.avatar.setAnim(anim);
  }
  remoteLook(id: number, look: LookData) { const r = this.remotes.get(id); if (r) { r.info.look = look; r.avatar.setLook(look, this.items); } }
  remoteTitle(id: number, title: string | null) { const r = this.remotes.get(id); if (r) { r.info.title = title; r.avatar.setLabel(r.info.name, r.info.level, title); } }
  remotesInfo(): RemoteInfo[] { return [...this.remotes.values()].map((r) => r.info); }
  remoteById(id: number) { return this.remotes.get(id)?.info; }
  setMyLook(look: LookData) { this.me.setLook(look, this.items); }
  setMyLabel(name: string, level: number, title: string | null) { this.me.setLabel(name, level, title, true); }

  /** Server kéo về vị trí hợp lệ */
  correct(x: number, z: number) { this.pos.set(x, 0, z); }

  // ---------- Hoạt ảnh của mình ----------
  /** Server xác nhận ngồi/quỳ (kind = null: đứng dậy) */
  applySeat(kind: SeatKind | null, mat?: string, x?: number, z?: number, ry?: number) {
    if (kind && mat) {
      this.seat = { kind, mat };
      if (x != null && z != null) this.pos.set(x, 0, z);
      if (ry != null) this.ry = ry;
    } else this.seat = null;
    this.activityPose = null; this.oneShotUntil = 0;
    this.locked = !!this.seat;
    this.anim = this.seat?.kind || 'idle'; this.me.setAnim(this.anim);
    this.nearMat = null; this.onNearMat(null);
  }
  private baseAnim() { return this.activityPose || this.seat?.kind || 'idle'; }

  playOneShot(anim: string, seconds: number) {
    this.anim = anim; this.me.setAnim(anim); this.oneShotUntil = performance.now() + seconds * 1000;
    this.onMove(this.pos.x, this.pos.z, this.ry, anim);
  }
  setPose(anim: string | null) {
    this.activityPose = anim;
    this.locked = !!anim || !!this.seat;
    this.anim = this.baseAnim(); this.me.setAnim(this.anim); this.oneShotUntil = 0;
    this.onMove(this.pos.x, this.pos.z, this.ry, this.anim);
  }
  faceTowards(x: number, z: number) { this.ry = Math.atan2(x - this.pos.x, z - this.pos.z); }

  // ---------- Hiệu ứng ----------
  fx(kind: string) {
    const now = performance.now();
    if (kind === 'incense') {
      this.incenseUntil = now + 5 * 60 * 1000;
      this.sticks.clear();
      for (let i = 0; i < 3; i++) {
        const s = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.7, 4), new THREE.MeshStandardMaterial({ color: 0xb54a2a }));
        s.position.set(this.refs.urnTop.x + (i - 1) * 0.09, this.refs.urnTop.y + 0.1, this.refs.urnTop.z);
        s.rotation.z = (i - 1) * 0.12;
        const ember = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff6a2a }));
        ember.position.y = 0.36; s.add(ember);
        this.sticks.add(s);
      }
    }
    if (kind === 'candle') this.candleUntil = now + 5 * 60 * 1000;
    if (kind === 'flower') this.flowerUntil = now + 10 * 60 * 1000;
    if (kind === 'bell') this.bellSwing = 1;
  }

  addLantern(wish: string, name: string, ageMs = 0) {
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.22, 0.08, 10), new THREE.MeshStandardMaterial({ color: 0xe9c87a }));
    g.add(base);
    for (let i = 0; i < 8; i++) {
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 4), new THREE.MeshStandardMaterial({ color: 0xf3a0b8, emissive: 0xff7a9a, emissiveIntensity: 0.25 }));
      const a = (i / 8) * Math.PI * 2; p.scale.set(0.6, 1.1, 0.35); p.position.set(Math.cos(a) * 0.17, 0.12, Math.sin(a) * 0.17); p.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
      g.add(p);
    }
    const flame = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 5), new THREE.MeshBasicMaterial({ color: 0xffd27a }));
    flame.position.y = 0.2; flame.scale.y = 1.6; g.add(flame);
    // nhãn lời nguyện
    const c = document.createElement('canvas'); c.width = 512; c.height = 96;
    const x = c.getContext('2d')!; x.textAlign = 'center'; x.font = '500 30px "Be Vietnam Pro", system-ui, sans-serif';
    const text = (wish.length > 34 ? wish.slice(0, 33) + '…' : wish);
    x.strokeStyle = 'rgba(10,15,30,.85)'; x.lineWidth = 6; x.strokeText(text, 256, 40); x.fillStyle = '#ffe7b8'; x.fillText(text, 256, 40);
    x.font = '400 24px "Be Vietnam Pro", system-ui, sans-serif'; x.fillStyle = '#d9c7a0'; x.strokeText('— ' + name, 256, 78); x.fillText('— ' + name, 256, 78);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    label.scale.set(3, 0.56, 1); label.position.y = 0.9; g.add(label);
    const born = performance.now() - ageMs;
    this.lanterns.push({ g, born, angle: Math.random() * Math.PI * 2, rad: 1.5 + Math.random() * (LAKE.r - 2.5) });
    this.scene.add(g);
    if (this.lanterns.length > 30) { const old = this.lanterns.shift()!; this.scene.remove(old.g); }
  }

  // ---------- Vòng lặp ----------
  private loop = () => {
    if (this.disposed) return;
    this.timer.update();
    const dt = Math.min(0.1, this.timer.getDelta());
    const now = performance.now();
    this.updateMovement(dt, now);
    this.me.update(dt);
    for (const r of this.remotes.values()) {
      const p = r.avatar.root.position;
      const k = Math.min(1, dt * 10);
      const dx = r.tx - p.x, dz = r.tz - p.z;
      p.x += dx * k; p.z += dz * k;
      let dr = r.tr - r.avatar.root.rotation.y; dr = Math.atan2(Math.sin(dr), Math.cos(dr));
      r.avatar.root.rotation.y += dr * k;
      r.avatar.update(dt);
    }
    this.updateCamera();
    this.updateEnvironment(dt, now);
    this.renderer.render(this.scene, this.camera);
  };

  private updateMovement(dt: number, now: number) {
    if (this.oneShotUntil && now > this.oneShotUntil) { this.oneShotUntil = 0; this.anim = this.baseAnim(); this.me.setAnim(this.anim); this.onMove(this.pos.x, this.pos.z, this.ry, this.anim); }
    let fx = 0, fz = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) fz += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) fz -= 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) fx -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) fx += 1;
    fx += this.joy.x; fz += this.joy.y;
    if (this.locked || this.oneShotUntil) {
      if (Math.hypot(fx, fz) > 0.3 && this.locked) this.onBlockedMove();
      fx = 0; fz = 0;
    }
    const mag = Math.min(1, Math.hypot(fx, fz));
    if (mag > 0.08) {
      const run = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || Math.hypot(this.joy.x, this.joy.y) > 0.92;
      const speed = (run ? RUN : WALK) * mag;
      // hướng theo camera
      const fwd = new THREE.Vector2(-Math.sin(this.yaw), -Math.cos(this.yaw));
      const right = new THREE.Vector2(-fwd.y, fwd.x);
      const nx = (fwd.x * fz + right.x * fx) / Math.max(1e-6, Math.hypot(fx, fz));
      const nz = (fwd.y * fz + right.y * fx) / Math.max(1e-6, Math.hypot(fx, fz));
      // Trượt vòng qua vật cản: thử lệch hướng, chọn hướng tiến xa nhất theo ý muốn
      const step = speed * dt;
      let bx = this.pos.x, bz = this.pos.z, bestGain = 0;
      for (const ang of [0, 0.7, -0.7, 1.4, -1.4]) {
        const c = Math.cos(ang), sn = Math.sin(ang);
        const dx = nx * c - nz * sn, dz = nx * sn + nz * c;
        const [x, z] = resolve(this.pos.x + dx * step, this.pos.z + dz * step, RADIUS, this.col);
        const gain = ((x - this.pos.x) * nx + (z - this.pos.z) * nz) * (ang === 0 ? 1.15 : 1);
        if (gain > bestGain + 1e-4) { bestGain = gain; bx = x; bz = z; }
        if (ang === 0 && gain >= step * 0.9) break;
      }
      this.pos.x = bx; this.pos.z = bz;
      const target = Math.atan2(nx, nz);
      let d = target - this.ry; d = Math.atan2(Math.sin(d), Math.cos(d));
      this.ry += d * Math.min(1, dt * 12);
      const a = run ? 'run' : 'walk';
      if (this.anim !== a) { this.anim = a; this.me.setAnim(a); }
      this.onMove(this.pos.x, this.pos.z, this.ry, a);
    } else if (this.anim === 'walk' || this.anim === 'run') {
      this.anim = 'idle'; this.me.setAnim('idle');
      this.onMove(this.pos.x, this.pos.z, this.ry, 'idle');
    }
    this.me.root.position.copy(this.pos);
    this.me.root.rotation.y = this.ry;
    // bồ đoàn gần nhất (khi đang đứng)
    let mat: Mat | null = null;
    if (!this.seat) {
      let md = 1.3;
      for (const m of MATS) {
        const d = Math.hypot(this.pos.x - m.x, this.pos.z - m.z);
        if (d < md && !this.matTaken(m.id)) { md = d; mat = m; }
      }
    }
    if (mat !== this.nearMat) { this.nearMat = mat; this.onNearMat(mat); }
    // tương tác gần nhất
    let best: Interactable | null = null, bd = Infinity;
    for (const it of INTERACTABLES) {
      const d = Math.hypot(this.pos.x - it.x, this.pos.z - it.z);
      if (d <= it.r && d < bd) { best = it; bd = d; }
    }
    if (best !== this.nearest) { this.nearest = best; this.onNearest(best); }
  }

  private camPos = new THREE.Vector3();
  private updateCamera() {
    const target = new THREE.Vector3(this.pos.x, 1.5, this.pos.z);
    const off = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch)).multiplyScalar(this.dist);
    const want = target.clone().add(off);
    want.y = Math.max(0.6, want.y);
    // Trong chánh điện: hạ camera để không xuyên mái
    if (this.pos.z < -7.5 && this.pos.z > -24 && Math.abs(this.pos.x) < 12) want.y = Math.min(want.y, 5.2);
    if (this.camPos.lengthSq() === 0) this.camPos.copy(want);
    this.camPos.lerp(want, 0.18);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(target);
  }

  /** Giờ Việt Nam hiện tại (0–24) */
  hourVN(): number {
    if (this.timeOverride != null) return this.timeOverride;
    const d = new Date();
    return ((d.getUTCHours() + 7) % 24) + d.getUTCMinutes() / 60;
  }

  private updateEnvironment(dt: number, now: number) {
    const theme = THEMES[this.refs.group.userData.theme] || null;
    const h = this.hourVN();
    // Mặt trời: mọc 6h, lặn 18h
    const dayT = (h - 6) / 12;
    const sunUp = dayT > 0 && dayT < 1;
    const elev = Math.sin(Math.PI * THREE.MathUtils.clamp(dayT, 0, 1));
    const az = Math.PI * dayT;
    this.sun.position.set(Math.cos(az) * 80 + this.pos.x, Math.max(8, elev * 90), -30 + this.pos.z);
    this.sun.target.position.set(this.pos.x, 0, this.pos.z);
    const night = sunUp ? 0 : 1;
    const dusk = sunUp ? Math.max(0, 1 - elev * 3.2) : 0;
    const fog = this.scene.fog as THREE.Fog;
    const day = new THREE.Color(theme?.skyDay ?? 0x9cc8e6), duskC = new THREE.Color(theme?.skyDusk ?? 0xe9a46a), nightC = new THREE.Color(theme?.skyNight ?? 0x0e1631);
    const sky = night ? nightC : day.clone().lerp(duskC, dusk);
    (this.skyMat.uniforms.top.value as THREE.Color).copy(sky);
    (this.skyMat.uniforms.bottom.value as THREE.Color).copy(night ? new THREE.Color(0x1d2547) : new THREE.Color(0xf6e7cc).lerp(duskC, dusk * 0.6));
    fog.color.copy(night ? new THREE.Color(0x141c38) : sky.clone().lerp(new THREE.Color(0xf3e6cf), 0.5));
    // Ban đêm: "mặt trời" thành ánh trăng xanh nhạt để cảnh vẫn đọc được
    if (night) this.sun.position.set(this.pos.x - 40, 70, this.pos.z - 50);
    this.sun.intensity = sunUp ? 0.6 + 1.8 * elev : 0.75;
    this.sun.color.set(night ? 0xa9bcff : dusk > 0.3 ? 0xffb07a : 0xfff0d6);
    this.hemi.intensity = night ? 1.1 : 0.55 + 0.5 * elev;
    this.hemi.color.set(night ? 0x9aa8d8 : 0xfff2dc);
    this.hemi.groundColor.set(night ? 0x3a3448 : 0x5a4a32);
    (this.stars.material as THREE.PointsMaterial).opacity = night ? 0.9 : 0;
    this.moon.visible = !!night;
    this.moon.position.set(this.pos.x - 120, 110, this.pos.z - 160);
    (this.fireflies.material as THREE.PointsMaterial).opacity = night ? 0.9 : 0;
    // Đèn lồng sáng về đêm
    const glow = night ? 1.6 : dusk * 0.8 + 0.08;
    for (const l of this.refs.lanternLights) {
      const mm = l.material as THREE.MeshStandardMaterial;
      mm.emissiveIntensity = glow * (0.9 + Math.sin(now * 0.004 + l.id) * 0.08);
    }
    this.hallLight.intensity = night ? 40 : 14;
    // Nước gợn
    for (const w of this.refs.water) (w.material as THREE.MeshStandardMaterial).roughness = 0.12 + Math.sin(now * 0.0015) * 0.04;
    for (const l of this.refs.lotus) l.position.y = 0.18 + Math.sin(now * 0.0012 + l.id) * 0.015;
    // Hào quang tượng Phật
    (this.refs.buddhaHalo.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.5 + Math.sin(now * 0.0012) * 0.15;
    // Nến, hoa, hương
    for (const c of this.refs.candles) { c.visible = now < this.candleUntil; c.scale.y = 1.6 + Math.sin(now * 0.02 + c.id) * 0.3; }
    for (const v of this.refs.flowerVases) v.visible = now < this.flowerUntil;
    if (now > this.incenseUntil && this.sticks.children.length) this.sticks.clear();
    // Khói hương: luôn có một làn nhẹ, đậm hơn khi vừa thắp
    const rate = now < this.incenseUntil ? 0.3 : 0.05;
    if (Math.random() < rate) {
      const s = new THREE.Mesh(this.smokeGeo, this.smokeMat);
      s.position.set(this.refs.urnTop.x + (Math.random() - 0.5) * 0.15, this.refs.urnTop.y + 0.5, this.refs.urnTop.z + (Math.random() - 0.5) * 0.15);
      this.scene.add(s);
      this.smoke.push({ mesh: s, vel: new THREE.Vector3((Math.random() - 0.5) * 0.1, 0.45 + Math.random() * 0.2, (Math.random() - 0.5) * 0.1), life: 0, max: 4 + Math.random() * 2 });
    }
    for (let i = this.smoke.length - 1; i >= 0; i--) {
      const p = this.smoke[i]; p.life += dt;
      p.vel.x += Math.sin(now * 0.001 + i) * 0.002;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.scale.setScalar(1 + p.life * 1.4);
      if (p.life > p.max) { this.scene.remove(p.mesh); this.smoke.splice(i, 1); }
    }
    this.smokeMat.opacity = 0.28;
    // Chuông đung đưa
    if (this.bellSwing > 0.001) { this.bellSwing *= Math.pow(0.35, dt); this.refs.bell.rotation.z = Math.sin(now * 0.008) * 0.18 * this.bellSwing; }
    // Hoa đăng trôi chầm chậm quanh hồ
    for (const l of this.lanterns) {
      const age = (now - l.born) / 1000;
      const a = l.angle + age * 0.03;
      l.g.position.set(LAKE.x + Math.cos(a) * l.rad, 0.14 + Math.sin(age * 1.3) * 0.02, LAKE.z + Math.sin(a) * l.rad);
      l.g.rotation.y = age * 0.2;
    }
    // Cánh hoa rơi quanh người chơi
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1);
    this.petalData.forEach((p, i) => {
      p.y -= p.vy * dt; p.ph += dt;
      if (p.y < 0.05) { p.y = 8 + Math.random() * 4; p.x = this.pos.x + (Math.random() - 0.5) * 50; p.z = this.pos.z + (Math.random() - 0.5) * 50; }
      e.set(p.ph * 1.3, p.ph, p.ph * 0.7); q.setFromEuler(e);
      mtx.compose(new THREE.Vector3(p.x + Math.sin(p.ph) * 0.6, p.y, p.z + Math.cos(p.ph * 0.8) * 0.4), q, one);
      this.petals.setMatrixAt(i, mtx);
    });
    this.petals.instanceMatrix.needsUpdate = true;
    // Đom đóm nhấp nháy
    if (night) {
      const arr = (this.fireflies.geometry.attributes.position as THREE.BufferAttribute);
      for (let i = 0; i < arr.count; i++) arr.setY(i, 0.6 + Math.abs(Math.sin(now * 0.0008 + i)) * 1.8);
      arr.needsUpdate = true;
    }
  }

  dispose() {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
