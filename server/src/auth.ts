import type { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { config } from './config.ts';
import { one, q } from './db.ts';
import { bad, HttpError, forbidden } from './errors.ts';

export type Role = 'player' | 'support' | 'moderator' | 'game_admin' | 'super_admin';
export const ROLE_RANK: Record<Role, number> = { player: 0, support: 1, moderator: 2, game_admin: 3, super_admin: 4 };

export interface AuthUser { id: number; username: string; role: Role }
declare global {
  namespace Express { interface Request { user?: AuthUser } }
}

const USERNAME_RE = /^[a-z0-9_.]{3,24}$/;

export function signToken(u: { id: number; role: string; token_version: number }): string {
  return jwt.sign({ sub: u.id, v: u.token_version }, config.jwtSecret, { expiresIn: '30d' });
}

export async function verifyToken(token: string): Promise<AuthUser> {
  let payload: any;
  try { payload = jwt.verify(token, config.jwtSecret); } catch { throw new HttpError(401, 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.', 'unauthorized'); }
  const u = await one<any>('SELECT id, username, role, is_banned, ban_reason, token_version FROM users WHERE id=$1', [payload.sub]);
  if (!u || u.token_version !== payload.v) throw new HttpError(401, 'Phiên đăng nhập không còn hiệu lực.', 'unauthorized');
  if (u.is_banned) throw new HttpError(403, `Tài khoản đã bị khóa${u.ban_reason ? ': ' + u.ban_reason : ''}.`, 'banned');
  return { id: u.id, username: u.username, role: u.role };
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) throw new HttpError(401, 'Bạn cần đăng nhập.', 'unauthorized');
  req.user = await verifyToken(token);
  next();
}

export function requireRole(min: Role) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user || ROLE_RANK[req.user.role] < ROLE_RANK[min]) throw forbidden();
    next();
  };
}

function newRecoveryCode(): string {
  // 4 nhóm x 4 ký tự, bỏ ký tự dễ nhầm
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(16);
  let s = '';
  for (let i = 0; i < 16; i++) s += alphabet[bytes[i] % alphabet.length] + (i % 4 === 3 && i < 15 ? '-' : '');
  return s;
}

function checkPassword(pw: unknown): string {
  if (typeof pw !== 'string' || pw.length < 8 || pw.length > 72) throw bad('Mật khẩu cần từ 8 đến 72 ký tự.');
  return pw;
}
function checkUsername(u: unknown): string {
  const s = String(u || '').trim().toLowerCase();
  if (!USERNAME_RE.test(s)) throw bad('Tên đăng nhập gồm 3–24 ký tự: chữ thường không dấu, số, dấu chấm hoặc gạch dưới.');
  return s;
}

// Giới hạn thử đăng nhập theo IP+tài khoản (bộ nhớ)
const attempts = new Map<string, { n: number; until: number }>();
function throttle(key: string) {
  const a = attempts.get(key);
  if (a && a.until > Date.now() && a.n >= 8) throw new HttpError(429, 'Bạn thử quá nhiều lần. Vui lòng đợi 10 phút.', 'rate_limited');
}
function fail(key: string) {
  const a = attempts.get(key);
  if (!a || a.until < Date.now()) attempts.set(key, { n: 1, until: Date.now() + 600_000 });
  else a.n++;
}

export async function register(body: any) {
  const username = checkUsername(body.username);
  const password = checkPassword(body.password);
  const exists = await one('SELECT 1 FROM users WHERE username=$1', [username]);
  if (exists) throw bad('Tên đăng nhập đã có người dùng.', 'username_taken');
  const recovery = newRecoveryCode();
  const [ph, rh] = await Promise.all([bcrypt.hash(password, 10), bcrypt.hash(recovery, 10)]);
  const u = await one<any>(
    `INSERT INTO users (username, password_hash, recovery_hash, last_login_at) VALUES ($1,$2,$3, now())
     RETURNING id, username, role, token_version`, [username, ph, rh]);
  return { token: signToken(u), user: { id: u.id, username: u.username, role: u.role }, recoveryCode: recovery };
}

export async function login(body: any, ip: string) {
  const username = String(body.username || '').trim().toLowerCase();
  const key = ip + '|' + username;
  throttle(key);
  const u = await one<any>('SELECT * FROM users WHERE username=$1', [username]);
  if (!u || !(await bcrypt.compare(String(body.password || ''), u.password_hash))) {
    fail(key);
    throw new HttpError(401, 'Sai tên đăng nhập hoặc mật khẩu.', 'bad_credentials');
  }
  if (u.is_banned) throw new HttpError(403, `Tài khoản đã bị khóa${u.ban_reason ? ': ' + u.ban_reason : ''}.`, 'banned');
  attempts.delete(key);
  await q('UPDATE users SET last_login_at=now() WHERE id=$1', [u.id]);
  return { token: signToken(u), user: { id: u.id, username: u.username, role: u.role } };
}

export async function recover(body: any, ip: string) {
  const username = String(body.username || '').trim().toLowerCase();
  const key = 'rec|' + ip + '|' + username;
  throttle(key);
  const code = String(body.recoveryCode || '').trim().toUpperCase();
  const password = checkPassword(body.newPassword);
  const u = await one<any>('SELECT * FROM users WHERE username=$1', [username]);
  if (!u || !(await bcrypt.compare(code, u.recovery_hash))) {
    fail(key);
    throw new HttpError(401, 'Tên đăng nhập hoặc mã khôi phục không đúng.', 'bad_recovery');
  }
  const recovery = newRecoveryCode();
  const [ph, rh] = await Promise.all([bcrypt.hash(password, 10), bcrypt.hash(recovery, 10)]);
  // Đổi mật khẩu, cấp mã khôi phục mới, vô hiệu hóa các phiên cũ
  const nu = await one<any>(`UPDATE users SET password_hash=$2, recovery_hash=$3, token_version=token_version+1 WHERE id=$1
                            RETURNING id, username, role, token_version`, [u.id, ph, rh]);
  attempts.delete(key);
  return { token: signToken(nu), user: { id: nu.id, username: nu.username, role: nu.role }, recoveryCode: recovery };
}
