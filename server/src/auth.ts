import type { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { config } from './config.ts';
import { one, q } from './db.ts';
import { bad, HttpError, forbidden } from './errors.ts';
import { sendMail, mailConfigured } from './mailer.ts';

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

function checkPassword(pw: unknown): string {
  if (typeof pw !== 'string' || pw.length < 8 || pw.length > 72) throw bad('Mật khẩu cần từ 8 đến 72 ký tự.');
  return pw;
}
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;
function checkEmail(e: unknown): string {
  const s = String(e || '').trim().toLowerCase();
  if (!EMAIL_RE.test(s)) throw bad('Email không hợp lệ.', 'bad_email');
  return s;
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
  const email = checkEmail(body.email);
  const password = checkPassword(body.password);
  if (await one('SELECT 1 FROM users WHERE username=$1', [username])) throw bad('Tên đăng nhập đã có người dùng.', 'username_taken');
  if (await one('SELECT 1 FROM users WHERE lower(email)=$1', [email])) throw bad('Email này đã được dùng cho tài khoản khác.', 'email_taken');
  const ph = await bcrypt.hash(password, 10);
  const u = await one<any>(
    `INSERT INTO users (username, email, password_hash, last_login_at) VALUES ($1,$2,$3, now())
     RETURNING id, username, role, token_version`, [username, email, ph]).catch((e) => {
    if (e.code === '23505') throw bad('Tên đăng nhập hoặc email đã có người dùng.', 'taken');
    throw e;
  });
  return { token: signToken(u), user: { id: u.id, username: u.username, role: u.role } };
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

const RESET_TTL_MIN = 15;
const RESET_MAX_ATTEMPTS = 5;
const GENERIC_SENT = 'Nếu email này đã đăng ký, mã đặt lại mật khẩu sẽ được gửi tới trong ít phút. Hãy kiểm tra cả thư mục Spam.';

/** Bước 1: gửi mã 6 số vào email. Luôn trả cùng một thông báo để không lộ email nào đã đăng ký. */
export async function forgotPassword(body: any, ip: string) {
  const email = checkEmail(body.email);
  throttle('forgot|' + ip);
  throttle('forgot|' + email);
  fail('forgot|' + ip); fail('forgot|' + email);   // mỗi yêu cầu đều tính vào giới hạn
  if (!mailConfigured()) throw new HttpError(503, 'Máy chủ chưa cấu hình gửi email. Vui lòng liên hệ quản trị viên.', 'mail_unavailable');
  const u = await one<any>('SELECT id, username, is_banned FROM users WHERE lower(email)=$1', [email]);
  if (!u || u.is_banned) return { ok: true, message: GENERIC_SENT };
  const recent = await one<any>(`SELECT 1 FROM password_resets WHERE user_id=$1 AND created_at > now() - interval '60 seconds'`, [u.id]);
  if (recent) return { ok: true, message: GENERIC_SENT };
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  await q(`UPDATE password_resets SET used_at=now() WHERE user_id=$1 AND used_at IS NULL`, [u.id]);
  await q(`INSERT INTO password_resets (user_id, code_hash, expires_at) VALUES ($1,$2, now() + ($3::int * interval '1 minute'))`,
    [u.id, await bcrypt.hash(code, 10), RESET_TTL_MIN]);
  await sendMail({
    to: email,
    subject: `Mã đặt lại mật khẩu Tâm An Online: ${code}`,
    text: `Xin chào ${u.username},\n\nMã đặt lại mật khẩu của bạn là: ${code}\nMã có hiệu lực trong ${RESET_TTL_MIN} phút và chỉ dùng được một lần.\n\nNếu bạn không yêu cầu, hãy bỏ qua thư này; mật khẩu của bạn không thay đổi.\n\nTâm An Online`,
    html: `<p>Xin chào <b>${u.username}</b>,</p><p>Mã đặt lại mật khẩu của bạn là:</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>Mã có hiệu lực trong ${RESET_TTL_MIN} phút và chỉ dùng được một lần.</p><p>Nếu bạn không yêu cầu, hãy bỏ qua thư này; mật khẩu của bạn không thay đổi.</p><p>Tâm An Online</p>`,
  });
  return { ok: true, message: GENERIC_SENT };
}

/** Bước 2: nhập mã + mật khẩu mới. Thành công thì đăng nhập luôn và thu hồi mọi phiên cũ. */
export async function resetPassword(body: any, ip: string) {
  const email = checkEmail(body.email);
  const code = String(body.code || '').trim();
  const password = checkPassword(body.newPassword);
  throttle('reset|' + ip);
  const invalid = () => { fail('reset|' + ip); return new HttpError(400, 'Mã không đúng hoặc đã hết hạn. Hãy yêu cầu mã mới.', 'bad_code'); };
  if (!/^\d{6}$/.test(code)) throw invalid();
  const u = await one<any>('SELECT id FROM users WHERE lower(email)=$1 AND NOT is_banned', [email]);
  if (!u) throw invalid();
  const r = await one<any>(`SELECT * FROM password_resets WHERE user_id=$1 AND used_at IS NULL AND expires_at > now() ORDER BY id DESC LIMIT 1`, [u.id]);
  if (!r || r.attempts >= RESET_MAX_ATTEMPTS) throw invalid();
  if (!(await bcrypt.compare(code, r.code_hash))) {
    await q('UPDATE password_resets SET attempts = attempts + 1 WHERE id=$1', [r.id]);
    throw invalid();
  }
  await q('UPDATE password_resets SET used_at=now() WHERE id=$1', [r.id]);
  const nu = await one<any>(`UPDATE users SET password_hash=$2, token_version=token_version+1 WHERE id=$1 RETURNING id, username, role, token_version`,
    [u.id, await bcrypt.hash(password, 10)]);
  return { token: signToken(nu), user: { id: nu.id, username: nu.username, role: nu.role } };
}

/** Đặt / đổi email khôi phục (cần mật khẩu hiện tại) */
export async function setEmail(userId: number, body: any) {
  const email = checkEmail(body.email);
  const u = await one<any>('SELECT password_hash FROM users WHERE id=$1', [userId]);
  if (!u || !(await bcrypt.compare(String(body.password || ''), u.password_hash))) throw new HttpError(401, 'Mật khẩu không đúng.', 'bad_credentials');
  const taken = await one('SELECT 1 FROM users WHERE lower(email)=$1 AND id<>$2', [email, userId]);
  if (taken) throw bad('Email này đã được dùng cho tài khoản khác.', 'email_taken');
  await q('UPDATE users SET email=$2 WHERE id=$1', [userId, email]);
  return { ok: true, email };
}
