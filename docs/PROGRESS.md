# Tiến độ & việc còn lại

Cập nhật: 02/11/2026 · Phiên bản MVP 0.1

## Đã hoàn thành và đã kiểm chứng

| Module | Cách kiểm chứng |
|---|---|
| Schema 25 bảng, migration, seed, super admin | `npm run migrate` trên PostgreSQL 16 |
| Đăng ký, đăng nhập, khôi phục bằng mã, thu hồi phiên | Test tích hợp + E2E |
| Tạo nhân vật (pháp danh duy nhất, lọc từ, xem trước 3D) | Test tích hợp + E2E |
| Kinh tế server-side: nhịp tối thiểu, giới hạn ngày, khu vực, tiêu vật phẩm, sổ giao dịch | 18 test tích hợp (`npm test`) |
| Lạy Phật, tràng hạt 108, thiền (đo giờ server), tụng kinh (thời lượng tối thiểu), dâng hương/nến/hoa, chuông, hoa đăng | Test tích hợp; lạy Phật, tràng hạt kiểm thêm bằng E2E |
| Nhiệm vụ ngày/tuần/một lần, nhận thưởng một lần mỗi kỳ | Test tích hợp |
| Cấp độ, thưởng lên cấp, thành tựu, danh hiệu | Test tích hợp |
| Cửa hàng, trang bị áo/phụ kiện/chuỗi hạt | Test tích hợp + E2E (mua hàng) |
| Bạn bè, chặn, tặng quà (điều kiện cấp, giới hạn ngày) | Test tích hợp + E2E (lời mời realtime) |
| Multiplayer: thấy nhau, đồng bộ vị trí, chống dịch chuyển, chat chung/riêng, lọc từ, đẩy phiên trùng | Test tích hợp + E2E 2 trình duyệt |
| Dấu mộc hành hương tự động theo vị trí server | Test tích hợp |
| Sự kiện nhân công đức | Test tích hợp |
| Admin: phân quyền 4 vai trò, điều chỉnh tài nguyên bắt buộc có lý do, khóa, ghi nhật ký | Test tích hợp + E2E |
| Thế giới 3D: 3 chùa, đủ khu vực, ngày/đêm theo giờ VN, khói hương, nước, sen, cánh hoa, đom đóm, đèn lồng | Ảnh chụp E2E |
| Điều khiển PC (WASD, chuột) & mobile (joystick, vuốt, chụm) | E2E bàn phím; joystick chưa kiểm trên máy thật |
| Sao lưu `pg_dump` xoay vòng 14 bản | Đã chạy `npm run backup` |

## Giới hạn hiện tại (nói rõ, không che)

1. **Chưa nghiên cứu được game tham chiếu.** Môi trường phát triển chặn tên miền `niemphat.online`.
2. **Đăng nhập Google/Facebook chưa có.** Cần OAuth client ID. Nút này không hiển thị để tránh nút không có chức năng.
3. **Khôi phục tài khoản dùng mã khôi phục**, chưa có email (cần dịch vụ gửi mail).
4. **Nghe tụng kinh bằng audio chưa có.** Cần bản ghi hợp pháp. Hiện chỉ có chế độ đọc.
5. **Trạng thái online nằm trong bộ nhớ một tiến trình.** Chạy nhiều tiến trình cần chuyển `presence.ts` sang Redis.
6. **Mô hình 3D dựng bằng khối cơ bản.** Đủ để chơi, nhưng chưa đạt mức "mô hình đẹp". Cần họa sĩ 3D làm GLB cho chánh điện, tượng Phật và nhân vật.
7. **Hoạt ảnh nhân vật là hoạt ảnh thủ tục**, chưa dùng bộ xương (skeletal) hay motion capture.
8. **Chưa kiểm thử tải** (100+ CCU) và **chưa kiểm thử trên điện thoại thật**. Mới chạy E2E ở viewport mô phỏng iPhone.
9. **Kiểm duyệt chat** mới dùng danh sách từ cấm cơ bản. Chưa có bộ lọc theo ngữ cảnh.
10. **Hoạt động tập thể** mới có cơ chế cộng tu (thưởng +20%). Chưa có "đại lễ" theo lịch.

## Việc tiếp theo (đề xuất ưu tiên)

| # | Việc | Lý do |
|---|---|---|
| 1 | Kiểm thử trên 3–5 điện thoại Android/iOS tầm trung; đo FPS, giảm bóng đổ nếu < 30 FPS | Phần lớn người chơi thể loại này dùng điện thoại |
| 2 | Kiểm thử tải WebSocket 200 CCU (k6/artillery) | Xác định ngưỡng cần tách tiến trình |
| 3 | Thuê/đặt mô hình GLB cho chánh điện, tượng Phật, 4–6 mẫu nhân vật | Nâng chất lượng hình ảnh |
| 4 | Đại lễ theo lịch (Rằm, mùng Một) có tụng kinh tập thể đồng bộ | Hoạt động cộng đồng giữ chân người chơi |
| 5 | OAuth Google + email khôi phục | Giảm mất tài khoản |
| 6 | Redis cho presence + nhiều tiến trình game | Mở rộng |
| 7 | Trang trí phòng riêng (thiền thất cá nhân) | Đầu ra cho Sen dài hạn |
