# Pharmesthetic Homecare

Trang bán hàng một trang cho khách lẻ của GIVEHADA. Khách chọn sản phẩm, gửi form đặt hàng, đơn đổ về Google Sheet và email báo về givehada@h2yjsc.com. Chuyên viên gọi xác nhận.

Dự án Vercel riêng, thư mục gốc là `shop/`, link dự kiến givehada-shop.vercel.app.

## Sửa nội dung

| Muốn sửa | Mở file |
|---|---|
| Tên, giá, quy cách, mô tả, ảnh sản phẩm | `content/products.json` |
| Thêm hoặc bỏ sản phẩm khỏi trang | `content/products.json`, mảng `products` |
| Ba sản phẩm chủ lực, liệu trình gợi ý, chữ trên trang | `content/site.json` |
| Địa chỉ nhận đơn (URL Apps Script) | `content/site.json`, mục `order.endpoint` |

Ảnh sản phẩm lấy theo đường dẫn trên cdn.givehada.com, phần sau `media/images/`. Mỗi lần deploy, Vercel tải ảnh về, nén sang WebP nhiều cỡ.

Đổi giá trên trang thì đổi luôn tab **Bảng giá** trong sheet "GIVEHADA Homecare | Đơn web". Đơn được tính tiền theo tab này, không theo giá trình duyệt gửi lên.

## Nhận đơn

Mã nhận đơn nằm ở `apps-script/Code.gs`, chạy trên Google Apps Script của tài khoản khuongnvm@h2yjsc.com:

1. Mở sheet "GIVEHADA Homecare | Đơn web", chọn Tiện ích mở rộng, Apps Script.
2. Dán toàn bộ `Code.gs`, lưu.
3. Chạy hàm `testNotify` một lần để cấp quyền, kiểm tra hộp thư nhận email thử.
4. Triển khai, Tùy chọn triển khai mới, loại Ứng dụng web, thực thi với tư cách Tôi, quyền truy cập Bất kỳ ai.
5. Dán URL ứng dụng web vào `order.endpoint` rồi đẩy code.

Mỗi đơn ghi một dòng vào tab **Đơn hàng**: thời gian, mã đơn, khách, sản phẩm, tạm tính, ghi chú, nguồn quảng cáo (utm), trạng thái để CS cập nhật.

## Chạy thử ở máy

```
npm install
npm run build:offline   # ảnh giả, không cần mạng
npx serve dist
```
