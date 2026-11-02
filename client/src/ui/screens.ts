// Màn hình: đăng nhập / đăng ký / khôi phục, mã khôi phục, chọn máy chủ, tạo nhân vật.
import * as THREE from 'three';
import { h, clear, toast } from './dom.ts';
import { api, saveSession, setToken, type Session } from '../api.ts';
import { Avatar, HAIRS, SKINS } from '../world/character.ts';

function screen(...children: Node[]) {
  const app = document.getElementById('app')!;
  clear(app);
  const s = h('div', { class: 'screen' }, ...children);
  app.appendChild(s);
  return s;
}
const brand = (sub: string) => h('div', { class: 'brand' }, h('h1', null, 'Tâm An Online'), h('p', null, sub));

export function authScreen(existing: Session | null): Promise<Session> {
  return new Promise((resolve) => {
    let mode: 'login' | 'register' | 'recover' = 'login';
    const err = h('div', { class: 'error', role: 'alert' });
    const body = h('div', { class: 'form' });
    const tabs = h('div', { class: 'tabs', role: 'tablist' });
    const done = (s: Session, recovery?: string) => {
      saveSession(s); setToken(s.token);
      if (recovery) recoveryScreen(recovery).then(() => resolve(s));
      else resolve(s);
    };
    const render = () => {
      clear(tabs); clear(body); err.textContent = '';
      for (const [k, label] of [['login', 'Đăng nhập'], ['register', 'Đăng ký'], ['recover', 'Quên mật khẩu']] as const) {
        tabs.appendChild(h('button', { role: 'tab', 'aria-selected': String(mode === k), onclick: () => { mode = k; render(); } }, label));
      }
      const user = h('input', { class: 'input', id: 'auth-user', autocomplete: 'username', placeholder: 'vd: minhtam', autocapitalize: 'off', spellcheck: 'false' });
      const pass = h('input', { class: 'input', id: 'auth-pass', type: 'password', autocomplete: mode === 'login' ? 'current-password' : 'new-password', placeholder: 'Ít nhất 8 ký tự' });
      const code = h('input', { class: 'input', id: 'auth-code', placeholder: 'XXXX-XXXX-XXXX-XXXX', autocapitalize: 'characters', spellcheck: 'false' });
      const submit = h('button', { class: 'btn primary big-btn', type: 'submit' }, mode === 'login' ? 'Vào chùa' : mode === 'register' ? 'Tạo tài khoản' : 'Đặt lại mật khẩu');
      const form = h('form', { class: 'form', onsubmit: async (e: Event) => {
        e.preventDefault(); err.textContent = ''; submit.disabled = true;
        try {
          if (mode === 'login') done(await api('/auth/login', { username: user.value, password: pass.value }));
          else if (mode === 'register') { const r = await api('/auth/register', { username: user.value, password: pass.value }); done(r, r.recoveryCode); }
          else { const r = await api('/auth/recover', { username: user.value, recoveryCode: code.value, newPassword: pass.value }); toast('Đã đặt lại mật khẩu.', 'good'); done(r, r.recoveryCode); }
        } catch (ex: any) { err.textContent = ex.message; }
        finally { submit.disabled = false; }
      } },
        h('div', { class: 'field' }, h('label', { for: 'auth-user' }, 'Tên đăng nhập'), user),
        mode === 'recover' ? h('div', { class: 'field' }, h('label', { for: 'auth-code' }, 'Mã khôi phục (nhận khi đăng ký)'), code) : null,
        h('div', { class: 'field' }, h('label', { for: 'auth-pass' }, mode === 'recover' ? 'Mật khẩu mới' : 'Mật khẩu'), pass),
        err, submit);
      body.appendChild(form);
      if (mode === 'register') body.appendChild(h('p', { class: 'muted', style: { margin: 0, fontSize: '12px' } }, 'Sau khi đăng ký, bạn sẽ nhận một mã khôi phục. Hãy lưu lại để lấy lại tài khoản khi quên mật khẩu.'));
      user.focus();
    };
    const cont = existing ? h('button', { class: 'btn gold big-btn', onclick: () => resolve(existing) }, `Tiếp tục với tài khoản ${existing.user.username}`) : null;
    screen(h('div', { class: 'card' }, brand('Chùa trực tuyến · tu tập cùng đạo hữu'), cont, tabs, body,
      h('p', { class: 'muted', style: { margin: 0, fontSize: '12px', textAlign: 'center' } }, 'Công đức trong game là điểm ghi nhận hoạt động, không mang giá trị tâm linh thực tế.')));
    render();
  });
}

export function recoveryScreen(code: string): Promise<void> {
  return new Promise((resolve) => {
    const copy = h('button', { class: 'btn', onclick: async () => {
      try { await navigator.clipboard.writeText(code); copy.textContent = 'Đã sao chép'; }
      catch { const sel = getSelection(); const r = document.createRange(); r.selectNodeContents(box); sel?.removeAllRanges(); sel?.addRange(r); copy.textContent = 'Đã chọn, nhấn Ctrl+C'; }
    } }, 'Sao chép mã');
    const box = h('div', { class: 'recovery-code' }, code);
    const ok = h('input', { type: 'checkbox', id: 'saved', onchange: () => { go.disabled = !ok.checked; } });
    const go = h('button', { class: 'btn primary big-btn', disabled: true, onclick: () => resolve() }, 'Tiếp tục');
    screen(h('div', { class: 'card' },
      h('h2', null, 'Mã khôi phục tài khoản'),
      h('p', { style: { margin: 0 } }, 'Mã này chỉ hiện một lần. Dùng nó để đặt lại mật khẩu khi quên. Mỗi lần dùng, bạn sẽ nhận mã mới.'),
      box, copy,
      h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, ok, 'Tôi đã lưu mã khôi phục ở nơi an toàn'),
      go));
  });
}

export async function serverScreen(session: Session, onLogout: () => void): Promise<{ serverId: number; charId: number | null }> {
  const [servers, me] = await Promise.all([api<any[]>('/servers'), api<any>('/me')]);
  return new Promise((resolve) => {
    const list = h('div', { class: 'server-list' });
    for (const s of servers) {
      const ch = me.characters.find((c: any) => c.server_id === s.id);
      list.appendChild(h('button', { class: 'server-item', disabled: !s.is_open, onclick: () => resolve({ serverId: s.id, charId: ch?.id ?? null }) },
        h('div', null, h('strong', null, s.name), h('span', { class: 'muted', style: { fontSize: '12px' } }, ch ? `Nhân vật: ${ch.dharma_name} · cấp ${ch.level}` : 'Chưa có nhân vật')),
        h('span', { style: { fontSize: '12px', whiteSpace: 'nowrap' } }, h('span', { class: 'dot' + (s.is_open ? '' : ' off') }), s.is_open ? `${s.online} đang online` : 'Bảo trì')));
    }
    screen(h('div', { class: 'card' }, brand(`Xin chào, ${session.user.username}`), h('h2', { style: { fontSize: '18px' } }, 'Chọn máy chủ'), list,
      h('div', { class: 'row-actions' },
        ['support', 'moderator', 'game_admin', 'super_admin'].includes(session.user.role) ? h('a', { class: 'btn', href: '/admin.html' }, 'Trang quản trị') : null,
        h('button', { class: 'btn ghost', onclick: onLogout }, 'Đăng xuất'))));
  });
}

export function creatorScreen(serverId: number): Promise<number> {
  return new Promise((resolve) => {
    const state = { gender: 'nu', hair: 'búi', skin: SKINS[1], robeColor: '#4f6d8f' };
    const ROBES = ['#4f6d8f', '#7a5236', '#8c8a86', '#5c7a5a'];
    const preview = h('div', { class: 'preview' }, h('div', { class: 'hint' }, 'Kéo để xoay nhân vật'));
    const name = h('input', { class: 'input', id: 'dharma', maxlength: 20, placeholder: 'vd: Diệu Hạnh, Minh Tâm' });
    const err = h('div', { class: 'error', role: 'alert' });
    const chips = <T extends string>(opts: { v: T; label: string }[], key: keyof typeof state) => {
      const wrap = h('div', { class: 'chips' });
      const draw = () => { clear(wrap); for (const o of opts) wrap.appendChild(h('button', { class: 'chip', type: 'button', 'aria-pressed': String(state[key] === o.v), onclick: () => { (state as any)[key] = o.v; draw(); update(); } }, o.label)); };
      draw(); return wrap;
    };
    const swatches = (colors: string[], key: 'skin' | 'robeColor', label: string) => {
      const wrap = h('div', { class: 'chips', role: 'group', 'aria-label': label });
      const draw = () => { clear(wrap); for (const c of colors) wrap.appendChild(h('button', { class: 'swatch', type: 'button', 'aria-label': `${label} ${c}`, 'aria-pressed': String(state[key] === c), style: { background: c }, onclick: () => { state[key] = c; draw(); update(); } })); };
      draw(); return wrap;
    };
    const submit = h('button', { class: 'btn primary big-btn', type: 'submit' }, 'Xác nhận tạo nhân vật');
    const form = h('form', { class: 'form', onsubmit: async (e: Event) => {
      e.preventDefault(); err.textContent = ''; submit.disabled = true;
      try {
        const r = await api('/characters', { serverId, dharmaName: name.value, gender: state.gender, hair: state.hair, skin: state.skin, robeColor: state.robeColor });
        cleanup(); resolve(r.id);
      } catch (ex: any) { err.textContent = ex.message; submit.disabled = false; }
    } },
      h('div', { class: 'field' }, h('label', { for: 'dharma' }, 'Pháp danh'), name),
      h('div', { class: 'field' }, h('label', null, 'Giới tính'), chips([{ v: 'nu', label: 'Nữ' }, { v: 'nam', label: 'Nam' }], 'gender')),
      h('div', { class: 'field' }, h('label', null, 'Kiểu tóc'), chips(HAIRS.map((x) => ({ v: x.code, label: x.name })), 'hair')),
      h('div', { class: 'field' }, h('label', null, 'Màu da'), swatches(SKINS, 'skin', 'Màu da')),
      h('div', { class: 'field' }, h('label', null, 'Màu áo tràng ban đầu'), swatches(ROBES, 'robeColor', 'Màu áo')),
      err, submit);
    screen(h('div', { class: 'card wide' }, h('h2', null, 'Tạo nhân vật'), h('div', { class: 'creator' }, preview, form)));

    // Xem trước 3D
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    preview.prepend(renderer.domElement);
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
    cam.position.set(0, 1.3, 5.2); cam.lookAt(0, 1, 0);
    scene.add(new THREE.HemisphereLight(0xfff2dc, 0x3a2418, 1.4));
    const key = new THREE.DirectionalLight(0xffe2b8, 2.2); key.position.set(2, 4, 3); scene.add(key);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshStandardMaterial({ color: 0x6b3f22, roughness: 0.8 }));
    disc.rotation.x = -Math.PI / 2; scene.add(disc);
    const look = () => ({ gender: state.gender, hair: state.hair, skin: state.skin, robe: null, accessory: null, bead: null, robeColor: state.robeColor });
    const av = new Avatar(look(), {});
    scene.add(av.root);
    const update = () => av.setLook(look(), {});
    let rot = 0.4, drag = false, lx = 0, alive = true;
    const el = renderer.domElement;
    el.addEventListener('pointerdown', (e) => { drag = true; lx = e.clientX; el.setPointerCapture(e.pointerId); });
    el.addEventListener('pointermove', (e) => { if (drag) { rot += (e.clientX - lx) * 0.01; lx = e.clientX; } });
    el.addEventListener('pointerup', () => { drag = false; });
    const size = () => { const r = preview.getBoundingClientRect(); renderer.setSize(r.width, r.height); cam.aspect = r.width / Math.max(1, r.height); cam.updateProjectionMatrix(); };
    size(); window.addEventListener('resize', size);
    const timer = new THREE.Timer();
    const loop = () => { if (!alive) return; av.root.rotation.y = rot; timer.update(); av.update(timer.getDelta()); renderer.render(scene, cam); requestAnimationFrame(loop); };
    loop();
    const cleanup = () => { alive = false; window.removeEventListener('resize', size); renderer.dispose(); };
    name.focus();
  });
}
