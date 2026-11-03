// Trạng thái online trong bộ nhớ (một tiến trình). Khi mở rộng nhiều máy chủ game: chuyển sang Redis.
import type { WebSocket } from 'ws';
import { COOP_WINDOW_MS } from '../../shared/content.ts';

export interface Look {
  gender: string; hair: string; skin: string;
  robe: string | null; accessory: string | null; bead: string | null;
}
export interface Player {
  charId: number;
  userId: number;
  serverId: number;
  templeId: number;
  name: string;
  level: number;
  title: string | null;
  look: Look;
  x: number; z: number; ry: number;
  anim: string;
  lastMoveAt: number;
  dirty: boolean;
  ws: WebSocket;
  chatTimes: number[];
  lastChat: string;
  stamped: Set<string>;
  seat: { kind: 'sit' | 'kneel'; mat: string } | null;
  blocked: Set<number>;
}

export const players = new Map<number, Player>();
export const roomKey = (serverId: number, templeId: number) => `${serverId}:${templeId}`;

export function roomPlayers(serverId: number, templeId: number): Player[] {
  const out: Player[] = [];
  for (const p of players.values()) if (p.serverId === serverId && p.templeId === templeId) out.push(p);
  return out;
}

export function serverOnline(serverId: number): number {
  let n = 0;
  for (const p of players.values()) if (p.serverId === serverId) n++;
  return n;
}

// Cộng tu: ghi nhận thời điểm hoạt động gần nhất theo phòng
const coop = new Map<string, Map<number, number>>();
export function noteCoop(serverId: number, templeId: number, charId: number, now = Date.now()): number {
  const k = roomKey(serverId, templeId);
  let m = coop.get(k);
  if (!m) coop.set(k, (m = new Map()));
  m.set(charId, now);
  let n = 0;
  for (const [id, t] of m) {
    if (now - t > COOP_WINDOW_MS) { m.delete(id); continue; }
    // Chỉ tính người đang có mặt trong cùng chùa (bản thân luôn được tính)
    const p = players.get(id);
    if (id === charId || (p && p.serverId === serverId && p.templeId === templeId)) n++;
  }
  return n;
}

export function send(p: Player | undefined, msg: unknown) {
  if (p && p.ws.readyState === 1) p.ws.send(JSON.stringify(msg));
}
export function sendToChar(charId: number, msg: unknown) {
  send(players.get(charId), msg);
}
export function broadcastRoom(serverId: number, templeId: number, msg: unknown, exceptId?: number) {
  const s = JSON.stringify(msg);
  for (const p of players.values()) {
    if (p.serverId === serverId && p.templeId === templeId && p.charId !== exceptId && p.ws.readyState === 1) p.ws.send(s);
  }
}
