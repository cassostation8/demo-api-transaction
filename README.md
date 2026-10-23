# Casso Console · Demo API giao dịch ngân hàng

Ứng dụng web mẫu cho thấy cách tích hợp **[Casso Console Open API](https://console.casso.vn/docs/quickstart)** để lấy lịch sử giao dịch ngân hàng của doanh nghiệp:

1. **Liên kết tài khoản ngân hàng** qua Cas Link → nhận `accessToken`.
2. **Gọi API giao dịch** (`/proxy/identity`, `/proxy/transactions`).
3. **Hiển thị dữ liệu** thành bảng kê và dashboard (lọc, tìm kiếm, xuất CSV).

Trang có sẵn một dashboard bằng **dữ liệu minh hoạ** để xem ngay, không cần tài khoản. Phần "Kết nối dữ liệu thật" chạy với key Casso của bạn, có khung API console hiện request/response thật và nút Copy cURL để bạn mang sang code của mình.

**Kiến trúc:** Node.js + Express (`server.js`) chỉ chuyển tiếp request tới Casso Console; giao diện là HTML/CSS/JS thuần trong `public/`. Không database, không bước build, server không lưu key.

---

## Chạy

```bash
git clone <URL-repo-này> demo-api-transaction
cd demo-api-transaction
npm install
npm start            # hoặc npm run dev (tự reload khi sửa code)
```

Mở <http://localhost:3030> — xong. Cần [Node.js 18+](https://nodejs.org); không cần file `.env` hay tài khoản Casso để xem dashboard minh hoạ.

---

## Tuỳ chọn: kết nối dữ liệu thật

Chỉ cần khi muốn liên kết tài khoản thật và gọi API bằng key của bạn.

### 1 · Lấy key trên Casso Console

1. Đăng ký / đăng nhập tại <https://console.casso.vn>. Tài khoản mới có thể dùng môi trường **Sandbox** để thử miễn phí với ngân hàng giả lập.
2. Ở **Tổng quan**, bấm **Tạo credential**, đặt tên, chọn dịch vụ **Transactions**.
3. Lưu lại **Client ID** và **Secret key** (xem trong trang chi tiết credential).

### 2 · Mở demo bằng URL công khai (cần cho Cas Link)

Cas Link chỉ trả kết quả về địa chỉ đã khai báo trên credential, và địa chỉ đó phải là HTTPS công khai — `localhost` không dùng được. Khi thử ở máy cá nhân, dùng **ngrok**:

1. Tạo tài khoản miễn phí và cài ngrok theo hướng dẫn: <https://ngrok.com/download>, rồi chạy `ngrok config add-authtoken <token>`.
2. (Tuỳ chọn) Lấy domain cố định miễn phí trong dashboard ngrok và điền vào `.env`: `NGROK_DOMAIN=ten-cua-ban.ngrok-free.app`.
3. Chạy 2 terminal:

   ```bash
   npm start          # terminal 1
   npm run tunnel     # terminal 2 — in ra URL https://....ngrok-free.app
   ```

4. Mở demo bằng **URL ngrok** đó (không dùng localhost nữa).

> Nếu đã deploy lên server có domain HTTPS (xem phần Deploy), bỏ qua bước này.

### 3 · Khai báo URL trên credential

Trong demo, kéo tới **Bước 1 · Liên kết tài khoản**: khối **"Cấu hình trên Casso Console"** hiện sẵn 2 URL theo domain đang mở, có nút Copy:

- **Authorized Redirect URIs**: `https://<domain>/casso/callback`
- **Authorized Webhook URLs**: `https://<domain>/casso/webhook`

Dán 2 URL này vào trang chi tiết credential trên Casso Console rồi **Lưu**.

### 4 · Chạy luồng trong demo

1. **Bước 1 · Liên kết tài khoản**: chọn **Sandbox** hoặc **Production** (phải khớp môi trường của credential), nhập Client ID + Secret key, rồi chọn một cách:
   - *iframe Cas Link*: chọn ngân hàng → đăng nhập trong cửa sổ Cas Link → demo nhận `accessToken`.
   - *link_id*: nếu đã có kết nối tạo sẵn trên Casso Console, dán `link_id` để nhận `accessToken` ngay.
2. **Bước 2 · Gọi API**: chọn khoảng ngày (và số tài khoản nếu muốn) → bấm gọi.
3. **Bước 3 · Bảng kê**: xem giao dịch thật; bấm **Xem dashboard** để mở dashboard toàn màn hình.

Đổi Sandbox ↔ Production sẽ xoá key, token và kết quả đang có.

---

## Tuỳ chọn: deploy lên server (PM2 + Nginx)

```bash
npm ci --omit=dev
cp .env.example .env      # đặt PUBLIC_BASE_URL=https://<domain-của-bạn>, PORT, TRUST_PROXY_HOPS
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
```

Cập nhật code: `git pull && npm ci --omit=dev && pm2 reload demo-api-transaction`.
Sau khi deploy, khai báo `<PUBLIC_BASE_URL>/casso/callback` và `<PUBLIC_BASE_URL>/casso/webhook` trên credential (như mục 3).

<details>
<summary>Chạy dưới sub-path sau Nginx (VD <code>/demo-api-transaction/</code>)</summary>

Frontend dùng đường dẫn tương đối nên chỉ cần Nginx bỏ prefix. `.env`: `PUBLIC_BASE_URL=https://<domain>/demo-api-transaction`, `TRUST_PROXY_HOPS=1`.

```nginx
location = /demo-api-transaction {
    return 301 /demo-api-transaction/;
}

location ^~ /demo-api-transaction/ {
    # App tự gửi header bảo mật (CSP, frame-ancestors…); đừng ghi đè ở đây.
    add_header X-Content-Type-Options nosniff always;

    proxy_pass         http://localhost:3030/;
    proxy_set_header   Host              $host;
    proxy_set_header   X-Real-IP         $remote_addr;
    proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
    proxy_read_timeout 60s;
}
```

</details>

---

## Biến môi trường (`.env`, tuỳ chọn)

Tạo bằng `cp .env.example .env` khi cần đổi mặc định.

| Biến | Mặc định | Dùng cho |
|---|---|---|
| `PORT` | `3030` | cổng server |
| `CASSO_BASE_URL` | `https://api-console.casso.vn` | host API Casso (sandbox và production dùng chung, khác nhau ở credential) |
| `CASSO_TIMEOUT_MS` | `45000` | timeout khi gọi Casso |
| `PUBLIC_BASE_URL` | suy từ URL trang | domain hiển thị cho Redirect/Webhook URL — nên đặt khi deploy |
| `TRUST_PROXY_HOPS` | `1` | số reverse proxy phía trước (ngrok/nginx) được tin `X-Forwarded-*` |
| `RATE_LIMIT_PER_MIN` | `300` | số request `/api`, `/casso/*` mỗi IP mỗi phút |
| `GITHUB_URL` | `https://github.com` | nút "Mã nguồn" ở góc phải |
| `NGROK_DOMAIN` | (trống = domain ngẫu nhiên) | domain cho `npm run tunnel` |

## Lỗi thường gặp

| Hiện tượng | Cách xử lý |
|---|---|
| `Không tìm thấy ngrok` khi `npm run tunnel` | Cài ngrok (mục 2 ở trên) và đảm bảo lệnh `ngrok` chạy được trong terminal. |
| Cas Link báo sai Redirect URI / không quay về demo | Kiểm tra đã dán đúng URL ở mục 3 và đang mở demo bằng đúng domain đó (không phải localhost). |
| `401` / sai credential | Kiểm tra Client ID, Secret key và chọn đúng Sandbox/Production. Tạo secret mới trên Console sẽ vô hiệu secret cũ. |
| `SERVICE_NOT_ALLOWED` | Credential chưa được cấp dịch vụ Transactions — bật trong trang credential. |
| Lỗi do chưa có gói | Tổ chức cần mua gói Transactions trên Casso Console (Sandbox có thể dùng thử). |
| `EADDRINUSE` | Cổng đã bị dùng — đổi `PORT` trong `.env`. |
| `429` | Vượt `RATE_LIMIT_PER_MIN` — chờ 1 phút hoặc tăng giới hạn. |

## Ghi chú kỹ thuật

- `state` của Cas Link được server ký HMAC-SHA512 bằng secret key, theo [tài liệu Liên kết tài khoản](https://console.casso.vn/docs/grant/link).
- `/casso/callback` đưa `publicToken` về trang demo. `/casso/webhook` chỉ trả 200 và ghi log (không xác thực chữ ký) — ứng dụng thật cần xác thực chữ ký webhook.
- Khi được host cùng domain với Casso Console, demo có thể tự liệt kê credential của tổ chức đang đăng nhập; nếu không, nhập key thủ công như trên.
- Server tự gửi CSP và các header bảo mật.

## Cấu trúc

```
server.js            proxy /api/* tới Casso Console, /casso/callback, /casso/webhook
public/index.html    Hero (dashboard minh hoạ) → Cách hoạt động → 3 bước kết nối
public/app.js        logic giao diện, gọi API, bảng kê, API console
public/style.css     giao diện theo brand Casso
scripts/tunnel.js    chạy ngrok theo PORT / NGROK_DOMAIN
ecosystem.config.cjs cấu hình PM2
```

## Giấy phép

[MIT](LICENSE)
