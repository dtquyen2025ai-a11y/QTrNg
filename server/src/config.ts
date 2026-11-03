import crypto from 'node:crypto';

const isProd = process.env.NODE_ENV === 'production';

function required(name: string, devDefault: string): string {
  const v = process.env[name];
  if (v) return v;
  if (isProd) throw new Error(`Thiếu biến môi trường ${name}`);
  return devDefault;
}

export const config = {
  isProd,
  port: Number(process.env.PORT || 8080),
  databaseUrl: required('DATABASE_URL', 'postgres://postgres@localhost:5432/chua'),
  // Dev: secret ngẫu nhiên mỗi lần chạy (phiên cũ hết hạn khi restart). Prod: bắt buộc cấu hình.
  jwtSecret: required('JWT_SECRET', crypto.randomBytes(32).toString('hex')),
  adminUsername: process.env.ADMIN_USERNAME || '',
  adminPassword: process.env.ADMIN_PASSWORD || '',
  corsOrigin: process.env.CORS_ORIGIN || '',
};
