// Casso Console Open API demo.
// Hero: dashboard tương tác đầy đủ (dữ liệu minh hoạ, luôn gắn nhãn) → Cách hoạt động →
// 3 bước với dữ liệu thật: (1) liên kết tài khoản lấy accessToken (link_id hoặc iframe Cas Link)
// → (2) gọi API giao dịch → (3) bảng kê, rồi mở dashboard dữ liệu thật.
// Dữ liệu thật đi thẳng từ Casso Console qua server.js; không lưu database.

const SANDBOX_TEST_ACCOUNTS = [
  { service: 'Ngân hàng', username: 'bankusrdemo-c2', password: '1', otp: '123456' }
]

// Gợi ý cách xử lý cho từng errorCode (theo https://console.casso.vn/docs/error).
const ERROR_HINTS = {
  MISSING_CREDENTIALS: 'Thiếu header x-client-id / x-secret-key.',
  INVALID_CREDENTIALS: 'Client ID không tồn tại hoặc secret key không khớp. Kiểm tra lại, và chắc chắn key thuộc đúng môi trường (sandbox / production).',
  BAD_REQUEST: 'Dữ liệu gửi lên không hợp lệ. Xem trường detail.',
  PERMISSION_DENIED: 'Gói dịch vụ hiện tại không hỗ trợ tính năng này.',
  QUOTA_EXCEEDED: 'Vượt giới hạn sử dụng của gói dịch vụ.',
  TOO_MANY_REQUESTS: 'Gửi quá nhiều request trong thời gian ngắn. Đợi một lát rồi thử lại.',
  INTERNAL_ERROR: 'Lỗi phía Casso Console khi gọi tới ngân hàng. Thử lại sau.',
  FI_SERVICE_ID_REQUIRED: 'Thiếu fiServiceId. Chọn một ngân hàng từ danh sách.',
  FI_SERVICE_NOT_SUPPORTED: 'fiServiceId không nằm trong danh sách GET /proxy/fi-services.',
  CONNECTION_LIMIT_REACHED: 'Đã đạt giới hạn số kết nối của gói dịch vụ.',
  ORG_MISMATCH: 'Tài khoản ngân hàng không thuộc về tổ chức của bạn — kết nối đã bị huỷ.',
  IDENTITY_REQUIRED: 'Cần gọi GET /proxy/identity để xác thực tài khoản trước khi tra cứu giao dịch.',
  INVALID_GRANT: 'accessToken không khớp với kết nối nào. Token có thể thuộc key khác hoặc môi trường khác.',
  LOOKBACK_EXCEEDED: 'Ngày bắt đầu sớm hơn giới hạn tra cứu của gói dịch vụ. Chọn khoảng ngày gần hơn.',
  NOT_FOUND: 'link_id không tồn tại, hoặc không thuộc tổ chức của key này.',
  LIMIT_REACHED: 'Đã chạm hạn mức bản ghi trong năm — một số giao dịch đã bị lược bỏ.',
  IDENTITY_NOT_VERIFIED: 'Một số tài khoản chưa xác thực xong tổ chức. Dữ liệu vẫn đầy đủ; gọi lại identity sau.',
  DEMO_MISSING_INPUT: 'Điền đủ các trường bắt buộc rồi gọi lại.',
  DEMO_NETWORK_ERROR: 'Server demo không kết nối được tới Casso Console.',
  RATE_LIMIT: 'Kết nối này vừa bị gọi quá nhiều lần. Đợi 1–2 phút rồi thử lại.',
  DEMO_TIMEOUT: 'Casso Console đang phản hồi chậm (thường do ngân hàng). Thử lại sau, hoặc chọn khoảng ngày ngắn hơn.'
}

const state = {
  config: null,
  env: sessionGet('casso_env') || 'sandbox',
  method: 'claim',
  cred: { clientId: '', secretKey: '' },
  fiServices: [],
  bankType: 'ENTERPRISE',
  selectedBank: null,
  grantToken: null,
  publicToken: null,
  accessToken: '',
  accounts: [],
  results: {},
  activeCall: {},
  real: null, // { transactions, accounts, query } sau khi gọi API thành công
  heroSource: 'sample',
  widgetScriptUrl: null
}

// Mỗi API call gắn với một panel "API console" bên phải bước tương ứng.
const CALLS = {
  claim: {
    panel: 'apiClaim', label: 'grant/claim', method: 'POST', path: '/proxy/grant/claim',
    body: () => ({ link_ids: [val('claimLinkId') || '<link_id>'] })
  },
  fiServices: { panel: 'apiWidget', label: 'fi-services', method: 'GET', path: '/proxy/fi-services' },
  grantToken: {
    panel: 'apiWidget', label: 'grant/token', method: 'POST', path: '/proxy/grant/token',
    body: () => ({ fiServiceId: state.selectedBank?.fi_service_id || '<fiServiceId>' })
  },
  exchange: {
    panel: 'apiWidget', label: 'grant/exchange', method: 'POST', path: '/proxy/grant/exchange',
    body: () => ({ publicToken: state.publicToken || '<publicToken>' })
  },
  identity: { panel: 'apiTx', label: 'identity', method: 'GET', path: '/proxy/identity', token: true },
  transactions: {
    panel: 'apiTx', label: 'transactions', method: 'GET', path: '/proxy/transactions', token: true,
    query: () => txQuery()
  }
}
const PANELS = {
  apiClaim: ['claim'],
  apiWidget: ['fiServices', 'grantToken', 'exchange'],
  apiTx: ['transactions', 'identity']
}

const ICONS = {
  search: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
  filter: '<svg class="ic ic-sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M22 3H2l8 9.5V19l4 2v-8.5L22 3z"/></svg>',
  download: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>',
  check: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>',
  alert: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>'
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------
const $ = (id) => document.getElementById(id)
const val = (id) => ($(id)?.value || '').trim()

function sessionGet(key) {
  try { return sessionStorage.getItem(key) } catch { return null }
}
function sessionSet(key, value) {
  try { sessionStorage.setItem(key, value) } catch { /* bỏ qua khi trình duyệt chặn storage */ }
}

/** Only https: image URLs from upstream bank data. */
function httpsUrl(value) {
  try {
    const u = new URL(String(value ?? ''))
    return u.protocol === 'https:' ? u.href : ''
  } catch {
    return ''
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

function toast(message, kind = 'info') {
  const el = $('toast')
  el.textContent = message
  el.dataset.kind = kind
  el.classList.add('show')
  clearTimeout(toast.timer)
  toast.timer = setTimeout(() => el.classList.remove('show'), 3200)
}

async function copyText(text, label) {
  try {
    await navigator.clipboard.writeText(text)
    toast(`Đã copy ${label}`, 'success')
  } catch {
    toast('Trình duyệt chặn clipboard — hãy copy thủ công', 'error')
  }
}

function isoDate(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 10)
}

function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + days)
  return isoDate(d)
}

// Chỉ giữ chữ số và '-' vì kết quả được chèn vào HTML (ngày lấy từ API/input).
function viDate(iso) {
  return iso ? String(iso).replace(/[^0-9-]/g, '').split('-').reverse().join('/') : ''
}

function formatVnd(amount, { sign = false } = {}) {
  const abs = new Intl.NumberFormat('vi-VN').format(Math.abs(Math.round(amount)))
  const prefix = amount < 0 ? '−' : sign && amount > 0 ? '+' : ''
  return `${prefix}${abs} đ`
}

function formatCompact(amount) {
  const abs = Math.abs(amount)
  const fmt = (n) => n.toLocaleString('vi-VN', { maximumFractionDigits: 1 })
  let text
  if (abs >= 1e9) text = `${fmt(abs / 1e9)} tỷ`
  else if (abs >= 1e6) text = `${fmt(abs / 1e6)} tr`
  else if (abs >= 1e3) text = `${fmt(abs / 1e3)}k`
  else text = fmt(abs)
  return `${amount < 0 ? '−' : ''}${text}`
}

function formatDateTime(tx) {
  const raw = tx.transactionDateTime || tx.transactionDate
  if (!raw) return '—'
  const [d, t] = raw.split('T')
  return `${viDate(d)}${t ? ` ${t.slice(0, 5)}` : ''}`
}

// Doc mô tả lỗi dạng { error: {...} }, nhưng một số lỗi (VD: 429 RATE_LIMIT) trả errorCode ở cấp ngoài cùng.
function errorOf(payload) {
  const data = payload?.data
  if (data?.error && typeof data.error === 'object') return data.error
  return data?.errorCode ? data : null
}

function envConfig() {
  return state.config?.[state.env] || {}
}

function envLabel() {
  return state.env === 'sandbox' ? 'Sandbox' : 'Production'
}

function apiHeaders(withToken, token) {
  const headers = { 'x-casso-env': state.env }
  if (state.cred.clientId) headers['x-client-id'] = state.cred.clientId
  if (state.cred.secretKey) headers['x-secret-key'] = state.cred.secretKey
  if (withToken) headers.Authorization = token
  return headers
}

const MISSING_KEYS = { ok: false, status: 0, missingKeys: true, data: { error: { errorCode: 'DEMO_MISSING_INPUT', errorMessage: 'Thiếu x-client-id / x-secret-key.' } } }

async function api(path, { method = 'GET', body, token } = {}) {
  if (!state.cred.clientId || !state.cred.secretKey) {
    toast('Nhập Client ID và Client secret trước', 'error')
    document.querySelector('.step-body:not([hidden]) [data-cred="clientId"]')?.focus()
    return MISSING_KEYS
  }
  const headers = apiHeaders(token !== undefined, token)
  if (body) headers['Content-Type'] = 'application/json'
  try {
    const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined })
    return await res.json()
  } catch (err) {
    return { ok: false, status: 0, data: { error: { errorCode: 'DEMO_NETWORK_ERROR', errorMessage: err.message } } }
  }
}

function setBusy(button, busy, busyText = 'Đang gọi…') {
  if (!button) return
  if (busy) {
    button.dataset.label = button.innerHTML
    button.textContent = busyText
    button.disabled = true
    button.setAttribute('aria-busy', 'true')
  } else {
    button.innerHTML = button.dataset.label || button.innerHTML
    button.disabled = false
    button.removeAttribute('aria-busy')
  }
}

function showResult(id, kind, html) {
  const el = $(id)
  el.hidden = false
  el.className = `inline-result ${kind}`
  el.innerHTML = html
}

function errorLine(payload) {
  const err = errorOf(payload)
  const code = err?.errorCode || payload.status
  const byStatus = { 401: 'INVALID_CREDENTIALS', 429: 'TOO_MANY_REQUESTS', 502: 'INTERNAL_ERROR', 504: 'DEMO_TIMEOUT' }[payload.status]
  const hint = ERROR_HINTS[err?.errorCode] || err?.errorMessage || ERROR_HINTS[byStatus] || ''
  // detail của backend nói rõ phần nào sai (VD ngày sớm nhất được phép khi LOOKBACK_EXCEEDED).
  const detail = typeof err?.detail === 'string' ? `<br><span class="muted">${escapeHtml(err.detail)}</span>` : ''
  return `${ICONS.alert}<span><b>Lỗi ${escapeHtml(code)}</b>${hint ? ` — ${escapeHtml(hint)}` : ''}${detail}</span>`
}

// ------------------------------------------------------------------
// Dữ liệu minh hoạ (chỉ cho hero, luôn gắn nhãn)
// ------------------------------------------------------------------
function seededRandom(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function buildSampleDataset() {
  const rand = seededRandom(20261008)
  const pick = (list) => list[Math.floor(rand() * list.length)]
  const between = (min, max, step = 1000) => Math.round((min + rand() * (max - min)) / step) * step
  const accounts = [
    { accountNumber: '0071001234567', accountName: 'CONG TY TNHH MAU', balance: 1284500000 },
    { accountNumber: '19035678901234', accountName: 'CONG TY TNHH MAU', balance: 356200000 }
  ]
  const to = new Date()
  const from = new Date()
  from.setDate(to.getDate() - 44)
  const transactions = []
  let order = 1024
  let ref = 260100

  const add = (date, hour, account, amount, description) => {
    const day = isoDate(date)
    const time = `${String(hour).padStart(2, '0')}:${String(Math.floor(rand() * 60)).padStart(2, '0')}:00`
    transactions.push({
      accountNumber: account, transactionDate: day, transactionDateTime: `${day}T${time}+07:00`,
      amount, reference: `FT${ref++}`, description
    })
  }

  for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
    const dom = d.getDate()
    const orders = 1 + Math.floor(rand() * 3)
    for (let i = 0; i < orders; i++) {
      add(d, 8 + Math.floor(rand() * 11), accounts[0].accountNumber, between(1500000, 28000000),
        `${pick(['NGUYEN VAN AN', 'TRAN THI BINH', 'CTY CP AN PHAT', 'LE HOANG NAM', 'CTY TNHH MINH KHOA'])} CHUYEN TIEN DH${order++}`)
    }
    if (rand() < 0.3) add(d, 10, accounts[0].accountNumber, -between(5000000, 42000000), `THANH TOAN NCC ${pick(['BAO BI SAO MAI', 'VAN TAI HOA BINH', 'IN AN TIEN PHONG'])}`)
    if (rand() < 0.25) add(d, 23, accounts[0].accountNumber, -11000, 'PHI SMS BANKING')
    if (rand() < 0.12) add(d, 15, accounts[0].accountNumber, -between(800000, 6000000), `TIEP KHACH ${pick(['DOI TAC', 'KHACH HANG'])} ${pick(['AN TRUA', 'CAFE', 'HOP MAT'])}`)
    if (dom === 5) add(d, 9, accounts[1].accountNumber, -186000000, 'CHUYEN LUONG NHAN VIEN THANG')
    if (dom === 20) add(d, 14, accounts[1].accountNumber, -42500000, 'NOP THUE GTGT NSNN')
    if (dom === 25) add(d, 0, accounts[1].accountNumber, 352000, 'INTEREST PAYMENT')
    if (dom === 15) add(d, 11, accounts[1].accountNumber, 120000000, 'CTY CP AN PHAT THANH TOAN HOP DONG HD2026')
  }
  return { transactions, accounts, query: { fromDate: isoDate(from), toDate: isoDate(to) }, isSample: true }
}

// ------------------------------------------------------------------
// Phân loại (quy tắc minh hoạ — doanh nghiệp tự định nghĩa bộ quy tắc của riêng họ)
// ------------------------------------------------------------------
const CATEGORY_RULES = [
  { name: 'Lãi tiền gửi', test: /\b(interest|lai tien gui|tra lai|lai nhap goc)\b/ },
  { name: 'Phí ngân hàng', test: /\b(phi sms|sms banking|fee|charge|phi dich vu|phi chuyen|vat phi)\b/ },
  { name: 'Lương & nhân sự', test: /\b(luong|salary|thuong|bhxh)\b/ },
  { name: 'Thuế & nhà nước', test: /\b(thue|tax|nsnn|kbnn|ngan sach)\b/ },
  { name: 'Nhà cung cấp', test: /\b(ncc|nha cung cap)\b/ },
  { name: 'Tiếp khách & sự kiện', test: /\b(tiep khach|an trua|happy hour|cafe|tiec|su kien)\b/ },
  { name: 'Thanh toán đơn hàng', test: /\b(dh|don hang|order|hd|invoice|inv)[\s\-_#:]*\d{3,}/ }
]
const UNCATEGORIZED = ['Thu khác', 'Chi khác']
const ORDER_CODE = /\b(DH|ORDER|INV|HD)[\s\-_#:]*\d{3,}\b/i

function plain(text) {
  return (text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase()
}

function categorize(tx) {
  const text = plain(`${tx.description} ${tx.reference}`)
  const rule = CATEGORY_RULES.find((r) => r.test.test(text))
  if (rule) return rule.name
  return Number(tx.amount) >= 0 ? UNCATEGORIZED[0] : UNCATEGORIZED[1]
}

function normalize(dataset) {
  return dataset.transactions.map((tx) => ({
    ...tx,
    description: tx.description || '',
    reference: tx.reference || '',
    amount: Number(tx.amount) || 0,
    day: tx.transactionDate || (tx.transactionDateTime || '').slice(0, 10),
    sortKey: tx.transactionDateTime || tx.transactionDate || '',
    category: categorize(tx)
  }))
}

// ------------------------------------------------------------------
// Ledger: bảng kê + dashboard dùng chung (hero, bước 3, dashboard dữ liệu thật)
// ------------------------------------------------------------------
const TIME_FILTERS = [
  { key: 'all', label: 'Toàn kỳ' },
  { key: '7d', label: '7 ngày gần nhất' },
  { key: 'month', label: 'Tháng gần nhất' }
]

function createLedger(root, { mode }) {
  const L = { root, mode, dataset: null, txs: [] }
  const dashboard = mode === 'dashboard'

  function resetFilters() {
    L.f = { quick: 'all', account: 'all', dir: 'all', category: 'all', time: 'all', search: '', col: { time: '', account: '', desc: '', ref: '', cat: '' } }
  }
  resetFilters()

  L.setData = (dataset) => {
    L.dataset = dataset
    L.txs = normalize(dataset)
    resetFilters()
    renderShell()
    renderData()
  }

  function range() {
    const { fromDate, toDate } = L.dataset.query
    if (L.f.time === '7d') {
      const start = addDays(toDate, -6)
      return { from: start > fromDate ? start : fromDate, to: toDate }
    }
    if (L.f.time === 'month') {
      const start = `${toDate.slice(0, 7)}-01`
      return { from: start > fromDate ? start : fromDate, to: toDate }
    }
    return { from: fromDate, to: toDate }
  }

  // Lọc theo sidebar, bỏ qua một nhóm để đếm số lượng cho chính nhóm đó.
  function sideFiltered(except) {
    const f = L.f
    const r = range()
    return L.txs.filter((t) => {
      if (except !== 'quick' && f.quick === 'uncat' && !UNCATEGORIZED.includes(t.category)) return false
      if (except !== 'account' && f.account !== 'all' && t.accountNumber !== f.account) return false
      if (except !== 'dir' && f.dir === 'in' && t.amount < 0) return false
      if (except !== 'dir' && f.dir === 'out' && t.amount >= 0) return false
      if (except !== 'category' && f.category !== 'all' && t.category !== f.category) return false
      if (except !== 'time' && (t.day < r.from || t.day > r.to)) return false
      return true
    })
  }

  function rows() {
    const q = plain(L.f.search)
    const c = L.f.col
    const has = (value, needle) => !needle || plain(value).includes(plain(needle))
    return sideFiltered()
      .filter((t) => !q || plain(`${t.description} ${t.reference} ${t.category} ${t.accountNumber}`).includes(q))
      .filter((t) => has(formatDateTime(t), c.time) && has(t.accountNumber, c.account) && has(t.description, c.desc) && has(t.reference, c.ref) && has(t.category, c.cat))
      .sort((a, b) => b.sortKey.localeCompare(a.sortKey))
  }

  function accountName(number) {
    return L.dataset.accounts.find((a) => a.accountNumber === number)?.accountName || ''
  }

  function sideOption(group, key, label, count) {
    const active = L.f[group] === key
    return `<button class="side-opt ${active ? 'active' : ''}" data-lf="${group}" data-v="${escapeHtml(key)}" aria-pressed="${active}">
      <span class="side-radio" aria-hidden="true"></span><span class="side-label" title="${escapeHtml(label)}">${escapeHtml(label)}</span>${count != null ? `<span class="side-count">${count}</span>` : ''}</button>`
  }

  function renderSide() {
    const byAcc = sideFiltered('account')
    const byDir = sideFiltered('dir')
    const byCat = sideFiltered('category')
    const accounts = [...new Set(L.txs.map((t) => t.accountNumber).filter(Boolean))]
    const cats = [...new Set(L.txs.map((t) => t.category))].sort()
    const count = (list, fn) => list.filter(fn).length
    const { fromDate, toDate } = L.dataset.query

    root.querySelector('[data-part="side"]').innerHTML = `
      <div class="side-tabs">
        <button class="side-tab ${L.f.quick === 'all' ? 'active' : ''}" data-lf="quick" data-v="all">Tất cả giao dịch</button>
        <button class="side-tab ${L.f.quick === 'uncat' ? 'active' : ''}" data-lf="quick" data-v="uncat">Chưa phân loại</button>
      </div>
      <div class="side-group">
        <div class="side-title">Tài khoản</div>
        ${sideOption('account', 'all', 'Tất cả tài khoản', byAcc.length)}
        ${accounts.map((a) => sideOption('account', a, `${a}${accountName(a) ? ` · ${accountName(a)}` : ''}`, count(byAcc, (t) => t.accountNumber === a))).join('')}
      </div>
      <div class="side-group">
        <div class="side-title">Loại</div>
        ${sideOption('dir', 'all', 'Tất cả', byDir.length)}
        ${sideOption('dir', 'in', 'Tiền vào', count(byDir, (t) => t.amount >= 0))}
        ${sideOption('dir', 'out', 'Tiền ra', count(byDir, (t) => t.amount < 0))}
      </div>
      <div class="side-group">
        <div class="side-title">Danh mục</div>
        ${sideOption('category', 'all', 'Tất cả danh mục', byCat.length)}
        ${cats.map((c) => sideOption('category', c, c, count(byCat, (t) => t.category === c))).join('')}
      </div>
      <div class="side-group">
        <div class="side-title">Thời gian</div>
        ${TIME_FILTERS.map((tf) => sideOption('time', tf.key, tf.label, null)).join('')}
        <div class="side-range">${viDate(fromDate)} → ${viDate(toDate)}</div>
      </div>`
  }

  function renderShell() {
    root.innerHTML = `
      <div class="ledger ${dashboard ? 'ledger-dash' : 'ledger-statement'}">
        <aside class="ledger-side" data-part="side" aria-label="Bộ lọc"></aside>
        <div class="ledger-main">
          <div class="ledger-toolbar">
            <label class="search-box">${ICONS.search}<input type="search" data-lsearch placeholder="Tìm theo mô tả, mã tham chiếu, tài khoản…" aria-label="Tìm giao dịch"></label>
            <span class="toolbar-meta" data-part="meta"></span>
            <button class="btn btn-ghost btn-sm" data-lexport>${ICONS.download}Xuất CSV</button>
          </div>
          ${dashboard ? `
            <div class="kpi-row" data-part="kpi"></div>
            <div class="card chart-card">
              <div class="card-head">
                <div><h3>Dòng tiền theo <span data-part="grain">ngày</span></h3>
                  <p class="muted">Tiền vào hướng lên, tiền ra hướng xuống. Rê chuột để xem chi tiết.</p></div>
                <div class="legend"><span><i class="sw sw-in"></i>Tiền vào</span><span><i class="sw sw-out"></i>Tiền ra</span></div>
              </div>
              <div class="chart-wrap"><svg data-part="chart" role="img" aria-label="Biểu đồ dòng tiền vào và ra"></svg><div class="chart-tip" hidden></div></div>
            </div>
            <div class="insight-grid" data-part="insights"></div>` : ''}
          <div class="sheet">
            <div class="sheet-scroll">
              <table class="sheet-table">
                <thead>
                  <tr>
                    <th class="col-time">Ngày diễn ra</th>
                    <th class="col-acc">Tài khoản</th>
                    <th>Mô tả</th>
                    <th class="col-ref">Mã tham chiếu</th>
                    <th class="col-type">Loại</th>
                    <th class="col-cat">Danh mục</th>
                    <th class="num col-amt">Giá trị</th>
                  </tr>
                  <tr class="filter-row">
                    <th><label class="col-filter">${ICONS.filter}<input data-lcol="time" placeholder="dd/mm" aria-label="Lọc ngày"></label></th>
                    <th><label class="col-filter">${ICONS.filter}<input data-lcol="account" aria-label="Lọc tài khoản"></label></th>
                    <th><label class="col-filter">${ICONS.filter}<input data-lcol="desc" aria-label="Lọc mô tả"></label></th>
                    <th><label class="col-filter">${ICONS.filter}<input data-lcol="ref" aria-label="Lọc mã tham chiếu"></label></th>
                    <th></th>
                    <th><label class="col-filter">${ICONS.filter}<input data-lcol="cat" aria-label="Lọc danh mục"></label></th>
                    <th></th>
                  </tr>
                </thead>
                <tbody data-part="tbody"></tbody>
                <tfoot><tr><td colspan="6" data-part="footLabel"></td><td class="num" data-part="footTotal"></td></tr></tfoot>
              </table>
            </div>
          </div>
        </div>
      </div>`
    renderSide()
  }

  function renderData() {
    const list = rows()
    const limit = 300
    root.querySelector('[data-part="tbody"]').innerHTML = list.length
      ? list.slice(0, limit).map((t) => `
        <tr>
          <td class="nowrap">${escapeHtml(formatDateTime(t))}</td>
          <td class="nowrap mono">${escapeHtml(t.accountNumber || '—')}</td>
          <td class="desc" title="${escapeHtml(t.description)}">${escapeHtml(t.description || '—')}</td>
          <td class="mono nowrap">${escapeHtml(t.reference || '—')}</td>
          <td class="nowrap">${t.amount >= 0 ? 'Tiền vào' : 'Tiền ra'}</td>
          <td><span class="cat-tag ${UNCATEGORIZED.includes(t.category) ? 'uncat' : ''}">${escapeHtml(t.category)}</span></td>
          <td class="num ${t.amount >= 0 ? 'pos' : 'neg'}">${formatVnd(t.amount, { sign: true })}</td>
        </tr>`).join('')
      : '<tr><td colspan="7" class="empty-row">Không có giao dịch phù hợp bộ lọc.</td></tr>'
    const total = list.reduce((s, t) => s + t.amount, 0)
    root.querySelector('[data-part="footLabel"]').textContent = `Tổng (${list.length.toLocaleString('vi-VN')} bản ghi)${list.length > limit ? ` · hiển thị ${limit} dòng mới nhất` : ''}`
    const foot = root.querySelector('[data-part="footTotal"]')
    foot.textContent = formatVnd(total, { sign: true })
    foot.className = `num ${total >= 0 ? 'pos' : 'neg'}`
    root.querySelector('[data-part="meta"]').textContent = `${list.length.toLocaleString('vi-VN')} / ${L.txs.length.toLocaleString('vi-VN')} giao dịch`

    if (dashboard) {
      renderKpis(root, L.dataset, list)
      renderChart(root, list, range())
      renderInsights(root, L.dataset, list)
    }
  }
  L.redrawChart = () => { if (dashboard && L.dataset) renderChart(root, rows(), range()) }

  L.exportCsv = () => {
    const list = rows()
    const header = ['transactionDateTime', 'accountNumber', 'description', 'reference', 'type', 'category', 'amount']
    // Chống CSV/formula injection: ô chuỗi bắt đầu bằng = + - @ tab CR được thêm dấu ' phía trước (số thật giữ nguyên).
    const csvCell = (v) => {
      let s = String(v ?? '')
      if (typeof v !== 'number' && /^[=+\-@\t\r]/.test(s) && !/^[-+]?\d+(\.\d+)?$/.test(s)) s = `'${s}`
      return `"${s.replace(/"/g, '""')}"`
    }
    const lines = [header.join(',')].concat(list.map((t) => [
      t.transactionDateTime || t.transactionDate, t.accountNumber, t.description, t.reference, t.amount >= 0 ? 'Tiền vào' : 'Tiền ra', t.category, t.amount
    ].map(csvCell).join(',')))
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `casso-${L.dataset.isSample ? 'minh-hoa' : 'giao-dich'}_${L.dataset.query.fromDate}_${L.dataset.query.toDate}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
    toast(`Đã xuất ${list.length} giao dịch`, 'success')
  }

  root.addEventListener('click', (e) => {
    const t = e.target.closest('button')
    if (!t || !L.dataset) return
    if (t.dataset.lf) {
      L.f[t.dataset.lf] = t.dataset.v
      renderSide()
      renderData()
    } else if (t.dataset.lexport !== undefined) {
      L.exportCsv()
    }
  })
  root.addEventListener('input', (e) => {
    if (!L.dataset) return
    if (e.target.dataset.lsearch !== undefined) L.f.search = e.target.value
    else if (e.target.dataset.lcol) L.f.col[e.target.dataset.lcol] = e.target.value
    else return
    renderData()
  })
  return L
}

function renderKpis(root, dataset, txs) {
  const ins = txs.filter((t) => t.amount >= 0)
  const outs = txs.filter((t) => t.amount < 0)
  const sumIn = ins.reduce((s, t) => s + t.amount, 0)
  const sumOut = outs.reduce((s, t) => s + t.amount, 0)
  const net = sumIn + sumOut
  const hasBalance = dataset.accounts.some((a) => a.balance != null)
  const balance = dataset.accounts.reduce((s, a) => (a.balance != null ? s + Number(a.balance) : s), 0)

  root.querySelector('[data-part="kpi"]').innerHTML = `
    <div class="kpi kpi-hero">
      <span class="kpi-label">Dòng tiền ròng</span>
      <span class="kpi-value ${net >= 0 ? 'pos' : 'neg'}">${formatVnd(net, { sign: true })}</span>
      <span class="kpi-sub">${net >= 0 ? '▲ Thu nhiều hơn chi' : '▼ Chi nhiều hơn thu'} · theo bộ lọc</span>
    </div>
    <div class="kpi">
      <span class="kpi-label"><i class="sw sw-in"></i>Tiền vào</span>
      <span class="kpi-value">${formatVnd(sumIn)}</span>
      <span class="kpi-sub">${ins.length.toLocaleString('vi-VN')} giao dịch</span>
    </div>
    <div class="kpi">
      <span class="kpi-label"><i class="sw sw-out"></i>Tiền ra</span>
      <span class="kpi-value">${formatVnd(sumOut)}</span>
      <span class="kpi-sub">${outs.length.toLocaleString('vi-VN')} giao dịch</span>
    </div>
    <div class="kpi">
      <span class="kpi-label">${hasBalance ? 'Số dư hiện tại' : 'Số tài khoản'}</span>
      <span class="kpi-value">${hasBalance ? formatVnd(balance) : dataset.accounts.length}</span>
      <span class="kpi-sub">${dataset.accounts.length || '—'} tài khoản trên kết nối</span>
    </div>`
}

function buildBuckets(txs, r) {
  const days = Math.round((new Date(`${r.to}T00:00:00`) - new Date(`${r.from}T00:00:00`)) / 86400000) + 1
  const monthly = days > 62
  const buckets = new Map()
  for (let d = r.from; d <= r.to; d = addDays(d, 1)) {
    const key = monthly ? d.slice(0, 7) : d
    if (!buckets.has(key)) buckets.set(key, { key, in: 0, out: 0, count: 0 })
  }
  txs.forEach((t) => {
    const key = monthly ? t.day.slice(0, 7) : t.day
    if (!buckets.has(key)) buckets.set(key, { key, in: 0, out: 0, count: 0 })
    const b = buckets.get(key)
    if (t.amount >= 0) b.in += t.amount
    else b.out += t.amount
    b.count++
  })
  return { monthly, list: [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key)) }
}

function niceStep(rangeValue) {
  const raw = rangeValue / 4
  const pow = 10 ** Math.floor(Math.log10(raw))
  const n = raw / pow
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow
}

function bucketLabel(key, monthly) {
  key = String(key).replace(/[^0-9-]/g, '')
  if (monthly) {
    const [y, m] = key.split('-')
    return `${m}/${y}`
  }
  const [, m, d] = key.split('-')
  return `${d}/${m}`
}

function barPath(x, w, y0, y1, r) {
  // Đầu cột bo 4px ở phía dữ liệu, gốc cột vuông ở đường 0.
  const h = Math.abs(y0 - y1)
  const rr = Math.min(r, w / 2, h)
  if (h < 0.5) return ''
  if (y1 < y0) return `M${x},${y0}V${y1 + rr}Q${x},${y1} ${x + rr},${y1}H${x + w - rr}Q${x + w},${y1} ${x + w},${y1 + rr}V${y0}Z`
  return `M${x},${y0}V${y1 - rr}Q${x},${y1} ${x + rr},${y1}H${x + w - rr}Q${x + w},${y1} ${x + w},${y1 - rr}V${y0}Z`
}

function renderChart(root, txs, r) {
  const svg = root.querySelector('[data-part="chart"]')
  const wrap = svg.parentElement
  const tip = wrap.querySelector('.chart-tip')
  const { monthly, list } = buildBuckets(txs, r)
  root.querySelector('[data-part="grain"]').textContent = monthly ? 'tháng' : 'ngày'

  const width = Math.max(wrap.clientWidth, 280)
  const height = 240
  const m = { top: 14, right: 12, bottom: 28, left: 60 }
  const plotW = width - m.left - m.right
  const plotH = height - m.top - m.bottom

  const maxIn = Math.max(0, ...list.map((b) => b.in))
  const maxOut = Math.max(0, ...list.map((b) => -b.out))
  const step = niceStep(Math.max(maxIn + maxOut, 1))
  const top = Math.max(step, Math.ceil(maxIn / step) * step)
  const bottom = maxOut > 0 ? Math.ceil(maxOut / step) * step : 0
  const y = (v) => m.top + ((top - v) / (top + bottom)) * plotH
  const y0 = y(0)
  const band = plotW / list.length
  const bw = Math.max(2, Math.min(24, band * 0.62))
  const labelEvery = Math.ceil(list.length / Math.max(2, Math.floor(plotW / 64)))

  let grid = ''
  for (let v = -bottom; v <= top + 1e-9; v += step) {
    const yy = Math.round(y(v)) + 0.5
    grid += `<line class="${v === 0 ? 'axis-zero' : 'grid'}" x1="${m.left}" x2="${width - m.right}" y1="${yy}" y2="${yy}"/>
      <text class="tick" x="${m.left - 8}" y="${yy + 4}" text-anchor="end">${formatCompact(v)}</text>`
  }
  let bars = ''
  let labels = ''
  list.forEach((b, i) => {
    const cx = m.left + band * i + band / 2
    const x = cx - bw / 2
    bars += `<rect class="hit" data-i="${i}" x="${m.left + band * i}" y="${m.top}" width="${band}" height="${plotH}"/>`
    if (b.in > 0) bars += `<path class="bar-in" d="${barPath(x, bw, y0 - 1, y(b.in), 4)}"/>`
    if (b.out < 0) bars += `<path class="bar-out" d="${barPath(x, bw, y0 + 1, y(b.out), 4)}"/>`
    if (i % labelEvery === 0) labels += `<text class="tick" x="${cx}" y="${height - 8}" text-anchor="middle">${bucketLabel(b.key, monthly)}</text>`
  })

  svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
  svg.setAttribute('width', width)
  svg.setAttribute('height', height)
  svg.innerHTML = `<rect class="hover-band" x="0" y="${m.top}" width="${band}" height="${plotH}" visibility="hidden"/>${grid}${bars}${labels}`
  const hoverBand = svg.querySelector('.hover-band')

  svg.onmousemove = (e) => {
    const target = e.target.closest('.hit')
    if (!target) return
    const i = Number(target.dataset.i)
    const b = list[i]
    hoverBand.setAttribute('x', m.left + band * i)
    hoverBand.setAttribute('visibility', 'visible')
    tip.hidden = false
    tip.innerHTML = `<b>${monthly ? `Tháng ${bucketLabel(b.key, true)}` : viDate(b.key)}</b>
      <div><i class="sw sw-in"></i>Vào <span>${formatVnd(b.in)}</span></div>
      <div><i class="sw sw-out"></i>Ra <span>${formatVnd(b.out)}</span></div>
      <div class="tip-net">Ròng <span>${formatVnd(b.in + b.out, { sign: true })}</span></div>
      <div class="muted">${b.count} giao dịch</div>`
    const rect = wrap.getBoundingClientRect()
    const scale = rect.width / width
    let left = (m.left + band * i + band / 2) * scale + 12
    if (left + 200 > rect.width) left -= 224
    tip.style.left = `${Math.max(0, left)}px`
    tip.style.top = `${m.top}px`
  }
  svg.onmouseleave = () => {
    tip.hidden = true
    hoverBand.setAttribute('visibility', 'hidden')
  }
}

function renderInsights(root, dataset, txs) {
  const byCat = new Map()
  txs.forEach((t) => {
    const c = byCat.get(t.category) || { name: t.category, total: 0, count: 0 }
    c.total += t.amount
    c.count++
    byCat.set(t.category, c)
  })
  const cats = [...byCat.values()].sort((a, b) => Math.abs(b.total) - Math.abs(a.total)).slice(0, 6)
  const maxCat = Math.max(1, ...cats.map((c) => Math.abs(c.total)))
  const matched = txs.filter((t) => ORDER_CODE.test(`${t.description} ${t.reference}`))
  const matchedSum = matched.reduce((s, t) => s + t.amount, 0)
  const largest = [...txs].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)).slice(0, 4)
  const accounts = [...new Set(txs.map((t) => t.accountNumber).filter(Boolean))]
  const byAcc = accounts.map((acc) => {
    const list = txs.filter((t) => t.accountNumber === acc)
    return { acc, name: dataset.accounts.find((a) => a.accountNumber === acc)?.accountName || '', net: list.reduce((s, t) => s + t.amount, 0), count: list.length }
  })
  const empty = '<p class="insight-empty">Không có giao dịch trong bộ lọc hiện tại.</p>'

  root.querySelector('[data-part="insights"]').innerHTML = `
    <article class="card insight">
      <h3>Tự động phân loại thu chi</h3>
      <p class="muted">Gắn danh mục theo nội dung chuyển khoản để có báo cáo quản trị mỗi ngày. Quy tắc ở đây là ví dụ minh hoạ.</p>
      ${cats.length ? `<ul class="cat-list">${cats.map((c) => `
        <li>
          <div class="cat-row"><span>${escapeHtml(c.name)} <span class="muted">· ${c.count}</span></span><span class="num">${formatVnd(c.total, { sign: true })}</span></div>
          <div class="cat-track"><div class="cat-fill ${c.total >= 0 ? 'in' : 'out'}" style="width:${(Math.abs(c.total) / maxCat) * 100}%"></div></div>
        </li>`).join('')}</ul>` : empty}
    </article>
    <article class="card insight">
      <h3>Đối soát đơn hàng tự động</h3>
      <p class="muted">Khách chuyển khoản kèm mã đơn (VD: <code>DH1024</code>) → hệ thống tự xác nhận đơn đã thanh toán, kế toán không cần dò sao kê.</p>
      ${matched.length
        ? `<p class="insight-big">${matched.length.toLocaleString('vi-VN')} <span>giao dịch khớp tự động · ${formatVnd(matchedSum, { sign: true })}</span></p>
           <ul class="mini-list">${matched.slice(0, 3).map((t) => `<li><span><span class="order-code">${escapeHtml(`${t.description} ${t.reference}`.match(ORDER_CODE)?.[0] || '')}</span> ${escapeHtml(formatDateTime(t))}</span><span class="num">${formatVnd(t.amount, { sign: true })}</span></li>`).join('')}</ul>`
        : '<p class="insight-empty">Chưa có giao dịch nào chứa mã đơn hàng.</p>'}
    </article>
    <article class="card insight">
      <h3>Theo dõi giao dịch lớn</h3>
      <p class="muted">Đặt ngưỡng cảnh báo để chủ doanh nghiệp được báo ngay khi có khoản thu/chi bất thường.</p>
      ${largest.length ? `<ul class="mini-list">${largest.map((t) => `
        <li><span title="${escapeHtml(t.description)}">${escapeHtml(formatDateTime(t))} · ${escapeHtml(t.description || '—')}</span><span class="num">${formatVnd(t.amount, { sign: true })}</span></li>`).join('')}</ul>` : empty}
    </article>
    <article class="card insight">
      <h3>Tổng hợp nhiều tài khoản</h3>
      <p class="muted">Một API cho mọi tài khoản trên kết nối — xem dòng tiền toàn doanh nghiệp thay vì đăng nhập từng app ngân hàng.</p>
      ${byAcc.length ? `<ul class="mini-list">${byAcc.map((a) => `
        <li><span>${escapeHtml(a.acc)}${a.name ? ` · ${escapeHtml(a.name)}` : ''} <span class="muted">· ${a.count} GD</span></span><span class="num">${formatVnd(a.net, { sign: true })}</span></li>`).join('')}</ul>` : empty}
    </article>`
}

// ------------------------------------------------------------------
// Environment & credentials
// ------------------------------------------------------------------
function renderEnv() {
  document.querySelectorAll('.env-option').forEach((btn) => {
    const active = btn.dataset.env === state.env
    btn.classList.toggle('active', active)
    btn.setAttribute('aria-checked', active)
  })
  const isSandbox = state.env === 'sandbox'
  $('envNote').innerHTML = isSandbox
    ? `<p>Dùng key của <b>tổ chức sandbox</b>. Khi đăng nhập ngân hàng (Casso Console hoặc iframe), dùng tài khoản test:</p>${testAccountsHtml()}`
    : '<p>Kết nối <b>ngân hàng thật</b>, dữ liệu thật. Dùng key của tổ chức thật — tài khoản test sandbox sẽ không đăng nhập được.</p>'
  document.querySelectorAll('[data-sandbox-only]').forEach((el) => {
    el.hidden = !isSandbox
    el.innerHTML = isSandbox ? testAccountsHtml() : ''
  })
  renderCredFields()
}

// Redirect URI / Webhook URL theo domain đang chạy (ngrok hoặc server thật) để khách copy vào Casso Console.
function renderConsoleSetup() {
  const cfg = state.config || {}
  // PUBLIC_BASE_URL của server, hoặc thư mục của trang hiện tại (giữ sub-path, VD /demo-api-transaction).
  const base = cfg.publicBaseUrl || new URL('.', window.location.href).href.replace(/\/+$/, '')
  $('callbackUrl').textContent = `${base}/casso/callback`
  $('webhookUrl').textContent = `${base}/casso/webhook`
  const host = new URL(base).hostname
  const isLocal = ['localhost', '127.0.0.1', '0.0.0.0'].includes(host)
  const warn = $('localhostWarn')
  warn.hidden = !isLocal
  if (isLocal) {
    warn.innerHTML = `${ICONS.alert}<span>Đang chạy trên <b>${escapeHtml(host)}</b> — Casso không gọi về được địa chỉ này nên iframe sẽ không trả publicToken.
      Chạy <code>npm run tunnel</code> rồi mở demo bằng URL ngrok; 2 URL phía trên sẽ tự đổi theo domain ngrok.</span>`
  }
  if (cfg.githubUrl) $('githubLink').href = cfg.githubUrl
}

function testAccountsHtml() {
  return SANDBOX_TEST_ACCOUNTS.map((acc) => `
    <div class="test-acc">
      <span class="test-acc-label">${escapeHtml(acc.service)}</span>
      <button class="copy-chip" data-copy="${escapeHtml(acc.username)}" data-copy-label="tài khoản">TK <code>${escapeHtml(acc.username)}</code></button>
      <button class="copy-chip" data-copy="${escapeHtml(acc.password)}" data-copy-label="mật khẩu">MK <code>${escapeHtml(acc.password)}</code></button>
      <button class="copy-chip" data-copy="${escapeHtml(acc.otp)}" data-copy-label="OTP">OTP <code>${escapeHtml(acc.otp)}</code></button>
    </div>`).join('')
}

function setEnv(env) {
  if (env === state.env) return
  const hasProgress = state.accessToken || state.real || Object.keys(state.results).length
  if (hasProgress && !confirm('Đổi môi trường sẽ xoá key, token và kết quả hiện tại (không dùng chéo giữa sandbox và production). Tiếp tục?')) return
  state.env = env
  sessionSet('casso_env', env)
  resetFlow()
  renderEnv()
  toast(`Đã chuyển sang ${envLabel()}`)
}

function resetFlow() {
  Object.assign(state, {
    fiServices: [], selectedBank: null, grantToken: null, publicToken: null,
    accessToken: '', accounts: [], results: {}, activeCall: {}, real: null, heroSource: 'sample'
  })
  state.cred = { clientId: '', secretKey: '' }
  ;['tokenResult', 'txResult', 'grantTokenResult', 'publicTokenResult'].forEach((id) => { $(id).hidden = true })
  $('claimLinkId').value = ''
  $('txToken').value = ''
  $('accountOptions').innerHTML = ''
  closeResult()
  renderStatement()
  renderHero()
  renderBankGrids()
  renderWidgetSteps()
  Object.keys(PANELS).forEach(renderApiPanel)
  renderProgress()
}

function renderCredFields() {
  const envName = state.env === 'sandbox' ? 'sandbox' : 'thật (production)'
  document.querySelectorAll('[data-cred-group]').forEach((group) => {
    group.innerHTML = `
      <div class="field-row">
        <label class="field"><span>Client ID <em>(x-client-id)</em></span>
          <input type="text" data-cred="clientId" value="${escapeHtml(state.cred.clientId)}" placeholder="Client ID" autocomplete="off" spellcheck="false"></label>
        <label class="field"><span>Client secret <em>(x-secret-key)</em></span>
          <span class="secret-wrap">
            <input type="password" data-cred="secretKey" value="${escapeHtml(state.cred.secretKey)}" placeholder="Client secret" autocomplete="new-password" spellcheck="false">
            <button type="button" class="secret-toggle" aria-label="Hiện / ẩn secret">Hiện</button>
          </span></label>
      </div>
      <button type="button" class="btn btn-secondary btn-sm" data-console-picker>Chọn credential và liên kết từ Casso Console</button>
      <p class="hint">Key của tổ chức ${envName}, lấy ở Casso Console → API Credential. Chỉ gửi tới server demo để gọi Casso, không lưu lại.</p>`
  })
}

let consolePickerCredential = null
let consolePickerConnection = null
let consolePickerEnvironment = 'sandbox'
let consolePickerLoading = false

async function portalGet(path) {
  const response = await fetch(path, { credentials: 'include', headers: { Accept: 'application/json' } })
  let payload
  try {
    payload = await response.json()
  } catch {
    throw new Error('Không đọc được API Casso Console. Hãy mở demo từ Console cùng domain hoặc nhập credential thủ công.')
  }
  if (!response.ok) {
    const error = new Error(payload?.error?.errorMessage || `Không thể đọc dữ liệu Console (HTTP ${response.status}).`)
    error.status = response.status
    throw error
  }
  return payload
}

// Màn hình chờ khi đang lấy dữ liệu thật sau "Dùng lựa chọn"; gọi lại để đổi dòng trạng thái, hideProdLoading() để tắt.
function showProdLoading(detail) {
  let el = $('prodLoading')
  if (!el) {
    el = document.createElement('div')
    el.id = 'prodLoading'
    el.className = 'prod-loading'
    el.setAttribute('role', 'alertdialog')
    el.setAttribute('aria-busy', 'true')
    el.innerHTML = `
      <div class="prod-loading-card">
        <div class="prod-loading-spinner" aria-hidden="true"></div>
        <h2>Đang lấy dữ liệu thật cho bạn</h2>
        <p id="prodLoadingDetail" role="status" aria-live="polite"></p>
        <button type="button" class="btn btn-ghost btn-sm" data-prod-loading-hide>Ẩn, tiếp tục chạy nền</button>
      </div>`
    el.querySelector('[data-prod-loading-hide]').onclick = hideProdLoading
    document.body.append(el)
  }
  el.querySelector('#prodLoadingDetail').textContent = detail
  el.hidden = false
}

function hideProdLoading() {
  const el = $('prodLoading')
  if (el) el.hidden = true
}

function ensureConsolePicker() {
  let dialog = $('consolePicker')
  if (dialog) return dialog
  dialog = document.createElement('dialog')
  dialog.id = 'consolePicker'
  dialog.className = 'console-picker'
  dialog.setAttribute('aria-labelledby', 'consolePickerTitle')
  dialog.innerHTML = `
    <h2 id="consolePickerTitle">Chọn dữ liệu từ Casso Console</h2>
    <p class="console-picker-copy">Dùng credential và kết nối trong tổ chức hiện tại. Secret chỉ được lấy sau khi bạn chọn credential.</p>
    <p id="consolePickerStatus" class="console-picker-status" role="status" aria-live="polite">Đang tải phiên Console…</p>
    <label class="field"><span>Credential</span><select id="consolePickerCredential" disabled><option value="">Chọn credential</option></select></label>
    <label class="field"><span>Kết nối ngân hàng</span><select id="consolePickerConnection" disabled><option value="">Chọn kết nối</option></select></label>
    <div class="console-picker-actions">
      <button type="button" class="btn btn-ghost" data-console-picker-close>Nhập thủ công</button>
      <button type="button" class="btn btn-primary" id="consolePickerApply" disabled>Dùng lựa chọn</button>
    </div>`
  dialog.addEventListener('close', () => {
    consolePickerCredential = null
    consolePickerConnection = null
  })
  document.body.append(dialog)
  return dialog
}

function updateConsolePickerApply(dialog) {
  const apply = dialog.querySelector('#consolePickerApply')
  apply.disabled = !consolePickerCredential?.secret_key || !consolePickerConnection
}

async function openConsolePicker() {
  if (consolePickerLoading) return
  consolePickerLoading = true
  consolePickerCredential = null
  consolePickerConnection = null
  const dialog = ensureConsolePicker()
  const status = dialog.querySelector('#consolePickerStatus')
  const credentialSelect = dialog.querySelector('#consolePickerCredential')
  const connectionSelect = dialog.querySelector('#consolePickerConnection')
  status.textContent = 'Đang tải phiên Console…'
  credentialSelect.disabled = true
  connectionSelect.disabled = true
  dialog.querySelector('#consolePickerApply').disabled = true
  if (!dialog.open) dialog.showModal()

  try {
    const [me, credentialData, connectionData] = await Promise.all([
      portalGet('/portal/me'),
      portalGet('/portal/credentials'),
      portalGet('/portal/org-grants'),
    ])
    if (!me.org) throw new Error('Phiên hiện tại chưa có tổ chức trong Casso Console.')
    consolePickerEnvironment = me.org.environment === 'production' ? 'production' : 'sandbox'

    const credentials = (credentialData.credentials || []).filter((credential) => credential.allowed_services?.includes('transactions'))
    const connections = (connectionData.connections || []).filter((connection) => connection.service === 'bank_connect' && connection.account_id)
    credentialSelect.onchange = async () => {
      consolePickerCredential = null
      updateConsolePickerApply(dialog)
      const clientId = credentialSelect.value
      if (!clientId) return
      status.textContent = 'Đang kiểm tra quyền xem secret của credential…'
      try {
        const result = await portalGet(`/portal/credentials/${encodeURIComponent(clientId)}`)
        if (!dialog.open || credentialSelect.value !== clientId) return
        consolePickerCredential = result.credential
        status.textContent = consolePickerCredential.secret_key
          ? 'Chọn kết nối ngân hàng để tiếp tục.'
          : 'Vai trò hiện tại không được xem secret key. Hãy dùng credential khác hoặc nhập thủ công.'
      } catch (error) {
        if (!dialog.open || credentialSelect.value !== clientId) return
        status.textContent = error.message
      }
      updateConsolePickerApply(dialog)
    }
    connectionSelect.onchange = () => {
      consolePickerConnection = connections.find((connection) => connection.account_id === connectionSelect.value) || null
      updateConsolePickerApply(dialog)
    }
    credentialSelect.innerHTML = '<option value="">Chọn credential</option>' + credentials.map((credential) =>
      `<option value="${escapeHtml(credential.client_id)}">${escapeHtml(credential.name)} · ${escapeHtml(credential.client_id)}</option>`,
    ).join('')
    connectionSelect.innerHTML = '<option value="">Chọn kết nối ngân hàng</option>' + connections.map((connection) => {
      const label = connection.label || connection.account_id
      return `<option value="${escapeHtml(connection.account_id)}">${escapeHtml(label)} · ${escapeHtml(connection.account_id)}</option>`
    }).join('')
    credentialSelect.disabled = !credentials.length
    connectionSelect.disabled = !connections.length

    if (!credentials.length) status.textContent = 'Không có credential được cấp quyền Transactions. Bạn vẫn có thể nhập thủ công.'
    else if (!connections.length) status.textContent = 'Tổ chức chưa có kết nối ngân hàng khả dụng. Bạn vẫn có thể nhập thủ công.'
    else status.textContent = 'Chọn credential và kết nối đã có trong tổ chức.'
    dialog.querySelector('#consolePickerApply').onclick = () => {
      if (!consolePickerCredential?.secret_key || !consolePickerConnection) return
      const hasProgress = state.cred.clientId || state.accessToken || state.real || Object.keys(state.results).length || val('claimLinkId') || val('txToken')
      if (hasProgress && !confirm('Dùng lựa chọn mới sẽ thay credential và xoá token/kết quả hiện tại. Tiếp tục?')) return
      resetFlow()
      state.env = consolePickerEnvironment
      sessionSet('casso_env', state.env)
      state.cred = { clientId: consolePickerCredential.client_id, secretKey: consolePickerCredential.secret_key }
      renderEnv()
      $('claimLinkId').value = consolePickerConnection.account_id
      setMethod('claim')
      renderApiPanel('apiClaim')
      dialog.close()
      toast('Đã chọn từ Casso Console — đang lấy dữ liệu thật…', 'success')
      void autoLoadFromConsole()
    }
  } catch (error) {
    status.textContent = error.message || 'Không thể tải dữ liệu từ Casso Console. Bạn vẫn có thể nhập thủ công.'
    credentialSelect.disabled = true
    connectionSelect.disabled = true
  } finally {
    consolePickerLoading = false
  }
}

// ------------------------------------------------------------------
// Tiến độ 3 bước
// ------------------------------------------------------------------
function renderProgress() {
  const done = { 1: Boolean(state.accessToken), 2: Boolean(state.real), 3: false }
  const current = !done[1] ? 1 : !done[2] ? 2 : 3
  document.querySelectorAll('.step-card').forEach((card) => {
    const n = Number(card.dataset.step)
    // Bước 2 luôn mở để CTO có sẵn token nhảy thẳng tới gọi API; bước 3 cần dữ liệu thật.
    const locked = n === 3 && !state.real
    card.classList.toggle('done', done[n])
    card.classList.toggle('current', n === current && !locked)
    card.classList.toggle('locked', locked)
    const status = card.querySelector('.step-status')
    if (status) status.innerHTML = done[n] ? `${ICONS.check} Xong` : n === current ? 'Đang làm' : ''
  })
  $('btnOpenDashboard').disabled = !state.real
}

function scrollToStep(n) {
  $(`step${n}`).scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function setMethod(method) {
  state.method = method
  document.querySelectorAll('.method-tab').forEach((tab) => {
    const active = tab.dataset.method === method
    tab.classList.toggle('active', active)
    tab.setAttribute('aria-selected', active)
  })
  $('panelClaim').hidden = method !== 'claim'
  $('panelWidget').hidden = method !== 'widget'
}

// ------------------------------------------------------------------
// API console panel
// ------------------------------------------------------------------
function buildRequestPreview(key) {
  const call = CALLS[key]
  const cfg = envConfig()
  const query = call.query ? call.query() : null
  const qs = query ? new URLSearchParams(Object.entries(query).filter(([, v]) => v)).toString() : ''
  const url = `${cfg.baseUrl || ''}${call.path}${qs ? `?${qs}` : ''}`
  const headers = {
    'x-client-id': state.cred.clientId || '<client-id>',
    'x-secret-key': state.cred.secretKey ? '••••••••' : '<secret-key>'
  }
  const token = call.token ? val('txToken') : ''
  if (call.token) headers.Authorization = token || '<accessToken>'
  const body = call.body ? call.body() : null
  if (body) headers['Content-Type'] = 'application/json'
  return { method: call.method, url, headers, body, token }
}

function curlFor(key) {
  const p = buildRequestPreview(key)
  const lines = [`curl --location --request ${p.method} '${p.url}'`]
  lines.push(`  --header 'x-client-id: ${state.cred.clientId || '<client-id>'}'`)
  lines.push(`  --header 'x-secret-key: <secret-key>'`)
  if (p.headers.Authorization) lines.push(`  --header 'Authorization: ${p.token || '<accessToken>'}'`)
  if (p.body) {
    lines.push(`  --header 'Content-Type: application/json'`)
    lines.push(`  --data '${JSON.stringify(p.body)}'`)
  }
  return lines.join(' \\\n')
}

function highlightJson(obj) {
  const json = escapeHtml(JSON.stringify(obj, null, 2))
  return json.replace(/(&quot;(?:\\.|[^&]|&(?!quot;))*?&quot;)(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi, (match, str, colon, literal) => {
    if (str) return colon ? `<span class="j-key">${str}</span>${colon}` : `<span class="j-str">${str}</span>`
    if (literal) return `<span class="j-lit">${match}</span>`
    return `<span class="j-num">${match}</span>`
  })
}

// grant/claim luôn trả 200 — lỗi nằm trong results[].ok, nên cần kiểm tra riêng.
function callFailed(key) {
  if (key !== 'claim') return false
  const first = state.results.claim?.data?.results?.[0]
  return !first || !first.ok
}
function callFailedError(key) {
  if (!callFailed(key) || !state.results[key]?.ok) return null
  const first = state.results.claim?.data?.results?.[0]
  return { errorCode: first?.error || 'NOT_FOUND', errorMessage: 'Claim không thành công cho link_id này.' }
}

function renderApiPanel(panelId) {
  const el = $(panelId)
  if (!el) return
  const keys = PANELS[panelId]
  const active = state.activeCall[panelId] || keys[0]
  const preview = buildRequestPreview(active)
  const result = state.results[active]

  const tabs = keys.length > 1
    ? `<div class="api-tabs" role="tablist">${keys.map((k) => `
        <button class="api-tab ${k === active ? 'active' : ''}" role="tab" aria-selected="${k === active}" data-panel="${panelId}" data-call="${k}">
          <span class="api-tab-dot ${state.results[k] ? (state.results[k].ok && !callFailed(k) ? 'ok' : 'err') : ''}"></span>${CALLS[k].label}
        </button>`).join('')}</div>`
    : ''

  const headerLines = Object.entries(preview.headers).map(([h, v]) => `<span class="h-name">${escapeHtml(h)}:</span> ${escapeHtml(v)}`).join('\n')
  const requestHtml = `<span class="h-method m-${preview.method.toLowerCase()}">${preview.method}</span> ${escapeHtml(preview.url)}\n${headerLines}${preview.body ? `\n\n${highlightJson(preview.body)}` : ''}`

  let responseHtml
  if (!result) {
    responseHtml = '<div class="api-empty">Chưa gọi. Nhấn nút bên trái để xem response thật từ Casso Console.</div>'
  } else {
    const err = errorOf(result) || callFailedError(active)
    const statusClass = result.ok && !callFailed(active) ? 'ok' : 'err'
    const hint = err ? (ERROR_HINTS[err.errorCode] || '') : ''
    responseHtml = `
      <div class="api-status">
        <span class="status-pill ${statusClass}">${result.status || 'ERR'}</span>
        ${result.latencyMs != null ? `<span class="muted">${result.latencyMs} ms</span>` : ''}
      </div>
      ${err ? `<div class="api-error"><b>${escapeHtml(err.errorCode || 'Lỗi')}</b>${err.errorMessage ? ` — ${escapeHtml(err.errorMessage)}` : ''}${err.detail ? `<br><span class="muted">${escapeHtml(err.detail)}</span>` : ''}${hint ? `<p>${escapeHtml(hint)}</p>` : ''}</div>` : ''}
      <pre class="code">${highlightJson(result.data)}</pre>`
  }

  el.innerHTML = `
    <div class="api-panel-head">
      <span class="api-title"><span class="api-dots" aria-hidden="true"><i></i><i></i><i></i></span>API console</span>
      <span class="muted">Request thật, gọi từ server của bạn</span>
    </div>
    ${tabs}
    <div class="api-section">
      <div class="api-section-head"><span>Request</span><button class="btn-link" data-curl="${active}">Copy cURL</button></div>
      <pre class="code">${requestHtml}</pre>
    </div>
    <div class="api-section">
      <div class="api-section-head"><span>Response</span>${result ? `<button class="btn-link" data-copy-json="${active}">Copy JSON</button>` : ''}</div>
      ${responseHtml}
    </div>`
}

function recordResult(key, payload) {
  state.results[key] = payload
  state.activeCall[CALLS[key].panel] = key
  renderApiPanel(CALLS[key].panel)
}

// ------------------------------------------------------------------
// Bước 1: liên kết tài khoản → accessToken
// ------------------------------------------------------------------
function onAccessToken(token, accounts, extraHtml = '') {
  state.accessToken = token
  if (accounts?.length) state.accounts = accounts
  $('txToken').value = token
  renderApiPanel('apiTx')
  const el = $('tokenResult')
  el.hidden = false
  el.innerHTML = `
    <div class="token-result-head"><span class="ok-dot">${ICONS.check}</span><b>Đã nhận accessToken</b>${extraHtml}</div>
    <div class="copy-field">
      <code>${escapeHtml(token)}</code>
      <button class="btn btn-ghost btn-sm" data-copy="${escapeHtml(token)}" data-copy-label="accessToken">Copy</button>
    </div>
    <button class="btn btn-primary" data-scroll-step="2">Tiếp tục bước 2: Gọi API ↓</button>`
  renderProgress()
}

async function doClaim() {
  const linkId = val('claimLinkId')
  if (!linkId) return toast('Dán link_id từ Casso Console trước', 'error')
  const btn = $('btnClaim')
  setBusy(btn, true)
  const payload = await api('api/grant/claim', { method: 'POST', body: { linkId } })
  setBusy(btn, false)
  if (payload.missingKeys) return
  recordResult('claim', payload)

  const first = payload.data?.results?.[0]
  if (payload.ok && first?.ok && first.access_token) {
    onAccessToken(first.access_token, null, `<span class="muted">grant_id <code>${escapeHtml(first.grant_id || '')}</code></span>`)
    toast('Đã nhận accessToken', 'success')
    return true
  }
  $('tokenResult').hidden = true
  const code = first?.error || errorOf(payload)?.errorCode || payload.status
  toast(`Không lấy được token: ${code}${ERROR_HINTS[code] ? ` — ${ERROR_HINTS[code]}` : ''}`, 'error')
  return false
}

// Sau khi chọn từ Console: claim → transactions 30 ngày → đổ dữ liệu thật vào dashboard.
async function autoLoadFromConsole() {
  showProdLoading('Đang lấy accessToken cho kết nối ngân hàng…')
  const claimed = await doClaim()
  if (!claimed) return hideProdLoading()
  setRange(30)
  showProdLoading('Đang tải giao dịch 30 ngày gần nhất…')
  const result = await doFetch({ scroll: false })
  hideProdLoading()
  if (!result.ok) return scrollToStep(2)
  state.heroSource = 'real'
  renderHero()
  $('hero').scrollIntoView({ behavior: 'smooth', block: 'start' })
}

// Ngân hàng cá nhân đã có liên kết trong tổ chức: chọn 1 liên kết có sẵn (→ account_id) hoặc 'new' (mở iframe); null = huỷ.
function choosePersonalLink(links, bankName) {
  let dialog = $('personalChoice')
  if (!dialog) {
    dialog = document.createElement('dialog')
    dialog.id = 'personalChoice'
    dialog.className = 'console-picker'
    document.body.append(dialog)
  }
  dialog.innerHTML = `
    <h2>${escapeHtml(bankName)} đã có liên kết cá nhân</h2>
    <p class="console-picker-copy"><b>1. Dùng liên kết có sẵn</b> — lấy accessToken bằng <code>POST /proxy/grant/claim</code>, không cần đăng nhập lại.</p>
    ${links.map((l) => `
      <div class="field-row">
        <code>${escapeHtml(l.account_id || l.link_id)} · ${escapeHtml(viDate((l.created_at || '').slice(0, 10)))}</code>
        <button type="button" class="btn btn-secondary btn-sm" data-pick="${escapeHtml(l.account_id || l.link_id)}">Dùng liên kết này</button>
      </div>`).join('')}
    <p class="console-picker-copy"><b>2. Kết nối tài khoản mới</b> — của người khác (giám đốc, cổ đông). Cùng một người liên kết lại sẽ bị từ chối.</p>
    <div class="console-picker-actions">
      <button type="button" class="btn btn-ghost" data-pick="">Huỷ</button>
      <button type="button" class="btn btn-primary" data-pick="new">Kết nối tài khoản mới</button>
    </div>`
  return new Promise((resolve) => {
    let picked = null
    dialog.onclick = (e) => {
      const b = e.target.closest('[data-pick]')
      if (!b) return
      e.stopPropagation()
      picked = b.dataset.pick || null
      dialog.close()
    }
    dialog.onclose = () => resolve(picked)
    dialog.showModal()
  })
}

function widgetProgress() {
  if (state.publicToken) return 4
  if (state.grantToken) return 3
  if (state.fiServices.length) return 2
  return 1
}

function renderWidgetSteps() {
  const current = widgetProgress()
  document.querySelectorAll('[data-wstep]').forEach((li) => {
    const n = Number(li.dataset.wstep)
    li.classList.toggle('done', n < current)
    li.classList.toggle('current', n === current)
    li.classList.toggle('locked', n > current)
  })
  $('btnGrantToken').disabled = !state.selectedBank
  $('btnOpenWidget').disabled = !state.grantToken
  $('btnExchange').disabled = !state.publicToken
}

async function doFiServices(btn = $('btnFiServices')) {
  setBusy(btn, true, 'Đang tải…')
  const payload = await api('api/fi-services')
  setBusy(btn, false)
  if (payload.missingKeys) return
  recordResult('fiServices', payload)
  const list = payload.data?.fi_services
  if (payload.ok && Array.isArray(list)) {
    // Demo này chỉ tra cứu giao dịch ngân hàng nên bỏ các dịch vụ khác (VD: hoá đơn GDT).
    state.fiServices = list.filter((s) => !s.service || s.service === 'bank_connect')
    state.selectedBank = null
    state.grantToken = null
    state.publicToken = null
    renderBankGrids()
    toast(`Key hợp lệ · ${state.fiServices.length} ngân hàng`, 'success')
  } else {
    toast(`Không tải được danh sách: ${errorOf(payload)?.errorCode || payload.status}`, 'error')
  }
  renderWidgetSteps()
}

// Lưới ngân hàng có ở 2 nơi (bước 1 tab iframe và hộp thoại liên kết nhanh), dùng chung state.
function renderBankGrids() {
  renderBankGrid('bankGrid', 'bankSearch', 'Danh sách ngân hàng hiện sau khi tải ở bước a.')
  renderBankGrid('qlBankGrid', 'qlBankSearch', 'Nhập key rồi bấm "Tải danh sách ngân hàng".')
  if (state.qlPhase !== 'range') $('qlStart').disabled = !state.selectedBank
}

function renderBankGrid(gridId, searchId, emptyText) {
  const grid = $(gridId)
  if (!state.fiServices.length) {
    grid.innerHTML = `<p class="muted">${escapeHtml(emptyText)}</p>`
    return
  }
  const q = val(searchId).toLowerCase()
  const hasTypes = state.fiServices.some((s) => s.type)
  const list = state.fiServices.filter((s) => {
    if (hasTypes && s.type !== state.bankType) return false
    if (!q) return true
    return [s.name, s.fi_full_name, s.fi_bin].some((v) => (v || '').toLowerCase().includes(q))
  })
  grid.innerHTML = list.length
    ? list.map((s) => `
      <button class="bank-item ${state.selectedBank?.fi_service_id === s.fi_service_id ? 'selected' : ''}" data-bank="${escapeHtml(s.fi_service_id)}" aria-pressed="${state.selectedBank?.fi_service_id === s.fi_service_id}">
        ${httpsUrl(s.logo_url) ? `<img src="${escapeHtml(httpsUrl(s.logo_url))}" alt="" loading="lazy" referrerpolicy="no-referrer" width="22" height="22">` : ''}
        <span class="bank-name">${escapeHtml(s.name)}</span>
      </button>`).join('')
    : '<p class="muted">Không có ngân hàng phù hợp.</p>'
}

async function doGrantToken() {
  if (!state.selectedBank) return
  const btn = $('btnGrantToken')
  setBusy(btn, true)
  const payload = await api('api/grant/token', { method: 'POST', body: { fiServiceId: state.selectedBank.fi_service_id } })
  setBusy(btn, false)
  if (payload.missingKeys) return
  recordResult('grantToken', payload)

  if (payload.ok && payload.data?.grantToken) {
    state.grantToken = payload.data.grantToken
    state.publicToken = null
    showResult('grantTokenResult', 'ok', `${ICONS.check}<span>grantToken <code>${escapeHtml(state.grantToken)}</code>
      <span class="muted">· hết hạn ${escapeHtml(payload.data.expiredAt || payload.data.expiration || 'sau 30 phút')} · dùng 1 lần</span></span>`)
    if (payload.data.links?.length) {
      const pick = await choosePersonalLink(payload.data.links, state.selectedBank.name)
      if (pick && pick !== 'new') {
        state.grantToken = null
        $('claimLinkId').value = pick
        setMethod('claim')
        renderApiPanel('apiClaim')
        renderWidgetSteps()
        return void doClaim()
      }
    }
  } else if (payload.ok && payload.data?.link_id) {
    // Tổ chức đã có kết nối cho ngân hàng này → doc hướng dẫn dùng claim thay vì mở widget.
    state.grantToken = null
    const linkId = payload.data.link_id
    showResult('grantTokenResult', 'warn', `${ICONS.alert}<span>Tổ chức đã liên kết <b>${escapeHtml(state.selectedBank.name)}</b>: <code>${escapeHtml(linkId)}</code>. Dùng tab link_id với mã này.
      <button class="btn btn-secondary btn-sm" data-use-link="${escapeHtml(linkId)}">Chuyển sang tab link_id</button></span>`)
  } else {
    state.grantToken = null
    showResult('grantTokenResult', 'err', errorLine(payload))
  }
  renderWidgetSteps()
}

function loadWidgetScript(url) {
  if (state.widgetScriptUrl === url && window.BankHub) return Promise.resolve()
  document.querySelectorAll('script[data-cas-link]').forEach((s) => s.remove())
  delete window.BankHub
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = url
    script.dataset.casLink = 'true'
    script.onload = () => {
      if (!window.BankHub?.useBankHubLink) return reject(new Error('Script tải xong nhưng không có window.BankHub'))
      state.widgetScriptUrl = url
      resolve()
    }
    script.onerror = () => reject(new Error(`Không tải được ${url}`))
    document.head.appendChild(script)
  })
}

// Ký state ở server, tải script Cas Link theo môi trường, mở iframe; resolve publicToken khi khách đăng nhập xong.
async function openCasLink(grantToken) {
  const signed = await api('api/grant/state', { method: 'POST' })
  if (!signed.ok) throw new Error(signed.message || 'Không ký được state')
  await loadWidgetScript(envConfig().widgetScriptUrl)
  return new Promise((resolve, reject) => {
    const link = window.BankHub.useBankHubLink({
      grantToken,
      state: signed.state,
      iframe: true,
      onSuccess: (publicToken) => resolve(publicToken),
      onExit: () => reject(new Error('Đã đóng iframe khi chưa hoàn tất'))
    })
    link.open()
  })
}

async function doOpenWidget() {
  if (!state.grantToken) return
  const btn = $('btnOpenWidget')
  setBusy(btn, true, 'Đang chờ đăng nhập ngân hàng…')
  try {
    const publicToken = await openCasLink(state.grantToken)
    state.grantToken = null // grantToken chỉ dùng được một lần
    setPublicToken(publicToken, 'iframe trả về')
  } catch (err) {
    toast(err.message, 'error')
  } finally {
    setBusy(btn, false)
  }
}

function setPublicToken(publicToken, source, { quiet = false } = {}) {
  state.publicToken = publicToken
  showResult('publicTokenResult', 'ok', `${ICONS.check}<span>${escapeHtml(source)} publicToken <code>${escapeHtml(publicToken)}</code></span>`)
  renderWidgetSteps()
  state.activeCall.apiWidget = 'exchange'
  renderApiPanel('apiWidget')
  if (!quiet) toast('Đã có publicToken — bấm "Lấy accessToken"', 'success')
}

async function doExchange() {
  if (!state.publicToken) return
  const btn = $('btnExchange')
  setBusy(btn, true)
  const payload = await api('api/grant/exchange', { method: 'POST', body: { publicToken: state.publicToken } })
  setBusy(btn, false)
  if (payload.missingKeys) return
  recordResult('exchange', payload)

  if (payload.ok && payload.data?.accessToken) {
    const identity = payload.data.identity || {}
    const accounts = identity.accounts || []
    const extra = `<span class="muted">${identity.fiService?.name ? escapeHtml(identity.fiService.name) : ''}
      ${accounts.length ? ` · ${accounts.map((a) => `${escapeHtml(a.accountNumber)} ${escapeHtml(a.accountName || '')}`).join(', ')}` : ''}</span>`
    onAccessToken(payload.data.accessToken, accounts, extra)
    toast('Đã nhận accessToken', 'success')
  } else {
    toast(`Không lấy được token: ${errorOf(payload)?.errorCode || payload.status}`, 'error')
    showResult('publicTokenResult', 'err', errorLine(payload))
  }
  renderWidgetSteps()
}

// ------------------------------------------------------------------
// Bước 2: gọi API (identity → transactions)
// ------------------------------------------------------------------
function txQuery() {
  return { fromDate: val('txFrom'), toDate: val('txTo'), accountNumber: val('txAccount').replace(/\s+/g, '') }
}

function setRange(days, month) {
  const to = new Date()
  const from = new Date()
  if (month) from.setDate(1)
  else from.setDate(to.getDate() - (days - 1))
  $('txFrom').value = isoDate(from)
  $('txTo').value = isoDate(to)
  document.querySelectorAll('#quickRanges button').forEach((b) => {
    b.classList.toggle('active', month ? b.dataset.range === 'month' : Number(b.dataset.days) === days)
  })
  renderApiPanel('apiTx')
}

// Trả về { ok, payload, empty } để hộp thoại liên kết nhanh biết kết quả.
async function doFetch({ scroll = true } = {}) {
  const token = val('txToken')
  const query = txQuery()
  if (!token) return toast('Cần accessToken từ bước 1', 'error'), { ok: false }
  if (!query.fromDate || !query.toDate) return toast('Chọn khoảng thời gian', 'error'), { ok: false }
  if (query.fromDate > query.toDate) return toast('Ngày bắt đầu phải trước ngày kết thúc', 'error'), { ok: false }

  const btn = $('btnFetch')
  setBusy(btn, true, 'Đang lấy giao dịch…')
  const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v)).toString()
  const payload = await api(`api/transactions?${qs}`, { token })
  setBusy(btn, false)
  if (payload.missingKeys) return { ok: false, payload }
  recordResult('transactions', payload)

  if (payload.ok && Array.isArray(payload.data?.transactions)) {
    if (payload.data.accounts?.length) state.accounts = payload.data.accounts
    const n = payload.data.transactions.length
    if (!n) {
      showResult('txResult', 'warn', `${ICONS.alert}<span>API trả về <b>0 giao dịch</b> từ ${viDate(query.fromDate)} đến ${viDate(query.toDate)}. Thử mở rộng khoảng thời gian (VD: 90 ngày).</span>`)
      return { ok: false, empty: true, payload }
    }
    state.real = { transactions: payload.data.transactions, accounts: state.accounts, query, isSample: false }
    state.heroSource = 'real'
    const limitWarn = errorOf(payload)?.errorCode === 'LIMIT_REACHED' ? ` ⚠ ${escapeHtml(ERROR_HINTS.LIMIT_REACHED)}` : ''
    showResult('txResult', 'ok', `${ICONS.check}<span>Nhận <b>${n.toLocaleString('vi-VN')} giao dịch thật</b>.${limitWarn}
      <button class="btn btn-primary btn-sm" data-scroll-step="3">Xem bảng kê ↓</button></span>`)
    renderProgress()
    renderStatement()
    renderHero()
    if (scroll) scrollToStep(3)
    return { ok: true, payload }
  }
  showResult('txResult', 'err', errorLine(payload))
  return { ok: false, payload }
}

// Tuỳ chọn: identity trả tổ chức + danh sách tài khoản (gợi ý cho ô Số tài khoản). Không bắt buộc trước transactions.
async function doIdentity() {
  const token = val('txToken')
  if (!token) return toast('Cần accessToken từ bước 1', 'error')
  const btn = $('btnIdentity')
  setBusy(btn, true, 'Đang lấy thông tin tài khoản…')
  const payload = await api('api/identity', { token })
  setBusy(btn, false)
  if (payload.missingKeys) return
  recordResult('identity', payload)
  if (!payload.ok) return showResult('txResult', 'err', errorLine(payload))
  const d = payload.data || {}
  state.accounts = d.accounts || state.accounts
  $('accountOptions').innerHTML = state.accounts.map((a) => `<option value="${escapeHtml(a.accountNumber)}">${escapeHtml(a.accountName || '')}</option>`).join('')
  const company = d.company?.name ? `<b>${escapeHtml(d.company.name)}</b>${d.company.taxCode ? ` · MST ${escapeHtml(d.company.taxCode)}` : ''} · ` : ''
  const pending = d.error === 'IDENTITY_NOT_VERIFIED' ? `<br>⚠ ${escapeHtml(ERROR_HINTS.IDENTITY_NOT_VERIFIED || 'Đang xác minh tổ chức — gọi lại sau ít phút.')}` : ''
  showResult('txResult', pending ? 'warn' : 'ok', `${pending ? ICONS.alert : ICONS.check}<span>${company}${state.accounts.length.toLocaleString('vi-VN')} tài khoản trên kết nối (đã thêm vào gợi ý ô Số tài khoản).${pending}</span>`)
}

// ------------------------------------------------------------------
// Hero, bảng kê bước 3, dashboard dữ liệu thật
// ------------------------------------------------------------------
let heroLedger
let statementLedger
let fullLedger
const SAMPLE = buildSampleDataset()

function renderHero() {
  const wantReal = state.heroSource === 'real'
  const badge = $('heroBadge')
  badge.className = `data-badge ${wantReal ? (state.real ? 'real' : 'empty') : 'sample'}`
  badge.textContent = !wantReal
    ? '● Dữ liệu minh hoạ · chưa phải dữ liệu của bạn'
    : state.real ? `● Dữ liệu thật · ${envLabel()}` : 'Chưa có dữ liệu thật'
  $('heroSource').querySelectorAll('.seg-btn').forEach((b) => {
    const active = b.dataset.source === state.heroSource
    b.classList.toggle('active', active)
    b.setAttribute('aria-selected', active)
  })
  $('btnQuickLinkLabel').textContent = !wantReal
    ? 'Thử với tài khoản demo · Sandbox'
    : state.real ? 'Liên kết ngân hàng khác · Production' : 'Liên kết tài khoản thật · Production'

  if (wantReal && !state.real) {
    heroLedger.dataset = null
    $('heroLedger').innerHTML = `
      <div class="hero-empty">
        <span class="hero-empty-icon"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 14v3M12 14v3M16 14v3"/></svg></span>
        <h3>Chưa có dữ liệu thật</h3>
        <p class="muted">Liên kết tài khoản ngân hàng doanh nghiệp bằng iframe Cas Link. Giao dịch sẽ hiện ngay tại dashboard này.</p>
        <div class="hero-empty-actions">
          <button class="btn btn-primary" data-quick-link>Liên kết tài khoản thật · Production</button>
          <a class="btn btn-ghost" href="#try">Hoặc làm từng bước ↓</a>
        </div>
      </div>`
    return
  }
  heroLedger.setData(wantReal ? state.real : SAMPLE)
}

// ------------------------------------------------------------------
// Liên kết nhanh bằng iframe Cas Link từ dashboard hero
// ------------------------------------------------------------------
const QL_STEPS = ['token', 'login', 'exchange', 'fetch']

function openQuickLink() {
  const source = state.heroSource
  const env = source === 'real' ? 'production' : 'sandbox'
  if (env !== state.env) {
    setEnv(env)
    if (state.env !== env) return // khách huỷ đổi môi trường
    state.heroSource = source
    renderHero()
  }
  const isSandbox = env === 'sandbox'
  $('qlEnv').className = `env-pill ${env}`
  $('qlEnv').textContent = isSandbox ? 'Sandbox · tài khoản demo' : 'Production · ngân hàng thật'
  $('qlTitle').textContent = isSandbox ? 'Thử với tài khoản demo' : 'Liên kết tài khoản ngân hàng thật'
  $('qlSubtitle').innerHTML = isSandbox
    ? 'Dùng key của <b>tổ chức sandbox</b>. Trong iframe, đăng nhập bằng tài khoản test bên dưới.'
    : 'Dùng key của <b>tổ chức thật</b>. Trong iframe, đăng nhập bằng tài khoản ngân hàng doanh nghiệp và OTP.'
  $('qlTestAccounts').hidden = !isSandbox
  $('qlTestAccounts').innerHTML = isSandbox ? testAccountsHtml() : ''
  const localWarn = $('localhostWarn')
  $('qlLocalWarn').hidden = localWarn.hidden
  $('qlLocalWarn').innerHTML = localWarn.innerHTML
  setQlPhase('link')
  renderBankGrids()
  $('quickLinkModal').hidden = false
  document.body.classList.add('overlay-open')
  const firstEmpty = [...$('quickLinkModal').querySelectorAll('[data-cred]')].find((i) => !i.value)
  ;(firstEmpty || $('qlStart')).focus()
}

function closeQuickLink() {
  if ($('qlStart').getAttribute('aria-busy')) return
  $('quickLinkModal').hidden = true
  if ($('resultOverlay').hidden) document.body.classList.remove('overlay-open')
}

// Giai đoạn 'link': key → ngân hàng → mở iframe. Giai đoạn 'range': đã có accessToken → chọn khoảng ngày → lấy giao dịch.
function setQlPhase(phase) {
  state.qlPhase = phase
  const linking = phase === 'link'
  $('qlSecKeys').hidden = !linking
  $('qlSecBank').hidden = !linking
  $('qlSecRange').hidden = linking
  $('qlRelink').hidden = linking
  $('qlStart').textContent = linking ? 'Mở iframe Cas Link' : 'Lấy giao dịch'
  $('qlStart').disabled = linking ? !state.selectedBank : false
  $('qlResult').hidden = true
  if (linking) {
    $('qlProgress').hidden = true
    QL_STEPS.forEach((k) => qlStep(k, ''))
    $('qlProgress').hidden = true
  } else {
    if (!val('qlFrom') || !val('qlTo')) setQlRange('30')
    else setQlRange(null)
  }
}

function setQlRange(days) {
  if (days) {
    const to = new Date()
    const from = new Date()
    if (days === 'month') from.setDate(1)
    else from.setDate(to.getDate() - (Number(days) - 1))
    $('qlFrom').value = isoDate(from)
    $('qlTo').value = isoDate(to)
  }
  document.querySelectorAll('#qlRanges button').forEach((b) => b.classList.toggle('active', b.dataset.qldays === String(days)))
}

function qlStep(key, status, note) {
  $('qlProgress').hidden = false
  const li = $('qlProgress').querySelector(`[data-qlstep="${key}"]`)
  li.className = status
  li.dataset.note = note || ''
}

function qlFail(payload, message) {
  return Object.assign(new Error(message || 'failed'), { payload })
}

function qlShowError(err, step) {
  qlStep(step, 'err')
  const out = $('qlResult')
  out.hidden = false
  out.className = 'inline-result err'
  out.innerHTML = err.payload && err.message === 'failed'
    ? errorLine(err.payload)
    : `${ICONS.alert}<span>${escapeHtml(err.message)}</span>`
}

function runQuickLink() {
  return state.qlPhase === 'range' ? runQlFetch() : runQlLink()
}

// Giai đoạn 1: grant/token → (iframe → grant/exchange) hoặc (grant/claim nếu ngân hàng đã liên kết)
async function runQlLink() {
  const bank = state.selectedBank
  if (!bank) return toast('Chọn một ngân hàng', 'error')

  const btn = $('qlStart')
  setBusy(btn, true, 'Đang liên kết…')
  QL_STEPS.forEach((k) => qlStep(k, ''))
  $('qlResult').hidden = true
  let current = 'token'

  try {
    qlStep('token', 'run')
    const gt = await api('api/grant/token', { method: 'POST', body: { fiServiceId: bank.fi_service_id } })
    if (gt.missingKeys) throw qlFail(gt)
    recordResult('grantToken', gt)
    let accessToken
    let accounts
    let viaClaim = false

    // Ngân hàng cá nhân đã có liên kết: hỏi dùng liên kết có sẵn hay kết nối tài khoản mới.
    let existingLink = gt.ok ? gt.data?.link_id : null
    if (gt.ok && gt.data?.grantToken && gt.data.links?.length) {
      const pick = await choosePersonalLink(gt.data.links, bank.name)
      if (!pick) throw new Error('Đã huỷ liên kết.')
      if (pick !== 'new') existingLink = pick
    }

    if (existingLink) {
      // Tổ chức đã liên kết ngân hàng này → claim bằng link_id, không cần mở iframe.
      viaClaim = true
      qlStep('token', 'done', 'Ngân hàng đã liên kết sẵn')
      qlStep('login', 'skip', 'Bỏ qua — dùng link_id có sẵn')
      current = 'exchange'
      qlStep('exchange', 'run')
      $('claimLinkId').value = existingLink
      const cl = await api('api/grant/claim', { method: 'POST', body: { linkId: existingLink } })
      recordResult('claim', cl)
      const first = cl.data?.results?.[0]
      if (!(cl.ok && first?.ok && first.access_token)) {
        throw qlFail({ ...cl, data: { error: { errorCode: first?.error || errorOf(cl)?.errorCode || 'NOT_FOUND' } } })
      }
      accessToken = first.access_token
      qlStep('exchange', 'done', 'grant/claim')
    } else if (gt.ok && gt.data?.grantToken) {
      qlStep('token', 'done')
      current = 'login'
      qlStep('login', 'run', 'Hoàn tất đăng nhập trong cửa sổ Cas Link')
      const publicToken = await openCasLink(gt.data.grantToken)
      setPublicToken(publicToken, 'iframe trả về', { quiet: true })
      qlStep('login', 'done')
      current = 'exchange'
      qlStep('exchange', 'run')
      const ex = await api('api/grant/exchange', { method: 'POST', body: { publicToken } })
      recordResult('exchange', ex)
      if (!(ex.ok && ex.data?.accessToken)) throw qlFail(ex)
      state.publicToken = null
      accessToken = ex.data.accessToken
      accounts = ex.data.identity?.accounts
      qlStep('exchange', 'done')
    } else {
      throw qlFail(gt)
    }

    onAccessToken(accessToken, accounts)
    renderWidgetSteps()
    setBusy(btn, false)

    const accText = (accounts || []).map((a) => `${escapeHtml(a.accountNumber)}${a.accountName ? ` · ${escapeHtml(a.accountName)}` : ''}`).join(', ')
    $('qlLinked').innerHTML = `
      <span class="ok-dot">${ICONS.check}</span>
      <div><b>Đã liên kết ${escapeHtml(bank.name)}</b>
        <span class="muted">${viaClaim ? 'Dùng kết nối có sẵn của tổ chức.' : 'Đăng nhập ngân hàng thành công.'}${accText ? ` Tài khoản: ${accText}.` : ''}</span></div>`
    setQlPhase('range')
    $('qlSecRange').scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    $('qlRanges').querySelector('button.active, button')?.focus()
    toast('Liên kết thành công — chọn khoảng thời gian để lấy giao dịch', 'success')
  } catch (err) {
    qlShowError(err, current)
  } finally {
    setBusy(btn, false)
    if (state.qlPhase === 'range') $('qlStart').textContent = 'Lấy giao dịch'
  }
}

// Giai đoạn 2: identity → transactions trong khoảng ngày đã chọn → đổ vào dashboard hero
async function runQlFetch() {
  const from = val('qlFrom')
  const to = val('qlTo')
  if (!from || !to) return toast('Chọn khoảng thời gian', 'error')
  if (from > to) return toast('Ngày bắt đầu phải trước ngày kết thúc', 'error')

  const btn = $('qlStart')
  setBusy(btn, true, 'Đang lấy giao dịch…')
  $('qlResult').hidden = true
  qlStep('fetch', 'run', `${viDate(from)} → ${viDate(to)}`)
  try {
    $('txFrom').value = from
    $('txTo').value = to
    document.querySelectorAll('#quickRanges button').forEach((b) => b.classList.remove('active'))
    const result = await doFetch({ scroll: false })
    if (!result.ok) {
      throw qlFail(result.payload, result.empty ? `Không có giao dịch từ ${viDate(from)} đến ${viDate(to)}. Chọn khoảng ngày rộng hơn rồi thử lại.` : undefined)
    }
    const n = state.real.transactions.length.toLocaleString('vi-VN')
    qlStep('fetch', 'done', `${n} giao dịch`)
    setBusy(btn, false)
    closeQuickLink()
    state.heroSource = 'real'
    renderHero()
    $('hero').scrollIntoView({ behavior: 'smooth', block: 'start' })
    toast(`Đã tải ${n} giao dịch thật vào dashboard`, 'success')
  } catch (err) {
    qlShowError(err, 'fetch')
  } finally {
    setBusy(btn, false)
  }
}

function renderStatement() {
  const root = $('statementLedger')
  if (!state.real) {
    $('statementMeta').textContent = 'Response của API, trình bày thành bảng kê để kế toán dùng ngay.'
    root.innerHTML = '<div class="statement-empty">Bảng kê hiện ở đây sau khi gọi API thành công ở bước 2.</div>'
    statementLedger.dataset = null
    return
  }
  const { query, transactions } = state.real
  $('statementMeta').innerHTML = `${transactions.length.toLocaleString('vi-VN')} giao dịch thật từ <code>GET /proxy/transactions</code> · ${viDate(query.fromDate)} → ${viDate(query.toDate)} · ${envLabel()}`
  statementLedger.setData(state.real)
}

function openResult() {
  if (!state.real) return
  const { query, transactions } = state.real
  $('resultBadge').textContent = `● Dữ liệu thật · ${envLabel()}`
  $('resultMeta').innerHTML = `${transactions.length.toLocaleString('vi-VN')} giao dịch · ${viDate(query.fromDate)} → ${viDate(query.toDate)}. Không lưu database — tải lại trang là mất.`
  $('resultOverlay').hidden = false
  document.body.classList.add('overlay-open')
  fullLedger.setData(state.real)
  $('btnCloseResult').focus()
}

function closeResult() {
  $('resultOverlay').hidden = true
  document.body.classList.remove('overlay-open')
}

// ------------------------------------------------------------------
// Wire-up
// ------------------------------------------------------------------
document.addEventListener('click', (e) => {
  const t = e.target.closest('button, a')
  if (!t) return

  if (t.hasAttribute('data-console-picker')) return void openConsolePicker()
  if (t.hasAttribute('data-console-picker-close')) return $('consolePicker')?.close()
  if (t.dataset.copy !== undefined) return copyText(t.dataset.copy, t.dataset.copyLabel || 'giá trị')
  if (t.dataset.copyFrom) return copyText($(t.dataset.copyFrom).textContent, t.dataset.copyLabel || 'giá trị')
  if (t.dataset.curl) return copyText(curlFor(t.dataset.curl), 'cURL')
  if (t.dataset.copyJson) return copyText(JSON.stringify(state.results[t.dataset.copyJson]?.data, null, 2), 'JSON')
  if (t.dataset.env) return setEnv(t.dataset.env)
  if (t.dataset.method) return setMethod(t.dataset.method)
  if (t.dataset.scrollStep) return scrollToStep(Number(t.dataset.scrollStep))
  if (t.dataset.source) {
    state.heroSource = t.dataset.source
    return renderHero()
  }
  if (t.dataset.quickLink !== undefined) return openQuickLink()
  if (t.dataset.qlclose !== undefined) return closeQuickLink()
  if (t.dataset.qldays) return setQlRange(t.dataset.qldays)
  if (t.dataset.qlrelink !== undefined) return setQlPhase('link')
  if (t.dataset.call) {
    state.activeCall[t.dataset.panel] = t.dataset.call
    return renderApiPanel(t.dataset.panel)
  }
  if (t.dataset.bank) {
    state.selectedBank = state.fiServices.find((s) => s.fi_service_id === t.dataset.bank) || null
    state.grantToken = null
    state.publicToken = null
    $('grantTokenResult').hidden = true
    $('publicTokenResult').hidden = true
    renderBankGrids()
    renderWidgetSteps()
    state.activeCall.apiWidget = 'grantToken'
    return renderApiPanel('apiWidget')
  }
  if (t.dataset.useLink) {
    $('claimLinkId').value = t.dataset.useLink
    setMethod('claim')
    renderApiPanel('apiClaim')
    return toast('Đã điền link_id — bấm "Lấy accessToken"')
  }
  if (t.dataset.type) {
    state.bankType = t.dataset.type
    document.querySelectorAll('[data-type]').forEach((b) => b.classList.toggle('active', b.dataset.type === t.dataset.type))
    return renderBankGrids()
  }
  if (t.dataset.days || t.dataset.range) return setRange(Number(t.dataset.days), t.dataset.range === 'month')
  if (t.classList.contains('secret-toggle')) {
    const input = t.previousElementSibling
    input.type = input.type === 'password' ? 'text' : 'password'
    t.textContent = input.type === 'password' ? 'Hiện' : 'Ẩn'
  }
})

document.addEventListener('input', (e) => {
  const key = e.target.dataset?.cred
  if (key) {
    state.cred[key] = e.target.value.trim()
    // đồng bộ các ô key ở bước 1 (2 tab) và bước 2
    document.querySelectorAll(`[data-cred="${key}"]`).forEach((el) => { if (el !== e.target) el.value = e.target.value })
    Object.keys(PANELS).forEach(renderApiPanel)
    return
  }
  if (e.target.id === 'claimLinkId') return renderApiPanel('apiClaim')
  if (['txToken', 'txFrom', 'txTo', 'txAccount'].includes(e.target.id)) {
    if (e.target.type === 'date') document.querySelectorAll('#quickRanges button').forEach((b) => b.classList.remove('active'))
    return renderApiPanel('apiTx')
  }
  if (e.target.id === 'bankSearch' || e.target.id === 'qlBankSearch') return renderBankGrids()
  if (e.target.id === 'qlFrom' || e.target.id === 'qlTo') return setQlRange(null)
})

// /casso/callback mở trong popup sẽ gửi publicToken về đây.
window.addEventListener('message', (e) => {
  if (e.origin !== window.location.origin || e.data?.type !== 'casso:public-token' || !e.data.publicToken) return
  receivePublicToken(e.data.publicToken)
})

function receivePublicToken(publicToken) {
  setMethod('widget')
  state.grantToken = null
  setPublicToken(publicToken, 'Redirect URI trả về')
  scrollToStep(1)
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return
  if (!$('quickLinkModal').hidden) return closeQuickLink()
  if (!$('resultOverlay').hidden) closeResult()
})

$('btnClaim').addEventListener('click', doClaim)
$('btnFiServices').addEventListener('click', () => doFiServices($('btnFiServices')))
$('btnGrantToken').addEventListener('click', doGrantToken)
$('btnOpenWidget').addEventListener('click', doOpenWidget)
$('btnExchange').addEventListener('click', doExchange)
$('btnUseManualPublic').addEventListener('click', () => {
  const token = val('manualPublicToken')
  if (!token) return toast('Dán publicToken trước', 'error')
  setPublicToken(token, 'Dùng')
})
$('btnFetch').addEventListener('click', () => doFetch())
$('btnIdentity').addEventListener('click', doIdentity)
$('qlLoadBanks').addEventListener('click', () => doFiServices($('qlLoadBanks')))
$('qlStart').addEventListener('click', runQuickLink)
$('quickLinkModal').addEventListener('click', (e) => { if (e.target.id === 'quickLinkModal') closeQuickLink() })
$('btnOpenDashboard').addEventListener('click', openResult)
$('btnCloseResult').addEventListener('click', closeResult)
$('btnRefetch').addEventListener('click', () => {
  closeResult()
  scrollToStep(2)
})

let resizeTimer
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer)
  resizeTimer = setTimeout(() => {
    heroLedger.redrawChart()
    if (!$('resultOverlay').hidden) fullLedger.redrawChart()
  }, 150)
})

async function init() {
  heroLedger = createLedger($('heroLedger'), { mode: 'dashboard' })
  statementLedger = createLedger($('statementLedger'), { mode: 'statement' })
  fullLedger = createLedger($('fullLedger'), { mode: 'dashboard' })
  try {
    state.config = await (await fetch('api/config')).json()
  } catch {
    toast('Không đọc được cấu hình server', 'error')
  }
  setRange(30)
  setMethod('claim')
  renderEnv()
  renderConsoleSetup()
  renderHero()
  renderStatement()
  renderBankGrids()
  renderWidgetSteps()
  Object.keys(PANELS).forEach(renderApiPanel)
  renderProgress()

  // /casso/callback chuyển trang về /?publicToken=... (chế độ chuyển trang, không có popup).
  const params = new URLSearchParams(window.location.search)
  const publicToken = params.get('publicToken')
  if (publicToken) {
    history.replaceState(null, '', window.location.pathname + window.location.hash)
    receivePublicToken(publicToken)
  } else void openConsolePicker()
}

init()
