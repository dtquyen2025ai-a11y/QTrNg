# Hướng dẫn deploy Tâm An Online

Game chạy trong **một container** (web + API + WebSocket) cộng với **một PostgreSQL**. Khi khởi động, server tự tạo bảng, nạp dữ liệu ban đầu và tạo tài khoản super admin.

Đã kiểm chứng: image build từ `Dockerfile` chạy được ở chế độ production, healthcheck `/api/health` báo khỏe, phục vụ `/` (game) và `/admin.html`. Nếu thiếu `JWT_SECRET`, server từ chối khởi động.

## Chọn cách nào?

| Cách | Chi phí tham khảo | Độ khó | Hợp với |
|---|---|---|---|
| **A. Render (Blueprint)** | ~7 USD/tháng web + ~6 USD/tháng DB | Dễ nhất: bấm vài nút | Thử nghiệm, vài chục người online |
| **B. VPS + Docker Compose** | VPS 2 GB RAM khoảng 5–6 USD/tháng | Trung bình: cần một tên miền | Chạy lâu dài, kiểm soát dữ liệu |

> **Không dùng gói free của Render cho game.** Gói free ngủ sau 15 phút không có người truy cập, làm rớt mọi kết nối WebSocket. Database free cũng bị xóa sau một thời gian.

Giá ở trên là tham khảo. Hãy xem bảng giá hiện tại của nhà cung cấp trước khi đăng ký.

---

## A. Render

1. Vào https://dashboard.render.com, chọn **New → Blueprint**.
2. Kết nối GitHub và chọn repo `QTrNg`, nhánh `main` (sau khi đã merge PR).
3. Render đọc `render.yaml` và đề xuất tạo:
   - Web service `tam-an-online` (Docker)
   - PostgreSQL `tam-an-db`
4. Render sẽ hỏi **ADMIN_PASSWORD**: nhập mật khẩu mạnh (≥ 12 ký tự). `JWT_SECRET` được sinh tự động.
5. Bấm **Apply**. Lần build đầu mất khoảng 3–5 phút.
6. Mở `https://tam-an-online.onrender.com` (tên miền thật hiển thị trong dashboard):
   - Game: `/`
   - Quản trị: `/admin.html`, đăng nhập bằng `admin` và mật khẩu ở bước 4.

Gắn tên miền riêng: **Settings → Custom Domains**. Render cấp HTTPS tự động.

---

## B. VPS + Docker Compose

Áp dụng cho Ubuntu 22.04/24.04 trên VPS bất kỳ.

1. Trỏ tên miền về IP VPS bằng bản ghi `A`, ví dụ `chua.tenmien.vn`.
2. Cài Docker:
   ```bash
   curl -fsSL https://get.docker.com | sh
   ```
3. Lấy mã nguồn và tạo file `.env`:
   ```bash
   git clone https://github.com/dtquyen2025ai-a11y/QTrNg.git tam-an && cd tam-an
   cat > .env <<EOF
   DOMAIN=chua.tenmien.vn
   POSTGRES_PASSWORD=$(openssl rand -hex 24)
   JWT_SECRET=$(openssl rand -hex 32)
   ADMIN_USERNAME=admin
   ADMIN_PASSWORD=doi-thanh-mat-khau-manh
   EOF
   ```
4. Chạy:
   ```bash
   docker compose up -d --build
   docker compose logs -f app     # đợi dòng "máy chủ chạy tại"
   ```
5. Mở `https://chua.tenmien.vn`. Caddy tự xin chứng chỉ HTTPS và chuyển tiếp WebSocket.

**Cập nhật phiên bản mới:**
```bash
git pull && docker compose up -d --build
```

**Sao lưu hằng ngày** (cron trên VPS, giữ 14 ngày):
```bash
mkdir -p ~/backups
( crontab -l; echo '15 3 * * * cd ~/tam-an && docker compose exec -T db pg_dump -U chua -Fc chua > ~/backups/chua-$(date +\%F).dump && find ~/backups -name "*.dump" -mtime +14 -delete' ) | crontab -
```

**Khôi phục:**
```bash
docker compose exec -T db pg_restore -U chua -d chua --clean < ~/backups/chua-YYYY-MM-DD.dump
```

---

## Kiểm tra sau khi deploy

- [ ] `https://<tên-miền>/api/health` trả về `{"ok":true,...}`
- [ ] Đăng ký tài khoản, tạo nhân vật, vào chùa được
- [ ] Mở 2 trình duyệt khác nhau: hai nhân vật thấy nhau, chat được (WebSocket hoạt động)
- [ ] Đăng nhập `/admin.html` bằng tài khoản admin
- [ ] **Đổi mật khẩu admin** nếu đã dùng mật khẩu tạm
- [ ] Đã bật sao lưu

## Lỗi thường gặp

| Hiện tượng | Nguyên nhân & cách xử lý |
|---|---|
| Vào game báo "Mất kết nối, đang thử lại…" liên tục | Reverse proxy không chuyển tiếp WebSocket. Với Nginx, thêm `proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";` cho `/ws`. Caddy và Render tự xử lý. |
| Container dừng ngay, log có "Thiếu biến môi trường" | Thiếu `DATABASE_URL` hoặc `JWT_SECRET` |
| Mọi người bị đăng xuất sau khi deploy lại | `JWT_SECRET` bị đổi. Hãy giữ nguyên giá trị này giữa các lần deploy. |
| Database ngoài (Neon, Supabase) báo lỗi SSL | Thêm `?sslmode=require` vào cuối `DATABASE_URL` |
| Đông người thì giật | Một tiến trình chịu được vài trăm người online. Muốn hơn, xem mục "Khi nào cần mở rộng" trong `docs/ARCHITECTURE.md`. |
