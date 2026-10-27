# Pharmesthetic Master Aesthetic House

Thư viện tài liệu dành cho Master của **GIVEHADA**: 5 phần, 23 tài liệu và video. Bản dựng lại từ trang Framer cũ, ưu tiên điện thoại.

## Sửa nội dung

Toàn bộ chữ, link tài liệu và link video nằm trong `content/site.json`. Sửa xong đẩy lên GitHub, Vercel tự dựng lại trong khoảng 1 phút.

- Đổi link tài liệu: sửa `href` của thẻ tương ứng.
- Thêm tài liệu: thêm một dòng mới vào `cards` của phần đó, gồm ảnh bìa (`img`, `w`, `h`), `title`, `text`, `href`.
- Video: thẻ trong phần Part II có thêm `video` là mã YouTube, bấm vào sẽ phát ngay trong trang.

## Cách dựng

`npm run build` tải ảnh và video gốc, nén ảnh sang WebP nhiều cỡ, cắt riêng ảnh và video đầu trang khổ dọc cho điện thoại, rồi xuất trang tĩnh vào `dist/`. Vercel chạy lệnh này mỗi lần deploy.

Chạy thử không cần mạng: `npm run build:offline` (dùng ảnh giả).
