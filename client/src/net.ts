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
  private emit(m: any) { for (const fn of this.handlers.get(m.t) || []) fn(m); }
  private setStatus(s: Net['status']) { this.status = s; this.onStatus?.(s); }

  connect() {
    this.closedByUser = false;
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
  close() { this.closedByUser = true; this.ws?.close(); }
  send(m: unknown) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(m)); }

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
