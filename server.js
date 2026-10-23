// Demo server: forwards Casso Console proxy API calls with the visitor's own keys and serves the demo UI.
import express from 'express'
import dotenv from 'dotenv'
import crypto from 'crypto'
import path from 'path'
import { fileURLToPath } from 'url'

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const PORT = process.env.PORT || 3030

// Sandbox và Production dùng chung host API; khác nhau ở credential (tổ chức sandbox / thật)
// và ở script widget Cas Link (xem https://console.casso.vn/docs/grant/link).
// Khách luôn tự nhập x-client-id / x-secret-key của họ trên UI — server không giữ credential nào.
const trimUrl = (url) => (url || '').replace(/\/+$/, '')
// Casso đôi khi treo khi ngân hàng chậm — không để trình duyệt chờ vô hạn.
const UPSTREAM_TIMEOUT_MS = Number(process.env.CASSO_TIMEOUT_MS) || 45000
const BASE_URL = trimUrl(process.env.CASSO_BASE_URL) || 'https://api-console.casso.vn'

const ENVIRONMENTS = {
  sandbox: { baseUrl: BASE_URL, widgetPath: '/link/v1/link-initialize.js' },
  production: { baseUrl: BASE_URL, widgetPath: '/link/v1/stable/link-initialize.js' }
}

// Sau ngrok / reverse proxy: chỉ tin đúng số hop proxy khai báo (mặc định 1), không tin mọi X-Forwarded-*.
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 1))
app.disable('x-powered-by')

// Origin của API/widget Casso — cho phép trong CSP (script widget, iframe, fetch của widget).
const CASSO_ORIGINS = [...new Set(Object.values(ENVIRONMENTS).map((e) => new URL(e.baseUrl).origin))]

// Header bảo mật + CSP; trang callback dùng nonce cho script inline của nó.
app.use((req, res, next) => {
  res.locals.nonce = crypto.randomBytes(16).toString('base64')
  const casso = CASSO_ORIGINS.join(' ')
  res.set({
    'Content-Security-Policy': [
      "default-src 'self'",
      `script-src 'self' 'nonce-${res.locals.nonce}' ${casso}`,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: https:",
      `connect-src 'self' ${casso}`,
      `frame-src ${casso}`,
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'"
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Strict-Transport-Security': 'max-age=15552000; includeSubDomains'
  })
  next()
})

// Giới hạn tần suất đơn giản theo IP (in-memory) để server không thành relay mở.
const RATE_WINDOW_MS = 60_000
const RATE_MAX = Number(process.env.RATE_LIMIT_PER_MIN) || 300
const hits = new Map()
setInterval(() => {
  const now = Date.now()
  for (const [ip, h] of hits) if (now - h.start > RATE_WINDOW_MS) hits.delete(ip)
}, RATE_WINDOW_MS).unref()
function rateLimit(req, res, next) {
  const now = Date.now()
  let h = hits.get(req.ip)
  if (!h || now - h.start > RATE_WINDOW_MS) hits.set(req.ip, (h = { start: now, count: 0 }))
  if (++h.count > RATE_MAX) {
    return res.status(429).json({
      ok: false,
      status: 429,
      data: { error: { errorCode: 'DEMO_RATE_LIMITED', errorMessage: 'Quá nhiều request, thử lại sau 1 phút.' } }
    })
  }
  next()
}

// Webhook của Casso có thể mang nhiều giao dịch nên có parser riêng, giới hạn lớn hơn; các route khác chỉ nhận body nhỏ.
const jsonParser = express.json({ limit: '10kb' })
const webhookJsonParser = express.json({ limit: '256kb' })
app.use((req, res, next) => (req.path === '/casso/webhook' ? next() : jsonParser(req, res, next)))
app.use(express.static(path.join(__dirname, 'public')))
app.use(['/api', '/casso/callback', '/casso/webhook'], rateLimit)

function maskKey(key, visibleChars = 4) {
  if (!key) return '(trống)'
  if (key.length <= visibleChars * 2) return '****'
  return `${key.slice(0, visibleChars)}…${key.slice(-visibleChars)}`
}

function getEnv(req) {
  const name = req.headers['x-casso-env'] === 'production' ? 'production' : 'sandbox'
  return { name, ...ENVIRONMENTS[name] }
}

const str = (v) => (typeof v === 'string' ? v : '')

function resolveCredentials(req) {
  return {
    clientId: (req.headers['x-client-id'] || '').trim(),
    secretKey: (req.headers['x-secret-key'] || '').trim()
  }
}

// Gọi thẳng Casso Proxy và trả nguyên status/response về UI, kèm request (đã che secret) để khách xem cấu trúc API.
async function callCasso(req, res, { method, endpoint, query, body, needsToken }) {
  const env = getEnv(req)
  const creds = resolveCredentials(req)
  const accessToken = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim()

  const missing = []
  if (!creds.clientId) missing.push('x-client-id')
  if (!creds.secretKey) missing.push('x-secret-key')
  if (needsToken && !accessToken) missing.push('Authorization (accessToken)')
  if (missing.length) {
    return res.status(400).json({
      ok: false,
      status: 400,
      data: { error: { errorCode: 'DEMO_MISSING_INPUT', errorMessage: `Thiếu ${missing.join(', ')}.` } }
    })
  }

  const qs = query ? new URLSearchParams(Object.entries(query).filter(([, v]) => v)).toString() : ''
  const url = `${env.baseUrl}${endpoint}${qs ? `?${qs}` : ''}`
  const headers = {
    'x-client-id': creds.clientId,
    'x-secret-key': creds.secretKey,
    Accept: 'application/json'
  }
  if (needsToken) headers.Authorization = accessToken
  if (body) headers['Content-Type'] = 'application/json'

  const request = {
    method,
    url,
    headers: {
      ...headers,
      'x-secret-key': maskKey(creds.secretKey),
      ...(needsToken ? { Authorization: maskKey(accessToken, 6) } : {})
    },
    body: body || undefined
  }

  const startedAt = Date.now()
  try {
    const cassoRes = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
    })
    const text = await cassoRes.text()
    let data
    try {
      data = text ? JSON.parse(text) : {}
    } catch {
      data = { raw: text }
    }
    return res.status(cassoRes.status).json({
      ok: cassoRes.ok,
      status: cassoRes.status,
      latencyMs: Date.now() - startedAt,
      environment: env.name,
      request,
      data
    })
  } catch (err) {
    if (err.name === 'TimeoutError') {
      return res.status(504).json({
        ok: false,
        status: 504,
        latencyMs: Date.now() - startedAt,
        environment: env.name,
        request,
        data: { error: { errorCode: 'DEMO_TIMEOUT', errorMessage: `Casso Console không phản hồi sau ${UPSTREAM_TIMEOUT_MS / 1000} giây.` } }
      })
    }
    return res.status(502).json({
      ok: false,
      status: 502,
      latencyMs: Date.now() - startedAt,
      environment: env.name,
      request,
      data: { error: { errorCode: 'DEMO_NETWORK_ERROR', errorMessage: `Không kết nối được tới ${env.baseUrl}: ${err.message}` } }
    })
  }
}

// Domain công khai của demo (ngrok hoặc server thật) — dùng để hiện Redirect URI / Webhook URL cho khách copy.
// Không đặt thì trả null: trình duyệt tự suy từ URL trang (giữ được sub-path như /demo-api-transaction).
const PUBLIC_BASE_URL = trimUrl(process.env.PUBLIC_BASE_URL) || null

// JSON an toàn khi nhúng vào <script> inline: chặn </script> và ký tự xuống dòng JS.
const scriptJson = (value) =>
  JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
const PUBLIC_TOKEN_RE = /^[A-Za-z0-9._~-]{1,512}$/

// Cấu hình công khai cho UI: không bao giờ trả secret key về trình duyệt.
app.get('/api/config', (req, res) => {
  const describe = (env) => ({
    baseUrl: env.baseUrl,
    widgetScriptUrl: `${env.baseUrl}${env.widgetPath}`
  })
  res.json({
    publicBaseUrl: PUBLIC_BASE_URL,
    githubUrl: process.env.GITHUB_URL || 'https://github.com',
    sandbox: describe(ENVIRONMENTS.sandbox),
    production: describe(ENVIRONMENTS.production)
  })
})

app.get('/api/fi-services', (req, res) =>
  callCasso(req, res, { method: 'GET', endpoint: '/proxy/fi-services' })
)

app.post('/api/grant/token', (req, res) =>
  callCasso(req, res, {
    method: 'POST',
    endpoint: '/proxy/grant/token',
    body: { fiServiceId: str(req.body?.fiServiceId) }
  })
)

// state = base64(JSON payload).HMAC-SHA512(hex) ký bằng x-secret-key — phải ký ở server vì cần secret.
app.post('/api/grant/state', (req, res) => {
  const creds = resolveCredentials(req)
  if (!creds.clientId || !creds.secretKey) {
    return res.status(400).json({ ok: false, message: 'Thiếu x-client-id / x-secret-key để ký state.' })
  }
  const payload = { clientId: creds.clientId, nonce: crypto.randomUUID(), issuedAt: new Date().toISOString() }
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64')
  const signature = crypto.createHmac('sha512', creds.secretKey).update(payloadB64).digest('hex')
  res.json({ ok: true, state: `${payloadB64}.${signature}`, payload })
})

app.post('/api/grant/exchange', (req, res) =>
  callCasso(req, res, {
    method: 'POST',
    endpoint: '/proxy/grant/exchange',
    body: { publicToken: str(req.body?.publicToken) }
  })
)

app.post('/api/grant/claim', (req, res) =>
  callCasso(req, res, {
    method: 'POST',
    endpoint: '/proxy/grant/claim',
    body: { link_ids: [str(req.body?.linkId)].filter(Boolean) }
  })
)

app.get('/api/identity', (req, res) =>
  callCasso(req, res, { method: 'GET', endpoint: '/proxy/identity', needsToken: true })
)

app.get('/api/transactions', (req, res) =>
  callCasso(req, res, {
    method: 'GET',
    endpoint: '/proxy/transactions',
    needsToken: true,
    // Query lặp (?a=1&a=2) thành mảng — chỉ nhận chuỗi.
    query: {
      fromDate: str(req.query.fromDate),
      toDate: str(req.query.toDate),
      accountNumber: str(req.query.accountNumber).replace(/\s+/g, '')
    }
  })
)

// Authorized Redirect URI: Casso chuyển trình duyệt về đây kèm ?publicToken=&state= (chế độ chuyển trang).
// Trả publicToken về trang demo để bước "Lấy accessToken" (grant/exchange) chạy bằng key của khách.
app.get('/casso/callback', (req, res) => {
  // Widget iframe có thể nạp Redirect URI bên trong iframe của Casso — cho phép đúng các origin đó nhúng trang này.
  res.set('Content-Security-Policy', res.get('Content-Security-Policy').replace("frame-ancestors 'none'", `frame-ancestors 'self' ${CASSO_ORIGINS.join(' ')}`))
  res.removeHeader('X-Frame-Options')
  const raw = String(req.query.publicToken || '')
  const publicToken = PUBLIC_TOKEN_RE.test(raw) ? raw : ''
  // Đường dẫn tương đối để chạy được cả ở gốc domain lẫn dưới sub-path (VD /demo-api-transaction/).
  const target = `../?publicToken=${encodeURIComponent(publicToken)}#step1`
  res.type('html').send(`<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><title>Đang hoàn tất liên kết…</title></head>
<body style="font-family:system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0;color:#1d2939">
  <p>${publicToken ? 'Liên kết thành công — đang quay lại trang demo…' : 'Không nhận được publicToken.'}</p>
  <script nonce="${res.locals.nonce}">
    (function () {
      var payload = ${scriptJson({ type: 'casso:public-token', publicToken })};
      // Chế độ popup → window.opener; chế độ iframe (widget nạp Redirect URI trong iframe) → window.parent.
      var target = window.opener || (window.parent !== window ? window.parent : null);
      if (target && payload.publicToken) {
        target.postMessage(payload, window.location.origin);
        if (window.opener) window.close();
        return;
      }
      window.location.replace(${scriptJson(target)});
    })();
  </script>
</body></html>`)
})

// Authorized Webhook URL: body hợp lệ thì trả 200 ngay (non-2xx khiến Casso retry) rồi chỉ ghi log — không lưu, không xử lý.
// Không xác thực chữ ký: endpoint công khai, nội dung chỉ để hiển thị log. Bị giới hạn tần suất theo IP (429);
// body hỏng / quá lớn trả 400 / 413 qua error handler bên dưới.
app.post('/casso/webhook', webhookJsonParser, (req, res) => {
  res.status(200).json({ received: true })
  // Body không xác thực: chỉ ghi giá trị đã ép chuỗi, cắt ngắn, bỏ ký tự điều khiển (chống giả mạo dòng log).
  const clean = (v) => String(v ?? '-').replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 80)
  console.log(`[webhook] ${new Date().toISOString()} ${clean(req.body?.webhookCode)} grant=${clean(req.body?.grantId)}`)
})

// Lỗi chung (body quá lớn, JSON hỏng…): trả JSON gọn, không lộ stack trace.
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500
  if (res.headersSent) return next(err)
  if (status >= 500) console.error(`[error] ${req.method} ${req.path} ${status} ${String(err.message).replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 200)}`)
  res.status(status).json({
    ok: false,
    status,
    data: { error: { errorCode: 'DEMO_BAD_REQUEST', errorMessage: status === 413 ? 'Request quá lớn.' : 'Request không hợp lệ.' } }
  })
})

// Chỉ nghe localhost: mọi truy cập đi qua nginx, không ai vào thẳng cổng để giả X-Forwarded-For.
app.listen(PORT, '127.0.0.1', () => {
  console.log('=======================================================')
  console.log(`🚀 Casso Transaction Demo: http://localhost:${PORT}`)
  for (const [name, env] of Object.entries(ENVIRONMENTS)) {
    console.log(`   ${name.padEnd(10)} ${env.baseUrl}`)
  }
  console.log('=======================================================')
})
