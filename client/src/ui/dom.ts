type Child = Node | string | number | null | undefined | false | Child[];
type Attrs = Record<string, any>;

/** Tạo phần tử DOM: h('button', { class: 'btn', onclick }, 'Nhãn') */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') (el as any)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}
function append(el: Node, children: Child[]) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}
export function clear(el: Element) { while (el.firstChild) el.firstChild.remove(); }
export const fmt = (n: number) => Number(n || 0).toLocaleString('vi-VN');

/** Biểu tượng SVG nội tuyến (tự vẽ) */
const P: Record<string, string> = {
  lotus: '<path d="M12 4c-2.5 3-2.5 6 0 9 2.5-3 2.5-6 0-9zM5 10c.6 4 3 6 7 6.5-.4-3.5-3-6-7-6.5zm14 0c-4 .5-6.6 3-7 6.5 4-.5 6.4-2.5 7-6.5zM4 19h16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  bow: '<circle cx="12" cy="5" r="2.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 20l2-6 2 2 2-2 2 6M10 14c0-3 1-5 2-5s2 2 2 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  beads: '<circle cx="12" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="2.2 1.6"/><circle cx="12" cy="19.5" r="1.8" fill="currentColor"/>',
  meditate: '<circle cx="12" cy="5" r="2.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 8v6M7 12l5 2 5-2M4 19c3-2 5-3 8-3s5 1 8 3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  book: '<path d="M4 5c3-1 6-1 8 1 2-2 5-2 8-1v13c-3-1-6-1-8 1-2-2-5-2-8-1zM12 6v13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  bell: '<path d="M7 16V11a5 5 0 0110 0v5l1.5 2h-13zM12 4v2M10.5 20.5a1.6 1.6 0 003 0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  user: '<circle cx="12" cy="8" r="3.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M5 20c1-4 4-6 7-6s6 2 7 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  scroll: '<path d="M7 4h10a2 2 0 012 2v12a2 2 0 01-2 2H7M7 4a2 2 0 00-2 2v1h4V6a2 2 0 00-2-2zM9 9h6M9 12h6M9 15h4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  shop: '<path d="M4 9l1.5-4h13L20 9M4 9h16v2a3 3 0 01-6 0 3 3 0 01-4 0 3 3 0 01-6 0zM5 13v7h14v-7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  people: '<circle cx="9" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="17" cy="9" r="2.4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M3 19c.8-3.4 3.2-5 6-5s5.2 1.6 6 5M15 14.5c2.6 0 4.6 1.4 5.4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  map: '<path d="M4 6l5-2 6 2 5-2v14l-5 2-6-2-5 2zM9 4v14M15 6v14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  menu: '<path d="M5 7h14M5 12h14M5 17h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  merit: '<path d="M12 3c-3 4-3 7 0 10 3-3 3-6 0-10z" fill="#e7b955"/><path d="M5 11c.5 4 3 6 7 6.5-.4-3.5-3-6-7-6.5zm14 0c-4 .5-6.6 3-7 6.5 4-.5 6.4-2.5 7-6.5z" fill="#c9973a"/>',
  sen: '<circle cx="12" cy="12" r="8" fill="#e98aa6"/><path d="M12 6c-2 2.5-2 5 0 7.5 2-2.5 2-5 0-7.5z" fill="#fbd3df"/>',
  ngoc: '<path d="M12 3l7 6-7 12-7-12z" fill="#6cc7b0"/><path d="M5 9h14M12 3l-3 6 3 12 3-12z" fill="none" stroke="#e6fff6" stroke-width="1" opacity=".7"/>',
};
export function icon(name: string, cls = 'ico'): SVGSVGElement {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', cls); s.setAttribute('aria-hidden', 'true');
  s.innerHTML = P[name] || '';
  return s;
}

let toastHost: HTMLElement | null = null;
export function setToastHost(el: HTMLElement | null) { toastHost = el; }
export function toast(text: string, kind: '' | 'good' | 'bad' | 'big' = '', ms = 3200) {
  let host = toastHost;
  if (!host || !host.isConnected) {
    host = document.querySelector('body > .toasts.floating') as HTMLElement | null;
    if (!host) { host = h('div', { class: 'toasts floating', 'aria-live': 'polite' }); document.body.appendChild(host); }
  }
  const t = h('div', { class: 'toast ' + kind, role: 'status' }, text);
  host.appendChild(t);
  while (host.children.length > 4) host.firstElementChild?.remove();
  setTimeout(() => t.remove(), ms);
}

export function modal(title: string, body: Node, actions: { label: string; cls?: string; onClick: () => void | boolean | Promise<void | boolean> }[]) {
  const wrap = h('div', { class: 'modal-wrap', onclick: (e: Event) => { if (e.target === wrap) close(); } });
  const close = () => wrap.remove();
  const m = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('h3', null, title), body,
    h('div', { class: 'row-actions' },
      h('button', { class: 'btn ghost', onclick: close }, 'Đóng'),
      actions.map((a) => h('button', { class: 'btn ' + (a.cls || 'primary'), onclick: async () => { const r = await a.onClick(); if (r !== false) close(); } }, a.label))));
  wrap.appendChild(m);
  document.body.appendChild(wrap);
  (m.querySelector('input, textarea, select') as HTMLElement | null)?.focus();
  return close;
}
