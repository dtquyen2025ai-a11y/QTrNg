// Gọi API. Token đăng nhập lưu trên thiết bị để "Tiếp tục chơi"; mọi tài nguyên nằm trên server.
const TOKEN_KEY = 'tam-an.token';
const USER_KEY = 'tam-an.user';

export interface Session { token: string; user: { id: number; username: string; role: string } }

export function loadSession(): Session | null {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const user = JSON.parse(localStorage.getItem(USER_KEY) || 'null');
    return token && user ? { token, user } : null;
  } catch { return null; }
}
export function saveSession(s: Session | null) {
  try {
    if (s) { localStorage.setItem(TOKEN_KEY, s.token); localStorage.setItem(USER_KEY, JSON.stringify(s.user)); }
    else { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); }
  } catch { /* trình duyệt chặn lưu trữ: vẫn chơi được, chỉ không nhớ phiên */ }
}

export class ApiError extends Error {
  status: number; code: string;
  constructor(status: number, message: string, code: string) { super(message); this.status = status; this.code = code; }
}

let token: string | null = loadSession()?.token ?? null;
export function setToken(t: string | null) { token = t; }
export function getToken() { return token; }

let onUnauthorized: (() => void) | null = null;
export function handleUnauthorized(fn: () => void) { onUnauthorized = fn; }

export async function api<T = any>(path: string, body?: unknown, method?: string): Promise<T> {
  let r: Response;
  try {
    r = await fetch('/api' + path, {
      method: method || (body !== undefined ? 'POST' : 'GET'),
      headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.', 'network');
  }
  let data: any = null;
  try { data = await r.json(); } catch { /* không phải JSON */ }
  if (!r.ok) {
    if (r.status === 401 && onUnauthorized && !path.startsWith('/auth/')) onUnauthorized();
    throw new ApiError(r.status, data?.error || `Lỗi máy chủ (${r.status}).`, data?.code || 'error');
  }
  return data as T;
}
