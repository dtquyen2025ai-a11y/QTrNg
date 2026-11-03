// Giao diện trong game: HUD, thanh thao tác, chat, minimap và các ngăn kéo chức năng.
import { h, clear, fmt, icon, toast, modal, setToastHost } from './dom.ts';
import { api } from '../api.ts';
import { Net } from '../net.ts';
import { World, type RemoteInfo } from '../world/game.ts';
import { INTERACTABLES, HALL, CHANT_HALL, POND, LAKE, URN, BELL, MEDITATION, BOUNDS, GATE_Z, type Interactable } from '../world/layout.ts';
import * as sfx from '../audio.ts';
import { SUTRAS, MEDITATION_OPTIONS, zoneAt, ceremonyProgram, ceremonyLineAt, CEREMONY_HOURS, CEREMONY_ATTEND_RATIO, POSE_RULES, poseAllows, type Zone, type Mat, type SeatKind } from '../../../shared/content.ts';

type State = any;
const PERIODS: [string, string][] = [['daily', 'Ngày'], ['weekly', 'Tuần'], ['special', 'Đặc biệt'], ['pilgrimage', 'Hành hương'], ['community', 'Cộng đồng']];
const SHOP_CATS: [string, string][] = [['offering', 'Lễ vật'], ['robe', 'Trang phục'], ['item', 'Vật phẩm'], ['decor', 'Trang trí'], ['special', 'Đặc biệt']];
const ACT_ANIM: Record<string, [string, number]> = { prostrate: ['prostrate', 2.5], incense: ['offer', 1.6], candle: ['offer', 1.4], flower: ['offer', 1.4], bell: ['bell', 1.2] };
const ACT_TARGET: Record<string, [number, number]> = { prostrate: [0, -22], incense: [URN.x, URN.z], candle: [-2.3, -20], flower: [2.3, -20], bell: [BELL.x, BELL.z] };

export class GameUI {
  state!: State;
  world!: World;
  net!: Net;
  root = h('div', { class: 'game' });
  hud = h('div', { class: 'hud' });
  private els: Record<string, HTMLElement> = {};
  private drawer: HTMLElement | null = null;
  private drawerName = '';
  private nearest: Interactable | null = null;
  private nearMat: Mat | null = null;
  private lastBlockedHint = 0;
  private zone: Zone | null = null;
  private chatTab: 'public' | number = 'public';
  private chatLog: { kind: 'chat' | 'pm' | 'sys'; id?: number; fromId?: number; from?: string; to?: string; toId?: number; body: string }[] = [];
  private session: { kind: 'meditate' | 'chant'; ends?: number; timer?: number } | null = null;
  private beadPending = 0;
  private beadLocal = 0;
  private beadTimer = 0;
  private refreshT = 0;
  private cer: any = null;          // trạng thái đại lễ từ server
  private clockOffset = 0;          // giờ server - giờ máy
  private cerPresent = 0;
  private cerTimer = 0;
  private hasClaimable = false;
  private pendingRequests = 0;

  constructor(private token: string, private charId: number, private onExit: (reason: 'logout' | 'servers' | 'travel') => void) {}

  async start() {
    const app = document.getElementById('app')!;
    clear(app);
    const loading = h('div', { class: 'loading' }, 'Đang vào chùa…');
    app.append(this.root, this.hud, loading);
    this.state = await api(`/c/${this.charId}/enter`, {});
    const c = this.state.character;
    const me: RemoteInfo = { id: c.id, name: c.dharmaName, level: this.state.stats.level, title: c.title, look: this.myLook(), x: c.pos.x, z: c.pos.z, ry: c.pos.ry, anim: 'idle' };
    this.world = new World(this.root, c.temple.code, c.temple.name, me, this.state.itemData);
    this.world.onNearest = (i) => { this.nearest = i; this.renderInteract(); };
    this.world.onMove = (x, z, ry, a) => { this.net?.move(x, z, ry, a); this.updateZone(x, z); };
    this.world.onPickPlayer = (id) => this.playerCard(id);
    this.world.onNearMat = (m) => { this.nearMat = m; this.renderInteract(); };
    this.world.onBlockedMove = () => {
      if (Date.now() - this.lastBlockedHint < 4000) return;
      this.lastBlockedHint = Date.now();
      toast(this.session ? 'Đang hành lễ. Kết thúc buổi lễ trước khi rời chỗ.' : 'Bạn đang ở chỗ trên bồ đoàn. Bấm E hoặc nút "Rời chỗ" để đi lại.');
    };
    if (import.meta.env.VITE_DEMO) (window as any).__pos = () => [this.world.pos.x, this.world.pos.z];
    this.buildHud();
    this.els.zone.textContent = c.temple.name;
    this.updateZone(c.pos.x, c.pos.z);
    this.connect();
    this.renderAll();
    loading.remove();
    const unlock = () => { sfx.unlockAudio(); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
    window.addEventListener('pointerdown', unlock); window.addEventListener('keydown', unlock);
    window.addEventListener('keydown', this.onKey);
    if (this.state.dailyGift) toast('Quà lên chùa hôm nay: 3 Nén hương, 2 Nến, 2 Hoa sen, 1 Hoa đăng', 'good', 5000);
    toast(`Chào mừng ${c.dharmaName} đến ${c.temple.name}`, 'big');
    this.loadChat();
    this.loadSocialBadge();
  }

  private myLook() {
    const c = this.state.character;
    return { gender: c.gender, hair: c.hair, skin: c.skin, robe: c.equipment.robe || null, accessory: c.equipment.accessory || null, bead: c.equipment.bead || null, robeColor: c.equipment.robeColor || null };
  }

  // ---------- Kết nối realtime ----------
  private connect() {
    const net = new Net(this.token, this.charId);
    this.net = net;
    net.onStatus = (s) => {
      this.els.net.textContent = s === 'online' ? '' : s === 'connecting' ? 'Đang kết nối…' : 'Mất kết nối, đang thử lại…';
      this.els.net.classList.toggle('hidden', s === 'online');
    };
    net.on('welcome', (m) => {
      if (m.ceremony) this.setCeremony(m.ceremony);
      for (const id of this.world.remotesInfo().map((r) => r.id)) this.world.removeRemote(id);
      for (const p of m.players) this.world.addRemote(p);
      for (const l of m.lanterns.slice().reverse()) this.world.addLantern(l.wish, l.name, Date.now() - new Date(l.created_at).getTime());
      this.world.correct(m.you.x, m.you.z);
      this.els.online.textContent = `${m.online} đạo hữu online`;
      this.renderNearby();
    });
    net.on('join', (m) => { this.world.addRemote(m.p); this.renderNearby(); });
    net.on('leave', (m) => { this.world.removeRemote(m.id); this.renderNearby(); });
    net.on('s', (m) => { for (const [id, x, z, ry, a] of m.p) if (id !== this.charId) this.world.updateRemote(id, x, z, ry, a); });
    net.on('look', (m) => { if (m.id !== this.charId) this.world.remoteLook(m.id, m.look); });
    net.on('title', (m) => { if (m.id !== this.charId) this.world.remoteTitle(m.id, m.title); });
    net.on('correct', (m) => this.world.correct(m.x, m.z));
    net.on('pose_ok', (m) => {
      this.world.applySeat(m.kind, m.mat, m.x, m.z, m.ry);
      // Rời chỗ giữa chừng thì kết thúc buổi thiền / tụng kinh
      if (!m.kind && this.session?.kind === 'meditate') this.finishMeditation();
      if (!m.kind && this.session?.kind === 'chant') this.endChant();
      if (!m.kind && this.cerChanting) this.cerChanting = false;
      if (m.kind) sfx.woodBlock(0.4);
      this.renderInteract();
      if (this.drawerName === 'ceremony') this.ceremonyPanel();
    });
    net.on('online', (m) => { this.els.online.textContent = `${m.n} đạo hữu online`; });
    net.on('chat', (m) => this.pushChat({ kind: 'chat', id: m.id, fromId: m.from.id, from: m.from.name, body: m.body }));
    net.on('pm', (m) => this.pushChat({ kind: 'pm', id: m.id, fromId: m.from.id, from: m.from.name, to: m.to.name, toId: m.to.id, body: m.body }));
    net.on('toast', (m) => toast(m.text));
    net.on('fx', (m) => {
      this.world.fx(m.kind);
      if (m.kind === 'bell') sfx.bell(m.id === this.charId ? 1 : 0.6);
    });
    net.on('lantern', (m) => { if (m.by !== this.charId) this.world.addLantern(m.lantern.wish, m.lantern.name); });
    net.on('stamp', (m) => { this.handleOutcome(m.result); this.scheduleRefresh(); });
    net.on('friend_request', (m) => { toast(`${m.from.name} muốn kết bạn với bạn. Mở Cộng đồng để trả lời.`, 'good', 6000); this.pendingRequests++; this.renderBadges(); });
    net.on('gift', (m) => { toast(m.text, 'good', 6000); sfx.chime(); this.scheduleRefresh(); });
    net.on('refresh', () => this.scheduleRefresh());
    net.on('ceremony_state', (m) => {
      const wasRunning = !!this.cer?.current;
      this.setCeremony(m.s);
      if (!wasRunning && m.s.current) { sfx.bell(0.9); toast('Đại lễ cộng tu bắt đầu tại Chánh điện', 'big', 6000); }
    });
    net.on('ceremony_tick', (m) => { this.cerPresent = m.present; this.clockOffset = m.serverNow - Date.now(); });
    net.on('ceremony_result', (m) => { sfx.bell(0.8); this.handleOutcome(m.result); toast(`Cùng ${m.participants} đạo hữu viên mãn đại lễ`, 'good', 6000); this.scheduleRefresh(); });
    net.on('ceremony_missed', (m) => toast(`Bạn có mặt ${Math.round(m.presence * 100)}% thời gian đại lễ, cần ${Math.round(m.need * 100)}% để được ghi nhận.`, 'bad', 7000));
    net.on('kicked', (m) => { net.close(); this.exit('servers'); toast(m.reason, 'bad', 10000); });
    net.on('error', (m) => toast(m.text, 'bad', 6000));
    net.on('closed', (m) => { if (m.code === 4000) { /* chuyển chùa */ } });
    net.connect();
  }

  // ---------- HUD ----------
  private buildHud() {
    setToastHost(this.hud.appendChild(h('div', { class: 'toasts', 'aria-live': 'polite' })));
    const e = this.els;
    e.badge = h('div', { class: 'avatar-badge' });
    e.name = h('div', { class: 'name' });
    e.exp = h('i');
    e.wallet = h('div', { class: 'wallet' });
    this.hud.appendChild(h('div', { class: 'top-left panel-glass' }, e.badge, h('div', { class: 'who' }, e.name, h('div', { class: 'exp-bar', title: 'Kinh nghiệm' }, e.exp), e.wallet)));
    e.event = h('div', { class: 'event-banner hidden' });
    this.hud.appendChild(e.event);
    e.cerBanner = h('button', { class: 'cer-banner hidden', onclick: () => this.openDrawer('ceremony') });
    this.hud.appendChild(e.cerBanner);
    this.cerTimer = window.setInterval(() => this.renderCeremonyHud(), 1000);
    e.minimap = h('canvas', { width: 300, height: 300 }) as any;
    e.zone = h('div', { class: 'zone-name panel-glass' });
    e.online = h('div', { class: 'net-status panel-glass muted' });
    e.net = h('div', { class: 'net-status panel-glass hidden', role: 'status' });
    e.nearby = h('div', { class: 'nearby panel-glass' });
    this.hud.appendChild(h('div', { class: 'top-right' }, h('div', { class: 'minimap panel-glass', title: 'Bản đồ nhỏ' }, e.minimap), e.zone, e.online, e.net, e.nearby));
    e.tracker = h('div', { class: 'tracker panel-glass' });
    this.hud.appendChild(e.tracker);
    this.buildChat();
    e.interact = h('div', { class: 'interact hidden' });
    this.hud.appendChild(e.interact);
    // Joystick ảo (điện thoại)
    const knob = h('i');
    const joy = h('div', { class: 'joystick', 'aria-label': 'Cần điều khiển di chuyển' }, knob);
    let jid: number | null = null;
    const setJ = (t: Touch) => {
      const r = joy.getBoundingClientRect(); let dx = (t.clientX - (r.left + r.width / 2)) / (r.width / 2); let dy = (t.clientY - (r.top + r.height / 2)) / (r.height / 2);
      const d = Math.hypot(dx, dy); if (d > 1) { dx /= d; dy /= d; }
      knob.style.transform = `translate(${dx * 35}px, ${dy * 35}px)`;
      this.world.setJoystick(dx, -dy);
    };
    joy.addEventListener('touchstart', (ev) => { ev.preventDefault(); const t = ev.changedTouches[0]; jid = t.identifier; setJ(t); }, { passive: false });
    joy.addEventListener('touchmove', (ev) => { ev.preventDefault(); for (const t of Array.from(ev.changedTouches)) if (t.identifier === jid) setJ(t); }, { passive: false });
    const endJ = (ev: TouchEvent) => { for (const t of Array.from(ev.changedTouches)) if (t.identifier === jid) { jid = null; knob.style.transform = ''; this.world.setJoystick(0, 0); } };
    joy.addEventListener('touchend', endJ); joy.addEventListener('touchcancel', endJ);
    this.hud.appendChild(joy);
    // Thanh thao tác
    const qb = (ic: string, label: string, key: string, fn: () => void, name: string) => {
      const b = h('button', { class: 'qb', title: `${label} (${key})`, onclick: fn }, icon(ic), h('span', null, label), h('kbd', null, key));
      e['qb_' + name] = b; return b;
    };
    this.hud.appendChild(h('nav', { class: 'quickbar panel-glass', 'aria-label': 'Thanh thao tác' },
      qb('bow', 'Lạy Phật', '1', () => this.doAct('prostrate'), 'prostrate'),
      qb('beads', 'Tràng hạt', '2', () => this.openDrawer('beads'), 'beads'),
      qb('meditate', 'Thiền', '3', () => this.openDrawer('meditate'), 'meditate'),
      qb('book', 'Tụng kinh', '4', () => this.openDrawer('chant'), 'chant'),
      qb('bell', 'Đại lễ', 'L', () => this.openDrawer('ceremony'), 'ceremony'),
      h('div', { class: 'qb-sep' }),
      qb('scroll', 'Nhiệm vụ', 'J', () => this.openDrawer('missions'), 'missions'),
      qb('user', 'Hồ sơ', 'C', () => this.openDrawer('profile'), 'profile'),
      qb('shop', 'Cửa hàng', 'B', () => this.openDrawer('shop'), 'shop'),
      qb('people', 'Cộng đồng', 'F', () => this.openDrawer('community'), 'community'),
      qb('map', 'Hành hương', 'M', () => this.openDrawer('pilgrimage'), 'pilgrimage'),
      qb('menu', 'Menu', 'Esc', () => this.openDrawer('menu'), 'menu')));
    this.drawMinimapLoop();
  }

  private onKey = (e: KeyboardEvent) => {
    const a = document.activeElement;
    if (a && ['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName)) { if (e.key === 'Escape') (a as HTMLElement).blur(); return; }
    const map: Record<string, () => void> = {
      Digit1: () => this.doAct('prostrate'), Digit2: () => this.openDrawer('beads'), Digit3: () => this.openDrawer('meditate'), Digit4: () => this.openDrawer('chant'),
      KeyJ: () => this.openDrawer('missions'), KeyC: () => this.openDrawer('profile'), KeyB: () => this.openDrawer('shop'), KeyF: () => this.openDrawer('community'),
      KeyM: () => this.openDrawer('pilgrimage'), KeyL: () => this.openDrawer('ceremony'), KeyE: () => this.interact(), Enter: () => (this.els.chatInput as HTMLInputElement).focus(),
      Escape: () => (this.drawer ? this.closeDrawer() : this.openDrawer('menu')),
      Space: () => { if (this.drawerName === 'beads') this.tapBead(); },
    };
    const fn = map[e.code];
    if (fn) { e.preventDefault(); if (!e.repeat || e.code === 'Space') fn(); }
  };

  private renderAll() {
    const s = this.state, c = s.character, st = s.stats;
    this.els.badge.textContent = c.dharmaName.trim().split(' ').pop()!.charAt(0).toUpperCase();
    clear(this.els.name);
    this.els.name.append(c.dharmaName, h('small', null, `Cấp ${st.level}${c.title ? ' · ' + c.title : ''}`));
    this.els.exp.style.width = `${Math.min(100, (st.exp / st.expNeeded) * 100)}%`;
    this.els.exp.parentElement!.title = `Kinh nghiệm ${fmt(st.exp)}/${fmt(st.expNeeded)}`;
    clear(this.els.wallet);
    this.els.wallet.append(
      h('span', { title: 'Công đức' }, icon('merit'), h('b', null, fmt(s.wallet.merit))),
      h('span', { title: 'Sen' }, icon('sen'), h('b', null, fmt(s.wallet.sen))),
      h('span', { title: 'Ngọc' }, icon('ngoc'), h('b', null, fmt(s.wallet.ngoc))));
    this.els.event.classList.toggle('hidden', !s.event);
    if (s.event) this.els.event.textContent = `Sự kiện: ${s.event.name} · công đức x${s.event.multiplier}`;
    // Theo dõi nhiệm vụ ngày
    clear(this.els.tracker);
    this.els.tracker.appendChild(this.els.cerLine ||= h('div', { class: 'cer-line' }));
    this.renderCeremonyHud();
    const daily = s.missions.filter((m: any) => m.reset === 'daily' && !m.locked && !m.claimed);
    this.hasClaimable = s.missions.some((m: any) => !m.locked && !m.claimed && m.progress >= m.target);
    this.els.tracker.appendChild(h('h4', null, 'Nhiệm vụ hôm nay', h('button', { class: 'btn small ghost', onclick: () => this.openDrawer('missions') }, 'Xem')));
    if (!daily.length) this.els.tracker.appendChild(h('div', { class: 'done' }, 'Đã nhận đủ thưởng nhiệm vụ ngày.'));
    for (const m of daily.slice(0, 4)) {
      const done = m.progress >= m.target;
      this.els.tracker.appendChild(h('div', { class: 'row' + (done ? ' done' : '') }, h('span', null, `${m.name} ${m.progress}/${m.target}${done ? ' · nhận thưởng' : ''}`),
        h('div', { class: 'bar' }, h('i', { style: { width: `${(m.progress / m.target) * 100}%` } }))));
    }
    this.world.setMyLabel(c.dharmaName, st.level, c.title);
    this.renderBadges();
    if (this.drawer) this.renderDrawer();
  }

  private renderBadges() {
    this.els.qb_missions?.classList.toggle('badge-dot', this.hasClaimable);
    this.els.qb_community?.classList.toggle('badge-dot', this.pendingRequests > 0);
  }

  private async loadSocialBadge() {
    try { const s = await api(`/c/${this.charId}/social`); this.pendingRequests = s.incoming.length; this.renderBadges(); } catch { /* bỏ qua */ }
  }

  scheduleRefresh() {
    clearTimeout(this.refreshT);
    this.refreshT = window.setTimeout(async () => {
      try { this.state = { ...await api(`/c/${this.charId}/state`), dailyGift: null }; this.renderAll(); } catch { /* lần sau */ }
    }, 400);
  }

  private updateZone(x: number, z: number) {
    const zn = zoneAt(this.state.character.temple.zones, x, z);
    if (zn?.code !== this.zone?.code) { this.zone = zn; this.els.zone.textContent = zn ? zn.name : this.state.character.temple.name; }
  }

  private renderNearby() {
    const list = this.world.remotesInfo();
    clear(this.els.nearby);
    this.els.nearby.appendChild(h('h4', null, `Xung quanh (${list.length})`));
    if (!list.length) this.els.nearby.appendChild(h('div', { class: 'muted' }, 'Chưa có ai trong chùa này.'));
    for (const p of list.slice(0, 20)) this.els.nearby.appendChild(h('button', { onclick: () => this.playerCard(p.id) }, `${p.name} · ${p.level}`));
  }

  private renderInteract() {
    const b = this.els.interact, it = this.nearest, seat = this.world?.seat;
    clear(b);
    const btn = (key: string, label: string, fn: () => void, cls = '') => h('button', { class: 'ibtn ' + cls, onclick: fn }, h('kbd', null, key), label);
    if (seat) {
      // Đang ngồi/quỳ: gợi ý nghi lễ làm được ở tư thế này
      const can = [['prostrate', '1 Lạy Phật'], ['meditate', '3 Thiền'], ['chant', '4 Tụng kinh']].filter(([r]) => poseAllows(r, seat)).map(([, l]) => l);
      b.append(h('span', { class: 'seat-hint' }, `Đã vào chỗ${can.length ? ' · ' + can.join(' · ') : ''}`),
        btn('E', 'Rời chỗ', () => this.standUp(), 'ghost'));
    } else if (this.nearMat && !this.world.locked) {
      b.append(h('span', { class: 'seat-hint' }, 'Bồ đoàn'), btn('E', 'Vào chỗ', () => this.seatDown()));
    } else if (it && !this.world?.locked) {
      b.append(btn('E', it.label, () => this.interact()));
    }
    b.classList.toggle('hidden', !b.childElementCount);
  }
  private seatDown() {
    if (!this.nearMat || this.world.seat) return;
    this.net.send({ t: 'pose', kind: 'place' as SeatKind, mat: this.nearMat.id });
  }
  private standUp() {
    if (this.session) return toast(this.session.kind === 'meditate' ? 'Bấm "Xả thiền" để kết thúc buổi thiền trước.' : 'Bấm "Dừng" để kết thúc thời kinh trước.');
    this.net.send({ t: 'pose', kind: null });
  }

  // ---------- Minimap ----------
  private drawMinimapLoop() {
    const cv = this.els.minimap as unknown as HTMLCanvasElement;
    const g = cv.getContext('2d')!;
    const W = cv.width, sx = (x: number) => ((x - BOUNDS.x0) / (BOUNDS.x1 - BOUNDS.x0)) * W, sz = (z: number) => ((z - BOUNDS.z0) / (BOUNDS.z1 - BOUNDS.z0)) * W;
    const sr = (r: number) => (r / (BOUNDS.x1 - BOUNDS.x0)) * W;
    const draw = () => {
      if (!this.world) return;
      g.fillStyle = '#3d4a2c'; g.fillRect(0, 0, W, W);
      g.fillStyle = '#a86a4a'; g.fillRect(sx(-11), sz(-8), sx(11) - sx(-11), sz(30) - sz(-8));
      g.fillStyle = '#7a2414'; g.fillRect(sx(HALL.cx - HALL.w / 2), sz(HALL.cz - HALL.d / 2), sr(HALL.w), sr(HALL.d));
      g.fillRect(sx(CHANT_HALL.cx - CHANT_HALL.w / 2), sz(CHANT_HALL.cz - CHANT_HALL.d / 2), sr(CHANT_HALL.w), sr(CHANT_HALL.d));
      g.fillStyle = '#3f7a8a';
      for (const w of [POND, LAKE]) { g.beginPath(); g.arc(sx(w.x), sz(w.z), sr(w.r), 0, 7); g.fill(); }
      g.fillStyle = '#6f8a3a'; g.beginPath(); g.arc(sx(MEDITATION.x), sz(MEDITATION.z), sr(5), 0, 7); g.fill();
      g.fillStyle = '#d9a441'; g.fillRect(sx(-8), sz(GATE_Z) - 3, sx(8) - sx(-8), 6);
      g.beginPath(); g.arc(sx(URN.x), sz(URN.z), 5, 0, 7); g.fill();
      g.beginPath(); g.arc(sx(BELL.x), sz(BELL.z), 5, 0, 7); g.fill();
      // nhãn tương tác
      g.fillStyle = 'rgba(255,240,210,.85)'; g.font = '600 15px system-ui';
      for (const it of INTERACTABLES) if (['lake', 'meditation', 'chant'].includes(it.id)) { const lb = it.id === 'lake' ? 'Hoa đăng' : it.id === 'meditation' ? 'Thiền' : 'Kinh'; g.fillText(lb, sx(it.x) - g.measureText(lb).width / 2, sz(it.z) + 5); }
      for (const r of this.world.remotesInfo()) { g.fillStyle = '#9fd6e8'; g.beginPath(); g.arc(sx(r.x), sz(r.z), 5, 0, 7); g.fill(); }
      // mình
      const p = this.world.pos;
      g.save(); g.translate(sx(p.x), sz(p.z)); g.rotate(-this.world.ry + Math.PI);
      g.fillStyle = '#ffe7a8'; g.strokeStyle = '#2a1709'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(0, -11); g.lineTo(8, 8); g.lineTo(0, 4); g.lineTo(-8, 8); g.closePath(); g.fill(); g.stroke();
      g.restore();
    };
    const tick = () => { if (!this.world) return; draw(); this.net?.flush(); setTimeout(tick, 150); };
    tick();
  }

  // ---------- Chat ----------
  private buildChat() {
    const e = this.els;
    e.chatTabs = h('div', { class: 'tabs', role: 'tablist' });
    e.chatLog = h('div', { class: 'chat-log', 'aria-live': 'polite' });
    e.chatInput = h('input', { class: 'input', id: 'chat-input', maxlength: 200, placeholder: 'Nhắn kênh chung… (Enter)', autocomplete: 'off' });
    const chat = h('section', { class: 'chat panel-glass', 'aria-label': 'Trò chuyện' },
      h('div', { class: 'chat-head' }, e.chatTabs, h('button', { class: 'btn small ghost', 'aria-label': 'Thu gọn chat', onclick: () => chat.classList.toggle('collapsed') }, '–')),
      e.chatLog,
      h('form', { class: 'chat-form', onsubmit: (ev: Event) => {
        ev.preventDefault();
        const input = e.chatInput as HTMLInputElement;
        const body = input.value.trim(); if (!body) return;
        this.net.send({ t: 'chat', body, to: this.chatTab === 'public' ? undefined : this.chatTab });
        input.value = '';
      } }, e.chatInput, h('button', { class: 'btn small primary', type: 'submit' }, 'Gửi')));
    e.chat = chat;
    if (matchMedia('(pointer: coarse)').matches) chat.classList.add('collapsed');
    this.hud.appendChild(chat);
    this.renderChat();
  }
  private async loadChat() {
    try {
      const r = await api(`/c/${this.charId}/chat`);
      const old = [
        ...r.public.map((m: any) => ({ kind: 'chat' as const, id: m.id, fromId: m.sender_id, from: m.name, body: m.body })),
        ...r.private.map((m: any) => ({ kind: 'pm' as const, id: m.id, fromId: m.sender_id, from: m.name, to: m.to_name, toId: m.recipient_id, body: m.body })),
      ].sort((a, b) => a.id - b.id);
      this.chatLog = [...old, ...this.chatLog.filter((m) => !old.some((o) => o.id === m.id))];
      this.renderChat();
    } catch { /* bỏ qua */ }
  }
  private pushChat(m: GameUI['chatLog'][number]) {
    this.chatLog.push(m);
    if (this.chatLog.length > 200) this.chatLog.shift();
    this.renderChat();
  }
  private pmPeers(): Map<number, string> {
    const peers = new Map<number, string>();
    for (const m of this.chatLog) if (m.kind === 'pm') {
      if (m.fromId === this.charId && m.toId) peers.set(m.toId, m.to!);
      else if (m.fromId) peers.set(m.fromId, m.from!);
    }
    return peers;
  }
  openPm(id: number, name: string) {
    this.chatTab = id;
    if (!this.pmPeers().has(id)) this.chatLog.push({ kind: 'sys', body: `Bắt đầu trò chuyện riêng với ${name}.`, toId: id, fromId: this.charId, to: name });
    this.els.chat.classList.remove('collapsed');
    this.renderChat();
    (this.els.chatInput as HTMLInputElement).focus();
  }
  private renderChat() {
    const e = this.els;
    clear(e.chatTabs);
    e.chatTabs.appendChild(h('button', { role: 'tab', 'aria-selected': String(this.chatTab === 'public'), onclick: () => { this.chatTab = 'public'; this.renderChat(); } }, 'Kênh chung'));
    const peers = this.pmPeers();
    for (const m of this.chatLog) if (m.kind === 'sys' && m.toId && !peers.has(m.toId)) peers.set(m.toId, m.to!);
    for (const [id, name] of peers) e.chatTabs.appendChild(h('button', { role: 'tab', 'aria-selected': String(this.chatTab === id), onclick: () => { this.chatTab = id; this.renderChat(); } }, name));
    (e.chatInput as HTMLInputElement).placeholder = this.chatTab === 'public' ? 'Nhắn kênh chung… (Enter)' : `Nhắn riêng ${peers.get(this.chatTab as number) || ''}…`;
    clear(e.chatLog);
    const shown = this.chatLog.filter((m) => this.chatTab === 'public' ? m.kind === 'chat' : (m.kind === 'pm' || m.kind === 'sys') && (m.fromId === this.chatTab || m.toId === this.chatTab));
    if (!shown.length) e.chatLog.appendChild(h('div', { class: 'msg m-sys' }, this.chatTab === 'public' ? 'Chưa có tin nhắn. Gửi lời chào đến các đạo hữu.' : 'Chưa có tin nhắn riêng.'));
    for (const m of shown.slice(-60)) {
      if (m.kind === 'sys') { e.chatLog.appendChild(h('div', { class: 'msg m-sys' }, m.body)); continue; }
      const who = h('b', { title: 'Xem người chơi', onclick: () => m.fromId && m.fromId !== this.charId && this.playerCard(m.fromId, m.id) }, m.fromId === this.charId && m.kind === 'pm' ? `Bạn → ${m.to}` : m.from);
      e.chatLog.appendChild(h('div', { class: 'msg m-' + m.kind }, who, ': ', m.body));
    }
    e.chatLog.scrollTop = e.chatLog.scrollHeight;
  }

  // ---------- Hoạt động ----------
  private outcomeBusy = false;
  async doAct(code: string) {
    if (this.session) return toast('Hãy kết thúc hoạt động hiện tại trước.');
    if (POSE_RULES[code] && !poseAllows(code, this.world.seat)) return toast(POSE_RULES[code].hint, 'bad');
    if (!POSE_RULES[code] && this.world.seat) return toast('Hãy rời chỗ trước (phím E).');
    if (this.outcomeBusy) return;
    const target = ACT_TARGET[code];
    if (target && !this.world.seat) this.world.faceTowards(target[0], target[1]);
    this.outcomeBusy = true;
    try {
      const r = await api(`/c/${this.charId}/act/${code}`, {});
      const [anim, secs] = ACT_ANIM[code];
      this.world.playOneShot(anim, secs);
      if (code === 'prostrate') { sfx.woodBlock(0.8); setTimeout(() => sfx.woodBlock(0.6), 1200); }
      if (code !== 'bell') sfx.chime();
      this.handleOutcome(r);
      this.scheduleRefresh();
    } catch (ex: any) {
      toast(ex.message, 'bad');
    } finally {
      setTimeout(() => { this.outcomeBusy = false; }, code === 'prostrate' ? 2500 : 600);
    }
  }

  handleOutcome(r: any) {
    if (!r) return;
    if (r.message) toast(r.message, r.rewarded ? 'good' : '');
    for (const L of r.levelUps || []) { toast(`Chúc mừng! Bạn đã lên cấp ${L}`, 'big', 5000); sfx.bell(0.7); }
    for (const a of r.achievements || []) toast(`Thành tựu mới: ${a.name}${a.title ? ' · mở khóa danh hiệu "' + a.title + '"' : ''}`, 'big', 6000);
  }

  private interact() {
    if (this.world.seat) return this.standUp();
    if (this.nearMat && !this.world.locked) return this.seatDown();
    const it = this.nearest;
    if (!it || this.world.locked) return;
    if (it.action === 'act') this.doAct(it.code);
    else this.openDrawer(it.code);
  }

  // ---------- Ngăn kéo ----------
  openDrawer(name: string) {
    if (this.drawerName === name && this.drawer) return this.closeDrawer();
    this.closeDrawer(true);
    this.drawerName = name;
    this.drawer = h('aside', { class: 'drawer', role: 'dialog', 'aria-label': name });
    document.body.appendChild(this.drawer);
    for (const [k, b] of Object.entries(this.els)) if (k.startsWith('qb_')) b.setAttribute('aria-pressed', String(k === 'qb_' + name));
    this.renderDrawer();
  }
  closeDrawer(silent = false) {
    if (this.session && !silent && (this.drawerName === 'meditate' || this.drawerName === 'chant')) {
      toast(this.session.kind === 'meditate' ? 'Đang thiền. Bấm "Xả thiền" để kết thúc.' : 'Đang tụng kinh. Bấm "Dừng" để kết thúc.');
      return;
    }
    if (this.drawerName === 'beads') this.flushBeads();
    this.drawer?.remove(); this.drawer = null; this.drawerName = '';
    for (const [k, b] of Object.entries(this.els)) if (k.startsWith('qb_')) b.setAttribute('aria-pressed', 'false');
    if (this.world?.anim === 'bead') this.world.setPose(null);
    if (this.drawerName === '' && this.cerChanting) { this.cerChanting = false; this.world?.setPose(null); }
    this.renderInteract();
  }
  private tabState: Record<string, string> = {};
  private shell(title: string, tabs: [string, string][] | null, body: (tab: string) => Node | Promise<Node>) {
    const d = this.drawer!;
    clear(d);
    const tab = tabs ? (this.tabState[this.drawerName] && tabs.some((t) => t[0] === this.tabState[this.drawerName]) ? this.tabState[this.drawerName] : tabs[0][0]) : '';
    d.appendChild(h('div', { class: 'drawer-head' }, h('h2', null, title), h('button', { class: 'close', 'aria-label': 'Đóng', onclick: () => this.closeDrawer() }, '×')));
    if (tabs) {
      const tb = h('div', { class: 'tabs', role: 'tablist' });
      for (const [k, label] of tabs) tb.appendChild(h('button', { role: 'tab', 'aria-selected': String(k === tab), onclick: () => { this.tabState[this.drawerName] = k; this.renderDrawer(); } }, label));
      d.appendChild(tb);
    } else d.appendChild(h('div'));
    const bodyEl = h('div', { class: 'drawer-body' }, h('div', { class: 'muted' }, 'Đang tải…'));
    d.appendChild(bodyEl);
    Promise.resolve(body(tab)).then((n) => { clear(bodyEl); bodyEl.appendChild(n); }).catch((e) => { clear(bodyEl); bodyEl.appendChild(h('div', { class: 'error' }, e.message)); });
  }

  private renderDrawer() {
    if (!this.drawer) return;
    const n = this.drawerName;
    if (n === 'beads') return this.beadsPanel();
    if (n === 'meditate') return this.meditatePanel();
    if (n === 'chant') return this.chantPanel();
    if (n === 'lantern') return this.lanternPanel();
    if (n === 'stele') return this.stelePanel();
    if (n === 'ceremony') return this.ceremonyPanel();
    if (n === 'missions') return this.shell('Nhiệm vụ', PERIODS, (t) => this.missionsBody(t));
    if (n === 'profile') return this.shell('Hồ sơ', [['me', 'Nhân vật'], ['bag', 'Túi đồ'], ['ach', 'Thành tựu'], ['hist', 'Lịch sử']], (t) => this.profileBody(t));
    if (n === 'shop') return this.shell('Cửa hàng', [...SHOP_CATS, ['tx', 'Giao dịch']], (t) => this.shopBody(t));
    if (n === 'community') return this.shell('Cộng đồng', [['near', 'Xung quanh'], ['friends', 'Bạn bè'], ['req', 'Lời mời'], ['search', 'Tìm kiếm'], ['rank', 'Xếp hạng'], ['block', 'Đã chặn']], (t) => this.communityBody(t));
    if (n === 'pilgrimage') return this.shell('Hành hương', null, () => this.pilgrimageBody());
    if (n === 'menu') return this.shell('Menu', null, () => this.menuBody());
  }

  // ----- Tràng hạt -----
  private beadsPanel() {
    const st = this.state.stats;
    if (!this.beadPending) this.beadLocal = st.bead_progress;
    const color = this.state.character.equipment.bead ? this.state.itemData[this.state.character.equipment.bead]?.color : null;
    const mala = h('div', { class: 'mala', style: color ? { '--bead': color } as any : null });
    const beads: HTMLElement[] = [];
    for (let i = 0; i < 108; i++) {
      const a = (i / 108) * Math.PI * 2 - Math.PI / 2;
      const b = h('i', { class: i === 0 ? 'guru' : '', style: { left: `${50 + 46 * Math.cos(a)}%`, top: `${50 + 46 * Math.sin(a)}%` } });
      beads.push(b); mala.appendChild(b);
    }
    const count = h('b');
    const rounds = h('span', { class: 'muted' });
    mala.appendChild(h('div', { class: 'center' }, count, h('span', { class: 'muted' }, '/108'), rounds));
    const paint = () => {
      beads.forEach((b, i) => b.classList.toggle('on', i > 0 && i <= this.beadLocal));
      count.textContent = String(this.beadLocal);
      rounds.textContent = `Đã trọn ${fmt(this.state.stats.bead_rounds)} chuỗi`;
    };
    (this as any)._paintBeads = paint;
    paint();
    this.shell('Lần tràng hạt', null, () => h('div', { class: 'list' },
      h('p', { class: 'muted', style: { margin: 0 } }, 'Mỗi hạt một câu niệm. Lần chậm rãi theo hơi thở. Trọn 108 hạt được ghi nhận một chuỗi.'),
      mala,
      h('button', { class: 'btn gold big-btn', onclick: () => this.tapBead() }, 'Lần hạt (Space)'),
      h('div', { class: 'note' }, 'Lần hạt được ở mọi nơi trong chùa. Server kiểm tra nhịp lần hạt; lần quá nhanh sẽ không được ghi nhận.')));
    if (!this.world.locked) { this.world.anim = 'bead'; this.world.me.setAnim('bead'); this.net.send({ t: 'anim', a: 'bead' }); }
  }
  private lastBeadTap = 0;
  tapBead() {
    const now = performance.now();
    if (now - this.lastBeadTap < 260) return;   // khớp nhịp server
    this.lastBeadTap = now;
    sfx.bead();
    this.beadLocal = (this.beadLocal + 1) % 108;
    this.beadPending++;
    if (this.beadLocal === 0) { sfx.bell(0.5); this.flushBeads(); }
    else { clearTimeout(this.beadTimer); this.beadTimer = window.setTimeout(() => this.flushBeads(), 1500); if (this.beadPending >= 20) this.flushBeads(); }
    (this as any)._paintBeads?.();
  }
  private async flushBeads() {
    clearTimeout(this.beadTimer);
    const n = this.beadPending; if (!n) return;
    this.beadPending = 0;
    try {
      const r = await api(`/c/${this.charId}/beads`, { count: n });
      this.state.stats.bead_progress = r.progress; this.state.stats.bead_rounds = r.rounds;
      if (!this.beadPending) this.beadLocal = r.progress;
      if (r.rewarded || r.message) this.handleOutcome(r);
      if (r.rewarded) this.scheduleRefresh();
    } catch (ex: any) {
      toast(ex.message, 'bad');
      this.beadLocal = this.state.stats.bead_progress;
    }
    (this as any)._paintBeads?.();
  }

  // ----- Thiền -----
  private meditatePanel() {
    if (this.session?.kind === 'meditate') return this.meditateRunning();
    this.shell('Thiền định', null, () => {
      let minutes = 5;
      const chips = h('div', { class: 'chips' });
      const draw = () => { clear(chips); for (const m of MEDITATION_OPTIONS) chips.appendChild(h('button', { class: 'chip', 'aria-pressed': String(m === minutes), onclick: () => { minutes = m; draw(); } }, `${m} phút`)); };
      draw();
      return h('div', { class: 'list' },
        h('p', { class: 'muted', style: { margin: 0 } }, 'Đến bồ đoàn ở Rừng trúc thiền hoặc trong Chánh điện, bấm "Vào chỗ" rồi bắt đầu. Thời gian được đo trên máy chủ.'),
        h('div', { class: 'section-title' }, 'Thời lượng'), chips,
        h('button', { class: 'btn gold big-btn', onclick: async () => {
          try {
            if (!poseAllows('meditate', this.world.seat)) return toast(POSE_RULES.meditate.hint, 'bad');
            await api(`/c/${this.charId}/meditate/start`, { minutes });
            this.session = { kind: 'meditate', ends: Date.now() + minutes * 60_000 };
            this.world.setPose('meditate');
            sfx.bell(0.6);
            this.renderInteract();
            this.meditateRunning();
          } catch (ex: any) { toast(ex.message, 'bad'); }
        } }, 'Bắt đầu thiền'),
        h('div', { class: 'note' }, `Đã thiền tổng cộng ${fmt(this.state.stats.meditation_minutes)} phút. Xả thiền sớm vẫn được ghi nhận số phút đã ngồi (tối thiểu 1 phút).`));
    });
  }
  private meditateRunning() {
    this.shell('Đang thiền', null, () => {
      const circle = h('div', { class: 'breath' }, h('div', null, h('b'), h('div', { class: 'muted' }, 'Hít vào')));
      const timeEl = circle.querySelector('b')!, label = circle.querySelector('.muted')!;
      let phase = 0;
      const step = () => {
        if (!this.session || this.session.kind !== 'meditate') return;
        const left = Math.max(0, this.session.ends! - Date.now());
        timeEl.textContent = `${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}`;
        const cyc = (Date.now() / 1000) % 10; const inhale = cyc < 4;
        if ((inhale ? 0 : 1) !== phase || !circle.className.includes(inhale ? 'in' : 'out')) { phase = inhale ? 0 : 1; circle.className = 'breath ' + (inhale ? 'in' : 'out'); label.textContent = inhale ? 'Hít vào' : 'Thở ra'; }
        if (left <= 0) { this.finishMeditation(); return; }
      };
      clearInterval(this.session!.timer);
      this.session!.timer = window.setInterval(step, 250);
      step();
      return h('div', { class: 'list' }, circle,
        h('p', { class: 'muted', style: { textAlign: 'center', margin: 0 } }, 'Hít vào 4 giây, thở ra 6 giây. Thả lỏng vai, để ý hơi thở.'),
        h('button', { class: 'btn big-btn', onclick: () => this.finishMeditation() }, 'Xả thiền'));
    });
  }
  private async finishMeditation() {
    if (!this.session) return;
    clearInterval(this.session.timer);
    this.session = null;
    this.world.setPose(null);
    try { const r = await api(`/c/${this.charId}/meditate/finish`, {}); sfx.bell(0.6); this.handleOutcome(r); this.scheduleRefresh(); }
    catch (ex: any) { toast(ex.message, 'bad'); }
    if (this.drawerName === 'meditate') this.meditatePanel();
  }

  // ----- Tụng kinh -----
  private chantPanel() {
    if (this.session?.kind === 'chant') return;
    this.shell('Tụng kinh', null, () => h('div', { class: 'list' },
      h('p', { class: 'muted', style: { margin: 0 } }, 'Vào chỗ trên bồ đoàn ở Giảng đường hoặc Chánh điện rồi chọn bài. Mỗi dòng được đánh dấu theo nhịp đọc; hoàn tất khi đọc trọn bài.'),
      SUTRAS.map((s) => h('div', { class: 'item' },
        h('div', { class: 'title' }, s.name),
        h('div', { class: 'desc' }, `${s.lines.length} dòng · tối thiểu ${s.minSeconds} giây · ${s.note}`),
        h('div', { class: 'actions' }, h('button', { class: 'btn small primary', onclick: () => this.startChant(s.code) }, 'Tụng'))))));
  }
  private async startChant(code: string) {
    const s = SUTRAS.find((x) => x.code === code)!;
    if (!poseAllows('chant', this.world.seat)) return toast(POSE_RULES.chant.hint, 'bad');
    try { await api(`/c/${this.charId}/chant/start`, { code }); } catch (ex: any) { return toast(ex.message, 'bad'); }
    this.session = { kind: 'chant' };
    this.world.setPose('chant');
    this.renderInteract();
    const startAt = Date.now(), perLine = (s.minSeconds * 1000) / s.lines.length;
    let current = 0;
    this.shell(s.name, null, () => {
      const box = h('div', { class: 'sutra' });
      const ps = s.lines.map((l, i) => box.appendChild(h('p', { class: i === 0 && code === 'tam_kinh' ? 'title' : '' }, l)));
      const next = h('button', { class: 'btn gold big-btn' }, 'Dòng tiếp');
      const finish = h('button', { class: 'btn primary big-btn', disabled: true, onclick: async () => {
        try { const r = await api(`/c/${this.charId}/chant/finish`, {}); sfx.bell(0.7); this.handleOutcome(r); this.scheduleRefresh(); this.endChant(); }
        catch (ex: any) { toast(ex.message, 'bad'); }
      } }, 'Hoàn tất thời kinh');
      const paint = () => {
        ps.forEach((p, i) => { p.classList.toggle('read', i < current); p.classList.toggle('current', i === current); });
        ps[Math.min(current, ps.length - 1)]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        const allowedLine = Math.floor((Date.now() - startAt) / perLine);
        next.disabled = current >= s.lines.length || current >= allowedLine + 1;
        finish.disabled = current < s.lines.length || Date.now() - startAt < s.minSeconds * 1000;
        next.textContent = current >= s.lines.length ? 'Đã đọc trọn bài' : next.disabled ? 'Đọc chậm rãi…' : 'Dòng tiếp';
      };
      next.onclick = () => { if (!next.disabled) { current++; sfx.woodBlock(0.6); paint(); } };
      const timer = window.setInterval(() => { if (this.session?.kind !== 'chant') return clearInterval(timer); paint(); }, 300);
      this.session!.timer = timer;
      paint();
      return h('div', { class: 'list' }, box, next, finish, h('button', { class: 'btn ghost', onclick: () => this.endChant() }, 'Dừng (không được ghi nhận)'));
    });
  }
  private endChant() {
    if (this.session) clearInterval(this.session.timer);
    this.session = null;
    this.world.setPose(null);
    if (this.drawerName === 'chant') this.chantPanel();
  }

  // ----- Đại lễ cộng tu -----
  private cerChanting = false;
  private setCeremony(st: any) {
    this.cer = st;
    this.clockOffset = st.serverNow - Date.now();
    this.renderCeremonyHud();
    if (this.drawerName === 'ceremony') this.ceremonyPanel();
  }
  private serverNow() { return Date.now() + this.clockOffset; }
  private hhmm(t: number) { return new Date(t).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' }); }
  private dur(ms: number) {
    const m = Math.max(0, Math.round(ms / 60000));
    return m >= 60 ? `${Math.floor(m / 60)} giờ ${m % 60} phút` : m >= 1 ? `${m} phút` : `${Math.max(0, Math.ceil(ms / 1000))} giây`;
  }
  private renderCeremonyHud() {
    const c = this.cer; if (!c || !this.els.cerBanner) return;
    const now = this.serverNow();
    const cur = c.current && now < c.current.endAt ? c.current : null;
    const b = this.els.cerBanner;
    b.classList.toggle('hidden', !cur || this.drawerName === 'ceremony');
    if (cur) b.textContent = `Đại lễ đang diễn ra tại Chánh điện · còn ${this.dur(cur.endAt - now)}${cur.mult > 1 ? ` · công đức x${cur.mult}` : ''} · Tham dự`;
    const line = this.els.cerLine;
    if (line) {
      clear(line);
      line.append(h('span', { class: c.lunar.holy ? 'holy' : '' }, `Âm lịch: ${c.lunar.label}`));
      if (cur) line.append(h('button', { class: 'btn small gold', onclick: () => this.openDrawer('ceremony') }, 'Đại lễ đang diễn ra'));
      else if (c.next) line.append(h('button', { class: 'btn small ghost', onclick: () => this.openDrawer('ceremony') }, `Đại lễ ${this.hhmm(c.next.startAt)} · còn ${this.dur(c.next.startAt - now)}`));
    }
  }

  private lastCerLine = -1;
  private ceremonyPanel() {
    const c = this.cer;
    const cur = c?.current && this.serverNow() < c.current.endAt ? c.current : null;
    if (!cur) {
      if (this.cerChanting) { this.cerChanting = false; this.world.setPose(null); }
      this.shell('Đại lễ cộng tu', null, () => h('div', { class: 'list' },
        c ? h('div', { class: 'note' }, `Hôm nay: ${c.lunar.label} âm lịch.${c.lunar.holy ? ' Ngày Rằm/mùng Một: có thêm đại lễ 12:00 và công đức x2.' : ''}`) : null,
        c?.next ? h('div', { class: 'stat' }, h('b', null, this.hhmm(c.next.startAt)), h('span', null, `Đại lễ kế tiếp · còn ${this.dur(c.next.startAt - this.serverNow())}${c.next.mult > 1 ? ' · công đức x' + c.next.mult : ''}`)) : null,
        h('p', { style: { margin: 0 } }, `Đại lễ diễn ra lúc ${CEREMONY_HOURS.map((x) => x + ':00').join(' và ')} hằng ngày (giờ Việt Nam). Cả máy chủ cùng tụng một bài, cùng một nhịp.`),
        h('div', { class: 'section-title' }, 'Cách được ghi nhận'),
        h('ul', { style: { margin: 0, paddingLeft: '18px', color: 'var(--muted)' } },
          h('li', null, 'Có mặt trong Chánh điện ít nhất ' + Math.round(CEREMONY_ATTEND_RATIO * 100) + '% thời gian buổi lễ (khoảng 4 phút).'),
          h('li', null, 'Mỗi người cùng dự thêm 2% công đức cho tất cả, tối đa +40%.'),
          h('li', null, 'Nhận thưởng tối đa 3 buổi mỗi ngày.')),
        h('div', { class: 'section-title' }, 'Trình tự'),
        h('div', { class: 'sutra' }, ceremonyProgram().filter((l) => l.kind !== 'line').map((l) => h('p', { class: 'read' }, l.text)))));
      return;
    }
    const prog = ceremonyProgram();
    this.shell('Đại lễ đang diễn ra', null, () => {
      const status = h('div', { class: 'note' });
      const box = h('div', { class: 'sutra' });
      const ps = prog.map((l) => box.appendChild(h('p', { class: l.kind === 'title' ? 'title' : l.kind === 'bell' ? 'bell' : '' }, l.kind === 'bell' ? '🔔 ' + l.text : l.text)));
      const sit = h('button', { class: 'btn gold big-btn' });
      sit.onclick = () => {
        if (this.cerChanting) { this.cerChanting = false; this.world.setPose(null); }
        else if (!poseAllows('ceremony', this.world.seat)) return toast(POSE_RULES.ceremony.hint, 'bad');
        else { this.cerChanting = true; this.world.setPose('chant'); }
        paint();
      };
      const paint = () => {
        const now = this.serverNow();
        if (!this.cer?.current || now >= cur.endAt) return;
        const idx = ceremonyLineAt(now - cur.startAt, cur.durationMs);
        if (idx !== this.lastCerLine) {
          this.lastCerLine = idx;
          const l = prog[idx];
          if (l) { if (l.kind === 'bell') sfx.bell(0.7); else sfx.woodBlock(0.5); }
          ps.forEach((p, i) => { p.classList.toggle('read', i < idx); p.classList.toggle('current', i === idx); });
          ps[Math.min(idx, ps.length - 1)]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
        const inHall = this.zone?.code === 'main_hall' && poseAllows('ceremony', this.world.seat);
        status.textContent = `${inHall ? 'Bạn đã vào chỗ trong Chánh điện, đang được ghi nhận.' : 'Chưa được ghi nhận: hãy đến bồ đoàn trong Chánh điện và bấm "Vào chỗ".'} · ${this.cerPresent} đạo hữu trong Chánh điện · còn ${this.dur(cur.endAt - now)}${cur.mult > 1 ? ' · công đức x' + cur.mult : ''}`;
        status.style.borderLeftColor = inHall ? 'var(--ok)' : 'var(--danger)';
        sit.textContent = this.cerChanting ? 'Ngừng tụng' : 'Tụng cùng đại chúng';
      };
      this.lastCerLine = -1;
      const t = window.setInterval(() => { if (this.drawerName !== 'ceremony') return clearInterval(t); paint(); }, 400);
      paint();
      return h('div', { class: 'list' }, status, box, sit);
    });
  }

  // ----- Hoa đăng -----
  private lanternPanel() {
    this.shell('Thả hoa đăng', null, () => {
      const inv = this.state.inventory.find((i: any) => i.code === 'hoa_dang');
      const wish = h('textarea', { class: 'input', id: 'wish', rows: 3, maxlength: 80, placeholder: 'Nguyện cho cha mẹ luôn mạnh khỏe…' }) as HTMLTextAreaElement;
      const err = h('div', { class: 'error' });
      return h('div', { class: 'list' },
        h('p', { class: 'muted', style: { margin: 0 } }, 'Lời nguyện sẽ trôi trên hồ và mọi người trong chùa cùng nhìn thấy trong 3 giờ.'),
        h('div', { class: 'field' }, h('label', { for: 'wish' }, 'Lời nguyện (2–80 ký tự)'), wish), err,
        h('div', { class: 'muted' }, `Bạn có ${inv?.quantity || 0} hoa đăng.`),
        h('button', { class: 'btn gold big-btn', disabled: !inv, onclick: async () => {
          err.textContent = '';
          try {
            const r = await api(`/c/${this.charId}/lantern`, { wish: wish.value });
            this.world.addLantern(r.lantern.wish, this.state.character.dharmaName);
            this.world.playOneShot('offer', 1.4); sfx.chime();
            this.handleOutcome(r); this.scheduleRefresh(); this.closeDrawer();
          } catch (ex: any) { err.textContent = ex.message; }
        } }, inv ? 'Thả hoa đăng' : 'Hết hoa đăng – mua ở Cửa hàng'));
    });
  }

  private stelePanel() {
    this.shell(this.state.character.temple.name, null, async () => {
      const temples = await api(`/c/${this.charId}/temples`);
      const t = temples.find((x: any) => x.id === this.state.character.temple.id);
      return h('div', { class: 'list' }, h('div', { class: 'tag' }, t.region), h('p', { style: { margin: 0 } }, t.description), h('div', { class: 'note' }, t.history));
    });
  }

  // ----- Nhiệm vụ -----
  private missionsBody(period: string) {
    const list = this.state.missions.filter((m: any) => m.period === period);
    const resetLabel: Record<string, string> = { daily: 'Làm mới mỗi ngày (0h giờ VN)', weekly: 'Làm mới mỗi thứ Hai', once: 'Một lần' };
    return h('div', { class: 'list' },
      list.length ? null : h('div', { class: 'muted' }, 'Chưa có nhiệm vụ trong mục này.'),
      list.map((m: any) => {
        const done = m.progress >= m.target;
        const r = m.reward;
        return h('div', { class: 'item' + (m.locked ? ' locked' : '') + (done && !m.claimed ? ' claimable' : '') },
          h('div', { class: 'title' }, m.name),
          h('div', { class: 'desc' }, `${m.description} · ${resetLabel[m.reset]}${m.locked ? ` · cần cấp ${m.minLevel}` : ''}`),
          h('div', { class: 'progress' }, h('i', { style: { width: `${Math.min(100, (m.progress / m.target) * 100)}%` } })),
          h('div', { class: 'reward' }, h('span', { class: 'num' }, `${m.progress}/${m.target}`),
            r.merit ? h('span', null, `+${r.merit} công đức`) : null, r.exp ? h('span', null, `+${r.exp} EXP`) : null,
            r.sen ? h('span', null, `+${r.sen} Sen`) : null, r.ngoc ? h('span', null, `+${r.ngoc} Ngọc`) : null,
            r.item ? h('span', null, `+${r.itemQty} ${this.itemName(r.item)}`) : null),
          h('div', { class: 'actions' }, m.claimed ? h('span', { class: 'tag' }, 'Đã nhận') :
            h('button', { class: 'btn small ' + (done ? 'gold' : ''), disabled: !done || m.locked, onclick: async () => {
              try { const res = await api(`/c/${this.charId}/missions/${m.id}/claim`, {}); sfx.chime(); this.handleOutcome(res); this.scheduleRefresh(); }
              catch (ex: any) { toast(ex.message, 'bad'); }
            } }, 'Nhận thưởng')));
      }));
  }
  private itemName(code: string) {
    const names: Record<string, string> = { huong: 'Nén hương', nen: 'Nến', hoa: 'Hoa sen', hoa_dang: 'Hoa đăng' };
    return names[code] || code;
  }

  // ----- Hồ sơ -----
  private async profileBody(tab: string): Promise<Node> {
    const s = this.state, st = s.stats, c = s.character;
    if (tab === 'me') {
      const titleSel = h('select', { class: 'input', id: 'title-sel', onchange: async () => {
        try { await api(`/c/${this.charId}/title`, { title: titleSel.value || null }); toast('Đã đổi danh hiệu.', 'good'); this.scheduleRefresh(); } catch (ex: any) { toast(ex.message, 'bad'); }
      } }, h('option', { value: '' }, '— Không hiển thị —'), s.titles.map((t: string) => h('option', { value: t, selected: t === c.title }, t))) as HTMLSelectElement;
      return h('div', { class: 'list' },
        h('div', null, h('h3', { style: { fontSize: '22px' } }, c.dharmaName), h('div', { class: 'muted' }, `Cấp ${st.level} · ${c.serverName} · đang ở ${c.temple.name}`)),
        h('div', { class: 'progress', title: 'Kinh nghiệm' }, h('i', { style: { width: `${(st.exp / st.expNeeded) * 100}%` } })),
        h('div', { class: 'muted num' }, `EXP ${fmt(st.exp)} / ${fmt(st.expNeeded)} để lên cấp ${st.level + 1}`),
        h('div', { class: 'stats-grid' },
          [['Công đức', s.wallet.merit], ['Sen', s.wallet.sen], ['Ngọc', s.wallet.ngoc], ['Lạy Phật', st.prostrations], ['Chuỗi hạt', st.bead_rounds], ['Phút thiền', st.meditation_minutes],
            ['Thời kinh', st.chants], ['Lễ vật', st.offerings], ['Hoa đăng', st.lanterns], ['Ngày lên chùa', st.days_active], ['Điểm thành tựu', st.achievement_points], ['Quà đã tặng', st.gifts_sent]]
            .map(([l, v]) => h('div', { class: 'stat' }, h('b', null, fmt(v as number)), h('span', null, l)))),
        h('div', { class: 'field' }, h('label', { for: 'title-sel' }, 'Danh hiệu hiển thị'), titleSel),
        h('div', { class: 'note' }, 'Công đức trong game là điểm ghi nhận hoạt động trong trò chơi, không mang giá trị tâm linh thực tế và không quy đổi ra tiền.'));
    }
    if (tab === 'bag') {
      const eq = c.equipment;
      const slotName: Record<string, string> = { robe: 'Áo', accessory: 'Phụ kiện', bead: 'Chuỗi hạt' };
      return h('div', { class: 'list' },
        s.inventory.map((it: any) => {
          const slot = it.data?.slot;
          const equipped = slot && eq[slot] === it.code;
          return h('div', { class: 'item' },
            h('div', { class: 'title' }, it.name, it.category === 'offering' ? h('span', { class: 'muted num' }, ` ×${it.quantity}`) : null),
            h('div', { class: 'desc' }, it.description),
            h('div', { class: 'actions' }, slot ? (equipped
              ? (slot === 'robe' ? h('span', { class: 'tag' }, 'Đang mặc') : h('button', { class: 'btn small', onclick: () => this.equip(slot, null) }, 'Tháo'))
              : h('button', { class: 'btn small gold', onclick: () => this.equip(slot, it.code) }, `Dùng (${slotName[slot]})`)) : null));
        }));
    }
    if (tab === 'ach') {
      return h('div', { class: 'list' }, s.achievements.map((a: any) => {
        const val = a.stat === 'level' ? st.level : st[a.stat];
        return h('div', { class: 'item' + (a.unlocked_at ? ' claimable' : ' locked') },
          h('div', { class: 'title' }, a.name, a.unlocked_at ? ' ✓' : ''),
          h('div', { class: 'desc' }, `${a.description}${a.title ? ` · Danh hiệu: ${a.title}` : ''} · ${a.points} điểm`),
          h('div', { class: 'progress' }, h('i', { style: { width: `${Math.min(100, (Number(val) / Number(a.threshold)) * 100)}%` } })));
      }));
    }
    const hist = await api(`/c/${this.charId}/history`);
    return h('div', { class: 'list' }, h('div', { class: 'section-title' }, 'Hoạt động gần đây'),
      h('table', { class: 'simple' }, h('tbody', null, hist.activities.map((a: any) => h('tr', null,
        h('td', null, new Date(a.created_at).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })),
        h('td', null, a.name + (a.amount > 1 ? ` ×${a.amount}` : '')),
        h('td', { class: 'r' }, a.rewarded ? `+${a.merit} công đức` : h('span', { class: 'muted' }, 'đã đạt giới hạn')))))));
  }
  private async equip(slot: string, code: string | null) {
    try {
      const r = await api(`/c/${this.charId}/equip`, { slot, code });
      this.state.character.equipment = r.equipment;
      this.world.setMyLook(this.myLook());
      toast('Đã cập nhật trang phục.', 'good');
      this.scheduleRefresh();
    } catch (ex: any) { toast(ex.message, 'bad'); }
  }

  // ----- Cửa hàng -----
  private shopCache: any[] | null = null;
  private async shopBody(tab: string): Promise<Node> {
    if (tab === 'tx') {
      const hist = await api(`/c/${this.charId}/history`);
      const label: Record<string, string> = { activity: 'Hoạt động', mission: 'Nhiệm vụ', shop: 'Mua hàng', gift_in: 'Nhận quà', gift_out: 'Tặng quà', level_up: 'Lên cấp', achievement: 'Thành tựu', daily_gift: 'Quà ngày', admin: 'Quản trị', starter: 'Khởi đầu' };
      const cur: Record<string, string> = { merit: 'công đức', sen: 'Sen', ngoc: 'Ngọc' };
      return h('table', { class: 'simple' }, h('thead', null, h('tr', null, h('th', null, 'Thời gian'), h('th', null, 'Loại'), h('th', { class: 'r' }, 'Thay đổi'))),
        h('tbody', null, hist.transactions.map((t: any) => h('tr', null,
          h('td', null, new Date(t.created_at).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })),
          h('td', null, label[t.kind] || t.kind),
          h('td', { class: 'r ' + (t.delta > 0 ? 'pos' : 'neg') }, `${t.delta > 0 ? '+' : ''}${fmt(t.delta)} ${t.currency === 'item' ? t.item_name : cur[t.currency] || t.currency}`)))));
    }
    this.shopCache ||= await api(`/c/${this.charId}/shop`);
    const level = this.state.stats.level;
    const owned = new Map(this.state.inventory.map((i: any) => [i.code, i.quantity]));
    const items = this.shopCache!.filter((i) => i.category === tab);
    return h('div', { class: 'list' },
      h('div', { class: 'wallet' }, h('span', null, icon('sen'), h('b', null, fmt(this.state.wallet.sen)), ' Sen'), h('span', null, icon('ngoc'), h('b', null, fmt(this.state.wallet.ngoc)), ' Ngọc')),
      items.map((it) => {
        const price = it.price_sen != null ? `${fmt(it.price_sen)} Sen` : `${fmt(it.price_ngoc)} Ngọc`;
        const has = owned.get(it.code);
        const locked = level < it.min_level;
        const qty = h('select', { class: 'input', style: { width: '64px', padding: '4px' }, 'aria-label': 'Số lượng' }, [1, 3, 5, 10].map((n) => h('option', { value: n }, n))) as HTMLSelectElement;
        return h('div', { class: 'item' + (locked ? ' locked' : '') },
          h('div', { class: 'title' }, it.name, has && it.stackable ? h('span', { class: 'muted num' }, ` (có ${has})`) : null),
          h('div', { class: 'desc' }, `${it.description}${locked ? ` · cần cấp ${it.min_level}` : ''}`),
          h('div', { class: 'reward' }, price),
          h('div', { class: 'actions' }, !it.stackable && has ? h('span', { class: 'tag' }, 'Đã có') : [
            it.stackable ? qty : null,
            h('button', { class: 'btn small gold', disabled: locked, onclick: async () => {
              try { const r = await api(`/c/${this.charId}/shop/buy`, { code: it.code, qty: it.stackable ? Number(qty.value) : 1 }); toast(r.message, 'good'); sfx.chime(); this.scheduleRefresh(); }
              catch (ex: any) { toast(ex.message, 'bad'); }
            } }, 'Mua')]));
      }));
  }

  // ----- Cộng đồng -----
  private async communityBody(tab: string): Promise<Node> {
    const row = (p: any, actions: Node[]) => h('div', { class: 'item' },
      h('div', { class: 'title' }, p.name, h('span', { class: 'muted' }, ` · cấp ${p.level}`)),
      h('div', { class: 'desc' }, p.online === undefined ? (p.title || '') : p.online ? 'Đang online' : 'Ngoại tuyến'),
      h('div', { class: 'actions' }, actions));
    if (tab === 'near') {
      const list = this.world.remotesInfo();
      return h('div', { class: 'list' }, h('div', { class: 'muted' }, `${list.length} người trong ${this.state.character.temple.name}. ${this.els.online.textContent}.`),
        list.map((p) => row({ ...p, online: true }, [h('button', { class: 'btn small', onclick: () => this.playerCard(p.id) }, 'Xem')])));
    }
    if (tab === 'search') {
      const input = h('input', { class: 'input', id: 'psearch', placeholder: 'Nhập pháp danh (ít nhất 2 chữ)' }) as HTMLInputElement;
      const results = h('div', { class: 'list' });
      const go = async () => {
        clear(results);
        const r = await api(`/c/${this.charId}/players?q=${encodeURIComponent(input.value)}`);
        if (!r.length) results.appendChild(h('div', { class: 'muted' }, 'Không tìm thấy người chơi phù hợp.'));
        for (const p of r) results.appendChild(row(p, [h('button', { class: 'btn small', onclick: () => this.playerCard(p.id, undefined, p) }, 'Xem')]));
      };
      return h('div', { class: 'list' }, h('form', { class: 'chat-form', style: { border: 0, padding: 0 }, onsubmit: (e: Event) => { e.preventDefault(); go().catch((ex) => toast(ex.message, 'bad')); } }, input, h('button', { class: 'btn primary small', type: 'submit' }, 'Tìm')), results);
    }
    if (tab === 'rank') {
      const sel = this.tabState.rankType || 'merit';
      const r = await api(`/c/${this.charId}/leaderboard?type=${sel}`);
      const unit: Record<string, string> = { merit: 'công đức', level: 'cấp', meditation: 'phút thiền' };
      return h('div', { class: 'list' },
        h('div', { class: 'chips' }, [['merit', 'Công đức'], ['level', 'Cấp độ'], ['meditation', 'Thiền định']].map(([k, l]) =>
          h('button', { class: 'chip', 'aria-pressed': String(sel === k), onclick: () => { this.tabState.rankType = k; this.renderDrawer(); } }, l))),
        h('table', { class: 'simple' }, h('tbody', null, r.map((p: any) => h('tr', { style: p.me ? { color: 'var(--gold-soft)', fontWeight: 600 } : null },
          h('td', { class: 'num' }, `#${p.rank}`), h('td', null, p.name, p.title ? h('span', { class: 'muted' }, ` · ${p.title}`) : null),
          h('td', { class: 'r' }, `${fmt(p.value)} ${unit[sel]}`))))));
    }
    const s = await api(`/c/${this.charId}/social`);
    this.pendingRequests = s.incoming.length; this.renderBadges();
    if (tab === 'friends') return h('div', { class: 'list' }, s.friends.length ? null : h('div', { class: 'muted' }, 'Chưa có bạn bè. Bấm vào một người chơi để kết bạn.'),
      s.friends.map((p: any) => row(p, [
        h('button', { class: 'btn small', onclick: () => this.openPm(p.id, p.name) }, 'Nhắn'),
        h('button', { class: 'btn small gold', onclick: () => this.giftModal(p.id, p.name) }, 'Tặng quà'),
        h('button', { class: 'btn small ghost', onclick: async () => { await api(`/c/${this.charId}/friends/${p.id}`, undefined, 'DELETE'); toast('Đã hủy kết bạn.'); this.renderDrawer(); } }, 'Hủy')])));
    if (tab === 'req') return h('div', { class: 'list' },
      h('div', { class: 'section-title' }, 'Lời mời nhận được'),
      s.incoming.length ? null : h('div', { class: 'muted' }, 'Không có lời mời mới.'),
      s.incoming.map((p: any) => row(p, [
        h('button', { class: 'btn small gold', onclick: () => this.respond(p.id, true) }, 'Đồng ý'),
        h('button', { class: 'btn small ghost', onclick: () => this.respond(p.id, false) }, 'Từ chối')])),
      h('div', { class: 'section-title' }, 'Đã gửi'),
      s.outgoing.length ? null : h('div', { class: 'muted' }, 'Chưa gửi lời mời nào.'),
      s.outgoing.map((p: any) => row(p, [h('span', { class: 'tag' }, 'Đang chờ')])));
    return h('div', { class: 'list' }, s.blocked.length ? null : h('div', { class: 'muted' }, 'Bạn chưa chặn ai.'),
      s.blocked.map((p: any) => row(p, [h('button', { class: 'btn small', onclick: async () => { await api(`/c/${this.charId}/block/${p.id}`, undefined, 'DELETE'); toast('Đã bỏ chặn.'); this.renderDrawer(); } }, 'Bỏ chặn')])));
  }
  private async respond(id: number, accept: boolean) {
    try { const r = await api(`/c/${this.charId}/friends/respond`, { id, accept }); toast(r.message, 'good'); this.scheduleRefresh(); this.renderDrawer(); }
    catch (ex: any) { toast(ex.message, 'bad'); }
  }

  playerCard(id: number, messageId?: number, known?: any) {
    const info = this.world.remoteById(id) || known;
    const name = info?.name || 'Người chơi';
    const body = h('div', { class: 'list' },
      h('div', { class: 'muted' }, info ? `Cấp ${info.level}${info.title ? ' · ' + info.title : ''}` : ''),
      h('div', { class: 'chips' },
        h('button', { class: 'btn small gold', onclick: async () => { try { const r = await api(`/c/${this.charId}/friends/request`, { id }); toast(r.message, 'good'); } catch (ex: any) { toast(ex.message, 'bad'); } } }, 'Kết bạn'),
        h('button', { class: 'btn small', onclick: () => { close(); this.openPm(id, name); } }, 'Nhắn riêng'),
        h('button', { class: 'btn small', onclick: () => { close(); this.giftModal(id, name); } }, 'Tặng quà'),
        h('button', { class: 'btn small danger', onclick: async () => { try { const r = await api(`/c/${this.charId}/block/${id}`, {}); toast(r.message); close(); } catch (ex: any) { toast(ex.message, 'bad'); } } }, 'Chặn'),
        h('button', { class: 'btn small danger', onclick: () => { close(); this.reportModal(id, name, messageId); } }, 'Báo cáo')));
    const close = modal(name, body, []);
  }
  private giftModal(id: number, name: string) {
    const sen = h('input', { class: 'input', id: 'gift-sen', type: 'number', min: 0, max: 200, value: 0 }) as HTMLInputElement;
    const offerings = this.state.inventory.filter((i: any) => i.category === 'offering' && i.quantity > 0);
    const item = h('select', { class: 'input', id: 'gift-item' }, h('option', { value: '' }, '— Không tặng vật phẩm —'), offerings.map((i: any) => h('option', { value: i.code }, `${i.name} (có ${i.quantity})`))) as HTMLSelectElement;
    const qty = h('input', { class: 'input', id: 'gift-qty', type: 'number', min: 1, max: 20, value: 1 }) as HTMLInputElement;
    const note = h('input', { class: 'input', id: 'gift-note', maxlength: 80, placeholder: 'Lời nhắn (không bắt buộc)' }) as HTMLInputElement;
    const err = h('div', { class: 'error' });
    modal(`Tặng quà cho ${name}`, h('div', { class: 'form' },
      h('div', { class: 'note' }, 'Chỉ tặng được cho bạn bè, từ cấp 3, tối đa 200 Sen mỗi ngày.'),
      h('div', { class: 'field' }, h('label', { for: 'gift-sen' }, 'Sen'), sen),
      h('div', { class: 'field' }, h('label', { for: 'gift-item' }, 'Lễ vật'), item),
      h('div', { class: 'field' }, h('label', { for: 'gift-qty' }, 'Số lượng lễ vật'), qty),
      h('div', { class: 'field' }, h('label', { for: 'gift-note' }, 'Lời nhắn'), note), err), [
      { label: 'Tặng', cls: 'gold', onClick: async () => {
        try {
          const r = await api(`/c/${this.charId}/gifts`, { toId: id, sen: Number(sen.value) || 0, itemCode: item.value || null, qty: Number(qty.value) || 1, note: note.value });
          toast(r.message, 'good'); this.handleOutcome({ achievements: r.achievements }); this.scheduleRefresh(); return true;
        } catch (ex: any) { err.textContent = ex.message; return false; }
      } }]);
  }
  private reportModal(id: number, name: string, messageId?: number) {
    const reason = h('textarea', { class: 'input', id: 'report-reason', rows: 3, maxlength: 300, placeholder: 'Mô tả vi phạm: ngôn từ xúc phạm, spam, lừa đảo…' }) as HTMLTextAreaElement;
    const err = h('div', { class: 'error' });
    modal(`Báo cáo ${name}`, h('div', { class: 'form' }, messageId ? h('div', { class: 'note' }, 'Tin nhắn liên quan sẽ được đính kèm.') : null, h('div', { class: 'field' }, h('label', { for: 'report-reason' }, 'Lý do'), reason), err), [
      { label: 'Gửi báo cáo', cls: 'primary', onClick: async () => {
        try { const r = await api(`/c/${this.charId}/reports`, { targetId: id, reason: reason.value, messageId }); toast(r.message, 'good'); return true; }
        catch (ex: any) { err.textContent = ex.message; return false; }
      } }]);
  }

  // ----- Hành hương -----
  private async pilgrimageBody(): Promise<Node> {
    const temples = await api(`/c/${this.charId}/temples`);
    const here = this.state.character.temple.id;
    const map = h('div', { class: 'pmap' });
    map.innerHTML = `<svg viewBox="0 0 400 300" aria-hidden="true"><rect width="400" height="300" fill="#2f3d2f"/>
      <path d="M150 20c30 20 10 50 40 70s0 60 30 80 40 40 20 70 30 40 40 60" fill="none" stroke="#3f6e8a" stroke-width="4" opacity=".6"/>
      <path d="M260 0c-20 60 40 90 20 150s40 100 60 150h60V0z" fill="#2c5a74" opacity=".75"/>
      <path d="M20 90l40-50 30 30 30-40 40 60z" fill="#4a5a44"/><path d="M70 110l30-40 25 25 25-30 30 45z" fill="#55684e"/>
      <g fill="#6f8a50" opacity=".5"><circle cx="190" cy="100" r="40"/><circle cx="120" cy="200" r="50"/></g></svg>`;
    const travel = async (t: any) => {
      if (t.id === here) return toast('Bạn đang ở đây.');
      if (!t.unlocked) return toast(`Cần đạt cấp ${t.minLevel} để hành hương đến ${t.name}.`, 'bad');
      try { await api(`/c/${this.charId}/travel`, { code: t.code }); toast(`Lên đường đến ${t.name}…`, 'big'); this.exit('travel'); }
      catch (ex: any) { toast(ex.message, 'bad'); }
    };
    for (const t of temples) map.appendChild(h('button', { class: (t.unlocked ? '' : 'locked ') + (t.id === here ? 'here' : ''), style: { left: `${t.mapX * 100}%`, top: `${t.mapY * 100}%` }, onclick: () => travel(t) }, t.name));
    const total = temples.reduce((n: number, t: any) => n + t.zones.filter((z: any) => z.stamped).length, 0);
    const all = temples.reduce((n: number, t: any) => n + t.zones.length, 0);
    return h('div', { class: 'list' }, map,
      h('div', { class: 'muted' }, 'Bấm tên chùa trên bản đồ hoặc nút bên dưới để hành hương. Đi vào mỗi khu vực để nhận dấu mộc.'),
      temples.map((t: any) => h('div', { class: 'item' + (t.unlocked ? '' : ' locked') },
        h('div', { class: 'title' }, t.name, h('span', { class: 'muted' }, ` · ${t.region}`)),
        h('div', { class: 'desc' }, t.description),
        h('div', { class: 'reward' }, `Dấu mộc ${t.zones.filter((z: any) => z.stamped).length}/${t.zones.length}`, t.unlocked ? '' : `· mở từ cấp ${t.minLevel}`),
        h('div', { class: 'actions' }, t.id === here ? h('span', { class: 'tag' }, 'Đang ở đây') : h('button', { class: 'btn small gold', disabled: !t.unlocked, onclick: () => travel(t) }, 'Hành hương')))),
      h('div', { class: 'section-title' }, `Hộ chiếu hành hương · ${total}/${all} dấu mộc`),
      temples.filter((t: any) => t.unlocked || t.zones.some((z: any) => z.stamped)).map((t: any) => h('div', { class: 'list' },
        h('div', { class: 'muted' }, t.name),
        h('div', { class: 'stamps' }, t.zones.map((z: any) => h('div', { class: 'stamp' + (z.stamped ? ' got' : '') }, z.name))))));
  }

  // ----- Menu -----
  private menuBody(): Node {
    const p = sfx.audioPrefs();
    const toggle = (k: 'sfx' | 'music', label: string) => h('label', { class: 'item', style: { cursor: 'pointer' } },
      h('div', { class: 'title' }, label),
      h('div', { class: 'actions' }, h('input', { type: 'checkbox', checked: p[k], onchange: (e: Event) => setAudioPref(k, (e.target as HTMLInputElement).checked) })));
    const setAudioPref = sfx.setAudioPref;
    return h('div', { class: 'list' },
      toggle('sfx', 'Âm thanh (chuông, mõ, hạt)'), toggle('music', 'Nhạc nền thiền'),
      h('div', { class: 'section-title' }, 'Điều khiển'),
      h('table', { class: 'simple' }, h('tbody', null, [
        ['W A S D / mũi tên', 'Di chuyển (giữ Shift để đi nhanh)'], ['Kéo chuột', 'Xoay camera'], ['Cuộn chuột', 'Phóng to / thu nhỏ'], ['E', 'Tương tác'],
        ['E', 'Vào chỗ trên bồ đoàn / Rời chỗ'], ['1 2 3 4', 'Lạy Phật · Tràng hạt · Thiền · Tụng kinh (lạy, thiền, tụng cần vào chỗ trước)'], ['L', 'Đại lễ cộng tu'], ['Space', 'Lần hạt khi mở tràng hạt'], ['Enter', 'Chat'], ['J C B F M', 'Nhiệm vụ · Hồ sơ · Cửa hàng · Cộng đồng · Hành hương'],
        ['Điện thoại', 'Cần điều khiển trái, vuốt để xoay, chụm 2 ngón để zoom'],
      ].map(([k, v]) => h('tr', null, h('td', null, h('b', null, k)), h('td', null, v))))),
      h('div', { class: 'section-title' }, 'Email khôi phục mật khẩu'),
      this.emailSection(),
      h('button', { class: 'btn', onclick: () => this.exit('servers') }, 'Đổi máy chủ'),
      h('button', { class: 'btn danger', onclick: () => this.exit('logout') }, 'Đăng xuất'));
  }

  private emailSection(): Node {
    const cur = h('div', { class: 'muted' }, 'Đang tải…');
    api('/me').then((r) => { cur.textContent = r.user.email ? `Hiện tại: ${r.user.email}` : 'Tài khoản chưa có email. Hãy thêm để lấy lại mật khẩu khi quên.'; }).catch(() => { cur.textContent = ''; });
    const email = h('input', { class: 'input', id: 'me-email', type: 'email', autocomplete: 'email', placeholder: 'ban@example.com' }) as HTMLInputElement;
    const pw = h('input', { class: 'input', id: 'me-pass', type: 'password', autocomplete: 'current-password', placeholder: 'Mật khẩu hiện tại' }) as HTMLInputElement;
    const err = h('div', { class: 'error' });
    return h('form', { class: 'form', onsubmit: async (e: Event) => {
      e.preventDefault(); err.textContent = '';
      try { const r = await api('/me/email', { email: email.value, password: pw.value }); cur.textContent = `Hiện tại: ${r.email}`; pw.value = ''; toast('Đã lưu email khôi phục.', 'good'); }
      catch (ex: any) { err.textContent = ex.message; }
    } }, cur,
      h('div', { class: 'field' }, h('label', { for: 'me-email' }, 'Email mới'), email),
      h('div', { class: 'field' }, h('label', { for: 'me-pass' }, 'Xác nhận bằng mật khẩu'), pw), err,
      h('button', { class: 'btn small primary', type: 'submit' }, 'Lưu email'));
  }

  // ---------- Thoát ----------
  exit(reason: 'logout' | 'servers' | 'travel') {
    if (this.session) clearInterval(this.session.timer);
    clearInterval(this.cerTimer);
    this.flushBeads();
    window.removeEventListener('keydown', this.onKey);
    this.drawer?.remove();
    document.querySelectorAll('.modal-wrap').forEach((m) => m.remove());
    this.net?.close();
    this.world?.dispose();
    (this as any).world = null;
    setToastHost(null);
    this.onExit(reason);
  }
}
