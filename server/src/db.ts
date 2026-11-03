import pg from 'pg';
import { config } from './config.ts';

// BIGINT -> number (an toàn tới 2^53, đủ cho số dư trong game)
pg.types.setTypeParser(20, (v) => Number(v));
// DATE -> chuỗi 'YYYY-MM-DD' (không chuyển múi giờ)
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20 });

export type Db = pg.PoolClient | pg.Pool;

export async function q<T = any>(sql: string, params: unknown[] = [], db: Db = pool): Promise<T[]> {
  const r = await db.query(sql, params as any[]);
  return r.rows as T[];
}
export async function one<T = any>(sql: string, params: unknown[] = [], db: Db = pool): Promise<T | null> {
  const r = await db.query(sql, params as any[]);
  return (r.rows[0] as T) ?? null;
}

/** Chạy trong transaction; tự rollback khi lỗi. */
export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
