# HƯỚNG DẪN CÀI ĐẶT LƯU TRỮ ICON DÙNG CHUNG (UPSTASH REDIS & VERCEL)

Tài liệu này hướng dẫn từng bước cách cấu hình cơ sở dữ liệu **Upstash Redis** miễn phí để khi Quản trị viên đổi icon (**Gà / Heo / Tự động**) cho từng trang trại, mọi người mở link ở bất kỳ máy tính hay điện thoại nào cũng thấy giống nhau.

---

## Bước 1. Tạo cơ sở dữ liệu Redis miễn phí trên Upstash

1. Truy cập [https://console.upstash.com](https://console.upstash.com) và đăng nhập (có thể đăng nhập nhanh bằng tài khoản GitHub hoặc Google).
2. Tại trang chủ Console, chuyển sang mục **Redis** và bấm nút **Create Database**:
   - **Name**: `thaiviet-farms-icons` (hoặc tên bất kỳ bạn muốn).
   - **Primary Region**: Chọn **ap-southeast-1 (Singapore)** để tốc độ tải từ Việt Nam nhanh nhất.
   - **Plan**: Chọn gói **Free** (hoàn toàn miễn phí, hỗ trợ 10.000 lệnh/ngày, dư sức cho hệ thống trang trại).
3. Bấm **Create** để hoàn tất tạo database.

---

## Bước 2. Lấy thông tin kết nối REST API

1. Ngay trong trang chi tiết của database vừa tạo, kéo xuống phần **REST API**.
2. Bạn sẽ thấy 2 thông số quan trọng:
   - `UPSTASH_REDIS_REST_URL` (có dạng `https://xxxx-xxxx.upstash.io`)
   - `UPSTASH_REDIS_REST_TOKEN` (chuỗi ký tự bảo mật dài)
3. Bấm nút **Copy** để sao chép lần lượt 2 giá trị này.
   - **Lưu ý bảo mật**: Tuyệt đối không dán `UPSTASH_REDIS_REST_TOKEN` vào mã nguồn frontend hay chia sẻ công khai. Chỉ đặt trong phần **Environment Variables** của Vercel ở Bước 3.

---

## Bước 3. Khai báo Biến Môi Trường trên Vercel và Redeploy

1. Mở trang quản lý dự án của bạn trên [https://vercel.com/dashboard](https://vercel.com/dashboard).
2. Vào mục **Settings** → **Environment Variables**.
3. Thêm lần lượt **3 biến môi trường** sau (đánh dấu chọn cả *Production*, *Preview*, và *Development*):

| Tên biến (Key) | Giá trị (Value) | Giải thích |
| :--- | :--- | :--- |
| `UPSTASH_REDIS_REST_URL` | `https://xxxx.upstash.io` | Đường dẫn REST URL copy từ Upstash ở Bước 2 |
| `UPSTASH_REDIS_REST_TOKEN` | `AXxx...` | Chuỗi REST Token bảo mật copy từ Upstash ở Bước 2 |
| `ADMIN_PASSWORD` | *Mật khẩu do bạn tự đặt* | Mật khẩu dùng để mở khoá nút **Quản trị** trên web |

*(Ngoài ra, nếu chưa thêm `MYMAPS_ID`, bạn có thể thêm luôn biến `MYMAPS_ID` chứa ID bản đồ Google My Maps của bạn).*

4. Sau khi bấm **Save**, chuyển sang tab **Deployments** trên Vercel:
   - Bấm vào biểu tượng `...` ở bản build trên cùng → chọn **Redeploy**.
   - Chờ khoảng 30–45 giây để Vercel hoàn tất cập nhật biến môi trường.

---

## Bước 4. Cách sử dụng Chế độ Quản trị trên Web

1. Mở đường dẫn web ứng dụng của bạn.
2. Ở góc trên bên phải (cạnh nút **NẠP DỮ LIỆU**), bấm vào nút hình ổ khoá **Quản trị**.
3. Nhập đúng mật khẩu `ADMIN_PASSWORD` bạn đã đặt ở Bước 3.
4. Khi đăng nhập thành công, góc trên sẽ hiện huy hiệu **"ĐANG Ở CHẾ ĐỘ QUẢN TRỊ"**:
   - **Đổi từng trang trại**: Bấm vào bất kỳ trang trại nào trên địa cầu hoặc bản đồ để mở Card thông tin → ở khung **"Chọn icon"**, bấm chọn **Gà**, **Heo** hoặc **Tự động**. Hệ thống sẽ lưu ngay lên Upstash Redis và hiện thông báo `"Đã lưu cho mọi người"`.
   - **Đổi hàng loạt**: Bấm nút **"Chọn icon hàng loạt"** trên thanh công cụ để mở bảng danh sách toàn bộ trang trại, tìm kiếm và gán nhanh icon cho từng dòng.
5. Khi tắt tab trình duyệt hoặc bấm **"Thoát quản trị"**, phiên quản trị sẽ tự động đóng lại. Người xem bình thường khi mở link sẽ chỉ xem được bản đồ với đúng các icon bạn đã chọn mà không thể chỉnh sửa.
