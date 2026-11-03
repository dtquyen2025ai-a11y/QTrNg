import http from 'node:http';
import { createApp } from './app.ts';
import { attachRealtime } from './realtime.ts';
import { migrate } from './migrate.ts';
import { config } from './config.ts';
import { startCeremonyScheduler, configureCeremony } from './ceremony.ts';

await migrate();
const server = http.createServer(createApp());
attachRealtime(server);
// Chỉ dùng khi kiểm thử/staging: rút ngắn thời lượng đại lễ
if (process.env.CEREMONY_DURATION_SEC) configureCeremony({ durationMs: Number(process.env.CEREMONY_DURATION_SEC) * 1000, sampleMs: 2000 });
startCeremonyScheduler();
server.listen(config.port, () => console.log(`[tam-an] máy chủ chạy tại http://localhost:${config.port}`));
