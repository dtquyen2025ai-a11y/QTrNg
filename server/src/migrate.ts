import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { pool, one } from './db.ts';
import { config } from './config.ts';

const dir = path.join(import.meta.dirname, '..', 'migrations');

export async function migrate(log = true): Promise<void> {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    const done = await one('SELECT 1 FROM schema_migrations WHERE name=$1', [f]);
    if (done) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(sql);
      await c.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
      await c.query('COMMIT');
      if (log) console.log(`[migrate] đã áp dụng ${f}`);
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }
  await seedAdmin(log);
}

async function seedAdmin(log: boolean) {
  if (!config.adminUsername || !config.adminPassword) return;
  const exists = await one('SELECT id FROM users WHERE username=$1', [config.adminUsername.toLowerCase()]);
  if (exists) return;
  const hash = await bcrypt.hash(config.adminPassword, 10);
  await pool.query(`INSERT INTO users (username, email, password_hash, role) VALUES ($1,$2,$3,'super_admin')`,
    [config.adminUsername.toLowerCase(), process.env.ADMIN_EMAIL || null, hash]);
  if (log) console.log(`[migrate] đã tạo super admin "${config.adminUsername}"`);
}

if (import.meta.main) {
  migrate().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
}
