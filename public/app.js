// Gulshan Factory — frontend (Urdu, RTL)
// Register service worker (makes the app installable on Android; caches nothing)
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// mouse wheel se number input ki value na badle — sirf type karne se
document.addEventListener('wheel', () => {
  const a = document.activeElement;
  if (a && a.tagName === 'INPUT' && a.type === 'number') a.blur();
}, { passive: true });

// ---------- theme: auto (system) / light / dark ----------
const THEME_META = { auto: ['🖥️', 'تھیم: خودکار (سسٹم)'], light: ['☀️', 'تھیم: لائٹ'], dark: ['🌙', 'تھیم: ڈارک'] };
function themePref() { try { return localStorage.getItem('gf-theme') || 'auto'; } catch (e) { return 'auto'; } }
function effectiveTheme() {
  const p = themePref();
  if (p !== 'auto') return p;
  try { return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch (e) { return 'light'; }
}
function applyTheme() {
  if (effectiveTheme() === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  else document.documentElement.removeAttribute('data-theme');
  const b = $('#themeBtn'), m = THEME_META[themePref()] || THEME_META.auto;
  if (b) { b.textContent = m[0]; b.title = m[1]; }
}
function cycleTheme() {
  const order = ['auto', 'light', 'dark'];
  const next = order[(order.indexOf(themePref()) + 1) % order.length];
  try { localStorage.setItem('gf-theme', next); } catch (e) {}
  applyTheme();
}
function setThemePref(v) { try { localStorage.setItem('gf-theme', v); } catch (e) {} applyTheme(); }
try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (themePref() === 'auto') applyTheme(); }); } catch (e) {}
applyTheme();
let ME = null, PERM = {};
let CACHE = { cats: [], units: [], products: [], vehicles: [], routes: [], shops: [] };
let countdownTimer = null;

async function api(method, url, body) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  let j = {}; try { j = t ? JSON.parse(t) : {}; } catch (e) { j = { _raw: t }; }
  if (!r.ok) { const e = new Error(j.error || ('HTTP ' + r.status)); e.detail = j.detail; throw e; }
  return j;
}
const can = (sec, lvl = 'view') => {
  if (!ME) return false;
  if (ME.role === 'super_admin') return true;
  const rank = { none: 0, view: 1, full: 2 };
  return (rank[PERM[sec]] || 0) >= (rank[lvl] || 0);
};
function karachiToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(new Date());
}

// ---------- init ----------
async function init() {
  try {
    checkVersion();
    const ad = await api('GET', '/api/ad').catch(() => ({ enabled: false }));
    if (ad.enabled && ad.url) await showSplash(ad);
    const st = await api('GET', '/api/status');
    if (st.setupRequired) { $('#setupView').style.display = 'flex'; return; }
    if (st.loggedIn) { await enterApp(); return; }
    $('#loginView').style.display = 'flex';
  } catch (e) { document.body.innerHTML = '<p style="padding:40px">سرور سے رابطہ نہیں ہو سکا</p>'; }
}
async function doSetup() {
  $('#suErr').textContent = '';
  try {
    await api('POST', '/api/setup', { username: $('#suUser').value.trim(), password: $('#suPass').value });
    await enterApp();
  } catch (e) { $('#suErr').textContent = 'خرابی: ' + e.message; }
}
async function doLogin() {
  $('#liErr').textContent = '';
  try {
    const username = $('#liUser').value.trim();
    await api('POST', '/api/login', { username, password: $('#liPass').value });
    try { localStorage.setItem('gf-lastuser', username); } catch (e) {}
    await enterApp();
  } catch (e) { $('#liErr').textContent = 'یوزر نام یا پاس ورڈ غلط ہے'; }
}
// ---------- forgot password (OTP to registered mobile) ----------
function showAuth(id) { for (const v of ['loginView', 'forgotView', 'otpView', 'setupView']) { const el = document.getElementById(v); if (el) el.style.display = v === id ? 'flex' : 'none'; } }
function showLogin() {
  try { const lu = localStorage.getItem('gf-lastuser'); if (lu && !$('#liUser').value) $('#liUser').value = lu; } catch (e) {}
  showAuth('loginView');
}
function showForgot() { $('#fpErr').textContent = ''; const sb = $('#fpSubBox'); if (sb) sb.style.display = 'none'; showAuth('forgotView'); }
let fpUsername = '';
async function doForgot() {
  const u = $('#fpUser').value.trim(), err = $('#fpErr'); err.textContent = '';
  if (!u) { err.textContent = 'یوزر نام لکھیں'; return; }
  try {
    const r = await api('POST', '/api/forgot-password', { username: u });
    if (!r.sent) { $('#fpSubBox').style.display = 'block'; err.textContent = 'پہلے نیچے سے اس موبائل پر اطلاع آن کریں'; return; }
  } catch (e) { err.textContent = e.message === 'too_many' ? 'زیادہ کوششیں — 15 منٹ بعد دوبارہ کوشش کریں' : 'خرابی: ' + e.message; return; }
  fpUsername = u; $('#otpErr').textContent = ''; $('#otpCode').value = ''; $('#otpPass').value = ''; $('#otpPass2').value = '';
  showAuth('otpView');
}
async function doForgotSubscribe() {
  const u = $('#fpUser').value.trim(), phone = $('#fpPhone').value.trim(), err = $('#fpSubErr');
  err.textContent = '';
  if (!u) { err.textContent = 'اوپر یوزر نام لکھیں'; return; }
  if (!phone) { err.textContent = 'رجسٹرڈ موبائل نمبر لکھیں'; return; }
  try {
    err.textContent = '⏳ اجازت طلب کی جا رہی ہے...';
    const sub = await getPushSubscription();
    if (!sub) { err.textContent = 'نوٹیفکیشن کی اجازت نہیں ملی — براؤزر سیٹنگ چیک کریں'; return; }
    await api('POST', '/api/push-subscribe-forgot', { username: u, phone, subscription: sub.toJSON() });
    err.textContent = '';
    alert('اطلاع آن ہو گئی ✅ — اب "OTP بھیجیں" دبائیں');
  } catch (e) {
    err.textContent = e.message === 'phone_mismatch' ? 'موبائل نمبر رجسٹرڈ نمبر سے نہیں ملتا' : e.message === 'too_many' ? 'زیادہ کوششیں — بعد میں کوشش کریں' : 'خرابی: ' + e.message;
  }
}
async function doReset() {
  const code = $('#otpCode').value.trim(), p1 = $('#otpPass').value, p2 = $('#otpPass2').value;
  const err = $('#otpErr'); err.textContent = '';
  if (p1 !== p2) { err.textContent = 'پاس ورڈ دونوں جگہ ایک جیسا لکھیں'; return; }
  if (p1.length < 6) { err.textContent = 'پاس ورڈ کم از کم 6 حروف کا ہو'; return; }
  try { await api('POST', '/api/reset-password', { username: fpUsername, code, password: p1 }); }
  catch (e) { err.textContent = 'OTP غلط یا مدت ختم — نیا OTP بھیجیں'; return; }
  alert('پاس ورڈ ری سیٹ ہو گیا ✅ اب لاگ اِن کریں');
  showAuth('loginView');
}
// ---------- app version / update notice ----------
async function checkVersion() {
  try {
    const { version } = await api('GET', '/api/version');
    const seen = localStorage.getItem('gf-ver');
    const vl = $('#verLine'); if (vl) vl.textContent = 'ورژن ' + version;
    if (seen && seen !== version) $('#updBar').style.display = 'block';
    localStorage.setItem('gf-ver', version);
  } catch (e) {}
}
async function doLogout() {
  await api('POST', '/api/logout');
  location.reload();
}
// ---------- change own password ----------
async function doChangePassword() {
  const cur = $('#pwCur').value, nw = $('#pwNew').value, nw2 = $('#pwNew2').value;
  const err = $('#pwErr'); err.textContent = '';
  if (nw !== nw2) { err.textContent = 'نیا پاس ورڈ دونوں جگہ ایک جیسا لکھیں'; return; }
  if (nw.length < 6) { err.textContent = 'پاس ورڈ کم از کم 6 حروف کا ہو'; return; }
  try {
    await api('POST', '/api/change-password', { current: cur, next: nw });
  } catch (e) { err.textContent = 'موجودہ پاس ورڈ غلط ہے'; return; }
  $('#pwModal').style.display = 'none';
  $('#pwCur').value = $('#pwNew').value = $('#pwNew2').value = '';
  alert('پاس ورڈ تبدیل ہو گیا ✅');
}
async function enterApp() {
  ME = await api('GET', '/api/me');
  PERM = ME.permissions || {};
  $('#loginView').style.display = 'none'; $('#setupView').style.display = 'none';
  $('#appView').style.display = 'block';
  $('#meLine').textContent = ME.username + ' — ' + ({ super_admin: 'سپر ایڈمن', factory: 'فیکٹری یوزر', shop: 'دکان' }[ME.role] || ME.role);
  renderTopbarDp();
  await refreshCache();
  buildMenu();
  const hashView = (location.hash || '').slice(1);
  _showView(hashView && viewAllowed(hashView) ? hashView : firstAllowedView());
  try {
    history.replaceState({ view: 'dashboard' }, '', '#dashboard');
    if (CUR_VIEW !== 'dashboard') history.pushState({ view: CUR_VIEW }, '', '#' + CUR_VIEW);
  } catch (e) {}
  setupPush(); // order notifications for staff (non-blocking)
}

// ---------- push notifications (new order alerts) ----------
function urlB64ToKey(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function getPushSubscription() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return null;
  if (Notification.permission === 'denied') return null;
  if (Notification.permission !== 'granted') { await Notification.requestPermission(); }
  if (Notification.permission !== 'granted') return null;
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const { publicKey } = await api('GET', '/api/vapid-public-key');
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToKey(publicKey) });
  }
  return sub;
}
async function setupPush() {
  try {
    // all roles subscribe: staff get order/login alerts, everyone gets route/supply updates
    const sub = await getPushSubscription();
    if (!sub) return false;
    await api('POST', '/api/push-subscribe', { subscription: sub.toJSON() });
    return true;
  } catch (e) { /* push optional — never break the app */ return false; }
}
async function enablePush() {
  const ok = await setupPush();
  alert(ok ? 'نوٹیفکیشن آن ہو گئے ✅' : 'نوٹیفکیشن آن نہیں ہوئے — براؤزر کی پرمیشن چیک کریں');
}

// ---------- cache ----------
async function refreshCache() {
  const get = async (u) => { try { return await api('GET', u); } catch (e) { return []; } };
  if (can('categories')) CACHE.cats = await get('/api/categories');
  if (can('units')) CACHE.units = await get('/api/units');
  if (can('products')) CACHE.products = await get('/api/products');
  if (can('vehicles')) CACHE.vehicles = await get('/api/vehicles');
  if (can('routes')) CACHE.routes = await get('/api/routes');
  if (can('shops')) CACHE.shops = await get('/api/shops');
  else if (ME.role === 'shop') { try { const s = await api('GET', '/api/shops'); CACHE.shops = s; } catch (e) {} }
}

// ---------- menu / views ----------
const MENU = [
  ['dashboard', '📊 ڈیش بورڈ'], ['supply', '🗓 سپلائی کیلنڈر'], ['order', '🧾 نیا آرڈر'], ['orders', '📦 آرڈرز'],
  ['daily', '📝 روزانہ آرڈر'], ['tray', '🧺 ٹرے باسکٹ'],
  ['order_history', '🕘 آرڈر ہسٹری'], ['reports', '🖨 رپورٹس'],
  ['vehicles', '🚚 گاڑیاں'], ['routes', '🗺 روٹس و شیڈول'], ['cats', '🗂 کیٹیگریز'],
  ['units', '⚖ یونٹس'], ['products', '🍞 آئٹمز'], ['shops', '🏪 دکانیں'],
];
const VIEW_SEC = { dashboard: 'dashboard', supply: 'routes', order: 'orders', orders: 'orders', daily: 'daily', tray: 'tray_basket', order_history: 'order_history', reports: 'reports',
  vehicles: 'vehicles', routes: 'routes', cats: 'categories', units: 'units', products: 'products', shops: 'shops' };
function viewAllowed(key) {
  const sec = VIEW_SEC[key];
  if (!sec) return true;
  if (sec === 'orders' && key === 'order') return can('orders', 'full');
  if (key === 'supply') return can('routes', 'full');
  return can(sec);
}
function firstAllowedView() {
  for (const [key] of MENU) if (viewAllowed(key)) return key;
  return 'dashboard';
}
function buildMenu() {
  const nav = $('#menuNav'); nav.innerHTML = '';
  for (const [key, label] of MENU) {
    if (!viewAllowed(key)) continue;
    const b = document.createElement('button');
    b.textContent = label; b.dataset.view = key;
    b.onclick = () => { showView(key); toggleMenu(false); };
    nav.appendChild(b);
  }
  const pw = document.createElement('button');
  pw.textContent = '🔑 پاس ورڈ تبدیل کریں'; pw.onclick = () => { $('#pwModal').style.display = 'flex'; toggleMenu(false); }; nav.appendChild(pw);
  const out = document.createElement('button');
  out.textContent = '🚪 لاگ آؤٹ'; out.onclick = doLogout; nav.appendChild(out);
}
let CUR_VIEW = null;
function _showView(name) {
  if (!viewAllowed(name)) name = firstAllowedView();
  CUR_VIEW = name;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('on'));
  const el = $('#v-' + (name === 'order_history' ? 'history' : name)); if (el) el.classList.add('on');
  document.querySelectorAll('#menuNav button').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  // View render karo — error aaye to blank screen ki bajaye friendly message
  const _fn = ({ dashboard: renderDashboard, supply: renderSupplyCalendar, order: renderOrderForm, orders: renderOrders, daily: renderDaily, order_history: renderHistory,
     vehicles: () => renderMaster('vehicles'), routes: renderRoutes, cats: () => renderMaster('cats'),
     units: () => renderMaster('units'), products: renderProducts, shops: () => renderMaster('shops'),
     reports: renderReports, tray: renderTray }[name] || (() => {}));
  const _showViewError = (e) => {
    const vname = (name === 'order_history' ? 'history' : name);
    const el2 = $('#v-' + vname);
    const msg = (e && e.message === 'forbidden') ? 'آپ کو اس صفحے کی اجازت نہیں ہے۔ ایڈمن سے رابطہ کریں۔' : 'صفحہ لوڈ نہیں ہو سکا۔ دوبارہ کوشش کریں۔';
    if (el2) el2.innerHTML = `<div style="text-align:center;padding:60px 20px;color:#666">
      <div style="font-size:48px;margin-bottom:12px">🔒</div>
      <div style="font-size:18px;font-weight:bold">رسائی نہیں</div>
      <div style="font-size:14px;margin-top:8px">${msg}</div></div>`;
  };
  try {
    const _r = _fn();
    if (_r && _r.catch) _r.catch(_showViewError);
  } catch (e) { _showViewError(e); }
}
function showView(name) {
  _showView(name);
  // Back hamesha dashboard par laye: dashboard ke upar sirf 1 entry rakho
  try {
    const top = history.state && history.state.view;
    if (CUR_VIEW === 'dashboard' || (top && top !== 'dashboard')) history.replaceState({ view: CUR_VIEW }, '', '#' + CUR_VIEW);
    else history.pushState({ view: CUR_VIEW }, '', '#' + CUR_VIEW);
  } catch (e) {}
}
// Android back button: pichle tab par wapas, pehle tab se back = app band (normal)
window.addEventListener('popstate', e => {
  const v = e.state && e.state.view;
  _showView(v || firstAllowedView());
});
function toggleMenu(open) {
  $('#sidemenu').classList.toggle('on', open);
  $('#scrim').classList.toggle('on', open);
  if (open) $('#setpanel').classList.remove('on');
}
function openSettings() {
  $('#setpanel').classList.add('on'); $('#scrim').classList.add('on');
  $('#sidemenu').classList.remove('on');
  const isSA = ME.role === 'super_admin';
  document.querySelectorAll('.setpanel .tabs button').forEach(b => {
    b.style.display = (b.dataset.tab === 'general' || isSA) ? '' : 'none';
  });
  setTab('general', document.querySelector('.setpanel .tabs button[data-tab="general"]'));
}
function closePanels() {
  $('#sidemenu').classList.remove('on'); $('#setpanel').classList.remove('on'); $('#scrim').classList.remove('on');
}

// ---------- dashboard ----------
function timeAgo(s) {
  try {
    const t = new Date(String(s || '').replace(' ', 'T') + 'Z').getTime();
    if (isNaN(t)) return '';
    const m = Math.floor((Date.now() - t) / 60000);
    if (m < 1) return 'ابھی';
    if (m < 60) return m + ' منٹ پہلے';
    const h = Math.floor(m / 60);
    if (h < 24) return h + ' گھنٹے پہلے';
    const d = Math.floor(h / 24);
    return d + ' دن پہلے';
  } catch (e) { return ''; }
}
function shopAvatar(name, img) {
  if (img) return `<span class="avatar"><img src="${esc(img)}" alt=""></span>`;
  const ch = String(name || '?').trim().charAt(0) || '?';
  return `<span class="avatar">${esc(ch)}</span>`;
}
function userAvatar(username, img) {
  if (img) return `<span class="avatar sm"><img src="${esc(img)}" alt=""></span>`;
  const ch = String(username || '?').trim().charAt(0) || '?';
  return `<span class="avatar sm">${esc(ch)}</span>`;
}
async function renderDashboard() {
  // Gaari wale aur supplier ka dashboard (dono)
  if (ME.account_type === 'vehicle' || ME.account_type === 'supplier') return renderSupplierDash();
  let d;
  try {
    d = await api('GET', '/api/dashboard');
  } catch (e) {
    // Permission nahi (403) to pehle allowed view par bhejo, warna friendly message
    const fav = firstAllowedView();
    if (fav && fav !== 'dashboard') { _showView(fav); return; }
    $('#v-dashboard').innerHTML = `<div style="text-align:center;padding:60px 20px;color:#666">
      <div style="font-size:48px;margin-bottom:12px">🔒</div>
      <div style="font-size:18px;font-weight:bold">ڈیش بورڈ دستیاب نہیں</div>
      <div style="font-size:14px;margin-top:8px">آپ کے اکاؤنٹ کو ڈیش بورڈ کی اجازت نہیں ہے۔</div></div>`;
    return;
  }
  const cd = d.upcoming.map(r => `
    <div class="supcard">
      <div class="suphead">🚚 <b>${esc(r.name)}</b>${(d.scope !== 'shop' && r.order_count != null) ? ` <span class="obadge">🧾 ${r.order_count} آرڈر</span>` : ''}</div>
      <div class="supmeta">🚛 ${esc(r.vehicle_name || '—')} &nbsp; 📅 سپلائی: <b>${esc(r.supply_date || '—')}</b></div>
      <div class="supmeta">⏰ کٹ آف: <b>${esc(r.cutoff_date || '')} ${esc(r.cutoff_time || '')}</b> &nbsp; 🕙 کھلے گا: <b>${esc(r.open_time || '10:00')}</b></div>
    </div>`).join('');
  const p2 = n => String(n).padStart(2, '0');
  const ro = (d.recent_orders || []).map(o => {
    const dt = new Date(String(o.created_at || '').replace(' ', 'T') + 'Z'); // stored UTC -> viewer local time
    const when = isNaN(dt) ? '' : `${p2(dt.getDate())}-${p2(dt.getMonth() + 1)} ${p2(dt.getHours())}:${p2(dt.getMinutes())}`;
    const simg = o.shop_image ? '/images/' + o.shop_image : null;
    const uimg = o.user_avatar ? '/images/' + o.user_avatar : null;
    const clickAttr = can('orders', 'full') ? ` onclick="gotoOrder('${esc(o.delivery_date || '')}')" style="cursor:pointer"` : '';
    return `<div class="drow"${clickAttr}>
      ${shopAvatar(o.shop_name, simg)}
      <div class="drmain">
        <div class="drshop">${esc(o.shop_name)} <span class="ordn">#${o.id}</span></div>
        <div class="drmeta">📦 ${o.items} آئٹمز • 📅 ${esc(o.delivery_date || '—')}</div>
        <div class="drmeta">🕐 ${esc(when)}${o.created_by ? ` • ${userAvatar(o.created_by, uimg)} <b>${esc(o.created_by)}</b>` : ''}</div>
      </div>
      <span class="chev">‹</span>
    </div>`;
  }).join('');
  const pcls = ['p4', 'p1', 'p2', 'p3', 'p5', 'p6'];
  let pi = 0;
  const stat = (icon, n, l) => { const c = pcls[pi++ % pcls.length]; return `<div class="pcard ${c}"><div class="pic">${icon}</div><div class="pnum">${n}</div><div class="plbl">${l}</div></div>`; };
  const cards = d.scope === 'shop'
    ? `<div class="pcard p3 wide"><div class="pic">🏪</div><div class="pnum">${esc(d.shop_name || 'میری دکان')}</div><div class="plbl">میری دکان</div></div>`
      + stat('🧾', d.today_orders, 'نئے آرڈرز (آج)')
      + stat('📦', d.total_orders, 'آنے والے آرڈرز')
      + (d.daily_today != null ? stat('📋', d.daily_today, 'روزانہ آرڈر (آج)') : '')
    : stat('🧾', d.today_orders, 'نئے آرڈرز (آج)')
      + stat('📦', d.total_orders, 'آنے والے آرڈرز')
      + stat('📋', d.daily_today || 0, 'روزانہ آرڈر (آج)')
      + stat('🏪', d.shops, 'شاپس')
      + stat('🗂', d.products, 'پروڈکٹس')
      + stat('👥', d.users, 'کل صارفین')
      + stat('🚚', d.vehicles, 'گاڑیاں');
  // 7-day bar chart (oldest -> today)
  const daily = d.daily || [0, 0, 0, 0, 0, 0, 0];
  const mx = Math.max(1, ...daily);
  const wdf = new Intl.DateTimeFormat('ur-PK', { weekday: 'short' });
  const bars = daily.map((v, i) => {
    const lbl = wdf.format(new Date(Date.now() - (6 - i) * 864e5));
    return `<div class="bcol"><div class="bval">${v}</div><div class="bar" style="height:${Math.max(6, Math.round(v / mx * 110))}px"></div><div class="bday">${lbl}</div></div>`;
  }).join('');
  const me = (typeof ME !== 'undefined' && ME && ME.username) || '';
  const qaBtns = [
    can('orders', 'full') ? '<button class="qbtn" onclick="showView(\'order\')"><span class="qic">🧾</span>نیا آرڈر</button>' : '',
    can('daily', 'view') ? '<button class="qbtn" onclick="showView(\'daily\')" style="background:linear-gradient(135deg,#e8721c,#f57c00)"><span class="qic">📋</span>روزانہ آرڈر</button>' : '',
    can('products', 'full') ? '<button class="qbtn" onclick="showView(\'products\')"><span class="qic">🗂</span>پروڈکٹ شامل کریں</button>' : '',
    can('shops', 'full') ? '<button class="qbtn" onclick="showView(\'shops\')"><span class="qic">🏪</span>شاپ شامل کریں</button>' : '',
    can('reports') ? '<button class="qbtn" onclick="showView(\'reports\')"><span class="qic">📊</span>رپورٹ دیکھیں</button>' : '',
  ].join('');
  $('#v-dashboard').innerHTML = `
    <div class="hero">
      <div class="hw">
        <div class="htitle">👋 خوش آمدید${me ? '، ' + esc(me) : ''}!</div>
        <div class="hsub">آپ کے بیکری سسٹم کا ڈیش بورڈ</div>
        <div class="htag">تازہ مصنوعات، خوش ذائقہ، آپ کے لیے</div>
      </div>
      <img class="hlogo" src="/logo.png" alt="گلشن">
    </div>
    <div class="dhead"><div class="dclock">🕐 <span id="liveClock"></span></div></div>
    <div id="cdBox"></div>
    <div class="dstats">${cards}</div>
    ${qaBtns ? `<h2 class="st">⚡ <span>فوری کارروائی</span></h2><div class="qagrid">${qaBtns}</div>` : ''}
    <h2 class="st">📊 <span>آرڈرز کا خلاصہ</span> <small class="stsmall">یہ ہفتہ</small></h2>
    <div class="chart">${bars}</div>
    <h2 class="st">🗓 <span>آنے والی سپلائی</span></h2>
    <div class="supgrid">${cd || '<p class="note">کوئی شیڈول نہیں</p>'}</div>
    <h2 class="st">📋 <span>${d.scope === 'shop' ? 'میرے تازہ ترین آرڈرز' : 'تازہ ترین آرڈرز'}</span></h2>
    <div class="drows">${ro || '<p class="note">ابھی کوئی آرڈر نہیں</p>'}</div>`;
  tickClock();
  const soon = (d.upcoming || []).find(r => r.cutoff_date && !cutoffPassedClient(r.cutoff_date, r.cutoff_time));
  if (soon) startCountdown(soon.cutoff_date, soon.cutoff_time, soon.name);
}
function tickClock() {
  const el = $('#liveClock'); if (!el) return;
  const f = () => { el.textContent = new Intl.DateTimeFormat('ur-PK', { timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date()); };
  f(); setInterval(f, 1000);
}
function startCountdown(cdate, ctime, label, boxId, opts) {
  opts = opts || {};
  if (countdownTimer) clearInterval(countdownTimer);
  const box = document.getElementById(boxId || 'cdBox'); if (!box || !cdate) return;
  const target = new Date(`${cdate}T${ctime || '23:59'}:00+05:00`).getTime();
  const f = () => {
    const ms = target - Date.now();
    if (ms <= 0) {
      if (opts.onDone) { clearInterval(countdownTimer); opts.onDone(); return; }
      box.innerHTML = `<div class="countdown">⏰ <b>${esc(label)}</b> کا کٹ آف وقت گزر چکا ہے</div>`; clearInterval(countdownTimer); return;
    }
    const h = Math.floor(ms / 36e5), m = Math.floor(ms % 36e5 / 6e4), s = Math.floor(ms % 6e4 / 1e3);
    box.innerHTML = `<div class="countdown"><small>${esc(opts.cap || '⏰ کٹ آف تک باقی وقت')} — ${esc(label)}</small><div class="t">${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}</div></div>`;
  };
  f(); countdownTimer = setInterval(f, 1000);
}

// ---------- order form (shop / admin) ----------
let orderDraft = {};
// ---------- supply calendar (super_admin + factory) ----------
let calYear = null, calMonth = null, CALDAYS = [], CALDEF = { cutoff: '20:00', open: '10:00' };
async function renderSupplyCalendar() {
  const now = new Date();
  if (calYear == null) { calYear = now.getFullYear(); calMonth = now.getMonth(); }
  const p2 = n => String(n).padStart(2, '0');
  const from = `${calYear}-${p2(calMonth + 1)}-01`;
  const lastDay = new Date(calYear, calMonth + 1, 0).getDate();
  const to = `${calYear}-${p2(calMonth + 1)}-${lastDay}`;
  try { CALDAYS = await api('GET', `/api/supply-days?from=${from}&to=${to}`); } catch (e) { CALDAYS = []; }
  try { const sd = await api('GET', '/api/supply-default'); if (sd) { if (sd.cutoff_time) CALDEF.cutoff = sd.cutoff_time; if (sd.open_time) CALDEF.open = sd.open_time; } } catch (e) {}
  const byDate = {}; CALDAYS.forEach(d => { byDate[d.supply_date] = d; });
  const monthName = new Intl.DateTimeFormat('ur-PK', { month: 'long', year: 'numeric' }).format(new Date(calYear, calMonth, 1));
  const todayS = karachiToday();
  const dows = ['ہفتہ', 'اتوار', 'پیر', 'منگل', 'بدھ', 'جمعرات', 'جمعہ'];
  const off = (new Date(calYear, calMonth, 1).getDay() + 1) % 7; // Saturday-first
  let cells = '';
  for (let i = 0; i < off; i++) cells += '<div class="cald empty"></div>';
  for (let d = 1; d <= lastDay; d++) {
    const ds = `${calYear}-${p2(calMonth + 1)}-${p2(d)}`;
    const s = byDate[ds];
    const past = ds < todayS;
    const cls = s ? 'cald sup' : (past ? 'cald past' : 'cald');
    const clickable = (past && !s) ? '' : `onclick="calTap('${ds}',${s ? s.id : 0})"`;
    cells += `<div class="${cls}" ${clickable}><span class="cdn">${d}</span>${s ? `<span class="cbo">🧾 ${s.order_count}</span>` : ''}</div>`;
  }
  $('#v-supply').innerHTML = `
    <h2 class="st">🗓 <span>سپلائی کیلنڈر</span></h2>
    <div class="calhead">
      <button class="btn small ghost" onclick="calNav(-1)">‹</button>
      <b>${monthName}</b>
      <button class="btn small ghost" onclick="calNav(1)">›</button>
    </div>
    <div class="calgrid">${dows.map(w => `<div class="cald dow">${w}</div>`).join('')}${cells}</div>
    <p class="note">🟢 سبز دن = سپلائی | خالی دن پر tap = نیا سپلائی day | سبز دن پر tap = کٹ آف بدلیں / ہٹائیں</p>
    <div id="calDetail"></div>`;
}
function calNav(d) {
  calMonth += d;
  if (calMonth < 0) { calMonth = 11; calYear--; }
  if (calMonth > 11) { calMonth = 0; calYear++; }
  renderSupplyCalendar();
}
async function calTap(ds, id) {
  if (!id) {
    if (!confirm(`📅 ${ds} کو سپلائی day بنائیں؟\n🕙 آرڈر: پچھلے دن ${CALDEF.open} سے\n⏰ کٹ آف: پچھلے دن ${CALDEF.cutoff} بجے`)) return;
    try { await api('POST', '/api/supply-days', { date: ds }); }
    catch (e) { alert('خرابی: ' + (e.message === 'already_exists' ? 'یہ دن پہلے سے لگا ہے' : e.message)); return; }
    renderSupplyCalendar(); return;
  }
  const s = CALDAYS.find(x => x.id === id); if (!s) return;
  $('#calDetail').innerHTML = `
    <div class="caldetail">
      <h3>🚚 سپلائی: ${esc(s.supply_date)}</h3>
      <div class="supmeta">🧾 ${s.order_count} آرڈر</div>
      <div class="supmeta">🕙 آرڈر کھلے گا: <b>${esc(s.cutoff_date || '')} ${esc(s.open_time || CALDEF.open)}</b></div>
      <div class="supmeta">⏰ کٹ آف: <b>${esc(s.cutoff_date || '')} ${esc(s.cutoff_time || '')}</b></div>
      <div class="formgrid">
        <label>آرڈر کھلنے کا ٹائم<br><input type="time" id="calOt" value="${esc(s.open_time || CALDEF.open)}"></label>
        <label>کٹ آف ٹائم<br><input type="time" id="calCt" value="${esc(s.cutoff_time || CALDEF.cutoff)}"></label>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0">
        <button class="btn small green" onclick="calSaveCt(${s.id})">💾 ٹائم محفوظ کریں</button>
        <button class="btn small danger" onclick="calRemove(${s.id},${s.order_count})">🗑 یہ سپلائی ہٹائیں</button>
      </div>
      <div id="calMove"></div>
    </div>`;
  $('#calDetail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
async function calSaveCt(id) {
  const t = $('#calCt').value, o = $('#calOt').value;
  if (!t || !o) { alert('ٹائم لکھیں'); return; }
  try { await api('PUT', '/api/supply-days/' + id, { cutoff_time: t, open_time: o }); }
  catch (e) { alert('خرابی: ' + e.message); return; }
  alert('ٹائم اپڈیٹ ہو گیا ✅');
  renderSupplyCalendar();
}
async function calRemove(id, n) {
  if (n > 0) {
    const others = CALDAYS.filter(x => x.id !== id);
    if (!others.length) { alert('کوئی دوسرا سپلائی day نہیں — پہلے نیا دن لگائیں'); return; }
    $('#calMove').innerHTML = `<div class="formgrid" style="margin-top:10px">
      <label>آرڈرز کس دن منتقل کریں؟<br><select id="calMoveTo">${others.map(o => `<option value="${o.id}">${esc(o.supply_date)} (${o.order_count} آرڈر)</option>`).join('')}</select></label>
      <label><br><button class="btn small dark" onclick="calRemoveGo(${id})">⏭ منتقل کریں اور ہٹائیں</button></label></div>`;
    return;
  }
  if (!confirm('یہ سپلائی day ہٹائیں؟')) return;
  await api('DELETE', '/api/supply-days/' + id);
  renderSupplyCalendar();
}
async function calRemoveGo(id) {
  const to = $('#calMoveTo').value;
  try { await api('DELETE', `/api/supply-days/${id}?move_to=${to}`); }
  catch (e) { alert('خرابی: ' + e.message); return; }
  alert('آرڈرز منتقل ہو گئے ✅');
  renderSupplyCalendar();
}
async function renderOrderForm() {
  await refreshCache();
  const isShop = ME.role === 'shop';
  // Order catalog: every user who may place orders gets it, regardless of catalog-management permissions
  let catalog = null;
  try { catalog = await api('GET', '/api/order-catalog'); } catch (e) { catalog = null; }
  const cats = catalog ? catalog.cats : CACHE.cats;
  const products = catalog ? catalog.products : CACHE.products.filter(p => p.active);
  const routes = catalog ? catalog.routes : CACHE.routes.filter(r => r.active);
  const shopOpts = isShop
    ? `<input type="hidden" id="ofShop" value="${ME.shop_id}"><div class="kbd">🏪 دکان: <b>${esc(ME.shop_name || '')}</b></div>`
    : `<label>دکان<br><select id="ofShop">${CACHE.shops.filter(s => s.active).map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label>`;
  // Order window: opens at open_time on cutoff_date, closes at cutoff_time.
  // Nearest currently-OPEN supply day is auto-selected — shop never picks a date.
  const winTs = r => ({
    open: r.cutoff_date ? new Date(`${r.cutoff_date}T${r.open_time || '10:00'}:00+05:00`).getTime() : 0,
    cut: r.cutoff_date ? new Date(`${r.cutoff_date}T${r.cutoff_time || '23:59'}:00+05:00`).getTime() : Infinity,
  });
  const nowTs = Date.now();
  const bySup = (a, b) => String(a.supply_date).localeCompare(String(b.supply_date));
  const open = routes.filter(r => { if (!r.supply_date) return false; const w = winTs(r); return nowTs >= w.open && nowTs <= w.cut; }).sort(bySup);
  const sup = open[0] || null;
  const nextUp = routes.filter(r => { if (!r.supply_date) return false; return winTs(r).open > nowTs; }).sort(bySup)[0] || null;
  const catsHtml = cats.map(c => {
    const prods = products.filter(p => p.category_id === c.id);
    if (!prods.length) return '';
    return `<div class="cathead">${esc(c.name)}</div>` + prods.map(p =>
      `<div class="prow"><span class="pn">${esc(p.name)}</span><span class="un">${esc(p.unit_name || '')}</span>
       <input type="number" min="0" step="any" data-pid="${p.id}" placeholder="0"></div>`).join('');
  }).join('');
  $('#v-order').innerHTML = `
    <h2 class="st">🧾 <span>نیا آرڈر</span></h2>
    ${sup ? `
    <input type="hidden" id="ofRoute" value="${sup.id}">
    <input type="hidden" id="ofDate" value="${esc(sup.supply_date || '')}">
    <div class="supbanner">🚚 <b>سپلائی: ${esc(sup.supply_date || '')}</b> &nbsp; ⏰ کٹ آف: <b>${esc(sup.cutoff_date || '')} ${esc(sup.cutoff_time || '')}</b></div>
    <div id="ofCd"></div>`
    : nextUp ? `
    <input type="hidden" id="ofRoute" value=""><input type="hidden" id="ofDate" value="">
    <div class="lockbar">🕙 اگلی سپلائی (<b>${esc(nextUp.supply_date || '')}</b>) کے آرڈر <b>${esc(nextUp.cutoff_date || '')} ${esc(nextUp.open_time || '10:00')}</b> بجے کھلیں گے</div>
    <div id="ofCd"></div>`
    : `<div class="lockbar">📢 ابھی کوئی سپلائی announce نہیں ہوئی — اعلان کا انتظار کریں</div>
       <input type="hidden" id="ofRoute" value=""><input type="hidden" id="ofDate" value="">`}
    <div class="formgrid">
      ${shopOpts}
      <label>نوٹ<br><input id="ofNote" placeholder="اختیاری"></label>
    </div>
    ${catsHtml || '<p class="note">کوئی آئٹم نہیں — پہلے آئٹمز شامل کریں</p>'}
    <div class="err" id="ofErr"></div>
    <button class="btn green" onclick="submitOrder()"${sup ? '' : ' disabled'}>✅ آرڈر بھیجیں</button>`;
  if (sup) startCountdown(sup.cutoff_date, sup.cutoff_time, sup.name, 'ofCd');
  else if (nextUp) startCountdown(nextUp.cutoff_date, nextUp.open_time || '10:00', nextUp.name, 'ofCd',
    { cap: '🕙 آرڈر کھلنے میں باقی وقت', onDone: () => renderOrderForm() });
}
function cutoffPassedClient(cdate, ctime) {
  if (!cdate) return false;
  return Date.now() > new Date(`${cdate}T${ctime || '23:59'}:00+05:00`).getTime();
}
function lockOrderForm(locked, label) {
  document.querySelectorAll('#v-order input[data-pid]').forEach(i => { i.disabled = locked; if (locked) i.value = ''; });
  const btn = document.querySelector('#v-order button.btn.green');
  if (btn) btn.disabled = locked;
  let bar = $('#ofLock');
  if (locked && !bar) {
    bar = document.createElement('div');
    bar.id = 'ofLock';
    bar.className = 'lockbar';
    $('#v-order').prepend(bar);
  }
  if (bar) {
    bar.style.display = locked ? 'block' : 'none';
    if (locked) bar.innerHTML = `🔒 <b>${esc(label || '')}</b> کا کٹ آف وقت گزر چکا ہے — اس روٹ پر آرڈر بند ہے`;
  }
}
function orderRouteChanged() {
  const sel = $('#ofRoute'); if (!sel) return;
  const o = sel.options[sel.selectedIndex];
  const locked = !!(o && o.value && cutoffPassedClient(o.dataset.cd, o.dataset.ct));
  lockOrderForm(locked, o ? o.text : '');
  const box = $('#ofCd');
  if (o && o.dataset.cd) startCountdown(o.dataset.cd, o.dataset.ct, o.text, 'ofCd');
  else if (box) box.innerHTML = '';
  const d = $('#ofDate');
  if (d && o && o.dataset.sd) d.value = o.dataset.sd;
}
async function submitOrder() {
  $('#ofErr').textContent = '';
  const items = [...document.querySelectorAll('#v-order input[data-pid]')]
    .map(i => ({ product_id: Number(i.dataset.pid), quantity: Number(i.value) || 0 }))
    .filter(i => i.quantity > 0);
  if (!items.length) { $('#ofErr').textContent = 'کم از کم ایک آئٹم کی مقدار لکھیں'; return; }
  try {
    const routeId = Number($('#ofRoute').value) || null;
    if (!routeId) { $('#ofErr').textContent = 'روٹ منتخب کریں'; return; }
    await api('POST', '/api/orders', {
      shop_id: Number($('#ofShop').value), route_id: routeId,
      delivery_date: $('#ofDate').value, note: $('#ofNote').value, items,
    });
    alert('آرڈر محفوظ ہو گیا ✅');
    document.querySelectorAll('#v-order input[data-pid]').forEach(i => i.value = '');
  } catch (e) {
    $('#ofErr').textContent = e.message === 'cutoff_passed' ? '⏰ کٹ آف وقت گزر چکا — آرڈر بند ہے' : e.message === 'not_open_yet' ? '🕙 آرڈر ابھی نہیں کھلا — مقررہ وقت کا انتظار کریں' : e.message === 'route_required' ? 'روٹ منتخب کریں' : 'خرابی: ' + e.message;
  }
}

// ---------- orders list ----------
function orderCard(o) {
  const simg = o.shop_image ? '/images/' + o.shop_image : null;
  const items = o.items.map(i => `<div class="oitem"><span>${esc(i.product_name)}${i.category_name ? ` <small>(${esc(i.category_name)})</small>` : ''}</span><b>${esc(i.quantity)} ${esc(i.unit_name || '')}</b></div>`).join('');
  const acts = can('orders', 'full')
    ? `<div class="oacts"><button class="btn small ghost" onclick="editOrder(${o.id})">✏ ترمیم</button>
       <button class="btn small danger" onclick="delOrder(${o.id})">🗑 حذف</button></div>` : '';
  return `<div class="ocard">
    <div class="ochead">${shopAvatar(o.shop_name, simg)}
      <div class="ocmain"><div class="octitle">${esc(o.shop_name)} <span class="ordn">#${o.id}</span></div>
      <div class="ocsub">📅 ${esc(o.delivery_date || '—')}${o.route_name ? ` • 🛣 ${esc(o.route_name)}` : ''}</div></div>
    </div>
    <div class="oitems">${items || '<p class="note">کوئی آئٹم نہیں</p>'}</div>
    ${acts}
  </div>`;
}
async function renderOrders() {
  const defDate = ORD_FILTER_DATE || karachiToday(); ORD_FILTER_DATE = null;
  const q = `date=${defDate}`;
  const list = await api('GET', '/api/orders?' + q);
  $('#v-orders').innerHTML = `<h2 class="st">📦 <span>آرڈرز</span> <small class="note">(${esc(defDate)})</small></h2>
    <div class="formgrid"><label>تاریخ<br><input type="date" id="olDate" value="${defDate}"></label>
    <label>روٹ<br><select id="olRoute"><option value="">تمام</option>${CACHE.routes.map(r => `<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select></label>
    <label><br><button class="btn small dark" onclick="filterOrders()">🔍 دیکھیں</button></label></div>
    <div id="olBody" class="ocards">${list.map(orderCard).join('') || '<p class="note">کوئی آرڈر نہیں</p>'}</div>
    ${can('orders', 'full') ? '<button class="btn" onclick="showView(\'order\')">🧾 نیا آرڈر</button>' : ''}`;
}
let ORD_FILTER_DATE = null;
function gotoOrder(deliveryDate) {
  ORD_FILTER_DATE = deliveryDate || karachiToday();
  showView('orders');
}
async function filterOrders() {
  const d = $('#olDate').value, r = $('#olRoute').value;
  const list = await api('GET', `/api/orders?date=${d}${r ? '&route_id=' + r : ''}`);
  $('#olBody').innerHTML = list.map(orderCard).join('') || '<p class="note">کوئی آرڈر نہیں</p>';
}
async function delOrder(id) {
  if (!confirm('آرڈر حذف کریں؟')) return;
  await api('DELETE', '/api/orders/' + id);
  filterOrders();
}
async function editOrder(id) {
  const list = await api('GET', '/api/orders');
  const o = list.find(x => x.id === id); if (!o) return;
  const qty = {};
  o.items.forEach(i => qty[i.product_id] = i.quantity);
  const catsHtml = CACHE.cats.map(c => {
    const prods = CACHE.products.filter(p => p.active && p.category_id === c.id);
    if (!prods.length) return '';
    return `<div class="cathead">${esc(c.name)}</div>` + prods.map(p =>
      `<div class="prow"><span class="pn">${esc(p.name)}</span><span class="un">${esc(p.unit_name || '')}</span>
       <input type="number" min="0" step="any" data-pid="${p.id}" value="${qty[p.id] || ''}" placeholder="0"></div>`).join('');
  }).join('');
  $('#v-orders').innerHTML = `<h2 class="st">✏ <span>آرڈر میں ترمیم</span> (#${o.id} — ${esc(o.shop_name)})</h2>
    <div class="formgrid"><label>ڈیلیوری تاریخ<br><input type="date" id="eoDate" value="${esc(o.delivery_date)}"></label>
    <label>نوٹ<br><input id="eoNote" value="${esc(o.note || '')}"></label></div>
    ${catsHtml}<br><button class="btn green" onclick="saveEditOrder(${o.id})">💾 محفوظ کریں</button>
    <button class="btn ghost" onclick="renderOrders()">↩ واپس</button>`;
}
async function saveEditOrder(id) {
  const items = [...document.querySelectorAll('#v-orders input[data-pid]')]
    .map(i => ({ product_id: Number(i.dataset.pid), quantity: Number(i.value) || 0 }));
  await api('PUT', '/api/orders/' + id, { delivery_date: $('#eoDate').value, note: $('#eoNote').value, items });
  alert('محفوظ ہو گیا ✅'); renderOrders();
}

// ---------- history ----------
async function renderHistory() {
  const g = await api('GET', '/api/order-history');
  const dates = Object.keys(g).sort().reverse();
  const isShopUser = !!(typeof ME !== 'undefined' && ME && ME.shop_id);
  let shopSel = '';
  if (!isShopUser && can('shops', 'view')) {
    const shops = await api('GET', '/api/shops').catch(() => []);
    shopSel = `<label>دکان<br><select id="hsShop">${shops.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label>`;
  }
  $('#v-history').innerHTML = `<h2 class="st">🕘 <span>آرڈر ہسٹری</span></h2>
    <div class="formgrid">
      ${shopSel}
      <label>تاریخ<br><input type="date" id="hsDate" value="${karachiToday()}"></label>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
      <button class="btn small green" onclick="printShopHistory()">🖨 دکان وائز ہسٹری پرنٹ کریں</button>
      <button class="btn small dark" onclick="printDateHistory()">🖨 تاریخ وائز ہسٹری پرنٹ کریں</button>
    </div>`
    + (dates.map(d =>
    `<div class="histdate">📅 ${esc(d)}</div>` + g[d].map(o =>
      `<div class="kbd"><b>${esc(o.shop_name)}</b> — ${o.items.map(i => esc(i.product_name) + ': ' + esc(i.quantity) + ' ' + esc(i.unit_name || '')).join('، ')}</div>`
    ).join('')).join('') || '<p class="note">کوئی ہسٹری نہیں</p>');
}
function printShopHistory() {
  const sel = document.getElementById('hsShop');
  const sid = sel ? sel.value : ((typeof ME !== 'undefined' && ME && ME.shop_id) || '');
  if (!sid) { alert('دکان منتخب کریں'); return; }
  window.open('/print?type=shop_history&shop_id=' + encodeURIComponent(sid), '_blank');
}
function printDateHistory() {
  const d = (document.getElementById('hsDate') || {}).value;
  if (!d) { alert('تاریخ منتخب کریں'); return; }
  window.open('/print?type=date_history&date=' + encodeURIComponent(d), '_blank');
}

// ---------- masters ----------
const MASTER_CONF = {
  vehicles: { title: '🚚 گاڑیاں', fields: [['name', 'نام'], ['plate', 'نمبر پلیٹ']], cols: ['نام', 'نمبر پلیٹ'] },
  cats: { title: '🗂 کیٹیگریز', api: 'categories', fields: [['name', 'نام'], ['sort', 'ترتیب']], cols: ['نام', 'ترتیب'] },
  units: { title: '⚖ یونٹس', fields: [['name', 'نام']], cols: ['نام'] },
  shops: { title: '🏪 دکانیں', fields: [['name', 'نام'], ['phone', 'فون'], ['address', 'پتہ']], cols: ['نام', 'فون', 'پتہ'] },
};
// Rozana me kaun hai — tick ki halat ke liye
let _dailyIds = null;
async function getDailyIds() {
  if (_dailyIds) return _dailyIds;
  try {
    const [c, u, p, s] = await Promise.all([
      api('GET', '/api/daily-categories'), api('GET', '/api/daily-units'),
      api('GET', '/api/daily-products'), api('GET', '/api/daily-shops'),
    ]);
    _dailyIds = { category: new Set(c.map(x => x.id)), unit: new Set(u.map(x => x.id)), product: new Set(p.map(x => x.id)), shop: new Set(s.map(x => x.id)) };
  } catch (e) { _dailyIds = { category: new Set(), unit: new Set(), product: new Set(), shop: new Set() }; }
  return _dailyIds;
}
async function toggleDaily(kind, id, btn) {
  const ids = await getDailyIds();
  const on = !ids[kind].has(id);
  try {
    await api('POST', `/api/daily/toggle/${kind}/${id}`, { on });
    _dailyIds = null; // refresh
    // jis daily screen par hain wahi dobara
    ({ category: renderDailyCats, unit: renderDailyUnits, product: renderDailyProducts, shop: renderDailyShops })[kind]();
  } catch (e) {
    alert(e.message === 'in_use' ? '⚠️ Ye rozana me istemal ho raha hai — pehle uska data hatain' : 'خرابی: ' + e.message);
  }
}
async function renderMaster(key) {
  const conf = MASTER_CONF[key];
  const endpoint = conf.api || key;
  const sec = VIEW_SEC[key] || key;
  const list = await api('GET', '/api/' + endpoint);
  const isShops = key === 'shops';
  const rows = list.map(r => `<tr>${isShops ? `<td>${r.image ? `<img class="shimg" src="/images/${esc(r.image)}" alt="">` : '<span class="note">—</span>'}
    ${can(sec, 'full') ? `<br><label class="btn small ghost" style="cursor:pointer">🖼 <input type="file" accept="image/*" style="display:none" onchange="uploadShopImage(${r.id},this)"></label>` : ''}</td>` : ''}${conf.fields.map(([f]) => `<td>${esc(r[f])}</td>`).join('')}
    <td>${r.active === 0 ? '<span class="badge off">بند</span>' : '<span class="badge">فعال</span>'}
    ${can(sec, 'full') ? ` <button class="btn small ghost" onclick="masterEdit('${key}','${endpoint}',${r.id})">✏</button>
    <button class="btn small danger" onclick="masterDel('${endpoint}',${r.id},'${key}')">🗑</button>` : ''}</td></tr>`).join('');
  const form = can(sec, 'full') ? `
    <div class="formgrid" id="mf-${key}">
      ${conf.fields.map(([f, l]) => `<label>${l}<br><input id="mf-${key}-${f}"></label>`).join('')}
      <label><br><button class="btn small green" onclick="masterAdd('${key}','${endpoint}')">➕ شامل کریں</button></label>
    </div>` : '';
  $('#v-' + key).innerHTML = `<h2 class="st">${conf.title}</h2>${form}
    <table><tr>${isShops ? '<th>تصویر</th>' : ''}${conf.cols.map(c => `<th>${c}</th>`).join('')}<th>حالت</th></tr>${rows || `<tr><td colspan=5>خالی</td></tr>`}</table>`;
}
async function uploadShopImage(id, input) {
  const f = input.files && input.files[0]; if (!f) return;
  try {
    const fd = new FormData(); fd.append('file', f);
    const r = await fetch('/api/shops/' + id + '/image', { method: 'POST', body: fd });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'failed');
    renderMaster('shops');
  } catch (e) { alert('تصویر اپ لوڈ ناکام — صرف تصویر (زیادہ سے زیادہ 5MB)'); }
}
async function masterAdd(key, endpoint) {
  const conf = MASTER_CONF[key]; const body = {};
  for (const [f] of conf.fields) body[f] = $('#mf-' + key + '-' + f).value;
  await api('POST', '/api/' + endpoint, body);
  renderMaster(key);
}
async function masterDel(endpoint, id, key) {
  if (!confirm('حذف کریں؟')) return;
  await api('DELETE', `/api/${endpoint}/${id}`);
  renderMaster(key);
}
async function masterEdit(key, endpoint, id) {
  const list = await api('GET', '/api/' + endpoint);
  const r = list.find(x => x.id === id); if (!r) return;
  const conf = MASTER_CONF[key];
  const vals = {};
  for (const [f, l] of conf.fields) {
    const v = prompt(l + ':', r[f] ?? '');
    if (v === null) return; vals[f] = v;
  }
  await api('PUT', `/api/${endpoint}/${id}`, vals);
  renderMaster(key);
}
// routes (special: vehicle + dates + time)
async function renderRoutes() {
  await refreshCache();
  const rows = CACHE.routes.map(r => {
    const v = CACHE.vehicles.find(x => x.id === r.vehicle_id);
    return `<tr><td>${esc(r.name)}</td><td>${esc(v ? v.name : '—')}</td><td>${esc(r.supply_date || '—')}</td>
    <td>${esc(r.cutoff_date || '—')} ${esc(r.cutoff_time || '')}</td>
    <td>${can('routes', 'full') ? `<button class="btn small ghost" onclick="routeEdit(${r.id})">✏</button>
    <button class="btn small danger" onclick="routeDel(${r.id})">🗑</button>` : ''}</td></tr>`;
  }).join('');
  const form = can('routes', 'full') ? `
    <div class="formgrid">
      <label>روٹ کا نام<br><input id="rf-name"></label>
      <label>گاڑی<br><select id="rf-vehicle"><option value="">—</option>${CACHE.vehicles.filter(v => v.active).map(v => `<option value="${v.id}">${esc(v.name)}</option>`).join('')}</select></label>
      <label>سپلائی تاریخ<br><input type="date" id="rf-sdate"></label>
      <label>کٹ آف تاریخ<br><input type="date" id="rf-cdate"></label>
      <label>کٹ آف وقت<br><input type="time" id="rf-ctime"></label>
      <label><br><button class="btn small green" onclick="routeAdd()">➕ شامل کریں</button></label>
    </div>` : '';
  $('#v-routes').innerHTML = `<h2 class="st">🗺 <span>روٹس و شیڈول</span></h2>${form}
    <table><tr><th>روٹ</th><th>گاڑی</th><th>سپلائی تاریخ</th><th>کٹ آف</th><th></th></tr>${rows || '<tr><td colspan=5>خالی</td></tr>'}</table>`;
}
async function routeAdd() {
  await api('POST', '/api/routes', { name: $('#rf-name').value, vehicle_id: Number($('#rf-vehicle').value) || null,
    supply_date: $('#rf-sdate').value, cutoff_date: $('#rf-cdate').value, cutoff_time: $('#rf-ctime').value });
  renderRoutes();
}
async function routeDel(id) { if (!confirm('حذف کریں؟')) return; await api('DELETE', '/api/routes/' + id); renderRoutes(); }
async function routeEdit(id) {
  const r = CACHE.routes.find(x => x.id === id); if (!r) return;
  const name = prompt('روٹ کا نام:', r.name); if (name === null) return;
  const sdate = prompt('سپلائی تاریخ (YYYY-MM-DD):', r.supply_date || ''); if (sdate === null) return;
  const cdate = prompt('کٹ آف تاریخ (YYYY-MM-DD):', r.cutoff_date || ''); if (cdate === null) return;
  const ctime = prompt('کٹ آف وقت (HH:MM):', r.cutoff_time || ''); if (ctime === null) return;
  await api('PUT', '/api/routes/' + id, { name, vehicle_id: r.vehicle_id, supply_date: sdate, cutoff_date: cdate, cutoff_time: ctime, active: r.active });
  renderRoutes();
}
// products
async function renderProducts() {
  await refreshCache();
  // Category-wise group karo
  const byCat = {};
  CACHE.products.forEach(p => {
    const k = p.category_name || 'متفرق';
    (byCat[k] = byCat[k] || []).push(p);
  });
  const rows = Object.entries(byCat).map(([cn, items]) => `
    <tr><td colspan="4" style="background:#111;color:#fff;font-weight:bold;text-align:center;padding:8px">📂 ${esc(cn)} (${items.length} آئٹم)</td></tr>
    ${items.map(p => `<tr><td>${esc(p.category_name || '—')}</td><td><b>${esc(p.name)}</b></td><td>${esc(p.unit_name || '—')}</td>
    <td>${can('products', 'full') ? `<button class="btn small ghost" onclick="moveProduct(${p.id},'up')">↑</button><button class="btn small ghost" onclick="moveProduct(${p.id},'down')">↓</button>
    <button class="btn small ghost" onclick="prodEdit(${p.id})">✏</button>
    <button class="btn small danger" onclick="prodDel(${p.id})">🗑</button>` : ''}</td></tr>`).join('')}`).join('');
  const form = can('products', 'full') ? `
    <div class="formgrid">
      <label>کیٹیگری<br><select id="pf-cat">${CACHE.cats.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label>
      <label>آئٹم کا نام<br><input id="pf-name" placeholder="مثلاً Milky Bread Small"></label>
      <label>یونٹ<br><select id="pf-unit">${CACHE.units.map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select></label>
      <label><br><button class="btn small green" onclick="prodAdd()">➕ شامل کریں</button></label>
    </div>` : '';
  const isSuper = typeof ME !== 'undefined' && ME && ME.role === 'super_admin';
  // Rate Lists section
  let rateListsHtml = '';
  try {
    const rateLists = await api('GET', '/api/rate-lists');
    const isSuper2 = typeof ME !== 'undefined' && ME && ME.role === 'super_admin';
    rateListsHtml = `<div style="margin:16px 0;padding:12px;background:#f5f5f5;border-radius:12px">
      <h3>💰 ریٹ لسٹس</h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0">
        ${rateLists.map(rl => `<button type="button" class="btn small" style="background:#1a237e;color:#fff" onclick="showRateList(${rl.id},'${esc(rl.name)}')">📋 ${esc(rl.name)}</button>`).join('')}
        ${isSuper2 ? '<button type="button" class="btn small" style="background:#2e7d32;color:#fff" onclick="addRateList()">➕ نئی لسٹ</button>' : ''}
      </div>
      <div id="rateListDetail"></div>
    </div>`;
  } catch(e) {}
  $('#v-products').innerHTML = `<h2 class="st">🍞 <span>آئٹمز</span></h2>` + rateListsHtml + `
    <div style="margin-bottom:8px;display:flex;gap:8px">
      ${isSuper ? '<button class="btn small" style="background:#ff9800;color:#fff" onclick="cleanDuplicates()">🧹 ڈپلیکیٹ صاف کرو</button>' : ''}
      <button class="btn small" style="background:#1a237e;color:#fff" onclick="window.open('/print?type=catalog&cb='+Date.now(),'_blank')">🖨 کیٹلاگ پرنٹ</button>
    </div>${form}
    <table><tr><th>کیٹیگری</th><th>نام</th><th>یونٹ</th><th></th></tr>${rows || '<tr><td colspan=4>خالی</td></tr>'}</table>`;
}
async function addRateList() {
  const name = prompt('ریٹ لسٹ کا نام (مثلاً: Wholesale, Distributor):');
  if (!name || !name.trim()) return;
  try {
    await api('POST', '/api/rate-lists', { name: name.trim() });
    renderProducts();
  } catch(e) { alert('Error: ' + (e.message || '')); }
}
async function showRateList(id, name) {
  const box = document.getElementById('rateListDetail');
  if (!box) return;
  box.innerHTML = '<p>لوڈ ہو رہا ہے...</p>';
  try {
    const prices = await api('GET', '/api/rate-lists/' + id + '/prices');
    const isSuper = typeof ME !== 'undefined' && ME && ME.role === 'super_admin';
    let html = `<div id="rlPrint-${id}"><h4>📋 ${esc(name)} — ریٹ لسٹ</h4>`;
    // Group by category
    const cats = {};
    prices.forEach(p => {
      const cat = p.category_name || 'دیگر';
      if (!cats[cat]) cats[cat] = [];
      cats[cat].push(p);
    });
    Object.keys(cats).sort().forEach(cat => {
      const catId = cats[cat][0] ? cats[cat][0].category_id : null;
      html += `<div style="margin-top:10px;background:#1a237e;color:#fff;padding:6px 12px;border-radius:8px;font-weight:bold;display:flex;justify-content:space-between;align-items:center">
        <span>📁 ${esc(cat)}</span>
        ${isSuper && catId ? `<button type="button" class="btn small" style="background:#fff;color:#1a237e;padding:2px 10px" onclick="addProductToCat(${catId},${id})" title="اس کیٹیگری میں آئٹم شامل کریں">➕</button>` : ''}
      </div>`;
      html += '<table><tr><th>آئٹم</th><th>ریٹ (Rs)</th></tr>';
      cats[cat].forEach((p, idx) => {
        const isHidden = p.visible === 0;
        if (!isSuper && isHidden) return;
        const iconBtn = 'width:30px;height:30px;border:none;border-radius:50%;cursor:pointer;font-size:14px;display:inline-flex;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,0.2);transition:transform 0.15s';
        html += `<tr style="${isHidden ? 'opacity:0.5;background:#f5f5f5' : ''}"><td style="padding:8px">` +
          `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">` +
          (isSuper ? `<input type="number" value="${idx + 1}" min="1" style="width:46px;padding:5px;border:2px solid #1a237e;border-radius:8px;text-align:center;font-weight:bold;color:#1a237e" onchange="setSerial(${p.product_id},this.value,${id})" title="نمبر بدلیں">`
                   : `<span style="background:#1a237e;color:#fff;border-radius:50%;width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center;font-weight:bold;font-size:13px">${idx + 1}</span>`) +
          `<span style="font-size:15px;font-weight:600">${esc(p.product_name)}</span>` +
          (isSuper ? `<span style="display:inline-flex;gap:5px;margin-right:auto">
            <button type="button" style="${iconBtn};background:#e3f2fd" onclick="editProduct(${p.product_id},'${esc(p.product_name)}',${id})" title="نام بدلیں">✏️</button>
            <button type="button" style="${iconBtn};background:${isHidden ? '#f3e5f5' : '#e8f5e9'}" onclick="toggleVisible(${p.product_id},${isHidden ? 1 : 0},${id})" title="${isHidden ? 'دکھائیں' : 'چھپائیں'}">${isHidden ? '🚫' : '👁️'}</button>
            <button type="button" style="${iconBtn};background:#ffebee" onclick="delProduct(${p.product_id},${id})" title="حذف کریں">🗑️</button>
          </span>` : '') +
          `</div></td><td>` +
          (isSuper ? `<input type="number" id="rlp-${id}-${p.product_id}" value="${p.price}" min="0" step="0.5" style="width:90px;padding:6px;border:2px solid #43a047;border-radius:8px;text-align:center;font-weight:bold">`
                   : `<b>${p.price}</b>`) + '</td></tr>';
      });
      html += '</table>';
    });
    html += '</div>';
    html += `<div style="margin-top:10px;display:flex;gap:8px">
      <button type="button" class="btn" style="background:#1a237e;color:#fff" onclick="printRateList(${id},'${esc(name)}')">🖨 پرنٹ کریں</button>
      ${isSuper ? `<button type="button" class="btn" style="background:#2e7d32;color:#fff" onclick="saveRateList(${id})">💾 ریٹ محفوظ کریں</button>
      <button type="button" class="btn small danger" onclick="delRateList(${id})">🗑 لسٹ حذف</button>` : ''}
    </div>`;
    box.innerHTML = html;
  } catch(e) { box.innerHTML = '<p>Error loading</p>'; }
}
function printRateList(id, name) {
  const el = document.getElementById('rlPrint-' + id);
  if (!el) return;
  const w = window.open('', '_blank');
  w.document.write('<html><head><title>' + name + ' — Rate List</title><style>' +
    'body{font-family:"Noto Nastaliq Urdu",serif;direction:rtl;padding:20px}' +
    'table{width:100%;border-collapse:collapse;margin-bottom:12px}' +
    'th,td{border:1px solid #333;padding:8px;text-align:right}' +
    'th{background:#eee}h4{text-align:center;font-size:20px}' +
    'input{border:none;font-weight:bold;width:60px}' +
    '</style></head><body><h4>🏭 گلشن فیکٹری — ' + name + ' ریٹ لسٹ</h4>' + el.innerHTML.replace(/<h4>.*?<\/h4>/, '') +
    '<p style="text-align:center;color:#888;font-size:12px">Printed: ' + new Date().toLocaleDateString('ur-PK') + '</p></body></html>');
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 500);
}
async function saveRateList(id) {
  const inputs = document.querySelectorAll(`[id^="rlp-${id}-"]`);
  const prices = {};
  inputs.forEach(inp => {
    const pid = inp.id.replace(`rlp-${id}-`, '');
    prices[pid] = parseFloat(inp.value) || 0;
  });
  try {
    await api('POST', '/api/rate-lists/' + id + '/prices', { prices });
    alert('✅ ریٹ محفوظ ہو گئے!');
  } catch(e) { alert('Error: ' + (e.message || '')); }
}
async function addProductToCat(catId, rateListId) {
  const name = prompt('نئے آئٹم کا نام:');
  if (!name || !name.trim()) return;
  try {
    await api('POST', '/api/products', { name: name.trim(), category_id: catId });
    showRateList(rateListId, document.querySelector('#rateListDetail h4')?.textContent?.replace('📋','').replace('— ریٹ لسٹ','').trim() || '');
  } catch(e) { alert('Error: ' + (e.message || '')); }
}
async function editProduct(pid, oldName, rateListId) {
  const name = prompt('نیا نام:', oldName);
  if (!name || !name.trim() || name.trim() === oldName) return;
  try {
    await api('PUT', '/api/products/' + pid, { name: name.trim() });
    showRateList(rateListId, document.querySelector('#rateListDetail h4')?.textContent?.replace(/📋|— ریٹ لسٹ/g,'').trim() || '');
  } catch(e) { alert('Error: ' + (e.message || '')); }
}
async function delProduct(pid, rateListId) {
  if (!confirm('یہ آئٹم تمام ریٹ لسٹس سے حذف ہو جائے گا! جاری رکھیں؟')) return;
  try {
    await api('DELETE', '/api/products/' + pid);
    showRateList(rateListId, document.querySelector('#rateListDetail h4')?.textContent?.replace(/📋|— ریٹ لسٹ/g,'').trim() || '');
  } catch(e) { alert('Error: ' + (e.message || '')); }
}
async function setSerial(pid, newPos, rateListId) {
  try {
    const prices = await api('GET', '/api/rate-lists/' + rateListId + '/prices');
    const catId = prices.find(x => x.product_id === pid)?.category_id;
    const sorted = prices.filter(p => p.category_id === catId).sort((a,b) => (a.sort_order||0) - (b.sort_order||0));
    const newIdx = Math.max(0, Math.min(sorted.length - 1, parseInt(newPos, 10) - 1));
    const item = sorted.find(p => p.product_id === pid);
    sorted.splice(sorted.indexOf(item), 1);
    sorted.splice(newIdx, 0, item);
    // Rewrite sort orders sequentially
    for (let i = 0; i < sorted.length; i++) {
      await api('PUT', '/api/products/' + sorted[i].product_id, { sort_order: (i + 1) * 10 });
    }
    showRateList(rateListId, document.querySelector('#rateListDetail h4')?.textContent?.replace(/📋|— ریٹ لسٹ/g,'').trim() || '');
  } catch(e) { alert('Error: ' + (e.message || '')); }
}
async function toggleVisible(pid, visible, rateListId) {
  try {
    await api('POST', '/api/rate-lists/' + rateListId + '/visibility', { product_id: pid, visible: !!visible });
    showRateList(rateListId, document.querySelector('#rateListDetail h4')?.textContent?.replace(/📋|— ریٹ لسٹ/g,'').trim() || '');
  } catch(e) { alert('Error: ' + (e.message || '')); }
}
async function moveProduct(pid, dir, rateListId) {
  try {
    // Get current sort orders and swap
    const prices = await api('GET', '/api/rate-lists/' + rateListId + '/prices');
    const sorted = prices.filter(p => p.category_id === prices.find(x => x.product_id === pid)?.category_id)
      .sort((a,b) => (a.sort_order||0) - (b.sort_order||0));
    const idx = sorted.findIndex(p => p.product_id === pid);
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;
    const a = sorted[idx], b = sorted[swapIdx];
    await api('PUT', '/api/products/' + a.product_id, { sort_order: b.sort_order || 0 });
    await api('PUT', '/api/products/' + b.product_id, { sort_order: a.sort_order || 0 });
    // If equal, set explicit orders
    if ((a.sort_order||0) === (b.sort_order||0)) {
      await api('PUT', '/api/products/' + a.product_id, { sort_order: idx + dir });
      await api('PUT', '/api/products/' + b.product_id, { sort_order: idx });
    }
    showRateList(rateListId, document.querySelector('#rateListDetail h4')?.textContent?.replace(/📋|— ریٹ لسٹ/g,'').trim() || '');
  } catch(e) { alert('Error: ' + (e.message || '')); }
}
async function delRateList(id) {
  if (!confirm('یہ ریٹ لسٹ حذف کریں؟')) return;
  try {
    await api('DELETE', '/api/rate-lists/' + id);
    renderProducts();
  } catch(e) { alert('Error: ' + (e.message || '')); }
}
async function prodAdd() {
  await api('POST', '/api/products', { name: $('#pf-name').value, category_id: Number($('#pf-cat').value) || null, unit_id: Number($('#pf-unit').value) || null });
  renderProducts();
}
async function prodDel(id) { if (!confirm('حذف کریں؟')) return; await api('DELETE', '/api/products/' + id); renderProducts(); }
async function moveProduct(id, dir) {
  await api('POST', `/api/products/${id}/move`, { dir });
  renderProducts();
}
async function cleanDuplicates() {
  if (!confirm('ڈپلیکیٹ آئٹمز صاف کریں؟ (پہلا رکھا جائے گا، باقی بند ہوں گے)')) return;
  const r = await api('POST', '/api/products/clean-duplicates', {});
  alert(r.cleaned + ' ڈپلیکیٹ صاف ہو گئے!');
  renderProducts();
}
async function prodEdit(id) {
  const p = CACHE.products.find(x => x.id === id); if (!p) return;
  const name = prompt('آئٹم کا نام:', p.name); if (name === null) return;
  await api('PUT', '/api/products/' + id, { name, category_id: p.category_id, unit_id: p.unit_id, active: p.active });
  renderProducts();
}

// ---------- reports ----------
async function renderReports() {
  $('#v-reports').innerHTML = `<h2 class="st">🖨 <span>رپورٹس — پروڈکشن شیٹ</span></h2>
    <div class="formgrid">
      <label>تاریخ<br><input type="date" id="rpDate" value="${karachiToday()}"></label>
      <label>روٹ<br><select id="rpRoute"><option value="">تمام روٹس</option>${CACHE.routes.map(r => `<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select></label>
      <label><br><button class="btn small dark" onclick="loadTotals()">🔍 ٹوٹل دیکھیں</button></label>
    </div>
    <div id="rpBody"></div>
    <div id="rpPrint"></div>`;
  loadTotals();
}
// ==================== Tray & Basket module ====================
let TRAY = { items: [], tab: 'dash' };
async function renderTray() {
  const el = $('#v-tray');
  const full = can('tray_basket', 'full'); // super_admin: entry + opening
  const isShop = ME.role === 'shop';
  try { TRAY.items = await api('GET', '/api/tray/items'); } catch (e) { TRAY.items = []; }
  const tabs = [['dash', '📊 ڈیش بورڈ']];
  if (full) { tabs.push(['ret', '📥 واپسی انٹری']); }
  tabs.push(['ledger', '🧾 کھاتہ']);
  tabs.push(['report', '🖨 رپورٹ']);
  if (!tabs.some(t => t[0] === TRAY.tab)) TRAY.tab = 'dash';
  const tabNames = {dash:'📊 ڈیش بورڈ', ret:'📥 واپسی انٹری', ledger:'🧾 کھاتہ', report:'🖨 رپورٹ'};
  const curTabName = tabNames[TRAY.tab] || tabNames.dash;
  el.innerHTML = `<h2 class="st">🧺 <span>ٹرے اور باسکٹ</span></h2>
    <div class="tray-dropdown-wrap" id="trayDD">
      <button class="tray-dropdown-btn" onclick="document.getElementById('trayDD').classList.toggle('open')">
        <span style="font-weight:700">${curTabName}</span>
        <span class="tray-dd-arrow">▼</span>
      </button>
      <div class="tray-dropdown-menu">
        ${tabs.map(t => `<button class="${TRAY.tab === t[0] ? 'active' : ''}" onclick="TRAY.tab='${t[0]}';renderTray()"><span style="font-size:20px">${t[1].split(' ')[0]}</span><span style="font-weight:700">${t[1].split(' ').slice(1).join(' ')}</span>${TRAY.tab === t[0] ? '<span style="margin-right:auto;color:#2e7d32;font-weight:bold">✓</span>' : ''}</button>`).join('')}
      </div>
    </div>
    <div id="trayBody" style="margin-top:12px"></div>
    <script>setTimeout(() => { document.addEventListener('click', function _tdd(e) { const dd = document.getElementById('trayDD'); if (dd && !dd.contains(e.target)) dd.classList.remove('open'); }); }, 100);</script>`;
  if (TRAY.tab === 'dash') renderTrayDash();
  else if (TRAY.tab === 'ret') renderTrayVoucher('ret');
  else if (TRAY.tab === 'opening') renderTrayOpening();
  else if (TRAY.tab === 'ledger') renderTrayLedger();
  else renderTrayReport();
}
async function showTrayNoticeForm() {
  const box = document.getElementById('trayNoticeForm');
  if (!box) return;
  box.innerHTML = `<div style="background:#fff;border:2px solid #ff9800;border-radius:12px;padding:14px;margin-bottom:12px">
    <h4>📢 نیا اعلان</h4>
    <input type="text" id="tnTitle" placeholder="عنوان (optional)" style="width:100%;padding:8px;margin:6px 0;border:1px solid #ddd;border-radius:8px">
    <textarea id="tnMsg" placeholder="پیغام لکھیں..." style="width:100%;padding:8px;margin:6px 0;border:1px solid #ddd;border-radius:8px;min-height:60px"></textarea>
    <select id="tnType" style="padding:8px;margin:6px 0;border:1px solid #ddd;border-radius:8px">
      <option value="none">صرف متن</option>
      <option value="image">تصویر</option>
      <option value="gif">GIF اینیمیشن</option>
      <option value="video">ویڈیو</option>
    </select>
    <input type="text" id="tnUrl" placeholder="میڈیا URL (تصویر/ویڈیو کا لنک) یا نیچے فائل اپلوڈ کریں" style="width:100%;padding:8px;margin:6px 0;border:1px solid #ddd;border-radius:8px">
    <div style="margin:6px 0"><label style="font-size:13px">📤 یا ویڈیو/تصویر اپلوڈ کریں:<br><input type="file" id="tnFile" accept="video/*,image/*,.gif" style="margin-top:4px"></label></div>
    <div id="tnUploadStatus" style="font-size:12px;color:#666"></div>
    <div style="margin-top:8px">
      <button type="button" class="btn" onclick="saveTrayNotice()" style="background:#2e7d32;color:#fff">💾 محفوظ کریں</button>
      <button type="button" class="btn" onclick="document.getElementById('trayNoticeForm').innerHTML=''" style="background:#999;color:#fff">❌ منسوخ</button>
    </div>
  </div>`;
}
async function saveTrayNotice() {
  const title = document.getElementById('tnTitle').value;
  const message = document.getElementById('tnMsg').value;
  const media_type = document.getElementById('tnType').value;
  let media_url = document.getElementById('tnUrl').value;
  const fileInput = document.getElementById('tnFile');
  // Upload file first if selected
  if (fileInput && fileInput.files && fileInput.files[0]) {
    const status = document.getElementById('tnUploadStatus');
    status.textContent = '⏳ اپلوڈ ہو رہا ہے...';
    const fd = new FormData();
    fd.append('file', fileInput.files[0]);
    try {
      const resp = await fetch('/api/tray/notices/upload', { method: 'POST', body: fd, credentials: 'same-origin' });
      const data = await resp.json();
      if (data.ok && data.url) {
        media_url = data.url;
        status.textContent = '✅ اپلوڈ ہو گیا!';
      } else {
        status.textContent = '❌ اپلوڈ ناکام';
        return;
      }
    } catch(e) { document.getElementById('tnUploadStatus').textContent = '❌ اپلوڈ ناکام'; return; }
  }
  if (!message.trim() && !media_url.trim()) { alert('پیغام یا میڈیا دیں!'); return; }
  try {
    await api('POST', '/api/tray/notices', { title, message, media_url, media_type });
    renderTrayDash();
  } catch(e) { alert('Error: ' + (e.message || '')); }
}
async function showTrayAccessForm() {
  const box = document.getElementById('trayAccessForm');
  if (!box) return;
  let users = [];
  try { users = await api('GET', '/api/users'); } catch(e) {}
  const userOpts = users.filter(u => u.role !== 'super_admin').map(u => `<option value="${u.id}">${esc(u.username)} (${u.role})</option>`).join('');
  box.innerHTML = `<div style="background:#fff;border:2px solid #5c6bc0;border-radius:12px;padding:14px;margin-bottom:12px">
    <h4>🔐 صارف کی دکان رسائی</h4>
    <p style="font-size:12px;color:#666">کس صارف کو کون سی دکانیں نظر آئیں گی؟ (خالی = سب نظر آئیں گی)</p>
    <select id="taUser" style="width:100%;padding:8px;margin:6px 0;border:1px solid #ddd;border-radius:8px" onchange="loadUserShops(this.value)">
      <option value="">صارف منتخب کریں...</option>${userOpts}
    </select>
    <div id="taShops" style="margin:8px 0"></div>
    <div style="margin-top:8px">
      <button type="button" class="btn" onclick="saveUserShops()" style="background:#2e7d32;color:#fff">💾 محفوظ کریں</button>
      <button type="button" class="btn" onclick="document.getElementById('trayAccessForm').innerHTML=''" style="background:#999;color:#fff">❌ منسوخ</button>
    </div>
  </div>`;
}
async function loadUserShops(userId) {
  const box = document.getElementById('taShops');
  if (!box || !userId) { box.innerHTML = ''; return; }
  let assigned = [];
  try { assigned = await api('GET', '/api/tray/user-shops/' + userId); } catch(e) {}
  const assignedSet = new Set(assigned.map(a => a.shop_type + '_' + a.shop_id));
  let shops = [];
  try { shops = await api('GET', '/api/tray/shop-options'); } catch(e) {}
  box.innerHTML = '<div style="max-height:200px;overflow-y:auto;border:1px solid #ddd;border-radius:8px;padding:8px">' +
    shops.map(s => {
      const parts = s.value.match(/^([ds])(\d+)$/);
      if (!parts) return '';
      const st = parts[1] === 'd' ? 'daily' : 'shop';
      const sid = parseInt(parts[2], 10);
      const key = st + '_' + sid;
      const checked = assignedSet.has(key) ? 'checked' : '';
      return `<label style="display:block;padding:4px;cursor:pointer"><input type="checkbox" data-st="${st}" data-sid="${sid}" ${checked}> ${esc(s.name)}</label>`;
    }).join('') + '</div>' +
    '<p style="font-size:11px;color:#888;margin-top:4px">نوٹ: کچھ بھی منتخب نہ کریں تو صارف کو سب دکانیں نظر آئیں گی</p>';
}
async function saveUserShops() {
  const userId = document.getElementById('taUser').value;
  if (!userId) { alert('صارف منتخب کریں!'); return; }
  const checked = document.querySelectorAll('#taShops input[type="checkbox"]:checked');
  const shops = Array.from(checked).map(c => ({ shop_type: c.dataset.st, shop_id: parseInt(c.dataset.sid, 10) }));
  try {
    await api('POST', '/api/tray/user-shops', { user_id: userId, shops });
    alert('✅ رسائی محفوظ ہو گئی!');
    document.getElementById('trayAccessForm').innerHTML = '';
  } catch(e) { alert('Error: ' + (e.message || '')); }
}
async function delTrayNotice(id) {
  if (!confirm('یہ اعلان حذف کریں؟')) return;
  try {
    await api('DELETE', '/api/tray/notices/' + id);
    renderTrayDash();
  } catch(e) { alert('Error: ' + (e.message || '')); }
}
function showTrayToast(title, subtitle) {
  // Remove existing toast
  const old = document.getElementById('trayToast');
  if (old) old.remove();
  const toast = document.createElement('div');
  toast.id = 'trayToast';
  toast.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px">
      <div style="font-size:36px;animation:trayBounce 0.6s ease">✅</div>
      <div>
        <div style="font-weight:700;font-size:16px;color:#1b5e20">${title}</div>
        ${subtitle ? `<div style="font-size:13px;color:#555;margin-top:2px">${subtitle}</div>` : ''}
      </div>
    </div>
    <div style="margin-top:10px;height:4px;background:#e8f5e9;border-radius:2px;overflow:hidden">
      <div id="trayToastBar" style="height:100%;width:100%;background:linear-gradient(90deg,#43a047,#2e7d32);border-radius:2px;transition:width 3s linear"></div>
    </div>`;
  toast.style.cssText = `
    position:fixed;top:20px;left:50%;transform:translateX(-50%) translateY(-100px);
    background:#fff;border:2px solid #43a047;border-radius:16px;
    padding:16px 20px;box-shadow:0 10px 30px rgba(46,125,50,0.25);
    z-index:9999;min-width:280px;max-width:90vw;
    font-family:'Noto Nastaliq Urdu','Jameel Noori Nastaleeq',serif;
    opacity:0;transition:all 0.4s cubic-bezier(0.4,0,0.2,1);`;
  document.body.appendChild(toast);
  // Animate in
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
  });
  // Animate progress bar
  setTimeout(() => { const bar = document.getElementById('trayToastBar'); if (bar) bar.style.width = '0%'; }, 50);
  // Auto-hide after 3 seconds
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(-100px)';
    setTimeout(() => toast.remove(), 400);
  }, 3000);
}
async function renderTrayDash() {
  const box = document.getElementById('trayBody');
  const isShop = ME.role === 'shop';
  let s;
  try { s = await api('GET', '/api/tray/summary'); }
  catch (e) { box.innerHTML = '<p>لوڈ نہیں ہو سکا</p>'; return; }
  const period = window._trayPeriod || 'today';
  // Fetch voucher totals for period
  let pdata = {};
  try {
    let fromStr = '';
    // Use Karachi date for consistent filtering (not browser local)
    const khiToday = karachiToday();
    const khiDate = new Date(khiToday + 'T12:00:00');
    const khiStr = (dt) => dt.getFullYear() + '-' + String(dt.getMonth()+1).padStart(2,'0') + '-' + String(dt.getDate()).padStart(2,'0');
    if (period === 'today') fromStr = khiToday;
    else if (period === 'week') { const d = new Date(khiDate); d.setDate(khiDate.getDate()-7); fromStr = khiStr(d); }
    else if (period === 'month') { const d = new Date(khiDate); d.setMonth(khiDate.getMonth()-1); fromStr = khiStr(d); }
    else if (period === 'yesterday') { const d = new Date(khiDate); d.setDate(khiDate.getDate()-1); fromStr = khiStr(d); }
    else if (period === 'custom') { fromStr = window._trayFrom || ''; }
    let toStr = (period === 'custom' && window._trayTo) ? window._trayTo : '';
    if (period === 'today') toStr = khiToday;
    else if (period === 'week') toStr = khiToday;
    else if (period === 'month') toStr = khiToday;
    else if (period === 'yesterday') { const d = new Date(khiDate); d.setDate(khiDate.getDate()-1); toStr = khiStr(d); }
    let vurl = '/api/tray/vouchers';
    if (fromStr) vurl += '?from='+fromStr;
    if (typeof toStr !== 'undefined' && toStr) vurl += (fromStr ? '&' : '?') + 'to='+toStr;
    const pv = await api('GET', vurl);
    window._trayEarliest = null;
    pv.forEach(v => {
      const k = v.shop_type + '_' + v.shop_id + '_' + v.item_id;
      pdata[k] = (pdata[k]||0) + (v.returned||0);
      if (v.date && (!window._trayEarliest || v.date < window._trayEarliest)) {
        window._trayEarliest = v.date;
      }
    });
  } catch(e) {}
  // Set date range text after pdata is loaded
  {
    const fmtD = (d) => d.toLocaleDateString('ur-PK', {day:'numeric', month:'short', year:'numeric'});
    const now2 = new Date();
    let rangeTxt = '';
    if (period === 'today') rangeTxt = '📅 ' + fmtD(now2);
    else if (period === 'yesterday') { const d = new Date(now2); d.setDate(now2.getDate()-1); rangeTxt = '📅 ' + fmtD(d); }
    else if (period === 'week') { const d = new Date(now2); d.setDate(now2.getDate()-7); rangeTxt = '📅 ' + fmtD(d) + ' سے ' + fmtD(now2); }
    else if (period === 'month') { const d = new Date(now2); d.setMonth(now2.getMonth()-1); rangeTxt = '📅 ' + fmtD(d) + ' سے ' + fmtD(now2); }
    else if (period === 'custom') {
      const f = window._trayFrom, t = window._trayTo;
      if (f && t) rangeTxt = '📅 ' + fmtD(new Date(f)) + ' سے ' + fmtD(new Date(t));
      else if (f) rangeTxt = '📅 ' + fmtD(new Date(f)) + ' سے اب تک';
      else rangeTxt = '📅 تاریخ منتخب کریں';
    }
    else {
      const earliest = window._trayEarliest;
      if (earliest) { const d = new Date(earliest); rangeTxt = '📅 ' + fmtD(d) + ' سے ' + fmtD(now2) + ' (تمام ریکارڈ)'; }
      else rangeTxt = '📅 شروع سے اب تک (تمام ریکارڈ)';
    }
    // Update after HTML is set (use timeout to ensure DOM exists)
    setTimeout(() => { const el = document.getElementById('trayRange'); if (el) el.innerHTML = '🗓️ رپورٹ: ' + rangeTxt; }, 0);
    // Also store for immediate use
    window._trayRangeTxt = '🗓️ رپورٹ: ' + rangeTxt;
  }
  const getQty = (sh, itemId) => {
    const k = sh.shop_type + '_' + sh.id + '_' + itemId;
    return pdata[k] || 0;
  };
  let html = '';
  const pb = (v,t) => '<button class="tfbtn ' + (period===v?'on':'') + '" onclick="window._trayPeriod=\''+v+'\';renderTrayDash()">'+t+'</button>';
  const showCustom = period === 'custom' ? '' : 'style="display:none"';
  // Date range label
  const fmtD = (d) => d.toLocaleDateString('ur-PK', {day:'numeric', month:'short', year:'numeric'});
  const now2 = new Date();
  let rangeTxt = '';
  if (period === 'today') rangeTxt = '📅 ' + fmtD(now2);
  else if (period === 'yesterday') { const d = new Date(now2); d.setDate(now2.getDate()-1); rangeTxt = '📅 ' + fmtD(d); }
  else if (period === 'week') { const d = new Date(now2); d.setDate(now2.getDate()-7); rangeTxt = '📅 ' + fmtD(d) + ' سے ' + fmtD(now2); }
  else if (period === 'month') { const d = new Date(now2); d.setMonth(now2.getMonth()-1); rangeTxt = '📅 ' + fmtD(d) + ' سے ' + fmtD(now2); }
  else {
    const earliest = window._trayEarliest;
    if (earliest) {
      const d = new Date(earliest);
      rangeTxt = '📅 ' + fmtD(d) + ' سے ' + fmtD(now2) + ' (تمام ریکارڈ)';
    } else {
      rangeTxt = '📅 شروع سے اب تک (تمام ریکارڈ)';
    }
  }
  const cf = window._trayFrom || '', ct = window._trayTo || '';
  html += '<div class="tray-filters"><div class="frow"><b>📅 مدت:</b>' + pb('today','آج') + pb('yesterday','کل') + pb('week','اس ہفتہ') + pb('month','اس مہینہ') + pb('all','تمام') + pb('custom','اپنی مرضی') + '</div>' +
    '<div class="frow" ' + showCustom + '><b>از:</b><input type="date" id="trayFrom" value="' + cf + '" style="padding:6px;border:2px solid #e8e0d0;border-radius:8px">' +
    '<b>تا:</b><input type="date" id="trayTo" value="' + ct + '" style="padding:6px;border:2px solid #e8e0d0;border-radius:8px">' +
    '<button class="tfbtn on" onclick="window._trayFrom=document.getElementById(\'trayFrom\').value;window._trayTo=document.getElementById(\'trayTo\').value;renderTrayDash()">🔍 دیکھیں</button></div>' +
    '<div id="trayRange" style="margin-top:6px;color:#8a6d3b;font-weight:bold">🗓️ رپورٹ: ' + rangeTxt + '</div></div>';
  // Notices/announcements (super admin only to manage)
  try {
    const notices = await api('GET', '/api/tray/notices');
    if (notices && notices.length) {
      html += '<div style="margin-bottom:12px">' + notices.map(n => {
        const isVideoOnly = n.media_type === 'video' && !n.message.trim() && !n.title.trim();
        let media = '';
        if (n.media_url) {
          if (n.media_type === 'video') {
            const url = n.media_url;
            const plyrId = 'plyr-' + n.id;
            const ytMatch = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
            if (ytMatch) {
              media = '<div id="' + plyrId + '" data-plyr-provider="youtube" data-plyr-embed-id="' + ytMatch[1] + '"></div>';
            } else {
              media = '<video id="' + plyrId + '" playsinline autoplay muted loop controls style="width:100%;border-radius:12px"><source src="' + esc(url) + '"></video>';
            }
            setTimeout(() => {
              const el = document.getElementById(plyrId);
              if (el && typeof Plyr !== 'undefined') { new Plyr('#' + plyrId, { autoplay: true, muted: true, controls: ['play', 'progress', 'current-time', 'mute', 'volume', 'fullscreen'] }); }
            }, 100);
          } else if (n.media_type === 'image' || n.media_type === 'gif') {
            media = '<div style="margin-top:8px"><img src="' + esc(n.media_url) + '" style="max-width:100%;border-radius:10px;max-height:300px"></div>';
          }
        }
        const delBtn = (typeof ME !== 'undefined' && ME && ME.role === 'super_admin') ? '<div style="text-align:center;padding:8px"><button type="button" class="btn small" style="background:#c62828;color:#fff" onclick="delTrayNotice(' + n.id + ')">🗑️ حذف</button></div>' : '';
        // Video-only: no yellow box, just the video
        if (isVideoOnly) {
          return '<div style="margin-bottom:10px;border-radius:12px;overflow:hidden">' + media + delBtn + '</div>';
        }
        return '<div style="background:linear-gradient(135deg,#fff3e0,#ffe0b2);border:2px solid #ff9800;border-radius:14px;padding:14px;margin-bottom:10px">' +
          '<div style="font-size:16px;font-weight:bold;color:#e65100">📢 ' + esc(n.title || 'اعلان') + '</div>' +
          '<div style="margin-top:6px;font-size:14px;color:#4e342e;white-space:pre-wrap">' + esc(n.message) + '</div>' +
          media + delBtn + '</div>';
      }).join('') + '</div>';
    }
    // Super admin add notice button + access management
    if (typeof ME !== 'undefined' && ME && ME.role === 'super_admin') {
      html += '<div style="margin-bottom:12px;text-align:center;display:flex;gap:8px;justify-content:center;flex-wrap:wrap">' +
        '<button type="button" class="btn" onclick="showTrayNoticeForm()" style="background:#ff9800;color:#fff">📢 نیا اعلان</button>' +
        '<button type="button" class="btn" onclick="showTrayAccessForm()" style="background:#5c6bc0;color:#fff">🔐 رسائی سیٹ کریں</button></div>' +
        '<div id="trayNoticeForm"></div><div id="trayAccessForm"></div>';
    }
  } catch(e) {}
  // Today's simple summary (no factory stock)
  {
    const todayStr = karachiToday();
    let todayRet = {};
    try {
      const tv = await api('GET', '/api/tray/vouchers?from='+todayStr+'&to='+todayStr);
      tv.forEach(v => {
        const k = v.item_id;
        todayRet[k] = (todayRet[k]||0) + (v.returned||0);
      });
    } catch(e) {}
    const tItems = (s.items||[]).map(it => ({it, q: todayRet[it.id]||0}));
    const isBasket = (it) => { const nm = (it.name_ur + ' ' + it.name_en).toLowerCase(); return nm.includes('باسکٹ') || nm.includes('basket'); };
    const trayTot = tItems.filter(x => !isBasket(x.it)).reduce((a,x) => a+x.q, 0);
    const basketTot = tItems.filter(x => isBasket(x.it)).reduce((a,x) => a+x.q, 0);
    html += '<div style="background:linear-gradient(135deg,#2e7d32,#43a047);border-radius:16px;padding:18px;color:#fff;text-align:center;margin-bottom:12px">' +
      '<div style="font-size:18px;font-weight:bold;margin-bottom:10px">📅 آج کی واپسی</div>' +
      '<div style="display:flex;gap:10px;justify-content:center">' +
      tItems.map(x => '<div style="background:rgba(255,255,255,.2);border-radius:10px;padding:10px 16px"><div style="font-size:24px;font-weight:800">'+x.q+'</div><div style="font-size:12px">'+x.it.icon+' '+x.it.name_ur+'</div></div>').join('') +
      '</div><div style="margin-top:10px;font-size:14px;opacity:.95">🍽️ ٹرے: <b style="font-size:20px">'+trayTot+'</b> &nbsp;&nbsp; 🧺 باسکٹ: <b style="font-size:20px">'+basketTot+'</b></div></div>';
  }
  // Item totals
  if (s.items && s.shops) {
    const tots = s.items.map(it => {
      let t = 0;
      s.shops.forEach(sh => { t += getQty(sh, it.id); });
      return {it, t};
    });
    const grand = tots.reduce((a,x) => a+x.t, 0);
    html += '<h3 style="margin-top:12px">📊 آئٹم وائز ٹوٹل</h3><div class="cards">' +
      tots.map(x => '<div class="card"><div class="n">'+x.t+'</div><div class="l">'+x.it.icon+' '+x.it.name_ur+'</div></div>').join('') +
      '<div class="card" style="background:linear-gradient(135deg,#2e7d32,#43a047)"><div class="n">'+grand+'</div><div class="l">📋 کل ٹوٹل</div></div></div>';
  }
  // Shop boxes
  const colors = ['sb1','sb2','sb3','sb4','sb5','sb6','sb7','sb8','sb9'];
  let ci = 0;
  const mkBox = (sh) => {
    const cls = colors[ci++ % colors.length];
    const items = s.items.filter(it => {
      const nm = (it.name_ur + ' ' + it.name_en).toLowerCase();
      const isArif = nm.includes('عارف') || nm.includes('arif');
      const isGen = nm.includes('عام') || nm.includes('general');
      if (sh.shop_type === 'daily') return !isArif;  // daily: hide Arif Tray
      if (sh.id === 0 || sh.shop_type !== 'daily') return !isGen;  // supply: hide General Tray
      return true;
    }).map(it => ({it, q: getQty(sh, it.id)}));
    const total = items.reduce((a,x) => a+x.q, 0);
    const shopVal = (sh.shop_type === 'daily' ? 'd' : 's') + sh.id;
    return '<div class="shop-box '+cls+'" onclick="TRAY.tab=\'ret\';window._trayShop=\''+shopVal+'\';renderTray()" style="cursor:pointer" title="انٹری کے لیے دبائیں"><div class="sname">'+esc(sh.name)+'</div>' +
      '<div class="sitems">' + items.map(x => '<div class="si"><div class="e">'+x.it.icon+'</div><div class="v">'+x.q+'</div></div>').join('') + '</div>' +
      '<div class="stotal"><div class="tv">'+total+'</div><div class="tl">کل</div></div></div>';
  };
  // Filter shops by user's assigned access (super_admin/factory see all)
  let myShopFilter = null;
  try {
    const myShops = await api('GET', '/api/tray/my-shops');
    if (!myShops.all && myShops.shops && myShops.shops.length) {
      myShopFilter = new Set(myShops.shops.map(x => x.shop_type + '_' + x.shop_id));
    }
  } catch(e) {}
  if (s.shops) {
    let allShops = s.shops;
    if (myShopFilter) {
      allShops = allShops.filter(sh => myShopFilter.has(sh.shop_type + '_' + sh.id));
    }
    const sup = allShops.filter(sh => sh.shop_type !== 'daily');
    const daily = allShops.filter(sh => sh.shop_type === 'daily');
    if (sup.length) html += '<h3 style="margin-top:14px">🚚 سپلائی</h3><div class="shop-boxes">' + sup.map(mkBox).join('') + '</div>';
    if (daily.length) html += '<h3 style="margin-top:14px">📝 روزانہ دکانیں ('+daily.length+')</h3><div class="shop-boxes">' + daily.map(mkBox).join('') + '</div>';
  }
  // Item settings (super admin only)
  if (ME.role === 'super_admin' && s.items) {
    html += '<h3 style="margin-top:16px">🏷️ آئٹم سیٹنگ</h3><div style="background:#fff;border-radius:12px;padding:12px">' +
      s.items.map(it => '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px;border-bottom:1px solid #f0f0f0">' +
        '<span>' + it.icon + ' <b>' + esc(it.name_ur) + '</b></span>' +
        '<span><button class="btn small" onclick="editTrayItem(' + it.id + ')">✏️</button> ' +
        '<button class="btn small" style="background:#c62828;color:#fff" onclick="delTrayItem(' + it.id + ')">🗑️</button></span></div>').join('') +
      '<button class="btn" style="margin-top:8px" onclick="addTrayItem()">➕ نیا آئٹم</button>' +
      '<button class="btn" style="margin-top:8px;background:#c62828;color:#fff" onclick="resetTrayData()">🗑️ سارا ڈیٹا ری سیٹ</button></div>';
  }
  box.innerHTML = html;
}

// Combined shop list: regular shops + daily shops (tray module)
async function trayShopOptions(selected, typeFilter) {
  let opts = [];
  try { opts = await api('GET', '/api/tray/shop-options').catch(() => []); } catch (e) {}
  // typeFilter: 'shop' = only supply, 'daily' = only daily, undefined = all
  return opts
    .filter(o => !typeFilter || o.type === typeFilter)
    .map(o => `<option value="${o.value}"${selected === o.value ? ' selected' : ''}>${esc(o.name)}</option>`).join('');
}
function trayParseShop(v) {
  if (!v) return { shop_id: 0, shop_type: 'shop' };
  return v[0] === 'd'
    ? { shop_id: parseInt(v.slice(1), 10) || 0, shop_type: 'daily' }
    : { shop_id: parseInt(v.slice(1), 10) || 0, shop_type: 'shop' };
}

async function renderTrayVoucher(kind, keepShop) {
  const isSent = kind === 'sent';
  const box = $('#trayBody');
  // Preserve selected shop across re-renders
  const prevShop = keepShop || (window._trayShop || 's0');
  let vehicles = [];
  try { vehicles = await api('GET', '/api/vehicles').catch(() => []); } catch (e) {}
  const shopOpts = await trayShopOptions(prevShop);
  // Filter items by shop type: Arif Supply gets Arif Tray, daily gets General Tray, both get Basket
  const filterItems = () => {
    const sh = trayParseShop(prevShop || 's0');
    return TRAY.items.filter(it => {
      const key = (it.key || '').toLowerCase();
      const ur = (it.name_ur || '');
      const en = (it.name_en || '').toLowerCase();
      const isArifTray = key.includes('arif') || ur.includes('عارف') || en.includes('arif');
      const isGeneralTray = key.includes('general') || ur.includes('عام') || en.includes('general');
      if (sh.shop_type === 'daily') return !isArifTray;  // daily: hide Arif Tray
      return !isGeneralTray;  // Arif Supply: hide General Tray
    });
  };
  const itemCards = filterItems().map(it => `
    <div class="tv-item" style="background:#fff;border:2px solid #e0e0e0;border-radius:12px;padding:12px;margin:8px 0;display:flex;align-items:center;justify-content:space-between">
      <div style="font-size:16px;font-weight:bold">${it.icon} ${it.name_ur}<br><small style="color:#888">${it.name_en}</small></div>
      <div style="display:flex;gap:8px;align-items:center">
        <input type="number" id="tvQ_${it.id}" value="0" min="0" inputmode="numeric" style="width:90px;text-align:center;font-size:28px;font-weight:bold;border:2px solid #e8721c;border-radius:10px;padding:8px" onfocus="this.select()">
      </div>
    </div>`).join('');
  box.innerHTML = `<div style="margin-bottom:10px"><button type="button" class="btn" onclick="TRAY.tab='dash';renderTray()" style="background:#616161;color:#fff">⬅️ ڈیش بورڈ واپس</button></div>
    <h3>${isSent ? '📤 بھیجا — Sent' : '📥 واپس — Return'}</h3>
    <div class="formgrid" style="margin-bottom:8px">
      <label>📅 تاریخ<br><input type="date" id="tvDate" value="${karachiToday()}"></label>
      <label>🏪 دکان<br><select id="tvShop" style="font-size:16px" onchange="window._trayShop=this.value;renderTrayVoucher('ret',this.value)">${shopOpts}</select></label>
      ${isSent ? `<label>🚚 گاڑی<br><select id="tvVeh"><option value="">—</option>${vehicles.map(v => `<option value="${v.id}">${esc(v.name)}</option>`).join('')}</select></label>` : ''}
      <label>📝 نوٹ<br><input type="text" id="tvNote" placeholder="اختیاری"></label>
    </div>
    <div style="margin:12px 0 4px;font-weight:bold;color:#555">${isSent ? '➡️ کتنی بھیجی؟ (ہر آئٹم)' : '⬅️ کتنی واپس آئی؟ (ہر آئٹم)'}</div>
    ${itemCards}
    <button class="btn green" style="width:100%;padding:16px;font-size:20px;margin-top:12px;border-radius:12px" onclick="saveTrayVoucher('${kind}')">💾 ${isSent ? 'بھیجا' : 'واپس'} محفوظ کریں</button>
    <div id="tvMsg" style="margin-top:10px"></div>
    <div id="tvList" style="margin-top:16px"></div>`;
  loadTrayVoucherList();
}
async function loadTrayVoucherList() {
  const box = $('#tvList');
  if (!box) return;
  // Filter by selected shop - use dropdown value directly for accuracy
  const shopVal = ($('#tvShop') && $('#tvShop').value) ? $('#tvShop').value : (window._trayShop || 's0');
  const sh = trayParseShop(shopVal);
  let url = '/api/tray/vouchers?shop_id=' + sh.shop_id + '&shop_type=' + sh.shop_type + '&_t=' + Date.now();
  let rows = [];
  try { rows = await api('GET', url); } catch (e) {}
  rows = rows.slice(0, 20);
  window._trayVoucherRows = rows;
  const shopName = ($('#tvShop') && $('#tvShop').selectedOptions[0]) ? $('#tvShop').selectedOptions[0].text : '';
  box.innerHTML = `<h4 style="margin:8px 0">📝 ${esc(shopName)} — پچھلی انٹریز (${rows.length})</h4>
    <div style="overflow-x:auto"><table class="tbl"><tr><th>تاریخ</th><th>واؤچر</th><th>دکان</th><th>آئٹم</th><th>تعداد</th><th>عمل</th></tr>` +
    (rows.map(r => {
      const qty = r.sent || r.returned;
      const type = r.sent ? '📤' : '📥';
      return `<tr><td>${r.date}</td><td>${r.voucher_no}</td><td>${esc(r.shop_name)}</td><td>${r.item_icon} ${r.item_ur}</td><td><b>${type} ${qty}</b></td>
      <td style="white-space:nowrap">
        <button class="btn small" onclick="editTrayVoucher(${r.id})">✏️</button>
        <button class="btn small" style="background:#c62828;color:#fff" onclick="delTrayVoucher(${r.id})">🗑️</button>
      </td></tr>`;
    }).join('') || '<tr><td colspan="6">کوئی واؤچر نہیں</td></tr>') + `</table></div>`;
}
async function editTrayVoucher(id) {
  // Get voucher from the already-loaded list (no extra API call)
  const rows = window._trayVoucherRows || [];
  const v = rows.find(r => r.id === id);
  if (!v) { alert('واؤچر نہیں ملا'); return; }
  // Set shop first and re-render to show correct items
  const shopVal = (v.shop_type === 'daily' ? 'd' : 's') + v.shop_id;
  window._trayShop = shopVal;
  await renderTrayVoucher('ret', shopVal);
  // Fill form after render
  const dEl = $('#tvDate');
  if (dEl) dEl.value = v.date || '';
  TRAY.items.forEach(it => {
    const qEl = $('#tvQ_' + it.id);
    if (qEl) qEl.value = (it.id === v.item_id) ? (v.sent || v.returned || 0) : 0;
  });
  const nEl = $('#tvNote');
  if (nEl) nEl.value = v.notes || '';
  window._editingVoucher = id;
  const mEl = $('#tvMsg');
  if (mEl) mEl.innerHTML = `<div class="note">✏️ واؤچر <b>${v.voucher_no}</b> ایڈٹ ہو رہا ہے — محفوظ دبائیں</div>
    <button class="btn small" onclick="cancelTrayEdit()">❌ منسوخ</button>`;
  window.scrollTo(0, 0);
}
function cancelTrayEdit() {
  window._editingVoucher = null;
  TRAY.items.forEach(it => { $('#tvQ_' + it.id).value = 0; });
  $('#tvNote').value = '';
  $('#tvMsg').innerHTML = '';
}
async function delTrayVoucher(id) {
  if (!confirm('Voucher delete karna hai?')) return;
  try {
    await api('DELETE', '/api/tray/vouchers/' + id);
    loadTrayVoucherList();
  } catch (e) { alert('Error: ' + (e.message || '')); }
}
function tvItemAdj(id, n) {
  const el = $('#tvQ_' + id);
  el.value = Math.max(0, (Number(el.value) || 0) + n);
  el.closest('.tv-item').style.borderColor = Number(el.value) > 0 ? '#4caf50' : '#e0e0e0';
}
async function saveTrayVoucher(kind) {
  const isSent = kind === 'sent';
  const sh = trayParseShop($('#tvShop').value);
  const qtys = TRAY.items.map(it => {
    const el = $('#tvQ_' + it.id);
    return { id: it.id, qty: el ? (Number(el.value) || 0) : 0 };
  }).filter(x => x.qty > 0);
  if (!qtys.length) { $('#tvMsg').innerHTML = `<div class="err">❌ کوئی تعداد نہیں لکھی</div>`; return; }
  // Edit mode: update single voucher
  if (window._editingVoucher) {
    const q = qtys[0];
    if (!q) { $('#tvMsg').innerHTML = `<div class="err">❌ تعداد لکھیں</div>`; return; }
    try {
      await api('PUT', '/api/tray/vouchers/' + window._editingVoucher, {
        date: $('#tvDate').value, shop_id: sh.shop_id, shop_type: sh.shop_type,
        vehicle_id: ($('#tvVeh') && $('#tvVeh').value) ? Number($('#tvVeh').value) : null,
        item_id: q.id, sent: isSent ? q.qty : 0, returned: isSent ? 0 : q.qty, notes: $('#tvNote').value,
      });
      $('#tvMsg').innerHTML = `<div class="note">✅ واؤچر اپڈیٹ ہو گیا!</div>`;
      window._editingVoucher = null;
      TRAY.items.forEach(it => { $('#tvQ_' + it.id).value = 0; });
      $('#tvNote').value = '';
      loadTrayVoucherList();
    } catch (e) { $('#tvMsg').innerHTML = `<div class="err">❌ ${e.message || 'خرابی'}</div>`; }
    return;
  }
  $('#tvMsg').innerHTML = '<p>محفوظ ہو رہا ہے...</p>';
  let ok = 0, vnos = [];
  let lastErr = '';
  for (const q of qtys) {
    try {
      const r = await api('POST', '/api/tray/vouchers', {
        date: $('#tvDate').value, shop_id: sh.shop_id, shop_type: sh.shop_type,
        vehicle_id: ($('#tvVeh') && $('#tvVeh').value) ? Number($('#tvVeh').value) : null,
        item_id: q.id, sent: isSent ? q.qty : 0, returned: isSent ? 0 : q.qty, notes: $('#tvNote').value,
      });
      ok++; vnos.push(r.voucher_no);
    } catch (e) { lastErr = (e.detail ? e.detail + ' | ' : '') + (e.message || ''); }
  }
  if (!ok && lastErr) {
    $('#tvMsg').innerHTML = `<div class="err">❌ Save nahi hua: ${lastErr}</div>`;
    return;
  }
  $('#tvMsg').innerHTML = `<div class="note">✅ ${ok} واؤچر محفوظ! <b>${vnos.join(', ')}</b></div>
    <div style="margin-top:8px"><button class="btn small dark" onclick="printLastTrayVouchers('${kind}')">🖨 پرنٹ کریں</button></div>`;
  showTrayToast(`✅ ${ok} واؤچر محفوظ!`, vnos.join(', '));
  TRAY.items.forEach(it => { window['_tvPQ_' + it.id] = Number($('#tvQ_' + it.id).value) || 0; $('#tvQ_' + it.id).value = 0; $('#tvQ_' + it.id).closest('.tv-item').style.borderColor = '#e0e0e0'; });
  $('#tvNote').value = '';
  window._lastTrayVouchers = vnos;
  // Sync shop before reloading list
  if ($('#tvShop')) window._trayShop = $('#tvShop').value;
  // Small delay to ensure server has committed, then reload
  setTimeout(() => loadTrayVoucherList(), 300);
}
async function renderTrayOpening() {
  const box = $('#trayBody');
  const shopOpts = await trayShopOptions(prevShop);
  let opening = [];
  try { opening = await api('GET', '/api/tray/opening'); } catch (e) {}
  box.innerHTML = `<h3>🏭 اوپننگ اسٹاک — Opening Stock</h3>
    <div class="formgrid">
      <label>جگہ<br><select id="toShop"><option value="s0">🏭 فیکٹری</option>${shopOpts}</select></label>
      <label>آئٹم<br><select id="toItem">${TRAY.items.map(i => `<option value="${i.id}">${i.icon} ${i.name_ur}</option>`).join('')}</select></label>
      <label>تعداد<br><input type="number" id="toQty" value="0" min="0"></label>
      <label><br><button class="btn green" onclick="saveTrayOpening()">💾 محفوظ کریں</button></label>
    </div><div id="toMsg" style="margin:8px 0"></div>
    <h3>موجودہ اوپننگ</h3>
    <table class="tbl"><tr><th>جگہ</th><th>آئٹم</th><th>تعداد</th><th>عمل</th></tr>
    ${opening.map(o => `<tr><td>${esc(o.shop_name || '')}</td><td>${o.icon} ${o.name_ur}</td><td><b>${o.qty}</b></td>
      <td style="white-space:nowrap">
        <button class="btn small" onclick="editTrayOpening(${o.shop_id},'${o.shop_type}',${o.item_id},${o.qty})">✏️</button>
        <button class="btn small" style="background:#c62828;color:#fff" onclick="delTrayOpening(${o.shop_id},'${o.shop_type}',${o.item_id})">🗑️</button>
      </td></tr>`).join('') || '<tr><td colspan="4">کوئی اوپننگ نہیں</td></tr>'}</table>`;
    box.innerHTML += `<h3 style="margin-top:16px">🏷️ آئٹم کے نام (Edit Items)</h3>
    <table class="tbl"><tr><th>آئیکون</th><th>اردو نام</th><th>English</th><th>عمل</th></tr>
    ${TRAY.items.map(it => `<tr><td style="font-size:20px">${it.icon}</td><td>${esc(it.name_ur)}</td><td>${esc(it.name_en)}</td>
      <td style="white-space:nowrap"><button class="btn small" onclick="editTrayItem(${it.id})">✏️</button> <button class="btn small" style="background:#c62828;color:#fff" onclick="delTrayItem(${it.id})">🗑️</button></td></tr>`).join('')}</table>
    <div style="margin-top:8px"><button class="btn green small" onclick="addTrayItem()">➕ نیا آئٹم</button></div>
    <div id="tiMsg" style="margin-top:8px"></div>`;
}
function editTrayOpening(shopId, shopType, itemId, qty) {
  $('#toShop').value = (shopType === 'daily' ? 'd' : 's') + shopId;
  $('#toItem').value = itemId;
  $('#toQty').value = qty;
  $('#toQty').focus();
  $('#toMsg').innerHTML = '<div class="note">✏️ ایڈٹ کریں اور محفوظ دبائیں</div>';
  window.scrollTo(0, 0);
}
async function delTrayOpening(shopId, shopType, itemId) {
  if (!confirm('Delete karna hai?')) return;
  try {
    await api('DELETE', '/api/tray/opening', { shop_id: shopId, shop_type: shopType, item_id: itemId });
    renderTrayOpening();
  } catch (e) { alert('Error: ' + (e.message || '')); }
}


async function resetTrayData() {
  if (!confirm('⚠️ کیا آپ واقعی سارا ٹرے ڈیٹا ڈیلیٹ کرنا چاہتے ہیں؟\nیہ واپس نہیں آئے گا!')) return;
  if (!confirm('آخری وارننگ! تمام واؤچر ڈیلیٹ ہو جائیں گے۔ جاری رکھیں؟')) return;
  try {
    const r = await api('DELETE', '/api/tray/vouchers');
    alert('✅ ' + (r.deleted || 0) + ' واؤچر ڈیلیٹ ہو گئے!');
    renderTrayDash();
  } catch(e) { alert('❌ ' + (e.message || 'Error')); }
}
function delTrayItem(id) {
  if (!confirm('Item delete karna hai?')) return;
  api('DELETE', '/api/tray/items/' + id)
    .then(() => { renderTray(); })
    .catch(e => alert('Error: ' + (e.message || '')));
}
function addTrayItem() {
  const icon = prompt('آئیکون (emoji):', '📦');
  if (icon === null) return;
  const ur = prompt('اردو نام:');
  if (!ur) return;
  const en = prompt('English name:') || '';
  api('POST', '/api/tray/items', { icon: icon, name_ur: ur, name_en: en })
    .then(() => { renderTray(); })
    .catch(e => alert('Error: ' + (e.message || '')));
}

function editTrayItem(id) {
  const it = TRAY.items.find(x => x.id === id);
  if (!it) return;
  const icon = prompt('آئیکون (emoji):', it.icon);
  if (icon === null) return;
  const ur = prompt('اردو نام:', it.name_ur);
  if (ur === null) return;
  const en = prompt('English name:', it.name_en);
  if (en === null) return;
  api('PUT', '/api/tray/items/' + id, { icon: icon, name_ur: ur, name_en: en })
    .then(() => {
      $('#tiMsg').innerHTML = '<div class="note">✅ نام اپڈیٹ ہو گیا!</div>';
      TRAY.items.find(x => x.id === id).icon = icon;
      TRAY.items.find(x => x.id === id).name_ur = ur;
      TRAY.items.find(x => x.id === id).name_en = en;
      renderTrayOpening();
    })
    .catch(e => { $('#tiMsg').innerHTML = '<div class="err">❌ ' + (e.message || '') + '</div>'; });
}

async function saveTrayOpening() {
  try {
    const sh = trayParseShop($('#toShop').value);
    await api('PUT', '/api/tray/opening', { shop_id: sh.shop_id, shop_type: sh.shop_type, item_id: Number($('#toItem').value), qty: Number($('#toQty').value) || 0 });
    $('#toMsg').innerHTML = `<div class="note">✅ اوپننگ محفوظ ہو گئی</div>`;
    renderTrayOpening();
  } catch (e) { $('#toMsg').innerHTML = `<div class="err">❌ ${e.message || 'خرابی'}</div>`; }
}


function printLastTrayVouchers(kind) {
  const isSent = kind === 'sent';
  const shopSel = $('#tvShop');
  const shopName = shopSel ? shopSel.options[shopSel.selectedIndex].text : '';
  const date = $('#tvDate') ? $('#tvDate').value : '';
  const note = $('#tvNote') ? $('#tvNote').value : '';
  const vnos = window._lastTrayVouchers || [];
  const rows = TRAY.items.map(it => {
    const q = window['_tvPQ_' + it.id] || 0;
    return q > 0 ? `<tr><td style="text-align:center;font-size:20px">${it.icon}</td><td><b>${it.name_ur}</b><br><small>${it.name_en}</small></td><td style="text-align:center;font-size:22px"><b>${q}</b></td></tr>` : '';
  }).join('');
  // Re-read quantities from a snapshot saved at print time
  const html = `
    <div style="background:linear-gradient(135deg,#1a1a2e,#e8721c);color:#fff;padding:14px 20px;border-radius:12px;text-align:center;margin-bottom:12px">
      <h1 style="margin:0;font-size:26px;font-weight:700">🧺 ٹرے اور باسکٹ رپورٹ — گلشن فیکٹری</h1>
      <div style="margin-top:6px;font-size:12px;opacity:.9">📅 ${karachiToday()}${f.length ? ' | ' + f.join('، ') : ''}</div>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:12px">
      <div style="flex:1;background:#fff3e0;border:2px solid #e8721c;border-radius:10px;padding:8px;text-align:center">
        <div style="font-size:22px;font-weight:800;color:#e8721c">${t.r}</div><div style="font-size:11px">📥 کل واپس</div>
      </div>
      <div style="flex:1;background:#e3f2fd;border:2px solid #1565c0;border-radius:10px;padding:8px;text-align:center">
        <div style="font-size:22px;font-weight:800;color:#1565c0">${rows.length}</div><div style="font-size:11px">🧾 واؤچر</div>
      </div>
      ${itemRows ? `<div style="flex:2;background:#f3e5f5;border:2px solid #7b1fa2;border-radius:10px;padding:8px;text-align:center">
        <div style="font-size:11px;margin-bottom:4px">🧺 آئٹم وائز</div>
        <div style="display:flex;gap:8px;justify-content:center">${Object.entries(sum.byItem).map(([k,v]) => `<span style="font-size:12px"><b>${v.icon} ${v.r}</b> ${k}</span>`).join('')}</div>
      </div>` : ''}
    </div>
    ${(() => {
    const typeF = ($('#trShopType') && $('#trShopType').value) || '';
    const mkPTable = (list, title) => {
      if (typeF && ((typeF === 'daily') !== (title === '📝 روزانہ دکانیں'))) return '';
      if (!list.length) return '';
      const t2 = list.reduce((a, r) => ({ r: a.r + r.returned }), { r: 0 });
      const tc = title.includes('سپلائی') ? '#e8721c' : '#7b1fa2';
      return `<div style="margin-bottom:12px;break-inside:avoid">
      <div style="display:flex;align-items:center;gap:8px;margin:12px 0 6px">
        <div style="width:10px;height:10px;border-radius:50%;background:${tc}"></div>
        <div style="font-size:19px;font-weight:700">${title}</div>
        <div style="margin-right:auto;background:#f0f0f0;padding:3px 14px;border-radius:12px;font-size:12px;font-weight:700">${list.length} واؤچر</div>
      </div>
      <table style="width:100%;border-collapse:separate;border-spacing:0;font-size:15px;border-radius:10px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,.08)">
      <tr><th style="padding:9px 6px;background:${tc};color:#fff">#</th><th style="padding:9px 6px;background:${tc};color:#fff">تاریخ</th><th style="padding:9px 6px;background:${tc};color:#fff">واؤچر</th><th style="padding:9px 6px;background:${tc};color:#fff">دکان</th><th style="padding:9px 6px;background:${tc};color:#fff">آئٹم</th><th style="padding:9px 6px;background:${tc};color:#fff">واپس</th></tr>` +
      list.map((r, i) => `<tr><td style="padding:8px 6px;text-align:center;border-bottom:1px solid #f0f0f0;background:${i%2 ? '#fafafa' : '#fff'}"><b>${i+1}</b></td><td style="padding:8px 6px;text-align:center;border-bottom:1px solid #f0f0f0;background:${i%2 ? '#fafafa' : '#fff'}">${r.date}</td><td style="padding:8px 6px;text-align:center;border-bottom:1px solid #f0f0f0;background:${i%2 ? '#fafafa' : '#fff'}"><b>${r.voucher_no}</b></td><td style="padding:8px 6px;border-bottom:1px solid #f0f0f0;background:${i%2 ? '#fafafa' : '#fff'}">${r.shop_name}</td><td style="padding:8px 6px;border-bottom:1px solid #f0f0f0;background:${i%2 ? '#fafafa' : '#fff'}">${r.item_icon || ''} ${r.item_ur}</td><td style="padding:8px 6px;text-align:center;border-bottom:1px solid #f0f0f0;background:${i%2 ? '#fafafa' : '#fff'}"><b style="font-size:16px">${r.returned}</b></td></tr>`).join('') +
      `<tr><td colspan="5" style="padding:9px 6px;text-align:center;background:#1a1a2e;color:#fff;font-weight:700">ٹوٹل</td><td style="padding:9px 6px;text-align:center;background:#1a1a2e;color:#fff;font-weight:700;font-size:16px">${t2.r}</td></tr></table></div>`;
    };
    return mkPTable(rows.filter(r => r.shop_type !== 'daily'), '🏪 سپلائی دکانیں') + mkPTable(rows.filter(r => r.shop_type === 'daily'), '📝 روزانہ دکانیں');
  })()}
    <p style="margin-top:12px;text-align:center;color:#999;font-size:11px">دستخط: ___________________</p>`;
  const w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
}

async function renderTrayLedger() {
  const box = $('#trayBody');
  const shopOpts = await trayShopOptions(window._trayShop || 's0');
  box.innerHTML = `<h3>🧾 دکان کا کھاتہ — Shop Ledger</h3>
    <div class="formgrid">
      <label>🏪 دکان منتخب کریں<br><select id="tlShop">${shopOpts}</select></label>
      <label><br><button class="btn small dark" onclick="loadTrayLedger()">🔍 کھاتہ دیکھیں</button></label>
    </div><div id="tlBody"></div>`;
}
async function loadTrayLedger() {
  const val = $('#tlShop').value;
  if (!val) return;
  const sh = trayParseShop(val);
  const box = $('#tlBody');
  box.innerHTML = '<p>لوڈ ہو رہا ہے...</p>';
  let vouchers = [], opening = [];
  try {
    const [v, o] = await Promise.all([
      api('GET', '/api/tray/vouchers').catch(() => []),
      api('GET', '/api/tray/opening').catch(() => []),
    ]);
    vouchers = v.filter(r => r.shop_id === sh.shop_id && r.shop_type === sh.shop_type);
    opening = o.filter(r => r.shop_id === sh.shop_id && r.shop_type === sh.shop_type);
  } catch (e) { box.innerHTML = '<p>لوڈ نہیں ہو سکا</p>'; return; }
  const shopName = vouchers.length ? vouchers[0].shop_name : (opening.length ? opening[0].shop_name : 'دکان');
  // Per-item summary
  const items = {};
  for (const o of opening) {
    const k = o.item_id;
    if (!items[k]) items[k] = { icon: o.icon, ur: o.name_ur, op: 0, s: 0, r: 0 };
    items[k].op += o.qty;
  }
  for (const v of vouchers) {
    const k = v.item_id;
    if (!items[k]) items[k] = { icon: v.item_icon, ur: v.item_ur, op: 0, s: 0, r: 0 };
    items[k].s += v.sent; items[k].r += v.returned;
  }
  const sumRows = Object.values(items).map(t =>
    `<tr><td>${t.icon} ${t.ur}</td><td>${t.op}</td><td>${t.s}</td><td>${t.r}</td><td><b>${t.op + t.s - t.r}</b></td></tr>`).join('');
  const tot = Object.values(items).reduce((a, t) => ({ op: a.op + t.op, s: a.s + t.s, r: a.r + t.r }), { op: 0, s: 0, r: 0 });
  const vRows = vouchers.map(v =>
    `<tr><td>${v.date}</td><td>${v.voucher_no}</td><td>${v.item_icon} ${v.item_ur}</td><td>${v.sent || '—'}</td><td>${v.returned || '—'}</td><td>${v.notes || ''}</td></tr>`).join('');
  box.innerHTML = `
    <h4 style="margin:12px 0 6px">🏪 ${esc(shopName)}</h4>
    <h4 style="margin:8px 0 6px">📊 خلاصہ</h4>
    <table class="tbl"><tr><th>آئٹم</th><th>اوپننگ</th><th>بھیجا</th><th>واپس</th><th>بقایا</th></tr>${sumRows}
    <tr style="background:#fff3e0"><td><b>ٹوٹل</b></td><td><b>${tot.op}</b></td><td><b>${tot.s}</b></td><td><b>${tot.r}</b></td><td><b>${tot.op + tot.s - tot.r}</b></td></tr></table>
    <h4 style="margin:12px 0 6px">📝 واؤچر ہسٹری (${vouchers.length})</h4>
    <div style="overflow-x:auto"><table class="tbl"><tr><th>تاریخ</th><th>واؤچر</th><th>آئٹم</th><th>بھیجا</th><th>واپس</th><th>نوٹ</th></tr>${vRows || '<tr><td colspan="6">کوئی واؤچر نہیں</td></tr>'}</table></div>
    <div style="margin-top:10px"><button class="btn small dark" onclick="printTrayLedger('${esc(shopName)}')">🖨 کھاتہ پرنٹ کریں</button></div>`;
  window._tlData = { shopName, items, vouchers };
}
function printTrayLedger(shopName) {
  const d = window._tlData;
  if (!d) return;
  const sumRows = Object.values(d.items).map(t =>
    `<tr><td style="text-align:center;font-size:20px">${t.icon}</td><td><b>${t.ur}</b></td><td style="text-align:center">${t.op}</td><td style="text-align:center">${t.s}</td><td style="text-align:center">${t.r}</td><td style="text-align:center;font-size:18px"><b>${t.op + t.s - t.r}</b></td></tr>`).join('');
  const tot = Object.values(d.items).reduce((a, t) => ({ op: a.op + t.op, s: a.s + t.s, r: a.r + t.r }), { op: 0, s: 0, r: 0 });
  const vRows = d.vouchers.map(v =>
    `<tr><td>${v.date}</td><td>${v.voucher_no}</td><td>${v.item_icon} ${v.item_ur}</td><td style="text-align:center">${v.sent || '—'}</td><td style="text-align:center">${v.returned || '—'}</td><td>${v.notes || ''}</td></tr>`).join('');
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>کھاتہ — ${shopName}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Jameel Noori Nastaleeq','Noto Nastaliq Urdu',serif; direction:rtl; padding:24px; color:#222; }
    .header { text-align:center; border-bottom:3px double #e8721c; padding-bottom:12px; margin-bottom:16px; }
    .header h1 { color:#e8721c; font-size:26px; }
    .header .shop { font-size:20px; margin-top:6px; background:#fff3e0; display:inline-block; padding:6px 24px; border-radius:20px; }
    table { width:100%; border-collapse:collapse; margin:12px 0; }
    th { background:#e8721c; color:#fff; padding:10px; }
    td { padding:10px; border-bottom:1px solid #eee; }
    tr:nth-child(even) td { background:#fff8f0; }
    .total-row td { background:#2e7d32 !important; color:#fff; font-size:17px; }
    h3 { color:#e8721c; margin:16px 0 8px; }
    .sign { display:flex; justify-content:space-between; margin-top:40px; }
    .sign div { text-align:center; width:40%; border-top:2px solid #333; padding-top:8px; }
    @media print { .no-print { display:none; } body { padding:0; } }
  </style></head><body>
    <div class="header"><h1>🧺 گلشن فیکٹری</h1><div class="shop">🧾 کھاتہ — ${shopName}</div>
    <div style="color:#666;font-size:13px;margin-top:4px">تاریخ: ${new Date().toISOString().slice(0, 10)}</div></div>
    <h3>📊 خلاصہ</h3>
    <table><tr><th></th><th>آئٹم</th><th>اوپننگ</th><th>بھیجا</th><th>واپس</th><th>بقایا</th></tr>${sumRows}
    <tr class="total-row"><td></td><td><b>ٹوٹل</b></td><td style="text-align:center"><b>${tot.op}</b></td><td style="text-align:center"><b>${tot.s}</b></td><td style="text-align:center"><b>${tot.r}</b></td><td style="text-align:center"><b>${tot.op + tot.s - tot.r}</b></td></tr></table>
    <h3>📝 واؤچر ہسٹری (${d.vouchers.length})</h3>
    <table><tr><th>تاریخ</th><th>واؤچر</th><th>آئٹم</th><th>بھیجا</th><th>واپس</th><th>نوٹ</th></tr>${vRows || '<tr><td colspan="6" style="text-align:center">کوئی واؤچر نہیں</td></tr>'}</table>
    <div class="sign"><div>دکان کے دستخط<br><br><br></div><div>فیکٹری کے دستخط<br><br><br></div></div>
    <div class="no-print" style="text-align:center;margin-top:16px"><button onclick="window.print()" style="padding:14px 48px;font-size:18px;background:#e8721c;color:#fff;border:none;border-radius:10px;cursor:pointer">🖨 پرنٹ / PDF</button></div>
  </body></html>`;
  const w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
}

async function renderTrayReport() {
  const box = $('#trayBody');
  const isAdmin = ME.role === 'super_admin' || ME.role === 'factory';
  let shops = [], vehicles = [];
  if (isAdmin) {
    try {
      [shops, vehicles] = await Promise.all([
        api('GET', '/api/shops').catch(() => []),
        api('GET', '/api/vehicles').catch(() => []),
      ]);
    } catch (e) {}
  }
  box.innerHTML = `<h3>🖨 رپورٹ — فلٹر</h3>
    <div class="formgrid">
      <label>سے<br><input type="date" id="trFrom"></label>
      <label>تک<br><input type="date" id="trTo" value="${karachiToday()}"></label>
      ${isAdmin ? `<label>🏪 دکان<br><select id="trShop"><option value="">تمام</option>${await trayShopOptions()}</select><div style="margin-top:4px;display:flex;gap:4px">
        <button type="button" class="btn small" onclick="trShopTypeFilter('')">تمام</button>
        <button type="button" class="btn small" onclick="trShopTypeFilter('shop')">🏪 سپلائی</button>
        <button type="button" class="btn small" onclick="trShopTypeFilter('daily')">📝 روزانہ</button>
      </div></label>
      <label>🚚 گاڑی<br><select id="trVeh"><option value="">تمام</option>${vehicles.map(v => `<option value="${v.id}">${esc(v.name)}</option>`).join('')}</select></label>` : ''}
      <label>آئٹم<br><select id="trItem"><option value="">تمام</option>${TRAY.items.map(i => `<option value="${i.id}">${i.icon} ${i.name_ur}</option>`).join('')}</select></label>
      <label>دکان کی قسم<br><select id="trShopType"><option value="">تمام</option><option value="shop">🏪 سپلائی</option><option value="daily">📝 روزانہ</option></select></label>
      <label><br><button class="btn small dark" onclick="loadTrayReport()">🔍 دیکھیں</button></label>
    </div><div id="trBody"></div>`;
  loadTrayReport();
}

async function trShopTypeFilter(type) {
  const sel = $('#trShop');
  const cur = sel.value;
  sel.innerHTML = '<option value="">تمام</option>' + await trayShopOptions(cur, type || undefined);
  const typeSel = $('#trShopType');
  if (typeSel) typeSel.value = type || '';
}

async function loadTrayReport() {
  const p = new URLSearchParams();
  if ($('#trFrom').value) p.set('from', $('#trFrom').value);
  if ($('#trTo').value) p.set('to', $('#trTo').value);
  if ($('#trShop') && $('#trShop').value) {
    const sh = trayParseShop($('#trShop').value);
    p.set('shop_id', sh.shop_id);
    if (sh.shop_type) p.set('shop_type', sh.shop_type);
  }
  if ($('#trVeh') && $('#trVeh').value) p.set('vehicle_id', $('#trVeh').value);
  if ($('#trItem').value) p.set('item_id', $('#trItem').value);
  // If shop type filter is set (daily/shop), apply it even when shop=all
  const typeF = $('#trShopType') && $('#trShopType').value;
  if (typeF && !($('#trShop') && $('#trShop').value)) {
    p.set('shop_type', typeF);
  }
  let rows = [];
  try { rows = await api('GET', '/api/tray/vouchers?' + p.toString()); } catch (e) {}
  const tot = rows.reduce((a, r) => ({ s: a.s + r.sent, r: a.r + r.returned }), { s: 0, r: 0 });
  const byItem = {};
  for (const r of rows) {
    const k = r.item_ur || ('#' + r.item_id);
    if (!byItem[k]) byItem[k] = { icon: r.item_icon || '', s: 0, r: 0 };
    byItem[k].s += r.sent; byItem[k].r += r.returned;
  }
  const itemRows = Object.entries(byItem).map(([k, v]) =>
    `<tr><td>${v.icon} ${esc(k)}</td><td><b>${v.r}</b></td></tr>`).join('');
  $('#trBody').innerHTML =
    `<h4 style="margin:10px 0 6px">📊 خلاصہ</h4>
    <div class="cards">
      <div class="card"><div class="n">${tot.r}</div><div class="l">📥 کل واپس<br>Total Returned</div></div>
      <div class="card"><div class="n">${rows.length}</div><div class="l">🧾 واؤچر<br>Vouchers</div></div>
    </div>
    ${itemRows ? `<h4 style="margin:10px 0 6px">🧺 آئٹم وائز</h4><table class="tbl"><tr><th>آئٹم</th><th>واپس</th></tr>${itemRows}</table>` : ''}
    ${(() => {
    const typeF = $('#trShopType') ? $('#trShopType').value : '';
    const mkTable = (list, title) => {
      if (typeF && ((typeF === 'daily') !== (title === '📝 روزانہ دکانیں'))) return '';
      if (!list.length) return '';
      const t = list.reduce((a, r) => ({ s: a.s + r.sent, r: a.r + r.returned }), { s: 0, r: 0 });
      return `<h4 style="margin:14px 0 6px">${title} (${list.length} واؤچر — بقایا: <b>${t.s - t.r}</b>)</h4>
      <table class="tbl"><tr><th>تاریخ</th><th>واؤچر</th><th>دکان</th><th>آئٹم</th><th>واپس</th></tr>` +
      list.map(r => `<tr><td>${r.date}</td><td>${r.voucher_no}</td><td>${esc(r.shop_name)}</td><td>${r.item_icon} ${r.item_ur}</td><td><b>${r.returned}</b></td></tr>`).join('') + `</table>`;
    };
    const sup = rows.filter(r => r.shop_type !== 'daily');
    const dly = rows.filter(r => r.shop_type === 'daily');
    return mkTable(sup, '🏪 سپلائی دکانیں') + mkTable(dly, '📝 روزانہ دکانیں') + (rows.length ? '' : '<p>کوئی ریکارڈ نہیں</p>');
  })()}
    <div style="margin-top:10px"><button class="btn small dark" onclick="printTrayReport()">🖨 پرنٹ / PDF (مکمل رپورٹ)</button></div>`;
  window._trayRows = rows;
  window._traySummary = { tot, byItem };
}



function printTrayReport() {
  const rows = window._trayRows || [];
  const sum = window._traySummary || { tot: { s: 0, r: 0 }, byItem: {} };
  const t = sum.tot;
  const itemRows = Object.entries(sum.byItem).map(([k, v], i) =>
    `<tr style="background:${i%2 ? '#fff8f0' : '#fff'}"><td style="padding:10px;border-bottom:1px solid #f0f0f0">${v.icon} <b>${k}</b></td><td style="padding:10px;border-bottom:1px solid #f0f0f0;text-align:center"><b style="font-size:18px;color:#e8721c">${v.r}</b></td></tr>`).join('');
  const f = [];
  if ($('#trFrom') && $('#trFrom').value) f.push('سے: ' + $('#trFrom').value);
  if ($('#trTo') && $('#trTo').value) f.push('تک: ' + $('#trTo').value);
  const html = `
    <div style="background:linear-gradient(135deg,#1a1a2e,#e8721c);color:#fff;padding:24px;border-radius:16px;text-align:center;margin-bottom:20px">
      <div style="font-size:32px;margin-bottom:8px">🧺</div>
      <h1 style="margin:0;font-size:26px">ٹرے اور باسکٹ رپورٹ</h1>
      <div style="font-size:16px;opacity:.9;margin-top:6px">گلشن فیکٹری • Gulshan Factory</div>
      <div style="margin-top:12px;background:rgba(255,255,255,.2);display:inline-block;padding:8px 24px;border-radius:20px;font-weight:bold">📅 ${karachiToday()}${f.length ? ' | ' + f.join('، ') : ''}</div>
    </div>
    <div style="display:flex;gap:12px;margin-bottom:20px">
      <div style="flex:1;background:linear-gradient(135deg,#ff9a3c,#e8721c);color:#fff;border-radius:12px;padding:16px;text-align:center">
        <div style="font-size:32px;font-weight:800">${t.r}</div><div style="font-size:13px">📥 کل واپس</div>
      </div>
      <div style="flex:1;background:linear-gradient(135deg,#42a5f5,#1565c0);color:#fff;border-radius:12px;padding:16px;text-align:center">
        <div style="font-size:32px;font-weight:800">${rows.length}</div><div style="font-size:13px">🧾 واؤچر</div>
      </div>
    </div>
    ${itemRows ? `<h3 style="color:#e8721c;border-bottom:3px solid #e8721c;padding-bottom:6px">🧺 آئٹم وائز خلاصہ</h3>
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;box-shadow:0 2px 8px rgba(0,0,0,.1);border-radius:8px;overflow:hidden">
    <tr style="background:#2d2d2d;color:#fff"><th style="padding:12px">آئٹم</th><th style="padding:12px">واپس</th></tr>${itemRows}</table>` : ''}
    ${(() => {
    const typeF = ($('#trShopType') && $('#trShopType').value) || '';
    const mkPTable = (list, title) => {
      if (typeF && ((typeF === 'daily') !== (title === '📝 روزانہ دکانیں'))) return '';
      if (!list.length) return '';
      const t = list.reduce((a, r) => ({ s: a.s + r.sent, r: a.r + r.returned }), { s: 0, r: 0 });
      const tcolor = title.includes('سپلائی') ? '#e8721c' : '#7b1fa2';
      return `<h3 style="color:${tcolor};border-bottom:3px solid ${tcolor};padding-bottom:6px;margin-top:20px">${title} <span style="background:${tcolor};color:#fff;padding:2px 12px;border-radius:12px;font-size:13px">${list.length} واؤچر</span></h3>
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px;box-shadow:0 2px 8px rgba(0,0,0,.08);border-radius:8px;overflow:hidden">
      <tr style="background:${tcolor};color:#fff"><th style="padding:10px">تاریخ</th><th style="padding:10px">واؤچر</th><th style="padding:10px">دکان</th><th style="padding:10px">آئٹم</th><th style="padding:10px">واپس</th></tr>` +
      list.map((r, i) => `<tr style="background:${i%2 ? '#fafafa' : '#fff'}"><td style="padding:8px;border-bottom:1px solid #f0f0f0;text-align:center">${r.date}</td><td style="padding:8px;border-bottom:1px solid #f0f0f0;text-align:center"><b>${r.voucher_no}</b></td><td style="padding:8px;border-bottom:1px solid #f0f0f0">${r.shop_name}</td><td style="padding:8px;border-bottom:1px solid #f0f0f0">${r.item_icon || ''} ${r.item_ur}</td><td style="padding:8px;border-bottom:1px solid #f0f0f0;text-align:center"><b style="color:#2e7d32;font-size:16px">${r.returned}</b></td></tr>`).join('') +
      `<tr style="background:#fff3e0"><td colspan="4" style="padding:10px;text-align:center"><b>📊 ٹوٹل</b></td><td style="padding:10px;text-align:center"><b style="font-size:18px">${t.r}</b></td></tr></table>`;
    };
    return mkPTable(rows.filter(r => r.shop_type !== 'daily'), '🏪 سپلائی دکانیں') + mkPTable(rows.filter(r => r.shop_type === 'daily'), '📝 روزانہ دکانیں');
  })()}
    <p style="margin-top:16px">دستخط: ___________________</p>`;
  const w = window.open('', '_blank');
  w.document.write(`<html><head><title>ٹرے باسکٹ رپورٹ</title>
    <link href="https://fonts.googleapis.com/css2?family=Noto+Nastaliq+Urdu:wght@400;600;700&display=swap" rel="stylesheet">
    <style>
    body{font-family:'Noto Nastaliq Urdu','Jameel Noori Nastaleeq',serif;direction:rtl;padding:12px;max-width:750px;margin:0 auto;color:#333;font-size:11px;line-height:1.8;font-weight:600}
    b, strong, th { font-weight:700; }
    h1{font-size:20px !important;margin:6px 0 !important} h3{font-size:14px !important;margin:8px 0 4px !important}
    table{font-size:11px} td,th{padding:4px 6px !important}
    @media print{
      button{display:none}
      body{padding:6px;font-size:10px;max-width:100%}
      h1{font-size:18px !important} h3{font-size:13px !important;margin:6px 0 3px !important}
      table{page-break-inside:auto}
      tr{page-break-inside:avoid}
      @page{size:A4;margin:10mm}
    }
    </style></head><body>${html}<br><div style="text-align:center" class="no-break"><button onclick="window.print()" style="padding:10px 36px;font-size:15px;background:#2d2d2d;color:#fff;border:none;border-radius:10px;cursor:pointer;font-family:inherit">🖨 پرنٹ / PDF</button></div>
    <p style="margin-top:16px;text-align:center;color:#999;font-size:12px">دستخط: ___________________</p></body></html>`);
  w.document.close();
}
async function loadTotals() {
  const d = $('#rpDate').value, r = $('#rpRoute').value;
  const t = await api('GET', `/api/totals?date=${d}${r ? '&route_id=' + r : ''}`);
  const rows = t.map(x => `<tr><td>${esc(x.category_name || '')}</td><td>${esc(x.product_name)}</td><td><b>${esc(x.total_qty)} ${esc(x.unit_name || '')}</b></td><td>${x.shop_count} دکان</td></tr>`).join('');
  $('#rpBody').innerHTML = `<table><tr><th>کیٹیگری</th><th>آئٹم</th><th>کل مقدار</th><th>دکانیں</th></tr>${rows || '<tr><td colspan=4>کوئی آرڈر نہیں</td></tr>'}</table>`;
  $('#rpPrint').innerHTML = `<a class="btn green" target="_blank" href="/print?type=totals&date=${d}${r ? '&route_id=' + r : ''}">🖨 آئٹم وائز ٹوٹل پرنٹ کریں</a>
  <a class="btn dark" target="_blank" href="/print?type=shops&date=${d}${r ? '&route_id=' + r : ''}">🧾 دکان وائز سلپ پرنٹ کریں (ہر دکان الگ صفحہ)</a>
  <a class="btn" target="_blank" href="/print?type=date_history&date=${d}">📜 اس تاریخ کی مکمل ہسٹری پرنٹ کریں</a>
  <a class="btn" style="background:#6a1b9a;color:#fff" href="#" onclick="adminBlankSheet();return false">📝 خالی آرڈر شیٹ (گاڑی کے لیے)</a>
  <a class="btn" style="background:#4a148c;color:#fff" href="#" onclick="showMatrixSelect();return false">📊 میٹرکس آرڈر شیٹ</a>`;
}

// ---------- settings: users & access ----------
let setTabName = 'general';
function setTab(t, btn) {
  setTabName = t;
  document.querySelectorAll('.setpanel .tabs button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  for (const k of ['general', 'users', 'access', 'push', 'ad']) $('#set' + k[0].toUpperCase() + k.slice(1)).style.display = t === k ? 'block' : 'none';
  if (t === 'general') renderSettingsGeneral();
  else if (t === 'users') renderSettingsUsers(); else if (t === 'access') renderSettingsAccess(); else if (t === 'push') renderSettingsPush(); else renderSettingsAd();
}
// ---------- settings: general (one place for everyone's options) ----------
async function renderSettingsGeneral() {
  const st = await api('GET', '/api/webauthn/status').catch(() => ({ on: false }));
  const tp = themePref();
  const myDp = ME.avatar ? `<img src="${esc(ME.avatar)}" class="bigdp" alt="">` : userAvatar(ME.username, null);
  $('#setGeneral').innerHTML = `<h3>⚙️ میری سیٹنگ</h3>
    <div class="profsec">
      ${myDp}
      <div><div class="profname">${esc(ME.username)}</div>
      <label class="btn small ghost" style="cursor:pointer">🖼 تصویر لگائیں
        <input type="file" id="dpFile" accept="image/*" style="display:none" onchange="uploadMyAvatar(this)"></label>
      <div class="err" id="dpErr"></div></div>
    </div>
    <div class="formgrid">
      <label>🎨 تھیم<br><select id="gsTheme" onchange="setThemePref(this.value)">
        <option value="auto"${tp === 'auto' ? ' selected' : ''}>🖥️ خودکار (سسٹم)</option>
        <option value="light"${tp === 'light' ? ' selected' : ''}>☀️ لائٹ</option>
        <option value="dark"${tp === 'dark' ? ' selected' : ''}>🌙 ڈارک</option></select></label>
      <label>🔐 فنگر پرنٹ / فیس لاگ اِن<br>
        <button class="btn small ${st.on ? 'ghost' : 'green'}" onclick="bioRegister()">${st.on ? '🔄 دوبارہ سیٹ کریں' : '✅ آن کریں'}</button>
        ${st.on ? ' <button class="btn small danger" onclick="bioRemove()">بند کریں</button>' : ''}</label>
      <label>🔔 نوٹیفکیشن<br><button class="btn small" onclick="enablePush()">Allow کریں</button></label>
      <label>🔑 پاس ورڈ<br><button class="btn small" onclick="document.getElementById('pwModal').style.display='flex'">تبدیل کریں</button></label>
    </div>
    <p class="note">👆 فنگر پرنٹ صرف اسی موبائل پر کام کرے گا جس پر آن کیا — لاگ اِن اسکرین پر یوزر نام لکھ کر 👆 دبائیں۔</p>`;
}
async function uploadMyAvatar(input) {
  const f = input.files && input.files[0]; if (!f) return;
  $('#dpErr').textContent = '⏳ اپ لوڈ ہو رہی ہے...';
  try {
    const fd = new FormData(); fd.append('file', f);
    const r = await fetch('/api/my-avatar', { method: 'POST', body: fd });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'failed');
    ME.avatar = j.avatar;
    renderTopbarDp();
    renderSettingsGeneral();
  } catch (e) { $('#dpErr').textContent = 'ناکام — صرف تصویر (زیادہ سے زیادہ 5MB)'; }
}
function renderTopbarDp() {
  const w = $('#meDpWrap'); if (!w) return;
  w.innerHTML = ME.avatar ? `<img src="${esc(ME.avatar)}" class="medp" alt="">` : '';
}
// ---------- biometric login (WebAuthn: fingerprint / face) ----------
function b64ToBuf(s) { s = String(s).replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const b = atob(s); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
function bufToB64(buf) { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function wbnPre(o) {
  const out = { ...o, challenge: b64ToBuf(o.challenge) };
  if (out.user) out.user = { ...out.user, id: b64ToBuf(out.user.id) };
  for (const k of ['excludeCredentials', 'allowCredentials']) if (out[k]) out[k] = out[k].map(c => ({ ...c, id: b64ToBuf(c.id) }));
  return out;
}
function wbnPost(c) {
  const o = { id: c.id, rawId: bufToB64(c.rawId), type: c.type, response: {} };
  for (const k of ['clientDataJSON', 'attestationObject', 'authenticatorData', 'signature', 'userHandle']) if (c.response[k]) o.response[k] = bufToB64(c.response[k]);
  return o;
}
async function bioRegister() {
  if (!window.PublicKeyCredential) { alert('اس براؤزر / موبائل میں فنگر پرنٹ سپورٹ نہیں'); return; }
  try {
    const { options } = await api('POST', '/api/webauthn/register-start');
    const cred = await navigator.credentials.create({ publicKey: wbnPre(options) });
    await api('POST', '/api/webauthn/register-finish', { cred: wbnPost(cred) });
    alert('فنگر پرنٹ لاگ اِن آن ہو گیا ✅');
    renderSettingsGeneral();
  } catch (e) { alert('ناکام — ' + (e.message || 'دوبارہ کوشش کریں')); }
}
async function bioRemove() {
  if (!confirm('فنگر پرنٹ لاگ اِن بند کریں؟')) return;
  await api('DELETE', '/api/webauthn');
  renderSettingsGeneral();
}
async function bioLogin() {
  const err = $('#liErr'); err.textContent = '';
  const dbg = (step, info) => { try { api('POST', '/api/webauthn-debug', { step, info: String(info || '').slice(0, 200) }); } catch (e) {} };
  dbg('click');
  if (!window.PublicKeyCredential) { err.textContent = 'اس براؤزر میں فنگر پرنٹ سپورٹ نہیں'; dbg('no-support'); return; }
  let username = $('#liUser').value.trim();
  if (!username) { try { username = localStorage.getItem('gf-lastuser') || ''; } catch (e) {} }
  if (!username) { err.textContent = 'پہلے یوزر نام لکھیں'; dbg('no-username'); return; }
  $('#liUser').value = username;
  try {
    err.textContent = '⏳ سرور سے رابطہ ہو رہا ہے...'; dbg('login-start-begin', username);
    const { options } = await api('POST', '/api/webauthn/login-start', { username });
    dbg('login-start-ok');
    err.textContent = '👆 اب فنگر پرنٹ لگائیں...'; dbg('get-begin');
    let asrt;
    try { asrt = await navigator.credentials.get({ publicKey: wbnPre(options) }); }
    catch (ge) { err.textContent = 'فنگر پرنٹ نہیں کھلا (' + (ge && ge.name || 'error') + ') — دوبارہ کوشش کریں'; dbg('get-error', ge && ge.name); return; }
    dbg('get-ok');
    if (!asrt) { err.textContent = 'فنگر پرنٹ منسوخ ہو گیا'; dbg('get-null'); return; }
    dbg('finish-begin');
    await api('POST', '/api/webauthn/login-finish', { username, asrt: wbnPost(asrt) });
    dbg('finish-ok');
    try { localStorage.setItem('gf-lastuser', username); } catch (e) {}
    await enterApp();
  } catch (e) { dbg('outer-error', e.message); err.textContent = e.message === 'no_bio' ? 'اس یوزر کے لیے فنگر پرنٹ سیٹ نہیں — پہلے لاگ اِن کر کے سیٹنگ میں آن کریں' : 'فنگر پرنٹ ناکام — دوبارہ کوشش کریں'; }
}
async function renderSettingsPush() {
  const st = await api('GET', '/api/push-status');
  $('#setPush').innerHTML = `<h3>🔔 اطلاعات (Notifications)</h3>
    <p>رجسٹرڈ ڈیوائسز: <b>${st.count}</b></p>
    ${st.devices.map(d => `<div>📱 ${esc(d.username)} — ${esc(d.created_at)}</div>`).join('') || '<p>ابھی کوئی ڈیوائس رجسٹرڈ نہیں۔</p>'}
    <button class="btn green" onclick="pushTest()">ٹیسٹ نوٹیفکیشن بھیجو</button>
    <p style="color:var(--muted);font-size:14px">نوٹ: ہر موبائل پر ایک دفعہ ایپ کھول کر لاگ اِن کریں اور "Allow notifications" دبائیں۔</p>`;
}
async function pushTest() {
  const r = await api('POST', '/api/push-test');
  alert(r.sent ? 'ٹیسٹ بھیج دیا گیا! اپنا موبائل چیک کرو 📱' : 'کوئی ڈیوائس رجسٹرڈ نہیں — پہلے موبائل پر نوٹیفکیشن Allow کرو');
}
// ---------- settings: splash ad ----------
function fmtDT(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' ' +
    d.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit' });
}
function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function adStatusLine(ad) {
  if (!ad.on) return '⚪ اشتہار بند ہے';
  const now = Date.now(), s = ad.start ? Date.parse(ad.start) : 0, e = ad.end ? Date.parse(ad.end) : 0;
  if (s && now < s) return '🕐 ' + fmtDT(ad.start) + ' سے شروع ہوگا';
  if (e && now > e) return '🔴 مدت ختم (' + fmtDT(ad.end) + ' تک تھا)';
  if (s && e) return '🟢 چل رہا ہے (' + fmtDT(ad.start) + ' سے ' + fmtDT(ad.end) + ' تک)';
  if (s) return '🟢 چل رہا ہے (' + fmtDT(ad.start) + ' سے شروع)';
  if (e) return '🟢 چل رہا ہے (' + fmtDT(ad.end) + ' تک)';
  return '🟢 چل رہا ہے (ہمیشہ)';
}
async function renderSettingsAd() {
  const ad = await api('GET', '/api/ad');
  const durs = [2, 3, 4, 5, 6, 8, 10].map(d => `<option value="${d}"${ad.duration === d ? ' selected' : ''}>${d} سیکنڈ</option>`).join('');
  $('#setAd').innerHTML = `<h3>📢 اشتہار (ایپ کھلنے پر)</h3>
    ${ad.hasAd ? (ad.type === 'video'
      ? `<video src="${ad.url}" style="max-width:100%;max-height:220px;border-radius:10px" controls playsinline></video>`
      : `<img src="${ad.url}" style="max-width:100%;max-height:220px;border-radius:10px">`) : '<p class="note">کوئی اشتہار نہیں لگا</p>'}
    ${ad.hasAd ? `<p><b>${adStatusLine(ad)}</b></p>` : ''}
    <div class="formgrid">
      <label>تصویر / ویڈیو ${ad.hasAd ? '(بدلنے کے لیے نئی فائل چنیں)' : ''}<br><input type="file" id="adFile" accept="image/*,video/*"></label>
      <label>دکھانے کی مدت<br><select id="adDur">${durs}</select></label>
      <label>📅 کب سے دکھائیں<br><input type="datetime-local" id="adStart" value="${toLocalInput(ad.start)}"></label>
      <label>📅 کب تک دکھائیں<br><input type="datetime-local" id="adEnd" value="${toLocalInput(ad.end)}"></label>
      <label><br><input type="checkbox" id="adOn" ${ad.on ? 'checked' : ''} style="width:auto"> اشتہار دکھائیں</label>
      <label><br><button class="btn small green" onclick="adSave()">💾 محفوظ کریں</button></label>
    </div>
    <p class="note">کب سے / کب تک خالی = ہمیشہ دکھائیں۔ محفوظ کریں سے بغیر فائل بدلے بھی ترمیم ہو جاتی ہے ✏️</p>
    ${ad.hasAd ? '<button class="btn small danger" onclick="adDel()">🗑 اشتہار حذف کریں</button>' : ''}`;
}
async function adSave() {
  const fd = new FormData();
  const f = $('#adFile').files[0];
  if (f) fd.append('file', f);
  fd.append('enabled', $('#adOn').checked ? '1' : '0');
  fd.append('duration', $('#adDur').value);
  const sv = $('#adStart').value, ev = $('#adEnd').value;
  fd.append('start', sv ? new Date(sv).toISOString() : '');
  fd.append('end', ev ? new Date(ev).toISOString() : '');
  const r = await fetch('/api/ads', { method: 'POST', body: fd });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    alert(j.error === 'bad_range' ? '״کب تک״ »کب سے« کے بعد ہونا چاہیے' : 'اپلوڈ ناکام — صرف تصویر یا ویڈیو (زیادہ سے زیادہ 25MB)');
    return;
  }
  alert('اشتہار محفوظ ہو گیا ✅');
  renderSettingsAd();
}
async function adDel() {
  if (!confirm('اشتہار حذف کریں؟')) return;
  await api('DELETE', '/api/ads');
  renderSettingsAd();
}
// ---------- splash ad at app start ----------
function showSplash(ad) {
  return new Promise(resolve => {
    const v = $('#splashView'), m = $('#splashMedia');
    m.innerHTML = ad.type === 'video'
      ? `<video src="${ad.url}" autoplay muted playsinline style="width:100%;height:100%;object-fit:contain"></video>`
      : `<img src="${ad.url}" style="width:100%;height:100%;object-fit:contain" alt="اشتہار">`;
    v.style.display = 'flex';
    let done = false;
    window.hideSplash = () => {
      if (done) return; done = true;
      v.style.display = 'none'; m.innerHTML = ''; resolve();
    };
    setTimeout(window.hideSplash, (ad.duration || 4) * 1000);
  });
}
const ACCT_TYPES = {
  shop: { label: '🏪 دکان (سپلائی)', role: 'shop' },
  daily_shop: { label: '📝 روزانہ دکان', role: 'shop' },
  department: { label: '🏭 ڈیپارٹمنٹ', role: 'factory' },
  supplier: { label: '🏭 سپلائر (ڈیپارٹمنٹ)', role: 'factory' },
  vehicle: { label: '🚚 گاڑی والا', role: 'factory' },
  viewer: { label: '👁 ویور', role: 'factory' },
  factory_admin: { label: '👑 فیکٹری ایڈمن', role: 'factory' },
  super_admin: { label: '🔑 سپر ایڈمن', role: 'super_admin' },
};
const acctLabel = u => (u.account_type && ACCT_TYPES[u.account_type] ? ACCT_TYPES[u.account_type].label
  : { super_admin: 'سپر ایڈمن', factory: 'فیکٹری', shop: 'دکان' }[u.role]);
async function renderSettingsUsers() {
  const users = await api('GET', '/api/users');
  await refreshCache();
  const rows = users.map(u => `<tr><td>${esc(u.username)}</td><td>${acctLabel(u)}</td>
    <td>${esc(u.shop_name || '—')}</td><td dir="ltr">${esc(u.phone || '—')}</td><td>${u.active ? '<span class="badge">فعال</span>' : '<span class="badge off">بند</span>'}</td>
    <td><button class="btn small ghost" onclick="userEdit(${u.id})">✏</button>
    ${u.id !== ME.id ? `<button class="btn small" style="background:#ff9800;color:#fff" onclick="userLogout(${u.id},'${esc(u.username)}')" title="لاگ آؤٹ کریں">🚪</button>
    <button class="btn small danger" onclick="userDel(${u.id})">🗑</button>` : ''}</td></tr>`).join('');
  $('#setUsers').innerHTML = `<h3>👥 یوزرز / اکاؤنٹس</h3>
    <table><tr><th>یوزر نام</th><th>اکاؤنٹ کی قسم</th><th>دکان</th><th>موبائل</th><th>حالت</th><th></th></tr>${rows}</table>
    <h3>➕ نیا اکاؤنٹ</h3>
    <div class="formgrid">
      <label>یوزر نام<br><input id="nu-name"></label>
      <label>پاس ورڈ<br><input id="nu-pass" type="password"></label>
      <label>موبائل نمبر<br><input id="nu-phone" dir="ltr" placeholder="03xx-xxxxxxx"></label>
      <label>اکاؤنٹ کی قسم<br><select id="nu-type" onchange="nuTypeChanged()">
        ${Object.entries(ACCT_TYPES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select></label>
      <label id="nu-shoprow">دکان (سپلائی)<br><select id="nu-shop">${CACHE.shops.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label>
      <label id="nu-dshoprow" style="display:none">روزانہ دکان<br><select id="nu-dshop"></select></label>
      <label><br><button class="btn small green" onclick="userAdd()">بنائیں</button></label>
    </div>
    <p class="note">ڈیپارٹمنٹ / سپلائر / ویور خودکار طور پر صرف دیکھ سکیں گے — کیٹیگری/دکان کی سیٹنگ روزانہ آرڈر → ⚙ ایکسس سیٹنگ سے کریں</p>`;
  loadDailyShopsForUserForm();
}
async function loadDailyShopsForUserForm() {
  try {
    const ds = await api('GET', '/api/daily-shops');
    const sel = $('#nu-dshop');
    if (sel) sel.innerHTML = ds.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  } catch (e) {}
}
function nuTypeChanged() {
  const t = $('#nu-type').value;
  $('#nu-shoprow').style.display = t === 'shop' ? 'block' : 'none';
  $('#nu-dshoprow').style.display = t === 'daily_shop' ? 'block' : 'none';
}
async function userAdd() {
  const atype = $('#nu-type').value;
  const role = (ACCT_TYPES[atype] || ACCT_TYPES.shop).role;
  await api('POST', '/api/users', { username: $('#nu-name').value.trim(), password: $('#nu-pass').value,
    role, account_type: atype,
    shop_id: atype === 'shop' ? Number($('#nu-shop').value) : null,
    daily_shop_id: atype === 'daily_shop' ? Number($('#nu-dshop').value) : null,
    phone: $('#nu-phone').value.trim() });
  renderSettingsUsers();
}
async function userDel(id) { if (!confirm('یوزر حذف کریں؟')) return; await api('DELETE', '/api/users/' + id); renderSettingsUsers(); }
async function userLogout(id, name) {
  if (!confirm('کیا ' + name + ' کو لاگ آؤٹ کرنا ہے؟')) return;
  try {
    const r = await api('POST', '/api/admin/logout-user/' + id);
    alert('✅ ' + (r.sessions_cleared || 0) + ' sessions ختم — user لاگ آؤٹ ہو گیا!');
  } catch(e) { alert('Error: ' + (e.message || '')); }
}
async function userEdit(id) {
  const users = await api('GET', '/api/users');
  const u = users.find(x => x.id === id); if (!u) return;
  const role = prompt('رول (super_admin / factory / shop):', u.role); if (role === null) return;
  const phone = prompt('موبائل نمبر:', u.phone || ''); if (phone === null) return;
  const active = confirm('اکاؤنٹ فعال رکھیں؟ (OK=فعال، Cancel=بند)');
  const pw = prompt('نیا پاس ورڈ (خالی چھوڑیں تو تبدیل نہیں ہوگا):', '');
  await api('PUT', '/api/users/' + id, { role: ['super_admin', 'factory', 'shop'].includes(role) ? role : u.role,
    shop_id: u.shop_id, active: active ? 1 : 0, phone, ...(pw ? { password: pw } : {}) });
  renderSettingsUsers();
}
const SEC_UR = { dashboard: 'ڈیش بورڈ', orders: 'آرڈرز', order_history: 'آرڈر ہسٹری', shops: 'دکانیں', products: 'آئٹمز',
  categories: 'کیٹیگریز', units: 'یونٹس', vehicles: 'گاڑیاں', routes: 'روٹس', schedule: 'شیڈول', reports: 'رپورٹس', users: 'یوزرز', daily: 'روزانہ آرڈر', tray_basket: '🧺 ٹرے اور باسکٹ' };
const LVL_UR = { none: '⛔ بند', view: '👁 صرف دیکھیں', full: '✅ مکمل اختیار' };
async function renderSettingsAccess() {
  const users = (await api('GET', '/api/users')).filter(u => u.role !== 'super_admin');
  const secs = await api('GET', '/api/sections');
  $('#setAccess').innerHTML = `<h3>🔐 رسائی / اختیار</h3>
    <label>یوزر منتخب کریں<br><select id="pa-user" onchange="renderPermMatrix()">${users.map(u => `<option value="${u.id}">${esc(u.username)}</option>`).join('')}</select></label>
    <div id="pa-matrix"></div><br><button class="btn green" onclick="savePerms()">💾 محفوظ کریں</button>`;
  renderPermMatrix();
}
async function renderPermMatrix() {
  const uid = $('#pa-user').value; if (!uid) return;
  const users = await api('GET', '/api/users');
  const u = users.find(x => x.id === Number(uid));
  const secs = await api('GET', '/api/sections');
  $('#pa-matrix').innerHTML = secs.map(s => `<div class="permgrid"><span>${SEC_UR[s] || s}</span>
    <select data-sec="${s}">${['none', 'view', 'full'].map(l => `<option value="${l}" ${u.permissions[s] === l ? 'selected' : ''}>${LVL_UR[l]}</option>`).join('')}</select>
  </div>`).join('');
}
async function savePerms() {
  const uid = $('#pa-user').value;
  const perms = {};
  document.querySelectorAll('#pa-matrix select').forEach(s => perms[s.dataset.sec] = s.value);
  await api('PUT', `/api/users/${uid}/permissions`, { permissions: perms });
  alert('رسائی محفوظ ہو گئی ✅');
}

// ==================== DAILY ORDERS (روزانہ آرڈر) — separate system ====================
let DAILY_DATE = null, DAILY_CUTOFF = '20:00', DAILY_VIEW_DATE = null, DAILY_SHOP_FILTER = '';
window.setDailyShopFilter = function(v) {
  DAILY_SHOP_FILTER = v;
  renderDailyBoard({order_date: DAILY_VIEW_DATE || DAILY_DATE, cutoff_time: DAILY_CUTOFF, cutoff_passed: false});
};
window.dailyShopChange = function(v) { DAILY_SHOP_FILTER = v; const di = {order_date: DAILY_VIEW_DATE || DAILY_DATE, cutoff_time: DAILY_CUTOFF}; renderDailyBoard(di, v); };
function fmtTime(ts) {
  try { return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Karachi' }); }
  catch (e) { return ''; }
}

async function renderDaily() {
  const di = await api('GET', '/api/daily/date');
  DAILY_DATE = di.order_date; DAILY_CUTOFF = di.cutoff_time;
  if (ME.role === 'shop' && ME.daily_shop_id) return renderDailyShopForm(di);
  if (ME.role === 'shop') {
    $('#v-daily').innerHTML = `
    <div style="background:linear-gradient(135deg,#e8721c,#f0953a);border-radius:16px;padding:24px;color:#fff;text-align:center;box-shadow:0 4px 16px rgba(232,114,28,.3)">
      <div style="font-size:48px;margin-bottom:12px">🏪</div>
      <div style="font-size:20px;font-weight:bold;margin-bottom:8px">روزانہ آرڈر</div>
      <div style="font-size:14px;opacity:.95;line-height:1.6">آپ کا اکاؤنٹ روزانہ آرڈر سسٹم سے منسلک نہیں ہے۔<br>ایڈمن سے رابطہ کریں تاکہ آپ کی دکان رجسٹر ہو سکے۔</div>
      <div style="margin-top:16px;font-size:12px;opacity:.8">👤 ${esc(ME.username)}</div>
    </div>`;
    return;
  }
  return renderDailyBoard(di);
}
// ---------- Supplier dashboard (supply system) - KHUBSURAT ----------
async function renderSupplierDash() {
  const d = await api('GET', '/api/supplier/dashboard');
  window._supData = d;
  const sched = await api('GET', '/api/supplier/schedule').catch(() => []);
  const statusLbl = { new: '🆕 نیا', collected: '📦 اٹھا لیا', delivered: '✅ پہنچا دیا' };
  const statusCol = { new: '#ff9800', collected: '#2196f3', delivered: '#4caf50' };
  const pending = d.shopOrders.filter(o => o.status !== 'delivered').length;
  const done = d.shopOrders.filter(o => o.status === 'delivered').length;
  const totalQty = d.itemTotals.reduce((a, t) => a + Number(t.total_qty || 0), 0);

  // SAB shops: order aaya ya nahi (NO STATUS - sirf pending/received with time)
  const shopHtml = (d.shopsStatus || []).map(sh => {
    if (!sh.has_order) {
      return `<div style="background:#fff8e1;border-radius:14px;padding:14px;margin-bottom:10px;box-shadow:0 2px 8px rgba(0,0,0,.06);border-right:5px solid #ffc107">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div style="font-weight:bold;font-size:16px">🏪 ${esc(sh.shop_name)}</div>
          <span style="font-size:11px;background:#ffc107;color:#000;padding:4px 10px;border-radius:12px;font-weight:bold">⏳ پینڈنگ</span>
        </div>
      </div>`;
    }
    const o = sh.order;
    const orderTime = o.created_at ? new Date(o.created_at.replace(' ', 'T') + 'Z').toLocaleString('ur-PK', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '';
    return `
    <div style="background:#fff;border-radius:14px;padding:14px;margin-bottom:10px;box-shadow:0 2px 8px rgba(0,0,0,.08);border-right:5px solid #4caf50">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div style="font-weight:bold;font-size:16px">🏪 ${esc(o.shop_name)}</div>
        <span style="font-size:11px;background:#4caf50;color:#fff;padding:4px 10px;border-radius:12px">✅ موصول</span>
      </div>
      <div style="font-size:13px;color:#666;margin:6px 0">📅 ${esc(o.delivery_date)} &nbsp; 🕐 ${orderTime} &nbsp; 📦 <b>${o.total_qty || 0}</b> items</div>
    </div>`;
  }).join('') || '<p class="note">کوئی دکان نہیں</p>';

  // Item-wise (khubsurat table)
  const itemHtml = d.itemTotals.map((t, i) => `
    <tr style="${i % 2 ? 'background:#f9f9f9' : ''}">
      <td style="padding:8px;font-weight:bold">${esc(t.product_name)}</td>
      <td style="text-align:center"><span style="background:#e3f2fd;padding:2px 8px;border-radius:10px;font-size:11px">${esc(t.category_name || '—')}</span></td>
      <td style="text-align:center;font-weight:900;font-size:16px;color:#e8721c">${t.total_qty}</td>
      <td style="text-align:center;font-size:12px">${t.shop_count} دکان</td>
    </tr>`).join('') || '<tr><td colspan=4>کوئی ڈیٹا نہیں</td></tr>';

  // Schedule
  const schedHtml = sched.map(x => `
    <div style="background:#fff;padding:10px 12px;border-radius:8px;margin-bottom:6px;border:1px solid #eee">
      <div>📅 <b>${esc(x.supply_date)}</b> ${x.label ? `(${esc(x.label)})` : ''}</div>
      <div style="font-size:12px;color:#666">⏰ کٹ آف: ${esc(x.cutoff_date || '')} ${esc(x.cutoff_time || '')}</div>
    </div>`).join('') || '<p class="note">کوئی شیڈول نہیں</p>';

  const totalShops = (d.shopsStatus || []).length;
  const orderedShops = (d.shopsStatus || []).filter(x => x.has_order).length;
  const pct = totalShops ? Math.round(orderedShops / totalShops * 100) : 0;
  $('#v-dashboard').innerHTML = `
    <div style="background:linear-gradient(135deg,#e8721c,#f0953a);border-radius:16px;padding:20px;color:#fff;margin-bottom:12px;box-shadow:0 4px 16px rgba(232,114,28,.3)">
      <div style="font-size:22px;font-weight:bold">🚚 میرا ڈیش بورڈ</div>
      <div style="font-size:13px;opacity:.9;margin-top:4px">👤 ${esc(ME.username)} &nbsp; 📅 آخری ${d.history_days} دن</div>
      <div style="display:flex;gap:10px;margin-top:12px">
        <div style="background:rgba(255,255,255,.2);border-radius:10px;padding:10px;flex:1;text-align:center">
          <div style="font-size:24px;font-weight:900">${pending}</div><div style="font-size:11px">⏳ پینڈنگ</div>
        </div>
        <div style="background:rgba(255,255,255,.2);border-radius:10px;padding:10px;flex:1;text-align:center">
          <div style="font-size:24px;font-weight:900">${done}</div><div style="font-size:11px">✅ مکمل</div>
        </div>
        <div style="background:rgba(255,255,255,.2);border-radius:10px;padding:10px;flex:1;text-align:center">
          <div style="font-size:24px;font-weight:900">${totalQty}</div><div style="font-size:11px">📦 کل آئٹمز</div>
        </div>
      </div>
    </div>

    <div id="supCountdown" style="background:linear-gradient(135deg,#2e7d32,#43a047);color:#fff;border-radius:12px;padding:14px;text-align:center;margin-bottom:12px;box-shadow:0 3px 10px rgba(46,125,50,.3)"></div>

    <div style="background:linear-gradient(135deg,#43a047,#66bb6a);border-radius:14px;padding:16px;color:#fff;margin-bottom:12px;box-shadow:0 3px 10px rgba(0,0,0,.1)">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div style="font-weight:bold">📊 آرڈر ٹریک</div>
        <div style="font-size:20px;font-weight:900">${orderedShops}/${totalShops}</div>
      </div>
      <div style="font-size:12px;opacity:.9;margin:4px 0">دکانوں کا آرڈر آیا (${pct}%)</div>
      <div style="background:rgba(255,255,255,.3);border-radius:10px;height:10px;overflow:hidden;margin-top:8px">
        <div style="background:#fff;height:100%;width:${pct}%;border-radius:10px;transition:width .5s"></div>
      </div>
    </div>

    <div style="display:flex;gap:8px;margin-bottom:12px">
      <button class="btn small" style="flex:1;background:#1a237e;color:#fff;padding:10px" onclick="supTab('shops')">🏪 دکانیں</button>
      <button class="btn small" style="flex:1;background:#2e7d32;color:#fff;padding:10px" onclick="supTab('items')">📦 آئٹمز</button>
      <button class="btn small" style="flex:1;background:#e65100;color:#fff;padding:10px" onclick="supTab('order')">📝 آرڈر</button>
      <button class="btn small" style="flex:1;background:#6a1b9a;color:#fff;padding:10px" onclick="supTab('sched')">📅 شیڈول</button>
    </div>

    <div id="supTabShops">${shopHtml}</div>
    <div id="supTabItems" style="display:none">
      <div style="display:flex;gap:8px;margin-bottom:8px">
        <button class="btn small" style="flex:1;background:#1a237e;color:#fff" onclick="supPrint('items')">🖨 آئٹم وائز پرنٹ</button>
        <button class="btn small" style="flex:1;background:#2e7d32;color:#fff" onclick="supPrint('shops')">🖨 دکان وائز پرنٹ</button>
        <button class="btn small" style="flex:1;background:#6a1b9a;color:#fff" onclick="supPrint('blanksheet')">📝 خالی آرڈر شیٹ</button>
        <button class="btn small" style="flex:1;background:#4a148c;color:#fff" onclick="supMatrixSelect()">📊 میٹرکس شیٹ</button>
      </div>
      <div style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">
        <table style="width:100%;border-collapse:collapse"><tr style="background:#1a237e;color:#fff"><th style="padding:10px;text-align:right">آئٹم</th><th>کیٹیگری</th><th>کل</th><th>دکانیں</th></tr>${itemHtml}</table>
      </div>
    </div>
    <div id="supTabOrder" style="display:none">
      <div style="background:#fff;border-radius:12px;padding:14px;box-shadow:0 2px 8px rgba(0,0,0,.08)">
        <h4>📝 دکان کی طرف سے آرڈر دیں</h4>
        <label>دکان<br><select id="supOrderShop" style="width:100%;padding:10px;border-radius:8px;border:1px solid #ddd;margin-bottom:10px"></select></label>
        <label>ڈیلیوری تاریخ<br><input type="date" id="supOrderDate" style="width:100%;padding:10px;border-radius:8px;border:1px solid #ddd;margin-bottom:10px"></label>
        <div id="supOrderItems" style="max-height:300px;overflow-y:auto;border:1px solid #eee;border-radius:8px;padding:8px;margin-bottom:10px"></div>
        <button class="btn" style="width:100%;background:linear-gradient(135deg,#4caf50,#388e3c);color:#fff;padding:12px;border:none;border-radius:8px;font-weight:bold;font-size:16px" onclick="supSubmitOrder()">✅ آرڈر جمع کریں</button>
      </div>
    </div>
    <div id="supTabSched" style="display:none">
      <div style="background:#f5f5f5;border-radius:12px;padding:14px">
        <h4>📅 سپلائی شیڈول (ایڈمن نے سیٹ کیا)</h4>
        <p class="note">یہ سپلائی کیلنڈر سے آ رہا ہے</p>
        ${schedHtml}
      </div>
    </div>`;
}
function supTab(t) {
  ['shops', 'items', 'order', 'sched'].forEach(x => document.getElementById('supTab' + x[0].toUpperCase() + x.slice(1)).style.display = x === t ? '' : 'none');
  if (t === 'order') loadSupOrderForm();
}
async function supAddSched() {
  const d = document.getElementById('supDate').value, t = document.getElementById('supTime').value;
  if (!d) return alert('تاریخ منتخب کریں');
  await api('POST', '/api/supplier/schedule', { supply_date: d, cutoff_time: t });
  renderSupplierDash();
}
async function supDelSched(dt) {
  if (!confirm('حذف کریں؟')) return;
  await api('DELETE', '/api/supplier/schedule/' + dt);
  renderSupplierDash();
}
async function loadSupOrderForm() {
  const d = await api('GET', '/api/supplier/dashboard');
  const shops = d.shopsStatus || [];
  document.getElementById('supOrderShop').innerHTML = shops.map(s => `<option value="${s.shop_id}">${esc(s.shop_name)}</option>`).join('');
  const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  const dt = document.getElementById('supOrderDate');
  dt.min = tomorrow;
  dt.value = tomorrow;
  const prods = await api('GET', '/api/products').catch(() => []);
  document.getElementById('supOrderItems').innerHTML = prods.filter(p => p.active).map(p => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:6px;border-bottom:1px solid #f0f0f0">
      <span style="font-size:14px">${esc(p.name)}</span>
      <input type="number" min="0" data-pid="${p.id}" placeholder="0" style="width:70px;padding:6px;border-radius:6px;border:1px solid #ddd;text-align:center">
    </div>`).join('');
}
async function supSubmitOrder() {
  const shop_id = Number(document.getElementById('supOrderShop').value);
  const delivery_date = document.getElementById('supOrderDate').value;
  const items = {};
  document.querySelectorAll('#supOrderItems input').forEach(el => {
    const q = Number(el.value) || 0;
    if (q > 0) items[el.dataset.pid] = q;
  });
  if (!Object.keys(items).length) return alert('کوئی آئٹم منتخب نہیں!');
  await api('POST', '/api/supplier/order', { shop_id, delivery_date, items });
  alert('✅ آرڈر ہو گیا!');
  renderSupplierDash();
}
// Countdown
function supCountdown() {
  const el = document.getElementById('supCountdown');
  if (!el) return;
  api('GET', '/api/supplier/schedule').then(sched => {
    if (!sched.length) { el.innerHTML = '⏰ کوئی شیڈول سیٹ نہیں'; return; }
    const next = sched.sort((a,b) => a.supply_date.localeCompare(b.supply_date))[0];
    const target = new Date(next.supply_date + 'T' + (next.cutoff_time || '20:00'));
    const now = new Date();
    const diff = target - now;
    if (diff < 0) { el.innerHTML = `⏰ کٹ آف گزر گیا (${next.supply_date})`; return; }
    const h = Math.floor(diff / 36e5), m = Math.floor(diff % 36e5 / 6e4), sec = Math.floor(diff % 6e4 / 1e3);
    el.innerHTML = `⏰ کٹ آف: <b>${next.supply_date}</b> ${next.cutoff_time} &nbsp; | &nbsp; باقی: <b style="font-size:18px">${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}</b>`;
  }).catch(() => {});
}
setInterval(supCountdown, 1000);
function supPrint(type) {
  // Simple print: current dashboard data
  const d = window._supData;
  if (!d) return alert('ڈیٹا لوڈ نہیں ہوا');
  if (type === 'blanksheet') { supPrintBlankSheet(d); return; }
  let html = '';
  if (type === 'items') {
    html = '<h2>آئٹم وائز آرڈر</h2><table border=1 style="width:100%;border-collapse:collapse"><tr><th>آئٹم</th><th>کیٹیگری</th><th>کل</th><th>دکانیں</th></tr>' +
      d.itemTotals.map(t => `<tr><td>${t.product_name}</td><td>${t.category_name || ''}</td><td>${t.total_qty}</td><td>${t.shop_count}</td></tr>`).join('') + '</table>';
  } else {
    html = '<h2>دکان وائز آرڈر</h2>' + (d.shopsStatus || []).map(sh => {
      if (!sh.has_order) return `<p>🏪 ${sh.shop_name} - ⏳ پینڈنگ</p>`;
      const o = sh.order;
      return `<p>🏪 ${o.shop_name} - ✅ ${o.total_qty} items (${o.delivery_date})</p>`;
    }).join('');
  }
  const w = window.open('', '_blank');
  w.document.write(`<html><head><title>پرنٹ</title><style>body{font-family:serif;direction:rtl}table{border-collapse:collapse}td,th{border:1px solid #000;padding:6px}</style></head><body>${html}<br><button onclick="window.print()">🖨 پرنٹ</button></body></html>`);
}
// خالی آرڈر شیٹ: ہر دکان کا اپنا بلاک — نام ڈرائیور لکھے گا، نیچے آئٹم + مقدار کی خالی لائنیں
async function supPrintBlankSheet(d) {
  const n = (d.shopsStatus || []).length;
  if (!n) return alert('کوئی دکان نہیں');
  // گاڑی کا نام: /api/vehicles سے (permission ہو تو)، ورنہ username
  let vehLabel = (typeof ME !== 'undefined' && ME && ME.username) ? ME.username : '';
  try {
    const vs = await api('GET', '/api/vehicles');
    const act = (vs || []).filter(v => v.active);
    if (act.length === 1) vehLabel = act[0].name + (act[0].plate ? ' (' + act[0].plate + ')' : '');
  } catch (e) { /* permission nahi — username hi */ }
  const dateStr = new Date().toLocaleDateString('ur-PK', { day: 'numeric', month: 'long', year: 'numeric' });
  const PER_PAGE = 6, LINES = 10;
  const pages = Math.ceil(n / PER_PAGE);
  const logoUrl = location.origin + '/logo.png';
  let pagesHtml = '';
  for (let p = 0; p < pages; p++) {
    const s = p * PER_PAGE, e = Math.min(s + PER_PAGE, n);
    let blocks = '';
    for (let i = s; i < e; i++) {
      let rows = '';
      for (let r = 0; r < LINES; r++) rows += '<tr><td class="it"></td><td class="qt"></td></tr>';
      blocks += '<div class="shopblock"><div class="sb-head">دکان ' + (i + 1) + ': <span class="sb-line"></span></div>'
        + '<table class="sb-table"><tr><th class="th-it">آئٹم کا نام</th><th class="th-qt">مقدار</th></tr>' + rows + '</table></div>';
    }
    pagesHtml += '<div class="page">'
      + '<div class="phead"><img src="' + logoUrl + '" alt="">'
      + '<div class="ptitle"><h1>گاڑی وائز آرڈر شیٹ</h1><div class="vline">گاڑی: <b>' + esc(vehLabel) + '</b></div></div>'
      + '<div class="datebox"><div class="dl">تاریخ</div><div class="dv">' + esc(dateStr) + '</div></div></div>'
      + '<div class="blocks">' + blocks + '</div>'
      + '<div class="pfoot"><span>فیکٹری انچارج: ____________</span><span>ڈرائیور: ____________</span><span>صفحہ ' + (p + 1) + ' / ' + pages + '</span></div>'
      + '</div>';
  }
  const css = "*{margin:0;padding:0;box-sizing:border-box}"
    + "body{font-family:'Noto Nastaliq Urdu','Jameel Noori Nastaleeq',serif;direction:rtl;background:#fff;color:#111}"
    + "@page{size:A4 landscape;margin:7mm}"
    + ".page{page-break-after:always;break-inside:avoid}"
    + ".page:last-child{page-break-after:auto}"
    + ".phead{display:flex;align-items:center;gap:12px;border-bottom:3px solid #1a237e;padding-bottom:5px;margin-bottom:7px}"
    + ".phead img{width:42px;height:42px;object-fit:contain}"
    + ".ptitle{flex:1}"
    + ".ptitle h1{font-size:22px;line-height:2.2}"
    + ".ptitle .vline{font-size:13px;line-height:2;color:#333}"
    + ".ptitle .vline b{color:#1a237e}"
    + ".datebox{border:2px solid #e8721c;border-radius:10px;padding:2px 18px;text-align:center;flex-shrink:0}"
    + ".datebox .dl{font-size:10px;color:#b34a00;line-height:1.9}"
    + ".datebox .dv{font-size:16px;font-weight:bold;color:#111;line-height:2.1;white-space:nowrap}"
    + ".blocks{display:grid;grid-template-columns:repeat(3,1fr);gap:4mm}"
    + ".shopblock{border:2px solid #1a237e;border-radius:8px;overflow:hidden;break-inside:avoid}"
    + ".sb-head{background:#1a237e;color:#fff;font-size:13px;font-weight:bold;padding:2px 10px;line-height:2.2}"
    + ".sb-line{display:inline-block;min-width:52%;border-bottom:1px dashed #fff}"
    + ".sb-table{width:100%;border-collapse:collapse}"
    + ".sb-table th{background:#e8721c;color:#fff;font-size:10.5px;padding:2px;line-height:2;border:1px solid #e8721c}"
    + ".sb-table th.th-it{width:62%}.sb-table th.th-qt{width:38%}"
    + ".sb-table td{border:1px solid #999;height:5.6mm}"
    + ".sb-table td.it{background:#fffdf5}"
    + ".pfoot{margin-top:5px;display:flex;justify-content:space-between;font-size:11.5px;line-height:2.2;border-top:1px solid #999;padding-top:2px}"
    + "@media screen{body{background:#eee;padding:10mm}.page{background:#fff;width:283mm;margin:0 auto 10mm;padding:7mm;box-shadow:0 2px 12px rgba(0,0,0,.15)}}"
    + "@media print{.no-print{display:none}}";
  const w = window.open('', '_blank');
  w.document.write('<!DOCTYPE html><html lang="ur" dir="rtl"><head><meta charset="utf-8"><title>خالی آرڈر شیٹ</title>'
    + '<link href="https://fonts.googleapis.com/css2?family=Noto+Nastaliq+Urdu:wght@400;600;700&display=swap" rel="stylesheet">'
    + '<style>' + css + '</style></head><body>'
    + '<div class="no-print" style="text-align:center;padding:10px">'
    + '<button onclick="window.print()" style="font-size:18px;padding:10px 30px;background:#1a237e;color:#fff;border:none;border-radius:8px;cursor:pointer">پرنٹ کریں</button></div>'
    + pagesHtml + '</body></html>');
  w.document.close();
}
// ایڈمن: خالی آرڈر شیٹ (تمام دکانیں — /api/supplier/dashboard super_admin کو سب دیتی ہے)
async function adminBlankSheet() {
  const d = await api('GET', '/api/supplier/dashboard').catch(() => null);
  if (!d || !(d.shopsStatus || []).length) return alert('دکانیں نہیں ملیں');
  supPrintBlankSheet(d);
}
// میٹرکس سلیکشن اسکرین: پرنٹ سے پہلے دکانیں اور آئٹمز منتخب کریں
async function showMatrixSelect(presetShops) {
  let md;
  try { md = await api('GET', '/api/matrix-data'); } catch (e) { return alert('ڈیٹا نہیں ملا'); }
  let shops = md.shops || [];
  if (presetShops && presetShops.length) {
    const ids = new Set(presetShops.map(s => s.id));
    shops = shops.filter(s => ids.has(s.id));
  }
  const products = md.products || [];
  if (!shops.length) return alert('کوئی دکان نہیں');
  if (!products.length) return alert('کوئی آئٹم نہیں');
  const UR_D = '۰۱۲۳۴۵۶۷۸۹';
  const ur = n => String(n).replace(/\d/g, d => UR_D[d]);
  const saved = mxLoadSel();
  // کیٹیگری وائز گروپ
  const groups = [], gmap = {};
  products.forEach(p => {
    const key = p.category_id || 0;
    if (!gmap[key]) { gmap[key] = { name: p.category_name || 'متفرق', items: [] }; groups.push(gmap[key]); }
    gmap[key].items.push(p);
  });
  const shopHtml = shops.map((s, i) => {
    const checked = saved ? saved.shops.includes(s.id) : true;
    // نمبر بھی دکھائیں تاکہ میٹرکس سے ملان ہو سکے
    return `<label class="mx-chk${checked ? '' : ' off'}" data-shop="${s.id}" data-idx="${i}"><input type="checkbox" ${checked ? 'checked' : ''} onchange="mxUpd(this)"> <b>${ur(i + 1)}</b> - ${esc(s.name)}</label>`;
  }).join('');
  const prodHtml = groups.map((g, gi) => {
    const items = g.items.map(p => {
      const checked = saved ? saved.prods.includes(p.id) : true;
      return `<label class="mx-chk mx-prod${checked ? '' : ' off'}" data-prod="${p.id}" data-cat="${gi}"><input type="checkbox" ${checked ? 'checked' : ''} onchange="mxUpd(this)"> ${esc(p.name)}</label>`;
    }).join('');
    return `<div class="mx-cat"><span>${esc(g.name)}</span><button type="button" onclick="mxCat(${gi},true)">سب ✓</button><button type="button" onclick="mxCat(${gi},false)">سب ✗</button></div><div class="mx-pgrid">${items}</div>`;
  }).join('');
  const ov = document.createElement('div');
  ov.id = 'mxOverlay';
  ov.innerHTML = `
  <style>
    #mxOverlay { position: fixed; inset: 0; background: rgba(0,0,0,.6); z-index: 9999; display: flex; align-items: center; justify-content: center; padding: 12px; }
    #mxBox { background: #fff; border-radius: 12px; max-width: 700px; width: 100%; max-height: 92vh; display: flex; flex-direction: column; overflow: hidden; }
    #mxHead { background: linear-gradient(135deg,#4a148c,#6a1b9a); color: #fff; padding: 14px 18px; }
    #mxHead h3 { margin: 0; font-size: 18px; }
    #mxHead p { margin: 4px 0 0; font-size: 12px; opacity: .85; }
    #mxBody { overflow-y: auto; padding: 14px 18px; flex: 1; }
    #mxBody h4 { color: #4a148c; margin: 0 0 4px; font-size: 16px; }
    #mxBody .mx-hint { font-size: 12px; color: #888; margin-bottom: 8px; }
    .mx-sgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px,1fr)); gap: 6px; margin-bottom: 14px; }
    .mx-pgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px,1fr)); gap: 6px; margin-bottom: 6px; }
    .mx-chk { display: flex; align-items: center; gap: 6px; background: #faf7ff; border: 1px solid #e0d4f5; border-radius: 8px; padding: 7px 9px; font-size: 13px; cursor: pointer; }
    .mx-chk.off { opacity: .45; background: #f0f0f0; }
    .mx-chk.off span { text-decoration: line-through; }
    .mx-chk input { width: 17px; height: 17px; accent-color: #6a1b9a; }
    .mx-cat { background: #4a148c; color: #fff; border-radius: 8px; padding: 7px 12px; margin: 12px 0 6px; font-size: 15px; display: flex; gap: 8px; align-items: center; }
    .mx-cat span { flex: 1; }
    .mx-cat button { background: rgba(255,255,255,.25); border: none; color: #fff; border-radius: 6px; padding: 3px 10px; font-size: 12px; cursor: pointer; font-family: inherit; }
    #mxCount { text-align: center; padding: 10px; background: #fff3e0; color: #e65100; font-size: 14px; border-top: 1px solid #ffe0b2; }
    #mxFoot { display: flex; gap: 10px; padding: 12px 18px; background: #faf7ff; }
    #mxFoot button { flex: 1; padding: 12px; border: none; border-radius: 10px; font-size: 16px; font-family: inherit; cursor: pointer; }
    #mxPrint { background: linear-gradient(135deg,#2e7d32,#43a047); color: #fff; }
    #mxCancel { background: #e0e0e0; color: #333; flex: .4; }
    .mx-quick { display: flex; gap: 6px; margin-bottom: 8px; }
    .mx-quick button { background: #ede7f6; border: 1px solid #d1c4e9; border-radius: 6px; padding: 5px 12px; font-size: 12px; cursor: pointer; color: #4a148c; font-family: inherit; }
  </style>
  <div id="mxBox">
    <div id="mxHead"><h3>📊 میٹرکس — انتخاب</h3><p>جو دکانیں اور آئٹمز پرنٹ کرنے ہیں ان پر ✓ رکھیں</p></div>
    <div id="mxBody">
      <h4>🏪 دکانیں (<b id="mxShopN">${ur(shops.length)}</b>)</h4>
      <div class="mx-quick"><button type="button" onclick="mxAll('shop',true)">سب ✓</button><button type="button" onclick="mxAll('shop',false)">سب ✗</button></div>
      <div class="mx-sgrid">${shopHtml}</div>
      <h4>🍞 آئٹمز (<b id="mxProdN">${ur(products.length)}</b>)</h4>
      <div class="mx-hint">جو آئٹم گاڑی پر نہیں جاتا اس سے ✓ ہٹا دیں</div>
      <div class="mx-quick"><button type="button" onclick="mxAll('prod',true)">سب ✓</button><button type="button" onclick="mxAll('prod',false)">سب ✗</button></div>
      ${prodHtml}
    </div>
    <div id="mxCount"></div>
    <div id="mxFoot">
      <button id="mxPrint" onclick="mxDoPrint()">🖨 پرنٹ کریں</button>
      <button type="button" onclick="mxResetSel()" style="background:#ffccbc;color:#bf360c;flex:.5;padding:12px;border:none;border-radius:10px;font-size:14px;font-family:inherit;cursor:pointer">↺ ری سیٹ</button>
      <button id="mxCancel" onclick="document.getElementById('mxOverlay').remove()">واپس</button>
    </div>
  </div>`;
  document.body.appendChild(ov);
  // preset shops محفوظ کریں تاکہ پرنٹ میں وہی جائیں
  ov._shops = shops;
  mxUpdCount();
}
// میٹرکس سلیکشن localStorage میں محفوظ کریں
function mxLoadSel() {
  try {
    const s = localStorage.getItem('mxSel');
    return s ? JSON.parse(s) : null;
  } catch (e) { return null; }
}
function mxSaveSel(shopIds, prodIds) {
  try { localStorage.setItem('mxSel', JSON.stringify({ shops: shopIds, prods: prodIds })); } catch (e) {}
}
function mxResetSel() {
  try { localStorage.removeItem('mxSel'); } catch (e) {}
  // سب دوبارہ چیک کر دیں
  document.querySelectorAll('#mxOverlay input[type="checkbox"]').forEach(i => {
    i.checked = true; i.closest('.mx-chk').classList.remove('off');
  });
  mxUpdCount();
}
function mxUpd(el) {
  el.closest('.mx-chk').classList.toggle('off', !el.checked);
  mxUpdCount();
}
function mxUpdCount() {
  const UR_D = '۰۱۲۳۴۵۶۷۸۹';
  const ur = n => String(n).replace(/\d/g, d => UR_D[d]);
  const s = document.querySelectorAll('#mxOverlay [data-shop] input:checked').length;
  const p = document.querySelectorAll('#mxOverlay [data-prod] input:checked').length;
  const sn = document.getElementById('mxShopN'), pn = document.getElementById('mxProdN'), c = document.getElementById('mxCount');
  if (sn) sn.textContent = ur(s);
  if (pn) pn.textContent = ur(p);
  if (c) c.textContent = `🖨 ${ur(s)} دکانیں × ${ur(p)} آئٹمز`;
}
function mxAll(kind, v) {
  const sel = kind === 'shop' ? '#mxOverlay [data-shop] input' : '#mxOverlay [data-prod] input';
  document.querySelectorAll(sel).forEach(i => { i.checked = v; i.closest('.mx-chk').classList.toggle('off', !v); });
  mxUpdCount();
}
function mxCat(gi, v) {
  document.querySelectorAll(`#mxOverlay [data-cat="${gi}"] input`).forEach(i => { i.checked = v; i.closest('.mx-chk').classList.toggle('off', !v); });
  mxUpdCount();
}
function mxDoPrint() {
  const ov = document.getElementById('mxOverlay');
  if (!ov) return;
  const shops = ov._shops || [];
  const selData = [...ov.querySelectorAll('[data-shop] input:checked')].map(i => {
    const lbl = i.closest('[data-shop]');
    return { id: +lbl.dataset.shop, idx: +lbl.dataset.idx };
  });
  const selShopIds = new Set(selData.map(d => d.id));
  const selProdIds = [...ov.querySelectorAll('[data-prod] input:checked')].map(i => +i.closest('[data-prod]').dataset.prod);
  const selShops = shops.filter(s => selShopIds.has(s.id)).map(s => {
    const d = selData.find(x => x.id === s.id);
    return { ...s, _origIdx: d ? d.idx : 0 };
  });
  // سلیکشن محفوظ کریں تاکہ اگلی بار وہی رہے
  mxSaveSel([...selShopIds], selProdIds);
  ov.remove();
  printMatrixSheet(selShops, selProdIds);
}
// گاڑی: اپنی assigned دکانوں کے ساتھ سلیکشن اسکرین
function supMatrixSelect() {
  const d = window._supData;
  if (!d) return alert('ڈیٹا لوڈ نہیں ہوا');
  const shops = (d.shopsStatus || []).map(s => ({ id: s.shop_id, name: s.shop_name }));
  showMatrixSelect(shops);
}
// میٹرکس آرڈر شیٹ (Sample A): آئٹم پہلے سے لکھے (کیٹیگری وائز)، صرف مقدار لکھنی ہے
// shopList: vehicle dashboard apni assigned dukanein dega؛ admin ke liye khaali = sab dukanein
async function printMatrixSheet(shopList, productIds) {
  const UR_D = '۰۱۲۳۴۵۶۷۸۹';
  const ur = n => String(n).replace(/\d/g, d => UR_D[d]);
  let md;
  try { md = await api('GET', '/api/matrix-data'); } catch (e) { return alert('ڈیٹا نہیں ملا'); }
  const shops = (shopList && shopList.length) ? shopList : (md.shops || []);
  let products = md.products || [];
  if (productIds && productIds.length) {
    const pset = new Set(productIds);
    products = products.filter(p => pset.has(p.id));
  }
  if (!shops.length) return alert('کوئی دکان نہیں');
  if (!products.length) return alert('کوئی آئٹم نہیں');
  let vehLabel = (typeof ME !== 'undefined' && ME && ME.username) ? ME.username : '';
  try {
    const vs = await api('GET', '/api/vehicles');
    const act = (vs || []).filter(v => v.active);
    if (act.length === 1) vehLabel = act[0].name + (act[0].plate ? ' (' + act[0].plate + ')' : '');
  } catch (e) { /* permission nahi */ }
  const dateStr = new Date().toLocaleDateString('ur-PK', { day: 'numeric', month: 'long', year: 'numeric' });
  // کیٹیگری وائز گروپ
  const groups = [], gmap = {};
  products.forEach(p => {
    const key = p.category_id || 0;
    if (!gmap[key]) { gmap[key] = { name: p.category_name || 'متفرق', items: [] }; groups.push(gmap[key]); }
    gmap[key].items.push(p);
  });
  const rows = [];
  groups.forEach(g => { rows.push({ t: 'cat', name: g.name }); g.items.forEach(it => rows.push({ t: 'item', name: it.name })); });
  // چہرے (faces): ہر face پر ~22 rows، کیٹیگری نہ ٹوٹے تو بینڈ دہرائیں
  const PER_FACE = 22, faces = [];
  let cur = [], curCat = '';
  rows.forEach(r => {
    if (r.t === 'cat') curCat = r.name;
    if (cur.length >= PER_FACE) { faces.push(cur); cur = []; if (r.t === 'item') cur.push({ t: 'cat', name: curCat }); }
    cur.push(r);
  });
  if (cur.length) faces.push(cur);
  const shopTh = shops.map((s) => '<th class="shop">' + esc(s.name) + '</th>').join('');
  let pagesHtml = '';
  faces.forEach((fr, p) => {
    let trs = '';
    fr.forEach(r => {
      if (r.t === 'cat') trs += '<tr class="cat"><td colspan="' + (shops.length + 1) + '">' + esc(r.name) + '</td></tr>';
      else trs += '<tr style="height:8mm"><td class="it">' + esc(r.name) + '</td>' + '<td></td>'.repeat(shops.length) + '</tr>';
    });
    pagesHtml += '<div class="page">'
      + '<div class="phead"><div class="ptitle">آرڈر شیٹ — میٹرکس</div>'
      + '<div class="pmeta">گاڑی: ' + esc(vehLabel) + ' &nbsp;|&nbsp; تاریخ: ' + esc(dateStr) + ' &nbsp;|&nbsp; صفحہ ' + ur(p + 1) + ' / ' + ur(faces.length) + '</div></div>'
      + '<table class="mx"><tr><th class="it">آئٹم</th>' + shopTh + '</tr>' + trs + '</table></div>';
  });
  const css = "*{margin:0;padding:0;box-sizing:border-box}"
    + "body{font-family:'Noto Nastaliq Urdu','Jameel Noori Nastaleeq',serif;direction:rtl;background:#fff;color:#111}"
    + "@page{size:A4 landscape;margin:7mm}"
    + ".page{page-break-after:always;break-inside:avoid}.page:last-child{page-break-after:auto}"
    + ".phead{display:flex;justify-content:space-between;align-items:center;border-bottom:2.5px solid #4a148c;padding-bottom:1mm;margin-bottom:2mm}"
    + ".ptitle{font-size:16px;font-weight:700;color:#4a148c;line-height:2}"
    + ".pmeta{font-size:11px;line-height:2}"
    + "table.mx{width:100%;border-collapse:collapse;table-layout:fixed}"
    + "table.mx th{background:#4a148c;color:#fff;font-size:11px;padding:1mm;line-height:2;border:1px solid #4a148c}"
    + "table.mx th.it{width:50mm;text-align:right;padding-right:3mm}"
    + "table.mx th.shop{font-size:9px;line-height:1.4;padding:1mm 0.5mm;vertical-align:middle;word-wrap:break-word}"
    + "table.mx td{border:1px solid #cfcfcf;font-size:12px}"
    + "table.mx td.it{text-align:right;padding-right:3mm;line-height:2}"
    + "table.mx tr.cat td{background:#ef6c00;color:#fff;font-weight:700;font-size:12.5px;text-align:center;line-height:2;border:1px solid #ef6c00}"
    + "@media screen{body{background:#eee;padding:10mm}.page{background:#fff;max-width:283mm;margin:0 auto 10mm;padding:7mm;box-shadow:0 2px 12px rgba(0,0,0,.15)}}"
    + "@media print{.no-print{display:none}}";
  const w = window.open('', '_blank');
  w.document.write('<!DOCTYPE html><html lang="ur" dir="rtl"><head><meta charset="utf-8"><title>میٹرکس آرڈر شیٹ</title>'
    + '<link href="https://fonts.googleapis.com/css2?family=Noto+Nastaliq+Urdu:wght@400;600;700&display=swap" rel="stylesheet">'
    + '<style>' + css + '</style></head><body>'
    + '<div class="no-print" style="text-align:center;padding:10px">'
    + '<button onclick="window.print()" style="font-size:18px;padding:10px 30px;background:#4a148c;color:#fff;border:none;border-radius:8px;cursor:pointer">پرنٹ کریں</button>'
    + '<div style="margin-top:6px;font-size:13px;color:#555">۲ شیٹس پر ڈبل سائیڈ پرنٹ کریں</div></div>'
    + pagesHtml + '</body></html>');
  w.document.close();
}
async function supSetStatus(id, status) {
  await api('POST', `/api/supplier/order/${id}/status`, { status });
  renderSupplierDash();
}
// countdown target = order_date se ek din pehle, cutoff time par
function dailyCutDate(orderDate) {
  const d = new Date(orderDate + 'T12:00:00');
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---------- shop: apna rozana order ----------
async function renderDailyShopForm(di) {
  const catalog = await api('GET', '/api/daily/catalog');
  const allowedIds = await api('GET', '/api/daily/my-items').catch(() => null);
  const myOrders = await api('GET', '/api/daily/orders?date=' + di.order_date);
  const mine = myOrders[0] || null;
  const qty = {};
  (mine && mine.items || []).forEach(i => qty[i.product_id] = i.quantity);
  const locked = di.cutoff_passed;
  const catsHtml = catalog.map(c => {
    const prods = c.products.filter(p => !allowedIds || allowedIds.includes(p.id));
    if (!prods.length) return '';
    return `<div class="cathead">${esc(c.name)}</div>` + prods.map(p =>
      `<div class="prow"><span class="pn">${esc(p.name)}</span>
       <input type="number" min="0" step="any" data-pid="${p.id}" value="${qty[p.id] || ''}" placeholder="0"${locked ? ' disabled' : ''}></div>`).join('');
  }).join('');
  $('#v-daily').innerHTML = `
    <div style="background:linear-gradient(135deg,#e8721c,#f0953a);border-radius:16px;padding:20px;margin-bottom:12px;color:#fff;box-shadow:0 4px 16px rgba(232,114,28,.3);position:relative;overflow:hidden">
      <div style="position:absolute;top:-30px;left:-30px;width:100px;height:100px;background:rgba(255,255,255,.1);border-radius:50%"></div>
      <div style="position:absolute;bottom:-40px;right:20px;width:80px;height:80px;background:rgba(255,255,255,.08);border-radius:50%"></div>
      <div style="position:relative;display:flex;align-items:center;gap:12px">
        <div style="font-size:40px;filter:drop-shadow(0 2px 4px rgba(0,0,0,.2))">📝</div>
        <div>
          <div style="font-size:24px;font-weight:bold;text-shadow:0 2px 4px rgba(0,0,0,.2)">روزانہ آرڈر</div>
          <div style="font-size:13px;opacity:.9">${esc(di.order_date)}</div>
        </div>
      </div>
    </div>
    <div class="supcard" style="background:linear-gradient(135deg,#fff8f0,#ffecd2);border:2px solid #e8721c;box-shadow:0 2px 8px rgba(232,114,28,.15)">
      <div class="suphead" style="font-size:19px;color:#c25e10">🖨 <b>پرنٹ آپشنز</b></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">
        <a class="btn" style="padding:16px;font-size:16px;text-align:center;background:linear-gradient(135deg,#2e7d32,#43a047);color:#fff;border:none;border-radius:10px;box-shadow:0 2px 6px rgba(46,125,50,.3)" target="_blank" href="/print?type=daily_total&date=${esc(di.order_date)}&cb="+Date.now()+"">📋<br><b>آئٹم وائز کل</b><br><small style="opacity:.9">تمام دکانوں کا ٹوٹل</small></a>
        <a class="btn" style="padding:16px;font-size:16px;text-align:center;background:linear-gradient(135deg,#1565c0,#1e88e5);color:#fff;border:none;border-radius:10px;box-shadow:0 2px 6px rgba(21,101,192,.3)" target="_blank" href="/print?type=daily_all&date=${esc(di.order_date)}&cb="+Date.now()+"">📦<br><b>مکمل پرنٹ</b><br><small style="opacity:.9">ٹوٹل + تمام دکانیں ایک ساتھ</small></a>
      </div>
      <div style="font-size:12px;color:#666;margin-top:8px;text-align:center">💡 <b>PDF</b> کے لیے پرنٹ کھولیں → <b>Ctrl+P</b> → <b>Save as PDF</b> منتخب کریں</div>
      <div style="display:flex;gap:10px;margin-top:12px;align-items:end">
        <label style="flex:1;font-size:15px"><b>🏪 دکان منتخب کریں</b><br><select id="dPrintShop" style="font-size:15px;padding:12px;width:100%;border-radius:8px;border:1px solid #e8721c">
          <option value="">-- دکان چنیں --</option>
          <option value="mine">🏪 میری دکان</option>
        </select></label>
        </select></label>
        <button class="btn" style="padding:12px 24px;font-size:16px;background:linear-gradient(135deg,#e8721c,#f0953a);color:#fff;border:none;border-radius:10px;white-space:nowrap" onclick="printDailyShop()">🖨 پرنٹ کریں</button>
      </div>
      </div>
    </div>
    <div class="supbanner">📦 پیداوار: <b>${esc(di.order_date)}</b></div>
    ${locked ? `<div class="lockbar">🔒 کٹ آف (${esc(di.cutoff_time)}) گزر چکا ہے — آرڈر بند ہے</div>` : `<div id="dCd"></div>`}
    ${catsHtml || '<p class="note">کوئی آئٹم نہیں</p>'}
    <div class="err" id="dErr"></div>
    <button class="btn green" onclick="submitDailyOrder()"${locked ? ' disabled' : ''}>✅ آرڈر بھیجیں</button>
    ${mine && !locked ? `<button class="btn small" style="background:#c62828;color:#fff" onclick="delDailyOrder(${mine.id})">🗑 آرڈر حذف کریں</button>` : ''}`;
  if (!locked) startCountdown(dailyCutDate(di.order_date), di.cutoff_time, 'روزانہ آرڈر', 'dCd', { onDone: () => renderDaily() });
}
async function submitDailyOrder() {
  const items = {};
  document.querySelectorAll('#v-daily input[data-pid]').forEach(i => { const q = parseFloat(i.value) || 0; if (q > 0) items[i.dataset.pid] = q; });
  try {
    await api('POST', '/api/daily/orders', { order_date: DAILY_DATE, items });
    alert('آرڈر بھیج دیا گیا ✅');
    renderDaily();
  } catch (e) { $('#dErr').textContent = 'خرابی: ' + e.message + (e.detail ? ' (' + e.detail + ')' : ''); }
}
// ---------- admin: kisi dukan ka order do ----------
async function renderDailyAdminOrder() {
  const di = await api('GET', '/api/daily/date');
  DAILY_DATE = di.order_date;
  const [shops, catalog] = await Promise.all([api('GET', '/api/daily-shops'), api('GET', '/api/daily/catalog')]);
  const catsHtml = catalog.map(c => {
    if (!c.products.length) return '';
    return `<div class="cathead">🗂 ${esc(c.name)}</div>` + c.products.map(p =>
      `<div class="prow"><span class="pn">${esc(p.name)}</span>
       <input type="number" min="0" step="any" data-pid="${p.id}" placeholder="0"></div>`).join('');
  }).join('');
  $('#v-daily').innerHTML = `
    <h2 class="st">📝 <span>دکان کا آرڈر دیں</span></h2>
    <button class="btn small" onclick="DAILY_VIEW_DATE=null;renderDaily()">← واپس</button>
    <div class="supbanner">📦 پیداوار: <b>${esc(di.order_date)}</b></div>
    <div class="formgrid"><label>دکان منتخب کریں<br><select id="dao-shop">
      ${shops.filter(s => s.active).map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}
    </select></label></div>
    ${catsHtml || '<p class="note">⚠️ کوئی آئٹم نہیں — پہلے 📦 روزانہ ڈیٹا سے آئٹمز شامل کریں</p>'}
    <div class="err" id="dErr"></div>
    ${catsHtml ? '<button class="btn green" onclick="submitDailyAdminOrder()">✅ آرڈر بھیجیں</button>' : ''}`;
}
async function submitDailyAdminOrder() {
  const shop_id = Number($('#dao-shop').value);
  if (!shop_id) { alert('دکان منتخب کریں'); return; }
  const items = {};
  document.querySelectorAll('#v-daily input[data-pid]').forEach(i => { const q = parseFloat(i.value) || 0; if (q > 0) items[i.dataset.pid] = q; });
  if (!Object.keys(items).length) { alert('کوئی مقدار درج نہیں کی'); return; }
  try {
    await api('POST', '/api/daily/orders', { order_date: DAILY_DATE, shop_id, items });
    alert('آرڈر بھیج دیا گیا ✅');
    DAILY_VIEW_DATE = null; renderDaily();
  } catch (e) { $('#dErr').textContent = 'خرابی: ' + e.message; }
}
async function delDailyOrder(id) {
  if (!confirm('آرڈر حذف کریں؟')) return;
  await api('DELETE', '/api/daily/orders/' + id);
  renderDaily();
}

// ---------- board: viewer / supplier / factory / admin ----------
async function renderDailyBoard(di) {
  const isAdmin = ME.role === 'super_admin';
  const date = DAILY_VIEW_DATE || di.order_date;
  const [orders, totals, tracker, catalog] = await Promise.all([
    api('GET', '/api/daily/orders?date=' + encodeURIComponent(date)),
    api('GET', '/api/daily/totals?date=' + encodeURIComponent(date)),
    api('GET', '/api/daily/tracker?date=' + encodeURIComponent(date)),
    api('GET', '/api/daily/catalog'),
  ]);
  const isCurrent = date === di.order_date;

  const rec = tracker.shops.filter(s => s.ordered), pend = tracker.shops.filter(s => !s.ordered);
  const pct = tracker.total ? Math.round(tracker.received / tracker.total * 100) : 0;
  const trackerHtml = `
    <div class="supcard" style="background:linear-gradient(135deg,#1b5e20,#2e7d32,#43a047);color:#fff;border:none;border-radius:16px;box-shadow:0 4px 16px rgba(27,94,32,.3);overflow:hidden;position:relative">
      <div style="position:absolute;top:-20px;right:-20px;width:120px;height:120px;background:rgba(255,255,255,.08);border-radius:50%"></div>
      <div style="position:absolute;bottom:-30px;left:-30px;width:100px;height:100px;background:rgba(255,255,255,.05);border-radius:50%"></div>
      <div style="display:flex;justify-content:space-between;align-items:center;position:relative">
        <div><div style="font-size:13px;opacity:.85">📊 آرڈر ٹریکر</div>
        <div style="font-size:36px;font-weight:bold;text-shadow:0 2px 4px rgba(0,0,0,.2)">${tracker.received}<span style="font-size:18px;opacity:.7"> / ${tracker.total}</span></div>
        <div style="font-size:13px;opacity:.85">دکانوں کا آرڈر آ گیا (${pct}%)</div></div>
        <div style="font-size:48px;filter:drop-shadow(0 2px 4px rgba(0,0,0,.2))">${pct === 100 ? '🎉' : '⏳'}</div>
      </div>
      <div style="background:rgba(255,255,255,.25);border-radius:10px;height:12px;margin:12px 0;overflow:hidden;position:relative">
        <div style="background:linear-gradient(90deg,#fff,#e8f5e9);height:100%;width:${pct}%;border-radius:10px;transition:width .5s;box-shadow:0 0 8px rgba(255,255,255,.5)"></div>
      </div>
    </div>
    ${pend.length ? `
    <div style="margin:12px 0">
      <div style="font-size:16px;font-weight:bold;color:#c62828;margin-bottom:8px">⏳ پینڈنگ (${pend.length})</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px">
        ${pend.map(s => `<div style="background:linear-gradient(135deg,#ffebee,#ffcdd2);border:2px solid #e57373;border-radius:10px;padding:10px;text-align:center;box-shadow:0 2px 6px rgba(198,40,40,.15)">
          <div style="font-size:14px;font-weight:bold;color:#b71c1c">🏪 ${esc(s.name)}</div>
          <div style="font-size:11px;color:#c62828">آرڈر باقی</div>
        </div>`).join('')}
      </div>
    </div>` : `<div style="background:linear-gradient(135deg,#e8f5e9,#c8e6c9);border-radius:12px;padding:16px;text-align:center;margin:12px 0;font-size:16px;font-weight:bold;color:#2e7d32">🎉 سب دکانوں کا آرڈر آ گیا!</div>`}
    ${rec.length ? `
    <div style="margin:12px 0">
      <div style="font-size:16px;font-weight:bold;color:#2e7d32;margin-bottom:8px">✅ موصول (${rec.length})</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px">
        ${rec.map(s => `<div style="background:linear-gradient(135deg,#e8f5e9,#c8e6c9);border:2px solid #81c784;border-radius:10px;padding:10px;text-align:center;box-shadow:0 2px 6px rgba(46,125,50,.15)">
          <div style="font-size:14px;font-weight:bold;color:#1b5e20">🏪 ${esc(s.name)}</div>
          <div style="font-size:11px;color:#388e3c">${fmtTime(s.at)} · ${s.items} آئٹم</div>
        </div>`).join('')}
      </div>
    </div>` : ''}`;
  // Category-wise cards: shop filter ho to us shop ke items, warna totals
  const cats = {};
  const shopF = DAILY_SHOP_FILTER;
  if (shopF) {
    const so = orders.find(o => String(o.shop_id) === shopF);
    if (so && so.items) {
      so.items.forEach(it => {
        const k = it.category_name || 'متفرق';
        (cats[k] = cats[k] || []).push({ product_name: it.product_name, total_qty: it.quantity, shop_count: 1 });
      });
    }
    // Shop ke catalog se baqi items bhi dikhao (0 quantity)
    if (catalog && Array.isArray(catalog)) {
      const hasNames = new Set();
      Object.values(cats).forEach(arr => arr.forEach(x => hasNames.add(x.product_name)));
      catalog.forEach(cat => {
        (cat.products || []).forEach(p => {
          if (!hasNames.has(p.name)) {
            const k = cat.name || 'متفرق';
            (cats[k] = cats[k] || []).push({ product_name: p.name, total_qty: 0, shop_count: 0 });
          }
        });
      });
    }
  } else {
    totals.forEach(t => { const k = t.category_name || 'متفرق'; (cats[k] = cats[k] || []).push(t); });
  }
  const catColors = {'بریڈ':'#e8721c','نمکین':'#2e7d32','ڈرائی':'#1565c0','فریش':'#9c27b0'};
  // Shop select hai to uska naam, warna "ٹوٹل"
  const colHead = shopF ? esc(((tracker.shops || []).find(x => String(x.id) === shopF) || {}).name || 'دکان') : 'ٹوٹل';
  const totHtml = `<div style="column-count:2;column-gap:12px">` + Object.entries(cats).map(([cn, items]) => {
    const total = items.reduce((a, t) => a + Number(t.total_qty || 0), 0);
    return `
    <div style="border:2px solid #111;border-radius:6px;overflow:hidden;background:#fff;break-inside:avoid;margin-bottom:12px;display:inline-block;width:100%">
      <div style="background:#111;color:#fff;font-size:15px;font-weight:bold;text-align:center;padding:8px">${esc(cn)} <span style="color:#ffb74d">(کل: ${total})</span></div>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr><th style="background:#f5f5f5;font-size:11px;padding:5px;border:1px solid #999;width:35px">#</th><th style="background:#f5f5f5;font-size:11px;padding:5px;border:1px solid #999">آئٹم</th><th style="background:#f5f5f5;font-size:11px;padding:5px;border:1px solid #999;width:60px">${colHead}</th></tr>
        ${items.map((t, i) => `<tr><td style="text-align:center;padding:6px;border:1px solid #bbb;font-weight:bold">${i+1}</td><td style="padding:6px;border:1px solid #bbb;font-weight:bold">${esc(t.product_name)} <small style="color:#888">(${t.shop_count} دکان)</small></td><td style="text-align:center;padding:6px;border:1px solid #bbb;font-weight:bold;font-size:16px">${esc(t.total_qty)}</td></tr>`).join('')}
      </table>
    </div>`; }).join('') + `</div>`;
  const ordersHtml = orders.filter(o => !shopF || String(o.shop_id) === shopF).map(o => `
    <div class="ocard" style="border-radius:14px;overflow:hidden;box-shadow:0 3px 12px rgba(0,0,0,.08);border:1px solid #eee;margin-bottom:12px">
      <div class="ochead" style="background:linear-gradient(135deg,#37474f,#546e7a);color:#fff;padding:12px 16px;display:flex;justify-content:space-between;align-items:center"><b style="font-size:15px">🏪 ${esc(o.shop_name)}</b>
        <span><a class="btn small" target="_blank" href="/print?type=daily_shop&date=${esc(date)}&shop_id=${o.shop_id}&cb="+Date.now()+"">🖨 پرنٹ</a>
        ${can('daily', 'full') ? `<button class="btn small" style="background:#c62828;color:#fff" onclick="delDailyOrderBoard(${o.id})">🗑</button>` : ''}</span>
      </div>
      ${(o.items || []).map(i => `<div class="prow"><span class="pn">${esc(i.product_name)} <small class="note">${esc(i.category_name || '')}</small></span><b>${esc(i.quantity)}</b></div>`).join('') || '<p class="note">کوئی آئٹم نہیں</p>'}
      ${o.note ? `<div class="note">نوٹ: ${esc(o.note)}</div>` : ''}
    </div>`).join('');
  $('#v-daily').innerHTML = `
    <div style="background:linear-gradient(135deg,#e8721c,#f0953a);border-radius:16px;padding:20px;margin-bottom:12px;color:#fff;box-shadow:0 4px 16px rgba(232,114,28,.3);position:relative;overflow:hidden">
      <div style="position:absolute;top:-30px;left:-30px;width:100px;height:100px;background:rgba(255,255,255,.1);border-radius:50%"></div>
      <div style="position:absolute;bottom:-40px;right:20px;width:80px;height:80px;background:rgba(255,255,255,.08);border-radius:50%"></div>
      <div style="position:relative;display:flex;align-items:center;gap:12px">
        <div style="font-size:40px;filter:drop-shadow(0 2px 4px rgba(0,0,0,.2))">📝</div>
        <div>
          <div style="font-size:24px;font-weight:bold;text-shadow:0 2px 4px rgba(0,0,0,.2)">روزانہ آرڈر</div>
          <div style="font-size:13px;opacity:.9">${esc(date)} ${isCurrent ? '• آج' : ''}</div>
        </div>
      </div>
    </div>
    <div class="supcard" style="background:linear-gradient(135deg,#fff8f0,#ffecd2);border:2px solid #e8721c;margin:8px 0;box-shadow:0 2px 8px rgba(232,114,28,.15)">
      <div class="suphead" style="font-size:19px;color:#c25e10">🖨 <b>پرنٹ آپشنز</b></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">
        <a class="btn" style="padding:16px;font-size:16px;text-align:center;background:linear-gradient(135deg,#2e7d32,#43a047);color:#fff;border:none;border-radius:10px;box-shadow:0 2px 6px rgba(46,125,50,.3)" target="_blank" href="/print?type=daily_total&date=${esc(date)}&cb="+Date.now()+"">📋<br><b>آئٹم وائز کل</b><br><small style="opacity:.9">تمام دکانوں کا ٹوٹل</small></a>
        <a class="btn" style="padding:16px;font-size:16px;text-align:center;background:linear-gradient(135deg,#1565c0,#1e88e5);color:#fff;border:none;border-radius:10px;box-shadow:0 2px 6px rgba(21,101,192,.3)" target="_blank" href="/print?type=daily_all&date=${esc(date)}&cb="+Date.now()+"">📦<br><b>مکمل پرنٹ</b><br><small style="opacity:.9">ٹوٹل + تمام دکانیں ایک ساتھ</small></a>
      </div>
      <div style="display:flex;gap:10px;margin-top:12px;align-items:end">
        <label style="flex:1;font-size:15px"><b>🏪 دکان منتخب کریں</b><br><select id="dPrintShop2" style="font-size:15px;padding:12px;width:100%;border-radius:8px;border:1px solid #e8721c">
          <option value="">-- دکان چنیں --</option>
          ${tracker.shops.map(s => `<option value="${s.id}">🏪 ${esc(s.name)}${s.ordered ? ' ✅' : ''}</option>`).join('')}
        </select></label>
        <button class="btn" style="padding:12px 24px;font-size:16px;background:linear-gradient(135deg,#e8721c,#f0953a);color:#fff;border:none;border-radius:10px;white-space:nowrap" onclick="printDailyShop2()">🖨 پرنٹ کریں</button>
      </div>
    </div>
    ${isAdmin ? `<div style="margin:8px 0"><button class="btn green" onclick="renderDailyAdminOrder()">📝 دکان کا آرڈر دیں</button></div>` : ''}
    ${isCurrent && !di.cutoff_passed ? `<div id="dCd"></div>` : ''}
    ${isCurrent && di.cutoff_passed ? `<div class="lockbar">🔒 کٹ آف (${esc(di.cutoff_time)}) گزر چکا ہے</div>` : ''}
    ${trackerHtml}
    <div class="formgrid">
      <label>پیداوار کی تاریخ<br><input type="date" id="dDate" value="${esc(date)}" onchange="DAILY_VIEW_DATE=this.value;DAILY_SHOP_FILTER='';renderDaily()"></label>
      <label>دکان<br><select id="dShopF" onchange="setDailyShopFilter(this.value)">
        <option value="">تمام دکانیں</option>
        ${tracker.shops.map(s => `<option value="${s.id}"${shopF === String(s.id) ? ' selected' : ''}>${esc(s.name)}${s.ordered ? ' ✅' : ''}</option>`).join('')}
      </select></label>
      ${isAdmin ? `<label><br><button class="btn small" onclick="renderDailyAccess()">⚙ ایکسس سیٹنگ</button></label>` : ''}
    </div>
    <div style="background:linear-gradient(135deg,#1a237e,#283593);border-radius:14px;padding:16px;margin:12px 0;color:#fff;box-shadow:0 4px 12px rgba(26,35,126,.25)">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <div style="font-size:32px">📋</div>
        <div style="flex:1;min-width:200px">
          <div style="font-size:20px;font-weight:bold">${shopF ? '🏪 ' + esc((tracker.shops.find(x => String(x.id) === shopF) || {}).name || '') + ' — آئٹم وائز' : 'All Parties — آئٹم وائز ٹوٹل'}</div>
          <div style="font-size:12px;opacity:.85">${shopF ? 'اس دکان کا آرڈر' : 'تمام دکانوں کا ملا کر ٹوٹل (live)'}</div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn small" style="background:#fff;color:#1a237e" onclick="window.open('/print?type=daily_total&date=${esc(date)}&cb='+Date.now(),'_blank')">🖨 ٹوٹل پرنٹ</button>
          ${shopF ? `<button class="btn small" style="background:#ffb74d;color:#111" onclick="window.open('/print?type=daily_shop&date=${esc(date)}&shop_id=${shopF}&cb='+Date.now(),'_blank')">🖨 دکان پرنٹ</button>` : ''}
        </div>
      </div>
    </div>
    ${totHtml || '<p class="note">کوئی آرڈر نہیں</p>'}
    ${shopF ? `<div style="background:linear-gradient(135deg,#e8721c,#f0953a);border-radius:12px;padding:14px;margin:12px 0;color:#fff"><b style="font-size:16px">🏪 ${esc((tracker.shops.find(x => String(x.id) === shopF) || {}).name || '')} کا آرڈر</b><div style="font-size:12px;opacity:.9">نیچے اس دکان کی مکمل تفصیل</div></div>` : ''}
    <h3 class="st">🏪 دکان وائز آرڈر (${orders.filter(o => !shopF || String(o.shop_id) === shopF).length})</h3>
    <div class="ocards">${ordersHtml || '<p class="note">کوئی آرڈر نہیں</p>'}</div>`;
  if (isCurrent && !di.cutoff_passed) startCountdown(dailyCutDate(di.order_date), di.cutoff_time, 'روزانہ آرڈر', 'dCd', { onDone: () => renderDaily() });
  // Auto-refresh har 30 sec (naye orders ke liye)
  if (window._dailyRefresh) clearInterval(window._dailyRefresh);
  window._dailyRefresh = setInterval(() => {
    if (document.getElementById('v-daily') && document.getElementById('v-daily').innerHTML.includes('All Parties')) {
      renderDaily();
    }
  }, 30000);
}
function printDailyShop2() {
  const sel = $('#dPrintShop2'); if (!sel || !sel.value) { alert('کوئی دکان منتخب نہیں'); return; }
  const d = ($('#dDate') || {}).value || DAILY_DATE;
  window.open(`/print?type=daily_shop&date=${encodeURIComponent(d)}&shop_id=${encodeURIComponent(sel.value)}&cb=${Date.now()}`, '_blank');
}
async function loadPrintSettings() {
  try {
    const ps = await api('GET', '/api/daily/print-settings');
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    const setC = (id, v) => { const el = document.getElementById(id); if (el) el.checked = v === '1'; };
    set('ps_cols', ps.print_cols || '2');
    set('ps_margin', ps.print_margin || '6');
    set('ps_gap', ps.print_gap || '10');
    set('ps_font', ps.print_font || 'Jameel Noori Nastaleeq');
    set('ps_title', ps.print_title_size || '24');
    setC('ps_title_bold', ps.print_title_bold || '1');
    setC('ps_title_italic', ps.print_title_italic || '0');
    set('ps_sub', ps.print_sub_size || '13');
    setC('ps_sub_bold', ps.print_sub_bold || '1');
    set('ps_cat', ps.print_cat_size || '17');
    setC('ps_cat_bold', ps.print_cat_bold || '1');
    set('ps_table', ps.print_table_size || '15');
    set('ps_name', ps.print_name_size || '15');
    setC('ps_name_bold', ps.print_name_bold || '1');
    set('ps_num', ps.print_num_size || '16');
    set('ps_head', ps.print_head_size || '14');
    setC('ps_num_bold', ps.print_num_bold || '1');
    previewPrint();
    loadCatOrder();
    loadShopOrder();
    loadSupUsers();
    loadHistDays();
    setTimeout(refreshPreview, 1000);
  } catch(e) {}
}
let _psCatOrder = [];
async function loadCatOrder() {
  try {
    const cats = await api('GET', '/api/daily-categories');
    const ps = await api('GET', '/api/daily/print-settings');
    let order = [];
    try { order = JSON.parse(ps.print_cat_order || '[]'); } catch(e) {}
    // Sort by saved order, then by name
    _psCatOrder = cats.map(c => c.name).sort((a, b) => {
      const ia = order.indexOf(a), ib = order.indexOf(b);
      if (ia === -1 && ib === -1) return a.localeCompare(b);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });
    renderCatOrder();
  } catch(e) {}
}
function renderCatOrder() {
  const el = document.getElementById('ps_cat_order');
  if (!el) return;
  el.innerHTML = '<div style="font-size:12px;color:#888;margin-bottom:6px">🖱️ پکڑ کر گھسیٹیں (drag) یا ↑↓ دبائیں</div>' + _psCatOrder.map((cn, i) => `
    <div draggable="true" ondragstart="dragCatStart(event,${i})" ondragover="dragCatOver(event)" ondrop="dragCatDrop(event,${i})" ondragend="dragCatEnd(event)"
      style="display:flex;align-items:center;gap:8px;padding:8px;background:#fff;border:2px solid #ddd;border-radius:8px;margin-bottom:6px;cursor:grab;transition:all .2s">
      <span style="cursor:grab;font-size:18px">⋮⋮</span>
      <span style="font-weight:bold;color:#9c27b0">${i+1}.</span>
      <span style="flex:1;font-weight:500">${esc(cn)}</span>
      <button class="btn small" onclick="moveCat(${i},-1)" ${i===0?'disabled':''}>↑</button>
      <button class="btn small" onclick="moveCat(${i},1)" ${i===_psCatOrder.length-1?'disabled':''}>↓</button>
    </div>`).join('');
}
let _dragCatIdx = null;
function dragCatStart(e, i) { _dragCatIdx = i; e.target.style.opacity = '0.5'; e.target.style.borderColor = '#9c27b0'; }
function dragCatOver(e) { e.preventDefault(); }
function dragCatDrop(e, i) {
  e.preventDefault();
  if (_dragCatIdx === null || _dragCatIdx === i) return;
  const [moved] = _psCatOrder.splice(_dragCatIdx, 1);
  _psCatOrder.splice(i, 0, moved);
  renderCatOrder();
  previewPrint();
  try { api('POST', '/api/daily/print-settings', { print_cat_order: JSON.stringify(_psCatOrder) }); } catch(e) {}
}
function dragCatEnd(e) { e.target.style.opacity = '1'; _dragCatIdx = null; }
async function moveCat(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= _psCatOrder.length) return;
  [_psCatOrder[i], _psCatOrder[j]] = [_psCatOrder[j], _psCatOrder[i]];
  renderCatOrder();
  previewPrint();
  // Auto-save!
  try { await api('POST', '/api/daily/print-settings', { print_cat_order: JSON.stringify(_psCatOrder) }); } catch(e) {}
}
let _psShopOrder = [];
async function loadShopOrder() {
  try {
    const shops = await api('GET', '/api/daily-shops');
    const ps = await api('GET', '/api/daily/print-settings');
    let order = [];
    try { order = JSON.parse(ps.print_shop_order || '[]'); } catch(e) {}
    _psShopOrder = shops.map(sh => sh.name).sort((a, b) => {
      const ia = order.indexOf(a), ib = order.indexOf(b);
      if (ia === -1 && ib === -1) return a.localeCompare(b);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });
    renderShopOrder();
  } catch(e) {}
}
function renderShopOrder() {
  const el = document.getElementById('ps_shop_order');
  if (!el) return;
  el.innerHTML = '<div style="font-size:12px;color:#888;margin-bottom:6px">🖱️ پکڑ کر گھسیٹیں — پہلے کس دکان کا پرنٹ نکلے</div>' + _psShopOrder.map((sn, i) => `
    <div draggable="true" ondragstart="dragShopStart(event,${i})" ondragover="event.preventDefault()" ondrop="dragShopDrop(event,${i})"
      style="display:flex;align-items:center;gap:8px;padding:8px;background:#fff;border:2px solid #ddd;border-radius:8px;margin-bottom:6px;cursor:grab">
      <span style="cursor:grab;font-size:18px">⋮⋮</span>
      <span style="font-weight:bold;color:#2e7d32">${i+1}.</span>
      <span style="flex:1;font-weight:500">🏪 ${esc(sn)}</span>
      <button class="btn small" onclick="moveShop(${i},-1)" ${i===0?'disabled':''}>↑</button>
      <button class="btn small" onclick="moveShop(${i},1)" ${i===_psShopOrder.length-1?'disabled':''}>↓</button>
    </div>`).join('');
}
let _dragShopIdx = null;
function dragShopStart(e, i) { _dragShopIdx = i; e.target.style.opacity = '0.5'; }
function dragShopDrop(e, i) {
  e.preventDefault();
  if (_dragShopIdx === null || _dragShopIdx === i) return;
  const [m] = _psShopOrder.splice(_dragShopIdx, 1);
  _psShopOrder.splice(i, 0, m);
  renderShopOrder();
  _dragShopIdx = null;
}
function moveShop(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= _psShopOrder.length) return;
  [_psShopOrder[i], _psShopOrder[j]] = [_psShopOrder[j], _psShopOrder[i]];
  renderShopOrder();
}
function refreshPreview() {
  const d = (document.getElementById('dDate') || {}).value || DAILY_DATE || new Date().toISOString().split('T')[0];
  const f = document.getElementById('printPreviewFrame');
  if (f) f.src = `/print?type=daily_total&date=${encodeURIComponent(d)}&cb=${Date.now()}`;
}
function previewPrint() {
  const gv = id => (document.getElementById(id) || {}).value || '';
  const gc = id => (document.getElementById(id) || {}).checked ? '1' : '0';
  const cols = gv('ps_cols') || '2', gap = gv('ps_gap') || '10';
  const ts = gv('ps_title') || '24', tb = gc('ps_title_bold') === '1' ? 'bold' : 'normal', ti = gc('ps_title_italic') === '1' ? 'italic' : 'normal';
  const ss = gv('ps_sub') || '13', sb = gc('ps_sub_bold') === '1' ? 'bold' : 'normal';
  const cs = gv('ps_cat') || '17', cb = gc('ps_cat_bold') === '1' ? 'bold' : 'normal';
  const ns = gv('ps_name') || '15', nb = gc('ps_name_bold') === '1' ? 'bold' : 'normal';
  const us = gv('ps_num') || '16', ub = gc('ps_num_bold') === '1' ? 'bold' : 'normal';
  const ff = gv('ps_font') || 'Jameel Noori Nastaleeq';
  const el = document.getElementById('printPreview');
  if (!el) return;
  const cats = _psCatOrder.length ? _psCatOrder : ['بریڈ', 'نمکین', 'ڈرائی', 'فریش'];
  const catTables = cats.map((cn, i) => `
    <div draggable="true" ondragstart="dragPrevStart(event,${i})" ondragover="event.preventDefault()" ondrop="dragPrevDrop(event,${i})"
      style="border:2px solid #111;border-radius:4px;cursor:grab;background:#fff;transition:transform .2s">
      <div style="background:#111;color:#fff;font-size:${cs}px;font-weight:${cb};text-align:center;padding:6px;cursor:grab">⋮⋮ ${esc(cn)}</div>
      <div style="font-size:${ns}px;font-weight:${nb};padding:4px;border-bottom:1px solid #555">نمونہ آئٹم <span style="font-size:${us}px;font-weight:${ub};float:left">00</span></div>
      <div style="font-size:${ns}px;font-weight:${nb};padding:4px;">نمونہ آئٹم <span style="font-size:${us}px;font-weight:${ub};float:left">00</span></div>
    </div>`).join('');
  el.innerHTML = `<div style="font-family:'${ff}',serif;text-align:center;border-bottom:2px solid #e8721c;padding-bottom:6px;margin-bottom:8px">
    <div style="font-size:${ts}px;font-weight:${tb};font-style:${ti}">گلشن فیکٹری</div>
    <div style="font-size:${ss}px;color:#e8721c;font-weight:${sb}">روزانہ ڈیمانڈ شیٹ</div></div>
  <div style="font-size:11px;color:#9c27b0;margin-bottom:6px">🖱️ ٹیبل پکڑ کر گھسیٹیں — ترتیب بدلیں!</div>
  <div style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:${gap}px">${catTables}</div>
  <div style="font-size:11px;color:#888;margin-top:6px">👆 لائیو پریویو — تبدیل کریں اور دیکھیں</div>`;
}
let _dragPrevIdx = null;
function dragPrevStart(e, i) { _dragPrevIdx = i; e.target.style.opacity = '0.6'; }
function dragPrevDrop(e, i) {
  e.preventDefault();
  if (_dragPrevIdx === null || _dragPrevIdx === i) return;
  const [m] = _psCatOrder.splice(_dragPrevIdx, 1);
  _psCatOrder.splice(i, 0, m);
  renderCatOrder();
  previewPrint();
  e.target.style.opacity = '1';
  _dragPrevIdx = null;
}
async function savePrintSettings() {
  const gv = id => (document.getElementById(id) || {}).value;
  const gc = id => (document.getElementById(id) || {}).checked ? '1' : '0';
  await api('POST', '/api/daily/print-settings', {
    print_cols: gv('ps_cols'), print_margin: gv('ps_margin'), print_gap: gv('ps_gap'),
    print_title_size: gv('ps_title'), print_title_bold: gc('ps_title_bold'), print_title_italic: gc('ps_title_italic'),
    print_sub_size: gv('ps_sub'), print_sub_bold: gc('ps_sub_bold'),
    print_cat_size: gv('ps_cat'), print_cat_bold: gc('ps_cat_bold'),
    print_table_size: gv('ps_table'),
    print_name_size: gv('ps_name'), print_name_bold: gc('ps_name_bold'),
    print_num_size: gv('ps_num'), print_num_bold: gc('ps_num_bold'), print_head_size: gv('ps_head'),
    print_font: gv('ps_font'),
    print_cat_order: JSON.stringify(_psCatOrder),
    print_shop_order: JSON.stringify(_psShopOrder),
  });
  alert('✅ پرنٹ سیٹنگز محفوظ ہو گئیں!');
}
function printDailyShop() {
  const sel = $('#dPrintShop'); if (!sel || !sel.value) { alert('کوئی دکان منتخب نہیں'); return; }
  const d = ($('#dDate') || {}).value || DAILY_DATE;
  window.open(`/print?type=daily_shop&date=${encodeURIComponent(d)}&shop_id=${encodeURIComponent(sel.value)}&cb=${Date.now()}`, '_blank');
}
async function delDailyOrderBoard(id) {
  if (!confirm('آرڈر حذف کریں؟')) return;
  await api('DELETE', '/api/daily/orders/' + id);
  renderDaily();
}

// ---------- admin: access settings ----------
async function renderDailyAccess() {
  const users = (await api('GET', '/api/users')).filter(u => u.role !== 'super_admin' && (u.permissions && u.permissions.daily && u.permissions.daily !== 'none'));
  const [cats, shops] = await Promise.all([api('GET', '/api/daily-categories'), api('GET', '/api/daily-shops')]);
  window._daCats = cats; window._daShops = shops;
  const groups = {};
  users.forEach(u => { const k = u.account_type || u.role; (groups[k] = groups[k] || []).push(u); });
  const optGroups = Object.entries(groups).map(([k, us]) => {
    const lbl = (ACCT_TYPES[k] ? ACCT_TYPES[k].label : k);
    return `<optgroup label="${esc(lbl)}">${us.map(u => `<option value="${u.id}">${esc(u.username)}</option>`).join('')}</optgroup>`;
  }).join('');
  $('#v-daily').innerHTML = `
    <h2 class="st">⚙ <span>روزانہ آرڈر — یوزر ایکسس</span></h2>
    <button class="btn small" onclick="DAILY_VIEW_DATE=null;renderDaily()">← واپس</button>
    <button class="btn small dark" onclick="renderDailyData()">📦 روزانہ ڈیٹا (کیٹیگری/آئٹم/دکان)</button>
    <div class="formgrid"><label>یوزر<br><select id="daUser" onchange="renderDailyAccessForm()">
      <option value="">— منتخب کریں —</option>
      ${optGroups}
    </select></label></div>
    <div id="daForm"><p class="note">👆 پہلے اوپر سے یوزر منتخب کریں — پھر یہاں کیٹیگری اور دکانوں پر ✅ ٹک لگائیں</p></div>
    <h3 class="st">🚚 گاڑی والے کی دکانیں (Supply)</h3>
    <p class="note">گاڑی والے کو کونسی دکانیں دکھانی ہیں؟</p>
    <div class="formgrid"><label>گاڑی والا<br><select id="supUser" onchange="loadSupShops()"><option value="">— منتخب کریں —</option></select></label></div>
    <div id="supShops"></div>
    <h3 class="st">📅 گاڑی والے کا شیڈول (Admin set kare)</h3>
    <div id="supSchedAdmin"></div>
    <h3 class="st">🎨 تھیم (رنگ)</h3>
    <p class="note">ایڈمن خود تھیم منتخب کرے!</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
      <button class="btn small" style="background:linear-gradient(135deg,#e8721c,#f0953a);color:#fff;padding:12px 20px" onclick="setTheme('orange')">🟠 اورنج</button>
      <button class="btn small" style="background:linear-gradient(135deg,#11998e,#38ef7d);color:#fff;padding:12px 20px" onclick="setTheme('green')">🟢 سبز</button>
      <button class="btn small" style="background:linear-gradient(135deg,#4facfe,#00f2fe);color:#fff;padding:12px 20px" onclick="setTheme('blue')">🔵 نیلا</button>
      <button class="btn small" style="background:linear-gradient(135deg,#a18cd1,#fbc2eb);color:#fff;padding:12px 20px" onclick="setTheme('purple')">🟣 جامنی</button>
      <button class="btn small" style="background:linear-gradient(135deg,#f093fb,#f5576c);color:#fff;padding:12px 20px" onclick="setTheme('pink')">🌸 گلابی</button>
    </div>
    <h3 class="st">📅 ہسٹری سیٹنگ (کتنے دن پرانا ڈیٹا)</h3>
    <div style="background:#f5f5f5;border-radius:10px;padding:12px">
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
        <span style="flex:1">🚚 گاڑی والا:</span>
        <input type="number" id="histSupplier" min="1" max="365" value="2" style="width:70px;padding:6px;border-radius:6px;border:1px solid #ddd">
        <span>دن</span>
      </div>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
        <span style="flex:1">🏪 سپلائی دکان:</span>
        <input type="number" id="histShop" min="1" max="365" value="30" style="width:70px;padding:6px;border-radius:6px;border:1px solid #ddd">
        <span>دن</span>
      </div>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
        <span style="flex:1">📝 روزانہ دکان:</span>
        <input type="number" id="histDaily" min="1" max="365" value="30" style="width:70px;padding:6px;border-radius:6px;border:1px solid #ddd">
        <span>دن</span>
      </div>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
        <span style="flex:1">🚚 گاڑی والا کتنے دن آگے تک آرڈر دے:</span>
        <input type="number" id="vehOrderDays" min="1" max="30" value="7" style="width:70px;padding:6px;border-radius:6px;border:1px solid #ddd">
        <span>دن</span>
      </div>
      <button class="btn small green" onclick="saveHistDays()">💾 محفوظ کریں</button>
    </div>
    <h3 class="st">⏰ روزانہ کٹ آف ٹائم</h3>
    <div class="formgrid"><label>کٹ آف<br><input type="time" id="daCutoff" value="${esc(DAILY_CUTOFF)}"></label>
    <label><br><button class="btn small" onclick="saveDailyCutoff()">💾 محفوظ کریں</button></label></div>
    <h3 class="st">🖨 پرنٹ سیٹنگز</h3>
    
<div class="supcard" style="border:2px solid #9c27b0;margin:8px 0">
      <div class="suphead" style="font-size:18px;color:#7b1fa2;cursor:pointer" onclick="document.getElementById('printSettings').style.display=document.getElementById('printSettings').style.display==='none'?'block':'none'">⚙️ <b>پرنٹ سیٹنگز (Excel Style)</b> <small>(کلک کریں)</small></div>
      <div id="printSettings" style="display:none;margin-top:10px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div style="grid-column:1/-1;background:#f3e5f5;padding:8px;border-radius:6px"><b>📄 پیج</b></div>
          <label>کالم تعداد<br><select id="ps_cols" onchange="previewPrint()" style="width:100%;padding:8px"><option value="2">2</option><option value="3">3</option><option value="4">4</option></select></label>
          <label>مارجن (mm)<br><input id="ps_margin" type="number" min="2" max="20" oninput="previewPrint()" style="width:100%;padding:8px"></label>
          <label>کالم گیپ<br><input id="ps_gap" type="number" min="4" max="30" oninput="previewPrint()" style="width:100%;padding:8px"></label>
          <div style="grid-column:1/-1;background:#e3f2fd;padding:8px;border-radius:6px;margin-top:4px"><b>🔤 فونٹ</b></div>
          <label style="grid-column:1/-1">فونٹ منتخب کریں<br><select id="ps_font" onchange="previewPrint()" style="width:100%;padding:8px">
            <option value="Jameel Noori Nastaleeq">Jameel Noori Nastaleeq</option>
            <option value="Urdu Typesetting">Urdu Typesetting</option>
            <option value="Noto Nastaliq Urdu">Noto Nastaliq Urdu</option>
            <option value="Gulzar">Gulzar</option>
          </select></label>
          <div style="grid-column:1/-1;background:#fce4ec;padding:8px;border-radius:6px;margin-top:4px"><b>📂 کیٹیگری ترتیب</b> <small>(اوپر نیچے کریں)</small></div>
          <div id="ps_cat_order" style="grid-column:1/-1"></div>
          <div style="grid-column:1/-1;background:#e8f5e9;padding:8px;border-radius:6px;margin-top:4px"><b>🏪 دکان پرنٹ ترتیب</b> <small>(پہلے کس کا پرنٹ)</small></div>
          <div id="ps_shop_order" style="grid-column:1/-1"></div>
          <div style="grid-column:1/-1;background:#e8f5e9;padding:8px;border-radius:6px;margin-top:4px"><b>📌 ہیڈر</b></div>
          <label>ہیڈنگ سائز<br><input id="ps_title" type="number" min="12" max="48" oninput="previewPrint()" style="width:100%;padding:8px"></label>
          <label>ہیڈنگ اسٹائل<br><div><label><input type="checkbox" id="ps_title_bold" onchange="previewPrint()"> <b>B</b></label> <label><input type="checkbox" id="ps_title_italic" onchange="previewPrint()"> <i>I</i></label></div></label>
          <label>سب ہیڈنگ سائز<br><input id="ps_sub" type="number" min="8" max="30" oninput="previewPrint()" style="width:100%;padding:8px"></label>
          <label>سب ہیڈنگ <b>B</b><br><input type="checkbox" id="ps_sub_bold" onchange="previewPrint()"></label>
          <div style="grid-column:1/-1;background:#fff3e0;padding:8px;border-radius:6px;margin-top:4px"><b>📊 ٹیبل</b></div>
          <label>کیٹیگری سائز<br><input id="ps_cat" type="number" min="10" max="36" oninput="previewPrint()" style="width:100%;padding:8px"></label>
          <label>کیٹیگری <b>B</b><br><input type="checkbox" id="ps_cat_bold" onchange="previewPrint()"></label>
          <label>آئٹم نام سائز<br><input id="ps_name" type="number" min="10" max="30" oninput="previewPrint()" style="width:100%;padding:8px"></label>
          <label>نام <b>B</b><br><input type="checkbox" id="ps_name_bold" onchange="previewPrint()"></label>
          <label>تعداد سائز<br><input id="ps_num" type="number" min="10" max="36" oninput="previewPrint()" style="width:100%;padding:8px"></label>
          <label>ہیڈر سائز (#/آئٹم/ٹوٹل)<br><input id="ps_head" type="number" min="10" max="24" oninput="previewPrint()" style="width:100%;padding:8px"></label>
          <label>تعداد <b>B</b><br><input type="checkbox" id="ps_num_bold" onchange="previewPrint()"></label>
        </div>
        <div style="margin-top:12px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <b>👁️ لائیو پریویو</b>
            <button class="btn small" onclick="refreshPreview()">🔄 ریفریش</button>
          </div>
          <iframe id="printPreviewFrame" style="width:100%;height:500px;border:2px dashed #9c27b0;border-radius:8px;background:#fff"></iframe>
          <div id="printPreview" style="margin-top:8px;border:1px solid #ddd;padding:8px;border-radius:6px;background:#fafafa;font-size:12px"></div>
        </div>
        <button class="btn green" style="margin-top:12px;padding:12px 24px;font-size:16px" onclick="savePrintSettings()">💾 سیٹنگز محفوظ کریں</button>
      </div>

    <h3 class="st">🏪 دکان کے آئٹمز <small class="note">(کونسی دکان کو کونسے آئٹم نظر آئیں — خالی = تمام)</small></h3>
    <div class="formgrid"><label>دکان<br><select id="daShop" onchange="renderDailyShopItems()">
      <option value="">— منتخب کریں —</option>
      ${window._daShops.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}
    </select></label></div>
    <div id="daShopForm"></div>
    <p class="note">نوٹ: روزانہ آرڈر کی رسائی (بند / صرف دیکھیں / مکمل) یوزر مینجمنٹ → رسائی سے سیٹ کریں۔</p>`;
  setTimeout(loadPrintSettings, 500);
}
async function renderDailyShopItems() {
  const sid = $('#daShop').value; if (!sid) { $('#daShopForm').innerHTML = ''; return; }
  const [allowed, catalog] = await Promise.all([
    api('GET', `/api/daily/shop-items/${sid}`),
    api('GET', '/api/daily/catalog'),
  ]);
  const has = new Set(allowed);
  const useAll = allowed.length === 0;
  $('#daShopForm').innerHTML = catalog.map(c => {
    if (!c.products.length) return '';
    return `<div class="cathead">${esc(c.name)}</div>` + c.products.map(p =>
      `<label class="chk"><input type="checkbox" data-pid="${p.id}"${useAll || has.has(p.id) ? ' checked' : ''}> ${esc(p.name)}</label>`).join('');
  }).join('') + `<button class="btn green" onclick="saveDailyShopItems()">💾 آئٹمز محفوظ کریں</button>
  <p class="note">سب اَن ٹک کر کے محفوظ کریں = تمام آئٹم نظر آئیں گے</p>`;
}
async function saveDailyShopItems() {
  const sid = $('#daShop').value; if (!sid) return;
  const boxes = [...document.querySelectorAll('#daShopForm input[data-pid]')];
  const allChecked = boxes.length > 0 && boxes.every(b => b.checked);
  const products = allChecked ? [] : boxes.filter(b => b.checked).map(b => Number(b.dataset.pid));
  await api('PUT', `/api/daily/shop-items/${sid}`, { products });
  alert('دکان کے آئٹم محفوظ ہو گئے ✅');
}
async function renderDailyAccessForm() {
  const uid = $('#daUser').value; if (!uid) { $('#daForm').innerHTML = '<p class="note">👆 پہلے اوپر سے یوزر منتخب کریں</p>'; return; }
  const acc = await api('GET', `/api/daily/access/${uid}`);
  const cats = window._daCats || [], shops = window._daShops || [];
  $('#daForm').innerHTML = `
    <h3 class="st">نظر آنے والی کیٹیگریز <small class="note">(خالی = تمام)</small></h3>
    ${cats.length ? cats.map(c => `<label class="chk"><input type="checkbox" data-cat="${c.id}"${acc.categories.includes(c.id) ? ' checked' : ''}> ${esc(c.name)}</label>`).join('')
      : '<p class="note">⚠️ کوئی کیٹیگری نہیں — پہلے 📦 روزانہ ڈیٹا سے کیٹیگریز لائیں</p>'}
    <h3 class="st">دکانیں <small class="note">(خالی = تمام)</small></h3>
    ${shops.length ? shops.map(s => `<label class="chk"><input type="checkbox" data-shop="${s.id}"${acc.shops.includes(s.id) ? ' checked' : ''}> ${esc(s.name)}</label>`).join('')
      : '<p class="note">⚠️ کوئی دکان نہیں — پہلے 📦 روزانہ ڈیٹا سے دکانیں لائیں</p>'}
    <button class="btn green" onclick="saveDailyAccess()">💾 ایکسس محفوظ کریں</button>`;
}
async function saveDailyAccess() {
  const uid = $('#daUser').value; if (!uid) return;
  const categories = [...document.querySelectorAll('#daForm input[data-cat]:checked')].map(i => Number(i.dataset.cat));
  const shops = [...document.querySelectorAll('#daForm input[data-shop]:checked')].map(i => Number(i.dataset.shop));
  await api('PUT', `/api/daily/access/${uid}`, { categories, shops });
  alert('ایکسس محفوظ ہو گیا ✅');
}
async function saveDailyCutoff() {
  const t = $('#daCutoff').value;
  if (!t) return;
  const r = await api('PUT', '/api/daily/settings', { cutoff_time: t });
  DAILY_CUTOFF = r.cutoff_time;
  alert('کٹ آف ٹائم محفوظ ہو گیا ✅');
}

// ---------- Daily data management (separate catalog: categories, units, products, shops) ----------
function renderDailyData() {
  $('#v-daily').innerHTML = `
    <h2 class="st">📦 <span>روزانہ ڈیٹا مینجمنٹ</span></h2>
    <button class="btn small" onclick="DAILY_VIEW_DATE=null;renderDaily()">← واپس</button>
    <p class="note">یہ ڈیٹا صرف روزانہ آرڈر کا ہے — سپلائی سسٹم سے بالکل الگ۔ یہاں تبدیلی سپلائی کو متاثر نہیں کرے گی۔</p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px">
      <button class="btn" onclick="renderDailyCats()">🗂 روزانہ کیٹیگریز</button>
      <button class="btn" onclick="renderDailyUnits()">⚖ روزانہ یونٹس</button>
      <button class="btn" onclick="renderDailyProducts()">🍞 روزانہ آئٹمز</button>
      <button class="btn" onclick="renderDailyShops()">🏪 روزانہ دکانیں</button>
    </div>`;
}
async function renderDailyCats() {
  const [daily, supply] = await Promise.all([api('GET', '/api/daily-categories'), api('GET', '/api/categories')]);
  const inD = new Set(daily.map(x => x.id));
  const rows = supply.map(c => `<tr><td>${esc(c.name)}</td><td style="text-align:center">
    ${inD.has(c.id)
      ? `<button class="btn small green" onclick="toggleDaily('category',${c.id})">✓ شامل ہے</button>`
      : `<button class="btn small" onclick="toggleDaily('category',${c.id})">➕ شامل کریں</button>`}
  </td></tr>`).join('');
  $('#v-daily').innerHTML = `
    <h2 class="st">🗂 <span>روزانہ کیٹیگریز</span></h2>
    <button class="btn small" onclick="renderDailyData()">← واپس</button>
    <p class="note"><b>➕ شامل کریں</b> دبائیں — جو شامل ہے اس پر <b>✓ شامل ہے</b> ہوگا۔ دوبارہ دبائیں تو نکل جائے گی۔</p>
    <table><tr><th>کیٹیگری</th><th style="text-align:center">روزانہ میں</th></tr>${rows || '<tr><td colspan=2>خالی</td></tr>'}</table>`;
}
async function renderDailyUnits() {
  const [daily, supply] = await Promise.all([api('GET', '/api/daily-units'), api('GET', '/api/units')]);
  const inD = new Set(daily.map(x => x.id));
  const rows = supply.map(u => `<tr><td>${esc(u.name)}</td><td style="text-align:center">
    ${inD.has(u.id)
      ? `<button class="btn small green" onclick="toggleDaily('unit',${u.id})">✓ شامل ہے</button>`
      : `<button class="btn small" onclick="toggleDaily('unit',${u.id})">➕ شامل کریں</button>`}
  </td></tr>`).join('');
  $('#v-daily').innerHTML = `
    <h2 class="st">⚖ <span>روزانہ یونٹس</span></h2>
    <button class="btn small" onclick="renderDailyData()">← واپس</button>
    <p class="note"><b>➕ شامل کریں</b> دبائیں — جو شامل ہے اس پر <b>✓ شامل ہے</b> ہوگا۔</p>
    <table><tr><th>یونٹ</th><th style="text-align:center">روزانہ میں</th></tr>${rows || '<tr><td colspan=2>خالی</td></tr>'}</table>`;
}
async function renderDailyProducts() {
  const [daily, supply] = await Promise.all([api('GET', '/api/daily-products'), api('GET', '/api/products')]);
  const inD = new Map(daily.map(x => [x.id, x]));
  const sorted = [...supply].sort((a, b) => {
    const da = inD.has(a.id), db = inD.has(b.id);
    if (da && !db) return -1; if (!da && db) return 1;
    if (da && db) return (inD.get(a.id).sort_order || 0) - (inD.get(b.id).sort_order || 0);
    return a.name.localeCompare(b.name);
  });
  const rows = sorted.map(p => `<tr><td>${esc(p.category_name || '—')}</td><td>${esc(p.name)}</td><td style="text-align:center">
    ${inD.has(p.id)
      ? `<button class="btn small green" onclick="toggleDaily('product',${p.id})">✓ شامل ہے</button>
         <button class="btn small ghost" onclick="moveDailyProduct(${p.id},'up')">↑</button><button class="btn small ghost" onclick="moveDailyProduct(${p.id},'down')">↓</button>`
      : `<button class="btn small" onclick="toggleDaily('product',${p.id})">➕ شامل کریں</button>`}
  </td></tr>`).join('');
  $('#v-daily').innerHTML = `
    <h2 class="st">🍞 <span>روزانہ آئٹمز</span></h2>
    <button class="btn small" onclick="renderDailyData()">← واپس</button>
    <p class="note">آئٹم شامل کریں تو اسکی <b>کیٹیگری اور یونٹ خود</b> شامل ہو جائے گی۔<br>↑↓ سے <b>ترتیب</b> بدلیں — یہی ترتیب آرڈر فارم اور پرنٹ میں آئے گی۔</p>
    <table><tr><th>کیٹیگری</th><th>نام</th><th style="text-align:center">روزانہ میں</th></tr>${rows || '<tr><td colspan=3>خالی</td></tr>'}</table>`;
}
async function moveDailyProduct(id, dir) {
  await api('POST', `/api/daily/products/${id}/move`, { dir });
  renderDailyProducts();
}
async function renderDailyShops() {
  const [daily, supply] = await Promise.all([api('GET', '/api/daily-shops'), api('GET', '/api/shops')]);
  const inD = new Set(daily.map(x => x.id));
  const rows = supply.map(s => `<tr><td>${esc(s.name)}</td><td dir="ltr">${esc(s.phone || '—')}</td><td style="text-align:center">
    ${inD.has(s.id)
      ? `<button class="btn small green" onclick="toggleDaily('shop',${s.id})">✓ شامل ہے</button>`
      : `<button class="btn small" onclick="toggleDaily('shop',${s.id})">➕ شامل کریں</button>`}
  </td></tr>`).join('');
  $('#v-daily').innerHTML = `
    <h2 class="st">🏪 <span>روزانہ دکانیں</span></h2>
    <button class="btn small" onclick="renderDailyData()">← واپس</button>
    <p class="note"><b>➕ شامل کریں</b> دبائیں — جو شامل ہے اس پر <b>✓ شامل ہے</b> ہوگا۔</p>
    <table><tr><th>دکان</th><th>فون</th><th style="text-align:center">روزانہ میں</th></tr>${rows || '<tr><td colspan=3>خالی</td></tr>'}</table>`;
}
// ---------- Supplier shops assignment ----------
async function loadSupUsers() {
  const users = (await api('GET', '/api/users')).filter(u => u.account_type === 'vehicle' || u.account_type === 'supplier');
  const sel = document.getElementById('supUser');
  if (sel) sel.innerHTML = '<option value="">— منتخب کریں —</option>' + users.map(u => `<option value="${u.id}">${esc(u.username)}</option>`).join('');
}
async function loadSupShops() {
  const uid = document.getElementById('supUser').value;
  if (!uid) { document.getElementById('supShops').innerHTML = ''; document.getElementById('supSchedAdmin').innerHTML = ''; return; }
  loadSupSchedAdmin(uid);
  const [shops, assigned] = await Promise.all([api('GET', '/api/shops'), api('GET', `/api/supplier/shops/${uid}`)]);
  const set = new Set(assigned);
  document.getElementById('supShops').innerHTML = shops.filter(s => s.active).map(s => `
    <label style="display:block;padding:6px;border:1px solid #ddd;border-radius:6px;margin-bottom:4px">
      <input type="checkbox" data-shop="${s.id}" ${set.has(s.id) ? 'checked' : ''}> ${esc(s.name)}
    </label>`).join('') + `<button class="btn small green" onclick="saveSupShops(${uid})">💾 محفوظ کریں</button>`;
}
async function setTheme(t) {
  await api('POST', '/api/app-theme', { theme: t });
  alert('✅ تھیم بدل گیا! (' + t + ')');
  location.reload();
}
async function saveHistDays() {
  const s = Number(document.getElementById('histSupplier').value) || 2;
  const sh = Number(document.getElementById('histShop').value) || 30;
  const d = Number(document.getElementById('histDaily').value) || 30;
  const v = Number(document.getElementById('vehOrderDays').value) || 7;
  await api('POST', '/api/history-days', { key: 'supplier_history_days', days: s });
  await api('POST', '/api/history-days', { key: 'shop_history_days', days: sh });
  await api('POST', '/api/history-days', { key: 'daily_history_days', days: d });
  await api('POST', '/api/history-days', { key: 'vehicle_order_days', days: v });
  alert('✅ محفوظ ہو گیا!');
}
async function loadHistDays() {
  try {
    const h = await api('GET', '/api/history-days');
    document.getElementById('histSupplier').value = h.supplier_history_days;
    document.getElementById('histShop').value = h.shop_history_days;
    document.getElementById('histDaily').value = h.daily_history_days;
    document.getElementById('vehOrderDays').value = h.vehicle_order_days || '7';
  } catch(e) {}
}
async function saveSupShops(uid) {
  const ids = [...document.querySelectorAll('#supShops input:checked')].map(el => Number(el.dataset.shop));
  await api('POST', `/api/supplier/shops/${uid}`, { shop_ids: ids });
  alert('✅ محفوظ ہو گیا!');
}
async function loadSupSchedAdmin(uid) {
  if (!uid) { document.getElementById('supSchedAdmin').innerHTML = ''; return; }
  const sched = await api('GET', `/api/supplier/schedule/${uid}`);
  document.getElementById('supSchedAdmin').innerHTML =
    sched.map(x => `<div style="display:flex;justify-content:space-between;align-items:center;background:#fff;padding:8px;border-radius:6px;margin-bottom:4px;border:1px solid #eee">
      <span>📅 <b>${esc(x.supply_date)}</b> ⏰ ${esc(x.cutoff_time)}</span>
      <button class="btn small danger" onclick="delSupSchedAdmin(${uid},'${x.supply_date}')">🗑</button>
    </div>`).join('') +
    `<div style="display:flex;gap:6px;margin-top:8px">
      <input type="date" id="supSchedDate" style="flex:1;padding:6px;border-radius:6px;border:1px solid #ddd">
      <input type="time" id="supSchedTime" value="20:00" style="padding:6px;border-radius:6px;border:1px solid #ddd">
      <button class="btn small green" onclick="addSupSchedAdmin(${uid})">➕</button>
    </div>`;
}
async function addSupSchedAdmin(uid) {
  const d = document.getElementById('supSchedDate').value, t = document.getElementById('supSchedTime').value;
  if (!d) return alert('تاریخ منتخب کریں');
  await api('POST', `/api/supplier/schedule/${uid}`, { supply_date: d, cutoff_time: t });
  loadSupSchedAdmin(uid);
}
async function delSupSchedAdmin(uid, dt) {
  if (!confirm('حذف کریں؟')) return;
  await api('DELETE', `/api/supplier/schedule/${uid}/${dt}`);
  loadSupSchedAdmin(uid);
}
// ---------- Daily: supply se select karke import ----------
const DIMPORT_CONF = {
  categories: { title: '🗂 سپلائی کیٹیگریز سے منتخب کریں', api: 'categories', back: 'renderDailyCats', label: c => c.name },
  units: { title: '⚖ سپلائی یونٹس سے منتخب کریں', api: 'units', back: 'renderDailyUnits', label: u => u.name },
  products: { title: '🍞 سپلائی آئٹمز سے منتخب کریں', api: 'products', back: 'renderDailyProducts', label: p => `${p.name} (${p.category_name || ''})` },
  shops: { title: '🏪 سپلائی دکانوں سے منتخب کریں', api: 'shops', back: 'renderDailyShops', label: s => s.name },
};
async function openDailyImport(kind) {
  const conf = DIMPORT_CONF[kind];
  const [supply, existing] = await Promise.all([
    api('GET', '/api/' + conf.api),
    api('GET', '/api/daily-' + kind),
  ]);
  const has = new Set(existing.map(x => x.id));
  const fresh = supply.filter(x => !has.has(x.id));
  $('#v-daily').innerHTML = `
    <h2 class="st">${conf.title}</h2>
    <button class="btn small" onclick="${conf.back}()">← واپس</button>
    ${fresh.length ? `<p class="note">${fresh.length} نئے دستیاب ہیں — ٹک کریں اور لے آئیں:</p>
    ${fresh.map(x => `<label class="chk"><input type="checkbox" data-iid="${x.id}"> ${esc(conf.label(x))}</label>`).join('')}
    <br><button class="btn green" onclick="doDailyImport('${kind}')">📥 منتخب لے آئیں</button>`
    : '<p class="note">سب پہلے سے روزانہ میں موجود ہیں ✅</p>'}`;
}
async function doDailyImport(kind) {
  const ids = [...document.querySelectorAll('#v-daily input[data-iid]:checked')].map(i => Number(i.dataset.iid));
  if (!ids.length) { alert('کچھ منتخب کریں'); return; }
  await api('POST', '/api/daily/import/' + kind, { ids });
  alert('لے آئے ✅');
  renderDailyData();
}
async function dailyShopDel(id) { if (!confirm('حذف کریں؟')) return; await api('DELETE', '/api/daily-shops/' + id); renderDailyShops(); }
async function dailyShopEdit(id) {
  const list = await api('GET', '/api/daily-shops');
  const s = list.find(x => x.id === id); if (!s) return;
  const name = prompt('دکان کا نام:', s.name); if (name === null) return;
  const phone = prompt('فون:', s.phone || ''); if (phone === null) return;
  const address = prompt('پتہ:', s.address || ''); if (address === null) return;
  const active = confirm('دکان فعال رکھیں؟ (OK=فعال، Cancel=بند)');
  await api('PUT', '/api/daily-shops/' + id, { name, phone, address, active: active ? 1 : 0 });
  renderDailyShops();
}

document.addEventListener('DOMContentLoaded', init);
