# Tâm An Online

Game web 3D mô phỏng không gian chùa Việt, chơi trên trình duyệt máy tính và điện thoại. Người chơi tạo nhân vật, đi lại trong chùa, lạy Phật, lần tràng hạt 108, thiền định, tụng kinh, thắp hương, dâng hoa, thả hoa đăng, làm nhiệm vụ, tích công đức và tu tập cùng người chơi khác theo thời gian thực.

Đây là sản phẩm độc lập. Tên gọi, mô hình 3D, âm thanh, nội dung và mã nguồn đều được xây mới, không dùng tài sản của trò chơi nào khác.

- Thiết kế: [docs/GDD.md](docs/GDD.md)
- Kiến trúc, database, công nghệ: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Tiến độ & việc còn lại: [docs/PROGRESS.md](docs/PROGRESS.md)
- Deploy (Render hoặc VPS + Docker): [docs/DEPLOY.md](docs/DEPLOY.md)

## Chạy trên máy

Yêu cầu: Node.js ≥ 22.18, PostgreSQL ≥ 14.

```bash
npm install
cp .env.example .env          # sửa DATABASE_URL, JWT_SECRET, ADMIN_USERNAME, ADMIN_PASSWORD
createdb chua                 # hoặc tạo database theo DATABASE_URL
npm run migrate               # tạo bảng + dữ liệu khởi tạo + tài khoản super admin

# Phát triển (2 cửa sổ)
npm run dev:server            # API + WebSocket tại :8080
npm run dev:client            # Vite tại :5173, tự proxy /api và /ws
```

Sau đó mở:
- Game: http://localhost:5173
- Quản trị: http://localhost:5173/admin.html

Mẹo: thêm `?gio=21` vào URL để xem cảnh ban đêm (chỉ đổi hiển thị trên máy bạn).

## Chạy production

```bash
npm ci && npm run build       # build client vào dist/
NODE_ENV=production npm start # một tiến trình phục vụ cả web, API và WebSocket
```

Khi `NODE_ENV=production`, bắt buộc có `DATABASE_URL` và `JWT_SECRET`. Đặt sau reverse proxy có HTTPS (Nginx/Caddy) và chuyển tiếp header `Upgrade` cho đường dẫn `/ws`.

Sao lưu hằng ngày (giữ 14 bản):
```bash
npm run backup                # pg_dump vào backups/
```

## Kiểm thử

```bash
createdb chua_test
npm run typecheck             # TypeScript server + client
npm test                      # 18 test tích hợp trên PostgreSQL thật (database chua_test)
npm run build && npm start &  # rồi:
npm run e2e                   # 2 trình duyệt thật: đăng ký → vào chùa → lạy Phật → gặp nhau → chat → kết bạn → admin
```

E2E cần Playwright và Chromium (`npm i -D playwright && npx playwright install chromium`). Ảnh chụp lưu ở `test-results/`.

## Điều khiển

| Máy tính | Điện thoại |
|---|---|
| W A S D / mũi tên: di chuyển, giữ Shift để đi nhanh | Cần điều khiển góc trái |
| Kéo chuột: xoay camera, cuộn: zoom | Vuốt để xoay, chụm 2 ngón để zoom |
| E: tương tác · 1–4: Lạy / Hạt / Thiền / Kinh | Nút tương tác, thanh thao tác dưới |
| J C B F M: Nhiệm vụ · Hồ sơ · Cửa hàng · Cộng đồng · Hành hương | Thanh thao tác |
| Enter: chat · Esc: menu | Nút chat |

## Lưu ý

Công đức trong game là điểm ghi nhận hoạt động trong trò chơi, **không mang giá trị tâm linh thực tế** và không quy đổi ra tiền. Game không có thanh toán bằng tiền thật.
