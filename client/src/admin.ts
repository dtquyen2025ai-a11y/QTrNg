// Trang quản trị: phân quyền do server kiểm tra; giao diện chỉ ẩn bớt nút theo vai trò.
import './admin.css';
import { api, loadSession, saveSession, setToken } from './api.ts';
import { h, clear } from './ui/dom.ts';

const RANK: Record<string, number> = { player: 0, support: 1, moderator: 2, game_admin: 3, super_admin: 4 };
const ROLE_NAME: Record<string, string> = { player: 'Người chơi', support: 'Hỗ trợ', moderator: 'Điều hành viên', game_admin: 'Quản trị game', super_admin: 'Quản trị cao nhất' };
const root = document.getElementById('admin')!;
let me: { id: number; username: string; role: string } | null = null;
let page = 'stats';
const can = (role: string) => !!me && RANK[me.role] >= RANK[role];
const dt = (s: string | null) => (s ? new Date(s).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : '—');
const n = (v: unknown) => Number(v || 0).toLocaleString('vi-VN');

function flash(main: HTMLElement, text: string) {
  const m = h('div', { class: 'msg', role: 'status' }, text);
  main.prepend(m); setTimeout(() => m.remove(), 4000);
}

function loginView() {
  clear(root);
  const u = h('input', { placeholder: 'Tên đăng nhập', autocomplete: 'username', id: 'au' }) as HTMLInputElement;
  const p = h('input', { type: 'password', placeholder: 'Mật khẩu', autocomplete: 'current-password', id: 'ap' }) as HTMLInputElement;
  const err = h('div', { class: 'muted' });
  root.appendChild(h('form', { class: 'login', onsubmit: async (e: Event) => {
    e.preventDefault();
    try {
      const r = await api('/auth/login', { username: u.value, password: p.value });
      saveSession(r); setToken(r.token); boot();
    } catch (ex: any) { err.textContent = ex.message; }
  } }, h('h2', null, 'Tâm An Quản Trị'), u, p, err, h('button', { class: 'btn primary', type: 'submit' }, 'Đăng nhập')));
}

async function boot() {
  try { me = (await api('/admin/me')).user; }
  catch (e: any) {
    if (e.status === 403) { clear(root); root.appendChild(h('div', { class: 'login' }, h('h2', null, 'Không có quyền'), h('p', null, 'Tài khoản này không có quyền quản trị.'), h('button', { class: 'btn', onclick: () => { saveSession(null); setToken(null); loginView(); } }, 'Đăng nhập tài khoản khác'))); return; }
    return loginView();
  }
  render();
}

const PAGES: [string, string, string][] = [
  ['stats', 'Tổng quan', 'support'], ['online', 'Người online', 'support'], ['players', 'Người chơi', 'support'],
  ['reports', 'Báo cáo vi phạm', 'support'], ['messages', 'Tin nhắn', 'moderator'], ['transactions', 'Giao dịch', 'support'],
  ['missions', 'Nhiệm vụ', 'support'], ['items', 'Vật phẩm & cửa hàng', 'support'], ['activities', 'Hoạt động & cân bằng', 'support'],
  ['events', 'Sự kiện', 'support'], ['temples', 'Chùa', 'support'], ['servers', 'Máy chủ', 'support'], ['logs', 'Nhật ký quản trị', 'game_admin'],
];

function render() {
  clear(root);
  const nav = h('nav', null, h('h1', null, 'Tâm An Quản Trị'),
    PAGES.filter(([, , r]) => can(r)).map(([k, label]) => h('button', { 'aria-current': String(k === page), onclick: () => { page = k; render(); } }, label)),
    h('div', { class: 'who' }, `${me!.username} · ${ROLE_NAME[me!.role]}`),
    h('button', { onclick: () => { saveSession(null); setToken(null); loginView(); } }, 'Đăng xuất'),
    h('a', { href: '/', style: { color: 'inherit', padding: '8px 10px', fontSize: '12px' } }, '← Về trò chơi'));
  const main = h('main', null, h('div', { class: 'muted' }, 'Đang tải…'));
  root.appendChild(h('div', { class: 'layout' }, nav, main));
  VIEWS[page](main).catch((e) => { clear(main); main.appendChild(h('div', { class: 'msg' }, e.message)); });
}

function table(headers: string[], rows: Node[][]) {
  return h('div', { class: 'table-wrap' }, h('table', null, h('thead', null, h('tr', null, headers.map((x) => h('th', null, x)))),
    h('tbody', null, rows.length ? rows.map((r) => h('tr', null, r.map((c) => (c instanceof HTMLTableCellElement ? c : h('td', null, c)))))
      : h('tr', null, h('td', { colspan: headers.length, class: 'muted' }, 'Không có dữ liệu.')))));
}
const num = (v: unknown) => h('td', { class: 'num' }, n(v));

/** Bảng sửa trực tiếp cho cấu hình game */
function editable(main: HTMLElement, path: string, rows: any[], cols: { key: string; label: string; type: 'text' | 'int' | 'num' | 'bool' | 'json' | 'date' | 'select'; opts?: string[]; readonly?: boolean }[], idKey = 'id') {
  const editableNow = can('game_admin');
  const body = rows.map((r) => {
    const inputs: Record<string, HTMLInputElement | HTMLSelectElement> = {};
    const cells = cols.map((c) => {
      if (c.readonly || !editableNow) return h('td', null, c.type === 'bool' ? (r[c.key] ? 'Có' : 'Không') : c.type === 'json' ? h('pre', null, JSON.stringify(r[c.key])) : c.type === 'date' ? dt(r[c.key]) : String(r[c.key] ?? '—'));
      let el: HTMLInputElement | HTMLSelectElement;
      if (c.type === 'bool') { el = h('input', { type: 'checkbox', checked: !!r[c.key] }) as HTMLInputElement; }
      else if (c.type === 'select') el = h('select', null, c.opts!.map((o) => h('option', { value: o, selected: o === r[c.key] }, o))) as HTMLSelectElement;
      else if (c.type === 'date') el = h('input', { type: 'datetime-local', value: r[c.key] ? new Date(new Date(r[c.key]).getTime() + 7 * 3600e3).toISOString().slice(0, 16) : '' }) as HTMLInputElement;
      else el = h('input', { value: c.type === 'json' ? JSON.stringify(r[c.key]) : r[c.key] ?? '', style: c.type === 'json' ? { minWidth: '260px' } : null }) as HTMLInputElement;
      inputs[c.key] = el;
      return h('td', null, el);
    });
    const save = h('button', { class: 'btn primary', onclick: async () => {
      const payload: Record<string, unknown> = {};
      for (const c of cols) {
        const el = inputs[c.key]; if (!el) continue;
        if (c.type === 'bool') payload[c.key] = (el as HTMLInputElement).checked;
        else if (c.type === 'date') payload[c.key] = el.value ? new Date(el.value + ':00+07:00').toISOString() : null;
        else payload[c.key] = el.value;
      }
      try { await api(`/admin/${path}/${r[idKey]}`, payload, 'PATCH'); flash(main, 'Đã lưu.'); }
      catch (ex: any) { flash(main, ex.message); }
    } }, 'Lưu');
    return editableNow ? [...cells, h('td', null, save)] : cells;
  });
  return table([...cols.map((c) => c.label), ...(editableNow ? [''] : [])], body);
}

const VIEWS: Record<string, (main: HTMLElement) => Promise<void>> = {
  async stats(main) {
    const s = await api('/admin/stats');
    clear(main);
    main.append(h('h2', null, 'Tổng quan'),
      h('div', { class: 'cards' }, [['Tài khoản', s.users], ['Nhân vật', s.characters], ['Đang online', s.online], ['Hoạt động hôm nay', s.activitiesToday], ['Người chơi hoạt động hôm nay', s.activeToday], ['Báo cáo chờ xử lý', s.openReports]]
        .map(([l, v]) => h('div', { class: 'card' }, h('b', null, n(v)), h('span', null, l)))),
      h('h3', null, 'Theo máy chủ'), table(['Máy chủ', 'Online'], s.servers.map((x: any) => [x.name, num(x.online)])),
      h('h3', null, 'Hoạt động hôm nay'), table(['Hoạt động', 'Số lần'], s.byActivity.map((x: any) => [x.name, num(x.n)])));
  },
  async online(main) {
    const list = await api('/admin/online');
    clear(main);
    main.append(h('h2', null, `Người online (${list.length})`), table(['ID', 'Pháp danh', 'Cấp', 'Máy chủ', 'Chùa', 'Vị trí', 'Trạng thái'],
      list.map((p: any) => [String(p.id), p.name, num(p.level), String(p.serverId), String(p.templeId), `${p.x}, ${p.z}`, p.anim])));
  },
  async players(main) {
    const q = h('input', { placeholder: 'Tìm tên đăng nhập hoặc pháp danh', id: 'pq' }) as HTMLInputElement;
    const box = h('div');
    const load = async () => {
      const list = await api(`/admin/players?q=${encodeURIComponent(q.value)}`);
      clear(box);
      box.appendChild(table(['Tài khoản', 'Vai trò', 'Pháp danh', 'Cấp', 'Công đức', 'Sen', 'Ngọc', 'Trạng thái', 'Đăng nhập cuối', 'Thao tác'], list.map((p: any) => [
        p.username, ROLE_NAME[p.role], p.dharma_name || '—', num(p.level), num(p.merit), num(p.sen), num(p.ngoc),
        h('span', null, p.is_banned ? h('span', { class: 'tag off' }, 'Bị khóa') : p.online ? h('span', { class: 'tag on' }, 'Online') : h('span', { class: 'tag' }, 'Offline'),
          p.muted_until && new Date(p.muted_until) > new Date() ? h('span', { class: 'tag off' }, 'Cấm chat') : null),
        dt(p.last_login_at),
        h('div', { class: 'row' },
          p.char_id ? h('button', { class: 'btn', onclick: () => detail(main, p.char_id) }, 'Chi tiết') : null,
          can('moderator') ? h('button', { class: 'btn bad', onclick: async () => {
            const reason = p.is_banned ? '' : (window.prompt('Lý do khóa tài khoản?') ?? '');
            if (!p.is_banned && !reason) return;
            try { await api(`/admin/users/${p.user_id}/ban`, { ban: !p.is_banned, reason }); load(); } catch (ex: any) { flash(main, ex.message); }
          } }, p.is_banned ? 'Mở khóa' : 'Khóa') : null,
          can('moderator') ? h('select', { onchange: async (e: Event) => {
            const m = Number((e.target as HTMLSelectElement).value); if (Number.isNaN(m)) return;
            try { await api(`/admin/users/${p.user_id}/mute`, { minutes: m }); flash(main, m ? `Đã cấm chat ${m} phút.` : 'Đã bỏ cấm chat.'); load(); } catch (ex: any) { flash(main, ex.message); }
          } }, h('option', { value: 'x' }, 'Cấm chat…'), [[0, 'Bỏ cấm'], [30, '30 phút'], [1440, '1 ngày'], [10080, '7 ngày']].map(([v, l]) => h('option', { value: v }, l))) : null,
          can('super_admin') && p.user_id !== me!.id ? h('select', { onchange: async (e: Event) => {
            try { await api(`/admin/users/${p.user_id}/role`, { role: (e.target as HTMLSelectElement).value }); flash(main, 'Đã đổi vai trò.'); load(); } catch (ex: any) { flash(main, ex.message); }
          } }, Object.entries(ROLE_NAME).map(([k, v]) => h('option', { value: k, selected: k === p.role }, v))) : null),
      ])));
    };
    clear(main);
    main.append(h('h2', null, 'Người chơi'), h('form', { class: 'row', onsubmit: (e: Event) => { e.preventDefault(); load(); } }, q, h('button', { class: 'btn primary' }, 'Tìm')), box);
    await load();
  },
  async reports(main) {
    const list = await api('/admin/reports?status=open');
    clear(main);
    main.append(h('h2', null, 'Báo cáo vi phạm đang mở'), table(['Thời gian', 'Người báo', 'Bị báo cáo', 'Lý do', 'Tin nhắn', 'Xử lý'], list.map((r: any) => [
      dt(r.created_at), r.reporter, r.target, r.reason, r.message || '—',
      can('moderator') ? h('div', { class: 'row' },
        h('button', { class: 'btn primary', onclick: async () => { await api(`/admin/reports/${r.id}`, { status: 'resolved', hideMessage: true }); render(); } }, 'Xử lý & ẩn tin'),
        h('button', { class: 'btn', onclick: async () => { await api(`/admin/reports/${r.id}`, { status: 'dismissed' }); render(); } }, 'Bỏ qua'),
        h('button', { class: 'btn', onclick: () => detail(main, r.target_id) }, 'Xem người chơi')) : 'Chỉ xem',
    ])));
  },
  async messages(main) {
    const list = await api('/admin/messages');
    clear(main);
    main.append(h('h2', null, 'Tin nhắn gần đây'), table(['Thời gian', 'Người gửi', 'Kênh', 'Nội dung', 'Ẩn'], list.map((m: any) => [dt(m.created_at), m.sender, m.recipient_id ? 'Riêng' : 'Chung', m.body, m.is_hidden ? 'Đã ẩn' : ''])));
  },
  async transactions(main) {
    const list = await api('/admin/transactions');
    clear(main);
    main.append(h('h2', null, 'Giao dịch gần đây'), table(['Thời gian', 'Nhân vật', 'Loại', 'Tài nguyên', 'Thay đổi', 'Số dư sau', 'Tham chiếu'],
      list.map((t: any) => [dt(t.created_at), t.dharma_name, t.kind, t.currency === 'item' ? t.item_name : t.currency, num(t.delta), num(t.balance_after), t.ref || ''])));
  },
  async missions(main) {
    const rows = await api('/admin/missions');
    clear(main);
    main.append(h('h2', null, 'Nhiệm vụ'), h('p', { class: 'muted' }, 'Thay đổi có hiệu lực ngay. Chỉ số (metric) hợp lệ: prostrate, bead_round, meditate_min, chant, offering, bell, lantern, explore, chat, coop, friend, gift, level, active_day.'),
      editable(main, 'missions', rows, [
        { key: 'code', label: 'Mã', type: 'text', readonly: true }, { key: 'name', label: 'Tên', type: 'text' }, { key: 'period', label: 'Nhóm', type: 'select', opts: ['daily', 'weekly', 'special', 'pilgrimage', 'community'] },
        { key: 'reset', label: 'Làm mới', type: 'select', opts: ['daily', 'weekly', 'once'] }, { key: 'metric', label: 'Chỉ số', type: 'text' }, { key: 'target', label: 'Mục tiêu', type: 'int' },
        { key: 'reward_merit', label: 'Công đức', type: 'int' }, { key: 'reward_exp', label: 'EXP', type: 'int' }, { key: 'reward_sen', label: 'Sen', type: 'int' }, { key: 'reward_ngoc', label: 'Ngọc', type: 'int' },
        { key: 'min_level', label: 'Cấp tối thiểu', type: 'int' }, { key: 'ends_at', label: 'Kết thúc', type: 'date' }, { key: 'is_active', label: 'Bật', type: 'bool' },
      ]));
  },
  async items(main) {
    const rows = await api('/admin/items');
    clear(main);
    main.append(h('h2', null, 'Vật phẩm & cửa hàng'), h('p', { class: 'muted' }, 'Để trống cả giá Sen và giá Ngọc nghĩa là không bán trong cửa hàng.'),
      editable(main, 'items', rows, [
        { key: 'code', label: 'Mã', type: 'text', readonly: true }, { key: 'name', label: 'Tên', type: 'text' }, { key: 'category', label: 'Loại', type: 'text', readonly: true },
        { key: 'price_sen', label: 'Giá Sen', type: 'int' }, { key: 'price_ngoc', label: 'Giá Ngọc', type: 'int' }, { key: 'min_level', label: 'Cấp', type: 'int' },
        { key: 'giftable', label: 'Tặng được', type: 'bool' }, { key: 'is_active', label: 'Đang bán', type: 'bool' }, { key: 'data', label: 'Dữ liệu', type: 'json' },
      ]));
  },
  async activities(main) {
    const rows = await api('/admin/activities');
    clear(main);
    main.append(h('h2', null, 'Hoạt động & cân bằng kinh tế'), h('p', { class: 'muted' }, 'Giới hạn ngày: số lần (thiền: số phút) được nhận thưởng mỗi ngày. Nhịp tối thiểu tính bằng mili giây.'),
      editable(main, 'activities', rows, [
        { key: 'code', label: 'Mã', type: 'text', readonly: true }, { key: 'name', label: 'Tên', type: 'text', readonly: true },
        { key: 'merit', label: 'Công đức', type: 'int' }, { key: 'exp', label: 'EXP', type: 'int' }, { key: 'sen', label: 'Sen', type: 'int' },
        { key: 'min_interval_ms', label: 'Nhịp tối thiểu (ms)', type: 'int' }, { key: 'daily_cap', label: 'Giới hạn ngày', type: 'int' }, { key: 'is_active', label: 'Bật', type: 'bool' },
      ], 'code'));
  },
  async events(main) {
    const rows = await api('/admin/events');
    clear(main);
    const name = h('input', { placeholder: 'Tên sự kiện, vd: Rằm tháng Giêng', id: 'ev-name' }) as HTMLInputElement;
    const mult = h('input', { type: 'number', step: '0.1', min: '1', value: '2', style: { width: '80px' }, id: 'ev-mult' }) as HTMLInputElement;
    const from = h('input', { type: 'datetime-local', id: 'ev-from' }) as HTMLInputElement;
    const to = h('input', { type: 'datetime-local', id: 'ev-to' }) as HTMLInputElement;
    (main.append as (...n: (Node | string | null)[]) => void)(h("h2", null, "Sự kiện"),
      can('game_admin') ? h('form', { class: 'row', onsubmit: async (e: Event) => {
        e.preventDefault();
        try {
          await api('/admin/events', { name: name.value, merit_multiplier: mult.value, starts_at: new Date(from.value + ':00+07:00').toISOString(), ends_at: new Date(to.value + ':00+07:00').toISOString(), is_active: true });
          render();
        } catch (ex: any) { flash(main, ex.message); }
      } }, name, h('label', null, 'Hệ số ', mult), h('label', null, 'Từ ', from), h('label', null, 'Đến ', to), h('button', { class: 'btn primary' }, 'Tạo sự kiện')) : null,
      editable(main, 'events', rows, [
        { key: 'name', label: 'Tên', type: 'text' }, { key: 'merit_multiplier', label: 'Hệ số công đức', type: 'num' },
        { key: 'starts_at', label: 'Bắt đầu (giờ VN)', type: 'date' }, { key: 'ends_at', label: 'Kết thúc (giờ VN)', type: 'date' }, { key: 'is_active', label: 'Bật', type: 'bool' },
      ]));
  },
  async temples(main) {
    const rows = await api('/admin/temples');
    clear(main);
    main.append(h('h2', null, 'Chùa'), editable(main, 'temples', rows, [
      { key: 'code', label: 'Mã', type: 'text', readonly: true }, { key: 'name', label: 'Tên', type: 'text' }, { key: 'region', label: 'Vùng', type: 'text' },
      { key: 'description', label: 'Mô tả', type: 'text' }, { key: 'min_level', label: 'Cấp mở', type: 'int' }, { key: 'is_active', label: 'Bật', type: 'bool' },
    ]));
  },
  async servers(main) {
    const rows = await api('/admin/servers');
    clear(main);
    main.append(h('h2', null, 'Máy chủ'), editable(main, 'servers', rows, [
      { key: 'code', label: 'Mã', type: 'text', readonly: true }, { key: 'name', label: 'Tên', type: 'text' }, { key: 'capacity', label: 'Sức chứa', type: 'int' }, { key: 'is_open', label: 'Mở', type: 'bool' },
    ]));
  },
  async logs(main) {
    const list = await api('/admin/logs');
    clear(main);
    main.append(h('h2', null, 'Nhật ký quản trị'), table(['Thời gian', 'Quản trị viên', 'Hành động', 'Đối tượng', 'Chi tiết'],
      list.map((l: any) => [dt(l.created_at), l.username, l.action, l.target || '', h('pre', null, JSON.stringify(l.detail))])));
  },
};

async function detail(main: HTMLElement, charId: number) {
  const d = await api(`/admin/characters/${charId}`);
  clear(main);
  const c = d.character;
  const cur = h('select', { id: 'adj-cur' }, [['sen', 'Sen'], ['ngoc', 'Ngọc'], ['merit', 'Công đức'], ['exp', 'EXP'], ['item', 'Vật phẩm']].map(([v, l]) => h('option', { value: v }, l))) as HTMLSelectElement;
  const delta = h('input', { type: 'number', placeholder: 'Số lượng (+/-)', id: 'adj-delta' }) as HTMLInputElement;
  const itemCode = h('input', { placeholder: 'Mã vật phẩm (nếu chọn vật phẩm)', id: 'adj-item' }) as HTMLInputElement;
  const reason = h('input', { placeholder: 'Lý do (bắt buộc)', id: 'adj-reason', style: { minWidth: '220px' } }) as HTMLInputElement;
  (main.append as (...n: (Node | string | null)[]) => void)(
    h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => render() }, '← Quay lại'), h('h2', null, `${c.dharma_name} (${c.username})`)),
    h('div', { class: 'cards' }, [...d.wallet.map((w: any) => [w.code, w.balance]), ['Cấp', c.level], ['Lạy Phật', c.prostrations], ['Chuỗi hạt', c.bead_rounds], ['Phút thiền', c.meditation_minutes]]
      .map(([l, v]: any) => h('div', { class: 'card' }, h('b', null, n(v)), h('span', null, l)))),
    can('game_admin') ? h('form', { class: 'row', onsubmit: async (e: Event) => {
      e.preventDefault();
      try { await api(`/admin/characters/${charId}/adjust`, { currency: cur.value, delta: Number(delta.value), itemCode: itemCode.value, reason: reason.value }); flash(main, 'Đã điều chỉnh và ghi nhật ký.'); detail(main, charId); }
      catch (ex: any) { flash(main, ex.message); }
    } }, h('strong', null, 'Điều chỉnh tài nguyên:'), cur, delta, itemCode, reason, h('button', { class: 'btn primary' }, 'Thực hiện')) : null,
    h('h3', null, 'Túi đồ'), table(['Vật phẩm', 'Số lượng'], d.inventory.map((i: any) => [`${i.name} (${i.code})`, num(i.quantity)])),
    h('h3', null, 'Giao dịch'), table(['Thời gian', 'Loại', 'Tài nguyên', 'Thay đổi', 'Số dư sau', 'Tham chiếu'], d.transactions.map((t: any) => [dt(t.created_at), t.kind, t.currency === 'item' ? t.item_name : t.currency, num(t.delta), num(t.balance_after), t.ref || ''])),
    h('h3', null, 'Hoạt động'), table(['Thời gian', 'Hoạt động', 'Số lượng', 'Có thưởng', 'Công đức'], d.activities.map((a: any) => [dt(a.created_at), a.activity_code, num(a.amount), a.rewarded ? 'Có' : 'Không', num(a.merit)])));
}

const s = loadSession();
if (s) { setToken(s.token); boot(); } else loginView();
