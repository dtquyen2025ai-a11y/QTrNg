import http from 'node:http';
import { createApp } from './app.ts';
import { attachRealtime } from './realtime.ts';
import { migrate } from './migrate.ts';
import { config } from './config.ts';

await migrate();
const server = http.createServer(createApp());
attachRealtime(server);
server.listen(config.port, () => console.log(`[tam-an] máy chủ chạy tại http://localhost:${config.port}`));
