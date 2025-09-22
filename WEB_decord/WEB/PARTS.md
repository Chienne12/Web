# Phân khu giao diện LinkCastPro (theo line dọc/ngang)

- Phần 1 — Menu trái (Trái/Trên)
  - Selector: `nav.menu[data-part="1"]`
  - Mô tả: Thanh điều hướng chính (Tổng quan, Thiết bị, Cài đặt, Hỗ trợ).

- Phần 2 — QR & Mã ghép (Trái/Dưới)
  - Selector: `.qr-card[data-part="2"]`
  - Mô tả: Hiển thị QR để ghép nối, nút "Hiển thị mã 6 số", copy mã.

- Phần 3 — Player (Phải/Trên)
  - Selector: `.player-card[data-part="3"]`
  - Mô tả: Vùng phát/nhận video, nút Play, 3 chip chỉ số (ms, Mbps, FPS).

- Phần 4 — Điều khiển & Mẹo (Phải/Dưới)
  - Selector: `.chips-row[data-part="4"]` và `.inline-tip[data-part="4"]`
  - Mô tả: Nhóm chip chất lượng (720p/1080p/Auto), Keyframe/Preset/Ghi MP4/Fullscreen, kèm mẹo mạng.

## Ghi chú sử dụng

- Quy ước line: 1 line dọc chia trái/phải, 1 line ngang ngay trên footer chia trên/dưới.
- Khi cần tham chiếu, dùng `data-part` hoặc `data-name` trong DOM để truy vết nhanh.
- Style đường kẻ dùng token `--line`; viền component dùng `--border` (không trộn lẫn).

