// Gulshan Factory — frontend (Urdu, RTL)
// Register service worker (makes the app installable on Android; caches nothing)
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

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
  if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
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
  showView(firstAllowedView());
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
  ['order_history', '🕘 آرڈر ہسٹری'], ['reports', '🖨 رپورٹس'],
  ['vehicles', '🚚 گاڑیاں'], ['routes', '🗺 روٹس و شیڈول'], ['cats', '🗂 کیٹیگریز'],
  ['units', '⚖ یونٹس'], ['products', '🍞 آئٹمز'], ['shops', '🏪 دکانیں'],
];
const VIEW_SEC = { dashboard: 'dashboard', supply: 'routes', order: 'orders', orders: 'orders', order_history: 'order_history', reports: 'reports',
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
function showView(name) {
  if (!viewAllowed(name)) name = firstAllowedView();
  document.querySelectorAll('.view').forEach(v => v.classList.remove('on'));
  const el = $('#v-' + (name === 'order_history' ? 'history' : name)); if (el) el.classList.add('on');
  document.querySelectorAll('#menuNav button').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  ({ dashboard: renderDashboard, supply: renderSupplyCalendar, order: renderOrderForm, orders: renderOrders, order_history: renderHistory,
     vehicles: () => renderMaster('vehicles'), routes: renderRoutes, cats: () => renderMaster('cats'),
     units: () => renderMaster('units'), products: renderProducts, shops: () => renderMaster('shops'),
     reports: renderReports }[name] || (() => {}))();
}
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
  const d = await api('GET', '/api/dashboard');
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
      + stat('📦', d.total_orders, 'کل آرڈرز')
    : stat('🧾', d.today_orders, 'نئے آرڈرز (آج)')
      + stat('📦', d.total_orders, 'کل آرڈرز')
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
  const rows = CACHE.products.map(p => `<tr><td>${esc(p.category_name || '—')}</td><td>${esc(p.name)}</td><td>${esc(p.unit_name || '—')}</td>
    <td>${can('products', 'full') ? `<button class="btn small ghost" onclick="prodEdit(${p.id})">✏</button>
    <button class="btn small danger" onclick="prodDel(${p.id})">🗑</button>` : ''}</td></tr>`).join('');
  const form = can('products', 'full') ? `
    <div class="formgrid">
      <label>کیٹیگری<br><select id="pf-cat">${CACHE.cats.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label>
      <label>آئٹم کا نام<br><input id="pf-name" placeholder="مثلاً Milky Bread Small"></label>
      <label>یونٹ<br><select id="pf-unit">${CACHE.units.map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select></label>
      <label><br><button class="btn small green" onclick="prodAdd()">➕ شامل کریں</button></label>
    </div>` : '';
  $('#v-products').innerHTML = `<h2 class="st">🍞 <span>آئٹمز</span></h2>${form}
    <table><tr><th>کیٹیگری</th><th>نام</th><th>یونٹ</th><th></th></tr>${rows || '<tr><td colspan=4>خالی</td></tr>'}</table>`;
}
async function prodAdd() {
  await api('POST', '/api/products', { name: $('#pf-name').value, category_id: Number($('#pf-cat').value) || null, unit_id: Number($('#pf-unit').value) || null });
  renderProducts();
}
async function prodDel(id) { if (!confirm('حذف کریں؟')) return; await api('DELETE', '/api/products/' + id); renderProducts(); }
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
async function loadTotals() {
  const d = $('#rpDate').value, r = $('#rpRoute').value;
  const t = await api('GET', `/api/totals?date=${d}${r ? '&route_id=' + r : ''}`);
  const rows = t.map(x => `<tr><td>${esc(x.category_name || '')}</td><td>${esc(x.product_name)}</td><td><b>${esc(x.total_qty)} ${esc(x.unit_name || '')}</b></td><td>${x.shop_count} دکان</td></tr>`).join('');
  $('#rpBody').innerHTML = `<table><tr><th>کیٹیگری</th><th>آئٹم</th><th>کل مقدار</th><th>دکانیں</th></tr>${rows || '<tr><td colspan=4>کوئی آرڈر نہیں</td></tr>'}</table>`;
  $('#rpPrint').innerHTML = `<a class="btn green" target="_blank" href="/print?type=totals&date=${d}${r ? '&route_id=' + r : ''}">🖨 آئٹم وائز ٹوٹل پرنٹ کریں</a>
  <a class="btn dark" target="_blank" href="/print?type=shops&date=${d}${r ? '&route_id=' + r : ''}">🧾 دکان وائز سلپ پرنٹ کریں (ہر دکان الگ صفحہ)</a>
  <a class="btn" target="_blank" href="/print?type=date_history&date=${d}">📜 اس تاریخ کی مکمل ہسٹری پرنٹ کریں</a>`;
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
async function renderSettingsUsers() {
  const users = await api('GET', '/api/users');
  await refreshCache();
  const rows = users.map(u => `<tr><td>${esc(u.username)}</td><td>${{ super_admin: 'سپر ایڈمن', factory: 'فیکٹری', shop: 'دکان' }[u.role]}</td>
    <td>${esc(u.shop_name || '—')}</td><td dir="ltr">${esc(u.phone || '—')}</td><td>${u.active ? '<span class="badge">فعال</span>' : '<span class="badge off">بند</span>'}</td>
    <td><button class="btn small ghost" onclick="userEdit(${u.id})">✏</button>
    ${u.id !== ME.id ? `<button class="btn small danger" onclick="userDel(${u.id})">🗑</button>` : ''}</td></tr>`).join('');
  $('#setUsers').innerHTML = `<h3>👥 یوزرز / دکان اکاؤنٹس</h3>
    <table><tr><th>یوزر نام</th><th>رول</th><th>دکان</th><th>موبائل</th><th>حالت</th><th></th></tr>${rows}</table>
    <h3>➕ نیا اکاؤنٹ</h3>
    <div class="formgrid">
      <label>یوزر نام<br><input id="nu-name"></label>
      <label>پاس ورڈ<br><input id="nu-pass" type="password"></label>
      <label>موبائل نمبر<br><input id="nu-phone" dir="ltr" placeholder="03xx-xxxxxxx"></label>
      <label>رول<br><select id="nu-role" onchange="document.getElementById('nu-shoprow').style.display=this.value==='shop'?'block':'none'">
        <option value="shop">دکان</option><option value="factory">فیکٹری یوزر</option><option value="super_admin">سپر ایڈمن</option></select></label>
      <label id="nu-shoprow">دکان<br><select id="nu-shop">${CACHE.shops.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label>
      <label><br><button class="btn small green" onclick="userAdd()">بنائیں</button></label>
    </div>`;
}
async function userAdd() {
  const role = $('#nu-role').value;
  await api('POST', '/api/users', { username: $('#nu-name').value.trim(), password: $('#nu-pass').value,
    role, shop_id: role === 'shop' ? Number($('#nu-shop').value) : null, phone: $('#nu-phone').value.trim() });
  renderSettingsUsers();
}
async function userDel(id) { if (!confirm('یوزر حذف کریں؟')) return; await api('DELETE', '/api/users/' + id); renderSettingsUsers(); }
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
  categories: 'کیٹیگریز', units: 'یونٹس', vehicles: 'گاڑیاں', routes: 'روٹس', schedule: 'شیڈول', reports: 'رپورٹس', users: 'یوزرز' };
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

document.addEventListener('DOMContentLoaded', init);
