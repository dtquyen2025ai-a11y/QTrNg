// Kiểm thử end-to-end trên trình duyệt thật (Chromium headless) với 2 người chơi.
// Yêu cầu: server đang chạy tại BASE (mặc định http://localhost:8080) với bản build client.
import { createRequire } from 'node:module';
// Dùng Playwright cài sẵn trên máy (hoặc cài: npm i -D playwright)
const { chromium } = createRequire(import.meta.url)('playwright');
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:8080';
const OUT = process.env.OUT || 'test-results';
fs.mkdirSync(OUT, { recursive: true });
const stamp = Date.now().toString(36);
// Pháp danh chỉ gồm chữ cái và phải duy nhất: đổi số trong mã thời gian thành chữ
const tag = stamp.replace(/[0-9]/g, (d) => 'abcdefghij'[+d]).slice(-7);
const Tag = tag.charAt(0).toUpperCase() + tag.slice(1);
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? '✔' : '✘'} ${name}${detail ? ' – ' + detail : ''}`); };

async function newPlayer(browser, user, dharma, viewport = { width: 1280, height: 800 }, query = '') {
  const ctx = await browser.newContext({ viewport, hasTouch: viewport.width < 600, isMobile: viewport.width < 600 });
  const page = await ctx.newPage();
  page.setDefaultTimeout(90000);
  const errors = [];
  const kicked = [];
  page.on('websocket', (ws) => ws.on('framereceived', (f) => { if (String(f.payload).includes('"kicked"')) kicked.push(String(f.payload)); }));
  page.on('pageerror', (e) => errors.push(e.message));
  // Bỏ qua phản hồi 4xx có chủ đích (server từ chối hành động sai khu vực/quá nhanh) – trình duyệt tự ghi chúng vào console
  page.on('console', (m) => m.type() === 'error' && !/favicon|status of 4(00|29)/.test(m.text()) && errors.push(m.text()));
  await page.goto(BASE + '/' + query);
  await page.getByRole('tab', { name: 'Đăng ký' }).click();
  await page.fill('#auth-user', user);
  await page.fill('#auth-email', user + '@example.com');
  await page.fill('#auth-pass', 'matkhau123');
  await page.getByRole('button', { name: 'Tạo tài khoản' }).click();
  await page.getByRole('button', { name: /Máy chủ Tâm An 1/ }).click();
  await page.fill('#dharma', dharma);
  await page.getByRole('button', { name: 'Tóc dài' }).click();
  await page.getByRole('button', { name: 'Xác nhận tạo nhân vật' }).click();
  await page.waitForSelector('.quickbar', { timeout: 120000 });
  await page.waitForFunction(() => !document.querySelector('.loading'));
  return { ctx, page, errors, kicked };
}

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const A = await newPlayer(browser, 'e2ea' + stamp, 'Minh Tâm ' + Tag);
  // Quên mật khẩu: giao diện gửi mã qua email (mã thật kiểm ở test tích hợp)
  {
    const fp = await (await browser.newContext()).newPage();
    await fp.goto(BASE + '/');
    await fp.getByRole('tab', { name: 'Quên mật khẩu' }).click();
    await fp.fill('#auth-email', 'e2ea' + stamp + '@example.com');
    await fp.getByRole('button', { name: 'Gửi mã qua email' }).click();
    await fp.waitForSelector('#auth-code');
    check('Quên mật khẩu: gửi mã qua email và hiện bước nhập mã', (await fp.textContent('.note')).includes('email'));
    await fp.close();
  }
  check('Vào game, HUD hiển thị', await A.page.isVisible('.top-left'));
  await A.page.waitForTimeout(1500);
  await A.page.screenshot({ path: `${OUT}/01-vao-chua.png` });

  // Quà đăng nhập & ví
  const wallet = await A.page.textContent('.wallet');
  check('Ví hiển thị Sen khởi đầu 50', wallet.includes('50'), wallet);

  // Lạy Phật ngoài chánh điện -> bị từ chối với lý do rõ ràng
  await A.page.keyboard.press('Digit1');
  await A.page.waitForSelector('.toast.bad', { timeout: 30000 });
  check('Chưa quỳ trên bồ đoàn thì không lạy Phật được', (await A.page.textContent('.toast.bad')).includes('Quỳ xuống'));

  // Đi vào chánh điện bằng bàn phím
  await A.page.locator('canvas').first().click({ position: { x: 640, y: 300 } });
  await A.page.keyboard.down('ShiftLeft'); await A.page.keyboard.down('KeyW');
  // Giữ phím W cho tới khi tới bồ đoàn trong chánh điện (máy kiểm thử render chậm nên không đi theo thời gian cố định)
  for (let i = 0; i < 120; i++) {
    await A.page.waitForTimeout(1000);
    if ((await A.page.textContent('.interact')).includes('Quỳ xuống') && /Chánh điện|Đại hùng/.test(await A.page.textContent('.zone-name'))) break;
  }
  await A.page.keyboard.up('KeyW'); await A.page.keyboard.up('ShiftLeft');
  await A.page.waitForTimeout(600);
  const zone = await A.page.textContent('.zone-name');
  check('Di chuyển tới Chánh điện', zone.includes('Chánh điện') || zone.includes('Đại hùng'), zone);
  await A.page.screenshot({ path: `${OUT}/02-chanh-dien.png` });
  await A.page.getByRole('button', { name: /Quỳ xuống/ }).click();
  await A.page.waitForSelector('.seat-hint:has-text("Đang quỳ")');
  check('Đến bồ đoàn: chọn Quỳ xuống', true);
  await A.page.keyboard.press('Digit1');
  await A.page.waitForSelector('.toast.good', { timeout: 30000 });
  const t = await A.page.textContent('.toast.good');
  check('Quỳ trên bồ đoàn rồi lạy Phật được cộng công đức', t.includes('công đức'), t);
  await A.page.waitForTimeout(900);
  await A.page.screenshot({ path: `${OUT}/03-lay-phat.png` });

  await A.page.keyboard.press('KeyE');
  await A.page.waitForSelector('.interact:has-text("Ngồi xuống")');
  check('Đứng dậy khỏi bồ đoàn', true);
  // Người chơi B (điện thoại)
  const B = await newPlayer(browser, 'e2eb' + stamp, 'Diệu Hạnh ' + Tag, { width: 390, height: 844 });
  await B.page.waitForTimeout(1500);
  await A.page.waitForFunction(() => document.querySelector('.nearby h4')?.textContent?.includes('(1)'), null, { timeout: 60000 });
  check('A thấy B trong danh sách xung quanh (multiplayer)', true);
  const bSees = await B.page.evaluate(() => document.querySelector('.nearby h4')?.textContent || '');
  await B.page.screenshot({ path: `${OUT}/04-dien-thoai.png` });

  // Chat: B mở chat, gửi; A nhận
  await B.page.getByRole('button', { name: 'Thu gọn chat' }).click();
  await B.page.fill('#chat-input', 'A Di Đà Phật, chào đạo hữu');
  await B.page.getByRole('button', { name: 'Gửi' }).click();
  await A.page.waitForFunction(() => document.querySelector('.chat-log')?.textContent?.includes('chào đạo hữu'), null, { timeout: 30000 });
  check('Chat công khai realtime giữa 2 người', true);

  // Panel: nhiệm vụ, cửa hàng, cộng đồng, hành hương, hồ sơ
  for (const [key, name, file] of [['KeyJ', 'Nhiệm vụ', '05-nhiem-vu'], ['KeyB', 'Cửa hàng', '06-cua-hang'], ['KeyF', 'Cộng đồng', '07-cong-dong'], ['KeyM', 'Hành hương', '08-hanh-huong'], ['KeyC', 'Hồ sơ', '09-ho-so']]) {
    await A.page.keyboard.press(key);
    await A.page.waitForSelector(`.drawer h2:has-text("${name}")`);
    await A.page.waitForFunction(() => !document.querySelector('.drawer-body')?.textContent?.startsWith('Đang tải'));
    await A.page.waitForTimeout(300);
    await A.page.screenshot({ path: `${OUT}/${file}.png` });
    check(`Mở ngăn kéo ${name}`, true);
  }
  // Mua hàng
  await A.page.keyboard.press('KeyB');
  await A.page.waitForSelector('.drawer h2:has-text("Cửa hàng")');
  await A.page.locator('.drawer .item', { hasText: 'Nén hương' }).getByRole('button', { name: 'Mua' }).click();
  await A.page.waitForSelector('.toast.good:has-text("Đã mua")', { timeout: 30000 });
  check('Mua Nén hương trong cửa hàng', true);
  await A.page.keyboard.press('Escape');

  // Tràng hạt
  await A.page.keyboard.press('Digit2');
  await A.page.waitForSelector('.mala');
  for (let i = 0; i < 6; i++) { await A.page.keyboard.press('Space'); await A.page.waitForTimeout(300); }
  const beadCount = await A.page.textContent('.mala .center b');
  check('Lần tràng hạt', Number(beadCount) >= 6, beadCount);
  await A.page.screenshot({ path: `${OUT}/10-trang-hat.png` });
  await A.page.keyboard.press('Escape');
  await A.page.waitForTimeout(1700);

  // Kết bạn từ thẻ người chơi
  await A.page.locator('.nearby button').first().click();
  await A.page.getByRole('button', { name: 'Kết bạn' }).click();
  await A.page.waitForSelector('.toast.good:has-text("lời mời")', { timeout: 30000 });
  await B.page.waitForSelector('.toast:has-text("muốn kết bạn")', { timeout: 30000 });
  check('Gửi lời mời kết bạn và B nhận thông báo realtime', true);

  // Cảnh ban đêm
  const N = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const np = await N.newPage();
  np.setDefaultTimeout(90000);
  await np.goto(BASE + '/?gio=21');
  await np.getByRole('button', { name: /Tiếp tục với tài khoản/ }).count().then(async (c) => { if (!c) { await np.fill('#auth-user', 'e2ea' + stamp); await np.fill('#auth-pass', 'matkhau123'); await np.getByRole('button', { name: 'Vào chùa' }).click(); } });
  await np.getByRole('button', { name: /Máy chủ Tâm An 1/ }).click();
  await np.waitForSelector('.quickbar', { timeout: 120000 });
  await np.waitForTimeout(2500);
  await np.screenshot({ path: `${OUT}/11-ban-dem.png` });
  check('Đăng nhập lại giữ nguyên tiến trình (vị trí trong chánh điện)', (await np.textContent('.zone-name')).match(/Chánh điện|Đại hùng/) !== null, await np.textContent('.zone-name'));
  const backToServers = await A.page.waitForSelector('.server-list', { timeout: 30000 }).then(() => true).catch(() => false);
  check('Phiên cũ ở tab A bị đẩy ra khi đăng nhập nơi khác', A.kicked.length > 0 && backToServers, A.kicked[0] || 'không nhận gói kicked');

  // Admin
  const ad = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  ad.setDefaultTimeout(60000);
  await ad.goto(BASE + '/admin.html');
  await ad.fill('#au', process.env.ADMIN_USERNAME || 'admin');
  await ad.fill('#ap', process.env.ADMIN_PASSWORD || 'admin12345');
  await ad.getByRole('button', { name: 'Đăng nhập' }).click();
  await ad.waitForSelector('.cards');
  await ad.screenshot({ path: `${OUT}/12-admin.png` });
  check('Trang admin đăng nhập & hiển thị tổng quan', true);
  await ad.getByRole('button', { name: 'Người chơi' }).click();
  await ad.waitForSelector('table');
  await ad.screenshot({ path: `${OUT}/13-admin-nguoi-choi.png` });

  // Đại lễ cộng tu: admin tổ chức ngay, người chơi (tab np, đang ở Chánh điện) tham dự và nhận thưởng
  const adminLogin = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: process.env.ADMIN_USERNAME || 'admin', password: process.env.ADMIN_PASSWORD || 'admin12345' }) })).json();
  const sch = await fetch(BASE + '/api/admin/ceremonies', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + adminLogin.token }, body: JSON.stringify({ minutes: 0 }) });
  check('Admin tổ chức đại lễ đột xuất', sch.ok, String(sch.status));
  const cer = await (await fetch(BASE + '/api/ceremony')).json();
  await np.waitForSelector('.cer-banner:not(.hidden)', { timeout: 30000 });
  await np.keyboard.press('KeyL');
  await np.waitForSelector('.drawer h2:has-text("Đại lễ đang diễn ra")');
  await np.keyboard.press('Escape');
  await np.waitForSelector('.interact:has-text("Quỳ xuống")');
  await np.keyboard.press('KeyQ');
  await np.waitForSelector('.seat-hint:has-text("Đang quỳ")');
  await np.keyboard.press('KeyL');
  await np.waitForSelector('.drawer h2:has-text("Đại lễ đang diễn ra")');
  await np.getByRole('button', { name: 'Ngồi tụng cùng đại chúng' }).click();
  await np.waitForTimeout(4000);
  await np.screenshot({ path: `${OUT}/14-dai-le.png` });
  const waitMs = (cer.current ? cer.current.endAt - cer.serverNow : 300000) + 60000;
  const got = await np.waitForSelector('.toast:has-text("Viên mãn đại lễ")', { timeout: waitMs }).then(() => true).catch(() => false);
  check('Quỳ trên bồ đoàn dự trọn đại lễ và nhận thưởng', got);

  for (const [who, p] of [['A', A], ['B', B]]) check(`Không có lỗi JavaScript (${who})`, p.errors.length === 0, p.errors.slice(0, 3).join(' | '));
  const hScroll = await B.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  check('Điện thoại không bị cuộn ngang', hScroll);
  console.log('B thấy:', bSees);
} catch (e) {
  check('Kịch bản E2E chạy trọn', false, e.message);
} finally {
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} kiểm tra đạt.`);
  fs.writeFileSync(`${OUT}/e2e.json`, JSON.stringify(results, null, 2));
  process.exit(failed.length ? 1 : 0);
}
