// Kết nối realtime. Tự kết nối lại khi rớt mạng.
type Handler = (m: any) => void;

export class Net {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Handler[]>();
  private closedByUser = false;
  private retry = 0;
  private lastMoveSent = 0;
  private pending: any = null;
  status: 'connecting' | 'online' | 'offline' = 'connecting';
  onStatus: ((s: Net['status']) => void) | null = null;
  constructor(private token: string, private charId: number) {}

  on(t: string, fn: Handler) {
    if (!this.handlers.has(t)) this.handlers.set(t, []);
    this.handlers.get(t)!.push(fn);
  }
  emit(m: any) { for (const fn of this.handlers.get(m.t) || []) fn(m); }
  private setStatus(s: Net['status']) { this.status = s; this.onStatus?.(s); }

  private demo: typeof import('./demo/server.ts') | null = null;
  connect() {
    this.closedByUser = false;
    if (import.meta.env.VITE_DEMO) {
      import('./demo/server.ts').then((d) => {
        this.demo = d;
        d.setDemoUser(this.token);
        d.setFxHook((kind) => this.emit({ t: 'fx', id: this.charId, kind }));
        this.setStatus('online');
        this.emit(d.welcome());
        d.startCeremonyLoop((m) => this.emit(m));
      });
      return;
    }
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(this.token)}&char=${this.charId}`);
    this.ws = ws;
    this.setStatus('connecting');
    ws.onopen = () => { this.retry = 0; this.setStatus('online'); };
    ws.onmessage = (e) => { try { this.emit(JSON.parse(e.data)); } catch { /* bỏ qua */ } };
    ws.onclose = (e) => {
      this.setStatus('offline');
      if (this.closedByUser || e.code === 4000) { this.emit({ t: 'closed', code: e.code }); return; }
      const wait = Math.min(15000, 1000 * 2 ** this.retry++);
      setTimeout(() => { if (!this.closedByUser) this.connect(); }, wait);
    };
  }
  close() { this.closedByUser = true; this.ws?.close(); this.demo?.setFxHook(null); }
  send(m: any) {
    // Vào/rời chỗ: bỏ gói vị trí cũ còn chờ gửi, nếu không server sẽ tưởng người chơi vừa rời bồ đoàn
    if (m.t === 'pose') this.pending = null;
    if (this.demo) {
      if (m.t === 'move') { for (const x of this.demo.onMove(m.x, m.z)) this.emit(x); }
      else if (m.t === 'pose') this.emit(this.demo.pose(m.kind ?? null, m.mat));
      else if (m.t === 'chat') {
        if (m.to) this.emit({ t: 'toast', text: 'Bản dùng thử offline chỉ có một người chơi.' });
        else this.emit(this.demo.chatEcho(String(m.body || '')));
      }
      return;
    }
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(m));
  }

  /** Gửi vị trí tối đa 10 lần/giây */
  move(x: number, z: number, ry: number, a: string) {
    this.pending = { t: 'move', x: +x.toFixed(2), z: +z.toFixed(2), ry: +ry.toFixed(2), a };
    const now = performance.now();
    if (now - this.lastMoveSent >= 100) { this.send(this.pending); this.pending = null; this.lastMoveSent = now; }
  }
  flush() {
    if (this.pending && performance.now() - this.lastMoveSent >= 100) { this.send(this.pending); this.pending = null; this.lastMoveSent = performance.now(); }
  }
}
