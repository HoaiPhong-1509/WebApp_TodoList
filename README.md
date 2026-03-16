**App TodoList**

Công nghệ sử dụng:

backend: NodeJS + MongoDB + thư viện Express

frontend: ReactJS + Tailwind + Các thư viện chính (react-router, sonner, axios, lucide-react, shadcn)

## Tính năng mới: Đăng ký / Đăng nhập

Đã thêm xác thực người dùng theo token Bearer.

## Tính năng mới: Xác minh Email khi đăng ký

- Khi đăng ký, backend kiểm tra định dạng email và kiểm tra MX record của domain email.
- Nếu domain email không thể nhận mail, đăng ký sẽ bị từ chối.
- Nếu hợp lệ, hệ thống gửi email xác minh chứa link `/verify-email?token=...`.
- Người dùng chỉ đăng nhập được sau khi xác minh email thành công.

- Đăng ký: `POST /api/auth/register`
- Đăng nhập: `POST /api/auth/login`
- Lấy thông tin user hiện tại: `GET /api/auth/me`
- Các API task (`/api/tasks/*`) đã được bảo vệ, yêu cầu token hợp lệ.

Mỗi task được gắn với user tạo task, nên dữ liệu task được tách riêng theo tài khoản.

## Chạy project

1. Cài dependencies:

```bash
npm run build
```

2. Chạy backend:

```bash
npm run start --prefix backend
```

3. Chạy frontend (môi trường dev):

```bash
npm run dev --prefix frontend
```

## Biến môi trường backend

File `backend/.env` cần có:

```env
MONGODB_CONNECTION_STRING=...
PORT=5001
JWT_SECRET=your_strong_secret
APP_BASE_URL=https://your-app.onrender.com

# SMTP settings (real email sending)
MAIL_HOST=smtp.gmail.com
MAIL_PORT=587
MAIL_SECURE=false
MAIL_USER=your_email@gmail.com
MAIL_PASS=your_app_password
MAIL_FROM=TodoList <your_email@gmail.com>

# Timeout (ms) for each SMTP phase AND the controller-level email budget.
# Recommended: 10000 (10 s) on Render free tier to stay well under the 60 s axios limit.
MAIL_SEND_TIMEOUT_MS=10000

# Dev-only fallback for local testing when SMTP is unavailable
# Do not enable this in production
RETURN_VERIFICATION_URL=false

# Optional: restrict CORS to specific origins (comma-separated)
# CORS_ORIGINS=https://your-app.onrender.com
```

Ghi chú:

- Nếu chưa cấu hình SMTP, backend dùng chế độ mock mail để phục vụ test local.
- Để gửi email thật, cần cấu hình đầy đủ biến `MAIL_*` như trên.
- Ở môi trường production, thiếu cấu hình SMTP thì backend sẽ báo lỗi khởi động để tránh chạy sai luồng xác minh email.
- `RETURN_VERIFICATION_URL` chỉ có tác dụng ở môi trường dev/local; production luôn tắt để không bypass xác minh email.

## Checklist chạy thực tế

- Đổi `JWT_SECRET` thành chuỗi bí mật mạnh, không dùng giá trị mặc định.
- Cấu hình `APP_BASE_URL` là domain frontend thật (ví dụ `https://your-app.onrender.com`).
- Cấu hình SMTP thật (Gmail SMTP, SendGrid SMTP, Mailgun SMTP...).
- Bật TLS đúng theo nhà cung cấp mail (`MAIL_SECURE`, `MAIL_PORT`).
- Cho phép DNS outbound từ server backend để kiểm tra MX record.
- Nếu dùng Gmail App Password, có thể dán dạng có khoảng trắng; backend sẽ tự chuẩn hóa trước khi gửi mail.
- Đặt `MAIL_SEND_TIMEOUT_MS=10000` để giới hạn thời gian gửi mail, tránh request bị treo quá lâu.

## Troubleshooting: Render + Gmail SMTP timeout

### Triệu chứng

Sau khi bấm **Register**, frontend hiển thị:

> "Request timed out. If your account was created, please continue from login and resend verification email."

### Nguyên nhân thường gặp

| Vấn đề | Giải thích |
|---|---|
| Gmail SMTP chậm / cold start | Render free tier có thể mất 10–20 s để thiết lập kết nối TLS tới `smtp.gmail.com:587`. |
| `MAIL_SEND_TIMEOUT_MS` chưa được đặt | Mặc định backend dùng 10 s (production), nhưng nên khai báo rõ ràng trên Render. |
| `APP_BASE_URL` sai | Link verify trong email trỏ sai domain → người dùng click nhưng không xác minh được. |
| Gmail App Password có khoảng trắng | Backend tự loại bỏ khoảng trắng, nhưng nên kiểm tra lại giá trị trên Render. |
| `NODE_ENV` chưa đặt là `production` | Backend sẽ dùng mock mail thay vì SMTP thật. |

### Các bước kiểm tra

1. Trên **Render → Environment**, kiểm tra:
   - `NODE_ENV=production`
   - `APP_BASE_URL=https://<your-service>.onrender.com` (không có dấu `/` cuối)
   - `MAIL_HOST=smtp.gmail.com`, `MAIL_PORT=587`, `MAIL_SECURE=false`
   - `MAIL_USER` và `MAIL_PASS` (Gmail App Password — không phải mật khẩu chính)
   - `MAIL_SEND_TIMEOUT_MS=10000`

2. Kiểm tra **Render Logs** sau khi deploy:
   - Tìm dòng `[auth][register] user created in DB` và `[auth][register] verification email sent` với trường `ms`.
   - Nếu thấy `email send failed` với `code: EMAIL_CONTROLLER_TIMEOUT` → SMTP chậm, tăng `MAIL_SEND_TIMEOUT_MS` lên `15000`.

3. Nếu email vẫn không đến sau khi đăng ký thành công:
   - Vào trang **Login**, nhập email đã đăng ký, bấm **Resend Verification Email**.
   - Kiểm tra hộp thư Spam/Junk.

4. Kiểm tra Gmail App Password:
   - Truy cập [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords).
   - Tạo App Password mới cho ứng dụng này.
   - Bật 2-Step Verification trên tài khoản Gmail trước.

### Luồng hoạt động chuẩn

```
[User] Register → [Backend] Tạo user (isVerified=false) → Gửi email xác minh
                                                         ↓
                              [Nếu SMTP timeout/lỗi] → Trả 201 emailDeliveryFailed=true
                                                         ↓
                         [Frontend] Redirect /login?resend=1 → User bấm "Resend Verification Email"
                                                         ↓
                         [User] Click link trong email → [Backend] Xác minh token → isVerified=true
                                                         ↓
                                                   [User] Đăng nhập thành công
```