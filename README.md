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
APP_BASE_URL=http://localhost:5173

# SMTP settings (real email sending)
MAIL_HOST=smtp.gmail.com
MAIL_PORT=587
MAIL_SECURE=false
MAIL_USER=your_email@gmail.com
MAIL_PASS=your_app_password
MAIL_FROM=TodoList <your_email@gmail.com>

# Dev-only fallback for local testing when SMTP is unavailable
# Do not enable this in production
RETURN_VERIFICATION_URL=false
```

Ghi chú:

- Nếu chưa cấu hình SMTP, backend dùng chế độ mock mail để phục vụ test local.
- Để gửi email thật, cần cấu hình đầy đủ biến `MAIL_*` như trên.
- Ở môi trường production, thiếu cấu hình SMTP thì backend sẽ báo lỗi khởi động để tránh chạy sai luồng xác minh email.
- `RETURN_VERIFICATION_URL` chỉ có tác dụng ở môi trường dev/local; production luôn tắt để không bypass xác minh email.

## Checklist chạy thực tế

- Đổi `JWT_SECRET` thành chuỗi bí mật mạnh, không dùng giá trị mặc định.
- Cấu hình `APP_BASE_URL` là domain frontend thật (ví dụ `https://your-app.com`).
- Cấu hình SMTP thật (Gmail SMTP, SendGrid SMTP, Mailgun SMTP...).
- Bật TLS đúng theo nhà cung cấp mail (`MAIL_SECURE`, `MAIL_PORT`).
- Cho phép DNS outbound từ server backend để kiểm tra MX record.