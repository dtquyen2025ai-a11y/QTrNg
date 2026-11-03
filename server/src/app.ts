import express, { type Request, type Response, type NextFunction } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { register, login, recover, requireAuth } from './auth.ts';
import { HttpError, bad } from './errors.ts';
import * as G from './game.ts';
import * as E from './economy.ts';
import { adminRouter } from './admin.ts';
import { broadcastRoom, players } from './presence.ts';
import { filterText, SUTRAS } from '../../shared/content.ts';
import { pool } from './db.ts';
import { ceremonyState } from './ceremony.ts';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '32kb' }));
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });

  const api = express.Router();
  api.get('/health', async (_req, res) => { await pool.query('SELECT 1'); res.json({ ok: true, online: players.size }); });

  api.post('/auth/register', async (req, res) => res.json(await register(req.body)));
  api.post('/auth/login', async (req, res) => res.json(await login(req.body, req.ip || '')));
  api.post('/auth/recover', async (req, res) => res.json(await recover(req.body, req.ip || '')));

  api.get('/servers', async (_req, res) => res.json(await G.listServers()));
  api.get('/sutras', (_req, res) => res.json(SUTRAS));
  api.get('/ceremony', (_req, res) => res.json(ceremonyState()));

  api.get('/me', requireAuth, async (req, res) => res.json({ user: req.user, characters: await G.myCharacters(req.user!.id) }));
  api.post('/characters', requireAuth, async (req, res) => {
    const c = await G.createCharacter(req.user!.id, req.body);
    res.json({ id: c.id });
  });

  // ----- Theo nhân vật -----
  const c = express.Router({ mergeParams: true });
  c.use(requireAuth, async (req: Request, _res: Response, next: NextFunction) => {
    const cid = Number(req.params.cid);
    if (!Number.isInteger(cid)) throw bad('Nhân vật không hợp lệ.');
    await G.requireOwnChar(null, req.user!.id, cid);
    (req as any).cid = cid;
    next();
  });
  const cid = (req: Request) => (req as any).cid as number;
  const fx = (charId: number, kind: string, extra: Record<string, unknown> = {}) => {
    const p = players.get(charId);
    if (p) broadcastRoom(p.serverId, p.templeId, { t: 'fx', id: charId, kind, ...extra });
  };

  c.post('/enter', async (req, res) => res.json(await G.enterGame(cid(req))));
  c.get('/state', async (req, res) => res.json(await G.fullState(cid(req))));
  c.get('/missions', async (req, res) => res.json(await G.missionList(cid(req))));
  c.post('/missions/:id/claim', async (req, res) => res.json(await E.claimMission(cid(req), Number(req.params.id))));

  c.post('/act/:code', async (req, res) => {
    const out = await E.doSimple(cid(req), String(req.params.code));
    fx(cid(req), String(req.params.code));
    res.json(out);
  });
  c.post('/beads', async (req, res) => res.json(await E.doBeads(cid(req), Number(req.body.count))));
  c.post('/meditate/start', async (req, res) => res.json(await E.startMeditation(cid(req), Number(req.body.minutes))));
  c.post('/meditate/finish', async (req, res) => res.json(await E.finishMeditation(cid(req))));
  c.post('/chant/start', async (req, res) => res.json(await E.startChant(cid(req), String(req.body.code))));
  c.post('/chant/finish', async (req, res) => res.json(await E.finishChant(cid(req))));
  c.post('/lantern', async (req, res) => {
    const raw = String(req.body.wish || '').replace(/\s+/g, ' ').trim();
    if (raw.length < 2 || raw.length > 80) throw bad('Lời nguyện từ 2 đến 80 ký tự.');
    const { text } = filterText(raw);
    const out = await E.releaseLantern(cid(req), text);
    const p = players.get(cid(req));
    broadcastRoom(out.serverId, out.templeId, { t: 'lantern', lantern: { ...out.lantern, name: p?.name || '' }, by: cid(req) });
    res.json(out);
  });

  c.get('/shop', async (_req, res) => res.json(await G.shopItems()));
  c.post('/shop/buy', async (req, res) => res.json(await G.buy(cid(req), String(req.body.code), Number(req.body.qty || 1))));
  c.post('/equip', async (req, res) => res.json(await G.equip(cid(req), String(req.body.slot), req.body.code ? String(req.body.code) : null)));
  c.post('/title', async (req, res) => res.json(await G.setTitle(cid(req), req.body.title ? String(req.body.title) : null)));
  c.get('/history', async (req, res) => res.json(await G.history(cid(req))));

  c.get('/temples', async (req, res) => res.json(await G.temples(cid(req))));
  c.post('/travel', async (req, res) => {
    const out = await G.travel(cid(req), String(req.body.code));
    players.get(cid(req))?.ws.close(4000, 'travel');
    res.json(out);
  });

  c.get('/social', async (req, res) => res.json(await G.social(cid(req))));
  c.get('/players', async (req, res) => res.json(await G.searchPlayers(cid(req), String(req.query.q || ''))));
  c.post('/friends/request', async (req, res) => res.json(await G.friendRequest(cid(req), Number(req.body.id))));
  c.post('/friends/respond', async (req, res) => res.json(await G.friendRespond(cid(req), Number(req.body.id), !!req.body.accept)));
  c.delete('/friends/:id', async (req, res) => res.json(await G.unfriend(cid(req), Number(req.params.id))));
  c.post('/block/:id', async (req, res) => res.json(await G.block(cid(req), Number(req.params.id))));
  c.delete('/block/:id', async (req, res) => res.json(await G.unblock(cid(req), Number(req.params.id))));
  c.post('/gifts', async (req, res) => res.json(await G.sendGift(cid(req), req.body)));
  c.post('/reports', async (req, res) => res.json(await G.report(cid(req), req.body)));
  c.get('/leaderboard', async (req, res) => res.json(await G.leaderboard(cid(req), String(req.query.type || 'merit'))));
  c.get('/chat', async (req, res) => res.json(await G.recentChat(cid(req))));

  api.use('/c/:cid', c);
  api.use('/admin', adminRouter());
  api.use((_req, _res, next) => next(new HttpError(404, 'API không tồn tại.', 'not_found')));
  app.use('/api', api);

  // Production: phục vụ bản build của client
  const dist = path.join(import.meta.dirname, '..', '..', 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { maxAge: '1h', index: false }));
    app.get('/admin', (_req, res) => res.sendFile(path.join(dist, 'admin.html')));
    app.get(/^\/(?!api|ws).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Dữ liệu gửi lên không hợp lệ.', code: 'bad_json' });
    console.error(err);
    res.status(500).json({ error: 'Máy chủ gặp sự cố. Vui lòng thử lại.', code: 'server_error' });
  });
  return app;
}
