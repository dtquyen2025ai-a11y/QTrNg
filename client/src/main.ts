import './style.css';
import { loadSession, saveSession, setToken, handleUnauthorized, ApiError, type Session } from './api.ts';
import { authScreen, serverScreen, creatorScreen } from './ui/screens.ts';
import { GameUI } from './ui/hud.ts';
import { h, clear, toast } from './ui/dom.ts';

let session: Session | null = loadSession();
let current: GameUI | null = null;

function logout() {
  saveSession(null); setToken(null); session = null;
  current = null;
  flow();
}
handleUnauthorized(() => {
  if (current) { current.exit('logout'); return; }
  logout();
});

async function flow(): Promise<void> {
  try {
    if (!session) session = await authScreen(null);
    else if (!current) session = await authScreen(session);
    const pick = await serverScreen(session, logout);
    const charId = pick.charId ?? await creatorScreen(pick.serverId);
    await play(charId);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) { logout(); return; }
    const app = document.getElementById('app')!;
    clear(app);
    app.appendChild(h('div', { class: 'screen' }, h('div', { class: 'card' },
      h('h2', null, 'Không thể tải trò chơi'), h('p', null, (e as Error).message),
      h('button', { class: 'btn primary', onclick: () => flow() }, 'Thử lại'))));
  }
}

async function play(charId: number) {
  const game = new GameUI(session!.token, charId, async (reason) => {
    current = null;
    if (reason === 'logout') return logout();
    if (reason === 'travel') return play(charId);
    const pick = await serverScreen(session!, logout);
    const id = pick.charId ?? await creatorScreen(pick.serverId);
    await play(id);
  });
  current = game;
  try { await game.start(); }
  catch (e: any) {
    current = null;
    toast(e.message, 'bad');
    if (e instanceof ApiError && e.status === 401) return logout();
    throw e;
  }
}

// Kiểm tra WebGL trước khi chơi
const gl = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl');
if (!gl) {
  document.getElementById('app')!.appendChild(h('div', { class: 'screen' }, h('div', { class: 'card' },
    h('h2', null, 'Trình duyệt chưa hỗ trợ 3D'), h('p', null, 'Tâm An Online cần WebGL. Hãy dùng Chrome, Edge, Safari hoặc Firefox bản mới và bật tăng tốc phần cứng.'))));
} else flow();
