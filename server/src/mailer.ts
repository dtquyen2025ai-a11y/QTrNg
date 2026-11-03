// Gửi email qua SMTP (Gmail, Brevo, Resend, SendGrid... đều có SMTP).
// Chưa cấu hình SMTP: môi trường dev in thư ra console; production báo lỗi rõ ràng thay vì im lặng.
import nodemailer from 'nodemailer';
import { config } from './config.ts';

export interface Mail { to: string; subject: string; text: string; html: string }
type Sender = (m: Mail) => Promise<void>;

let sender: Sender | null = null;

function smtpSender(): Sender | null {
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  const transport = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' } : undefined,
  });
  const from = process.env.MAIL_FROM || process.env.SMTP_USER || 'no-reply@localhost';
  return async (m) => { await transport.sendMail({ from, ...m }); };
}

export function mailConfigured(): boolean {
  return !!sender || !!process.env.SMTP_HOST || !config.isProd;
}

/** Dùng trong kiểm thử để bắt thư thay vì gửi thật */
export function setMailer(fn: Sender | null) { sender = fn; }

export async function sendMail(m: Mail) {
  const s = sender || smtpSender();
  if (s) return s(m);
  if (config.isProd) throw new Error('Chưa cấu hình máy chủ gửi email (SMTP_HOST).');
  console.log(`[mail:dev] Tới ${m.to} | ${m.subject}\n${m.text}`);
}
