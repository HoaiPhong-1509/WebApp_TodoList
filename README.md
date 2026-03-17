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

# Email provider (production): Brevo API
BREVO_API_KEY=xkeysib-xxxxxxxxxxxxxxxx
BREVO_SENDER_EMAIL=your_verified_sender@example.com
# Optional display name
BREVO_SENDER_NAME=TodoList

# Timeout (ms) for email API requests.
# Recommended: 10000 (10 s).
MAIL_SEND_TIMEOUT_MS=10000

# Optional DNS checks for email deliverability
# MX lookup timeout (ms)
MX_LOOKUP_TIMEOUT_MS=2500
# Default: false (strict mode)
EMAIL_DNS_ALLOW_ON_TIMEOUT=false
# Default: false (strict mode)
EMAIL_DNS_ALLOW_ON_ERROR=false

# Optional mailbox-level validation via Abstract API
# https://www.abstractapi.com/email-verification-validation-api
EMAIL_VALIDATION_API_KEY=
EMAIL_VALIDATION_TIMEOUT_MS=4000
# If true, register/resend requires validator service to be configured
EMAIL_REQUIRE_PROVIDER_VALIDATION=true
# If false, validator "unknown" results are rejected
EMAIL_ALLOW_UNKNOWN_PROVIDER_RESULT=false

# Dev-only fallback for local testing when email provider is unavailable
# Do not enable this in production
RETURN_VERIFICATION_URL=false

# Optional: restrict CORS to specific origins (comma-separated)
# CORS_ORIGINS=https://your-app.onrender.com
```

Ghi chú:

- Nếu có `BREVO_API_KEY`, backend gửi email thật qua Brevo API.
- Nếu không có `BREVO_API_KEY`: dev/local dùng mock mail; production sẽ báo lỗi cấu hình email.
- Khi register/resend, backend kiểm tra định dạng email + DNS (MX, fallback A/AAAA).
- Domain giả/không tồn tại (ví dụ `abc@khongtontai.invalid`) sẽ bị từ chối.
- Để chặn mailbox giả trên domain thật (ví dụ địa chỉ ngẫu nhiên `...@gmail.com`), cần bật `EMAIL_VALIDATION_API_KEY` và cấu hình strict như trên.
- `RETURN_VERIFICATION_URL` chỉ có tác dụng ở môi trường dev/local; production luôn tắt để không bypass xác minh email.

## Checklist chạy thực tế

- Đổi `JWT_SECRET` thành chuỗi bí mật mạnh, không dùng giá trị mặc định.
- Cấu hình `APP_BASE_URL` là domain frontend thật (ví dụ `https://your-app.onrender.com`).
- Cấu hình Brevo (`BREVO_API_KEY`, `BREVO_SENDER_EMAIL`) để gửi mail production ổn định qua HTTPS.
- Đặt `MAIL_SEND_TIMEOUT_MS=10000` để giới hạn thời gian gửi mail, tránh request bị treo quá lâu.

## Troubleshooting: Production email

### Triệu chứng

Sau khi bấm **Register/Resend**, frontend báo timeout hoặc backend log email send failed.

### Các bước kiểm tra

1. Trên Render Environment, kiểm tra:
   - `NODE_ENV=production`
   - `APP_BASE_URL=https://<your-service>.onrender.com` (không có dấu `/` cuối)
   - `BREVO_API_KEY` hợp lệ
   - `BREVO_SENDER_EMAIL` là sender đã verify trên Brevo
   - `MAIL_SEND_TIMEOUT_MS=10000`

2. Kiểm tra **Render Logs** sau khi deploy:
   - Tìm dòng `[auth][register] verification email sent` hoặc `[auth][resend] verification email sent`.
   - `provider` phải là `brevo`.
   - Nếu thấy `code: EMAIL_PROVIDER_NOT_CONFIGURED`, thiếu `BREVO_API_KEY` hoặc `BREVO_SENDER_EMAIL`.

3. Nếu email vẫn không đến sau khi đăng ký thành công:
   - Vào trang **Login**, nhập email đã đăng ký, bấm **Resend Verification Email**.
   - Kiểm tra hộp thư Spam/Junk.

### Luồng hoạt động chuẩn

```
[User] Register → [Backend] Tạo user (isVerified=false) → Gửi email xác minh
                                                         ↓
                              [Nếu email provider timeout/lỗi] → Trả 201 emailDeliveryFailed=true
                                                         ↓
                         [Frontend] Redirect /login?resend=1 → User bấm "Resend Verification Email"
                                                         ↓
                         [User] Click link trong email → [Backend] Xác minh token → isVerified=true
                                                         ↓
                                                   [User] Đăng nhập thành công
```