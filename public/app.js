// Gulshan Factory — frontend (Urdu, RTL)
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
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
    await api('POST', '/api/login', { username: $('#liUser').value.trim(), password: $('#liPass').value });
    await enterApp();
  } catch (e) { $('#liErr').textContent = 'یوزر نام یا پاس ورڈ غلط ہے'; }
}
async function doLogout() {
  await api('POST', '/api/logout');
  location.reload();
}
async function enterApp() {
  ME = await api('GET', '/api/me');
  PERM = ME.permissions || {};
  $('#loginView').style.display = 'none'; $('#setupView').style.display = 'none';
  $('#appView').style.display = 'block';
  $('#meLine').textContent = ME.username + ' — ' + ({ super_admin: 'سپر ایڈمن', factory: 'فیکٹری یوزر', shop: 'دکان' }[ME.role] || ME.role);
  await refreshCache();
  buildMenu();
  showView('dashboard');
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
  ['dashboard', '📊 ڈیش بورڈ'], ['order', '🧾 نیا آرڈر'], ['orders', '📦 آرڈرز'],
  ['order_history', '🕘 آرڈر ہسٹری'], ['reports', '🖨 رپورٹس'],
  ['vehicles', '🚚 گاڑیاں'], ['routes', '🗺 روٹس و شیڈول'], ['categories', '🗂 کیٹیگریز'],
  ['units', '⚖ یونٹس'], ['products', '🍞 آئٹمز'], ['shops', '🏪 دکانیں'],
];
function buildMenu() {
  const nav = $('#menuNav'); nav.innerHTML = '';
  const vis = { dashboard: 'dashboard', order: 'orders', orders: 'orders', order_history: 'order_history', reports: 'reports',
    vehicles: 'vehicles', routes: 'routes', categories: 'categories', units: 'units', products: 'products', shops: 'shops' };
  for (const [key, label] of MENU) {
    const sec = vis[key];
    if (sec === 'orders' && key === 'order' && !can('orders', 'full')) continue;
    if (!can(sec)) continue;
    const b = document.createElement('button');
    b.textContent = label; b.dataset.view = key;
    b.onclick = () => { showView(key); toggleMenu(false); };
    nav.appendChild(b);
  }
  const out = document.createElement('button');
  out.textContent = '🚪 لاگ آؤٹ'; out.onclick = doLogout; nav.appendChild(out);
}
function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('on'));
  const el = $('#v-' + name); if (el) el.classList.add('on');
  document.querySelectorAll('#menuNav button').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  ({ dashboard: renderDashboard, order: renderOrderForm, orders: renderOrders, history: renderHistory,
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
  if (ME.role !== 'super_admin') { alert('صرف سپر ایڈمن'); return; }
  $('#setpanel').classList.add('on'); $('#scrim').classList.add('on');
  $('#sidemenu').classList.remove('on'); renderSettingsUsers();
}
function closePanels() {
  $('#sidemenu').classList.remove('on'); $('#setpanel').classList.remove('on'); $('#scrim').classList.remove('on');
}

// ---------- dashboard ----------
async function renderDashboard() {
  const d = await api('GET', '/api/dashboard');
  const cd = d.upcoming.map(r => `
    <div class="kbd">🚚 <b>${esc(r.name)}</b> — گاڑی: ${esc(r.vehicle_name || '—')}
    <br>📅 سپلائی: ${esc(r.supply_date || '—')} &nbsp; ⏰ کٹ آف: ${esc(r.cutoff_date || '')} ${esc(r.cutoff_time || '')}</div>`).join('');
  $('#v-dashboard').innerHTML = `
    <div class="clock">🕐 <span id="liveClock"></span></div>
    <div id="cdBox"></div>
    <h2 class="st">📊 <span>ڈیش بورڈ</span></h2>
    <div class="cards">
      <div class="card"><div class="n">${d.today_orders}</div><div class="l">آج کے آرڈر</div></div>
      <div class="card"><div class="n">${d.total_orders}</div><div class="l">کل آرڈر</div></div>
      <div class="card"><div class="n">${d.shops}</div><div class="l">دکانیں</div></div>
      <div class="card"><div class="n">${d.vehicles}</div><div class="l">گاڑیاں</div></div>
      <div class="card"><div class="n">${d.routes}</div><div class="l">روٹس</div></div>
      <div class="card"><div class="n">${d.products}</div><div class="l">آئٹمز</div></div>
    </div>
    <h2 class="st">🗓 <span>آنے والی سپلائی</span></h2>${cd || '<p class="note">کوئی شیڈول نہیں</p>'}
    <div style="margin-top:14px">
      ${can('orders', 'full') ? '<button class="btn" onclick="showView(\'order\')">🧾 نیا آرڈر</button> ' : ''}
      ${can('reports') ? '<button class="btn green" onclick="showView(\'reports\')">🖨 پروڈکشن شیٹ</button>' : ''}
    </div>`;
  tickClock();
  const soon = d.upcoming.find(r => r.cutoff_date);
  if (soon) startCountdown(soon.cutoff_date, soon.cutoff_time, soon.name);
}
function tickClock() {
  const el = $('#liveClock'); if (!el) return;
  const f = () => { el.textContent = new Intl.DateTimeFormat('ur-PK', { timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date()); };
  f(); setInterval(f, 1000);
}
function startCountdown(cdate, ctime, label, boxId) {
  if (countdownTimer) clearInterval(countdownTimer);
  const box = document.getElementById(boxId || 'cdBox'); if (!box || !cdate) return;
  const target = new Date(`${cdate}T${ctime || '23:59'}:00+05:00`).getTime();
  const f = () => {
    const ms = target - Date.now();
    if (ms <= 0) { box.innerHTML = `<div class="countdown">⏰ <b>${esc(label)}</b> کا کٹ آف وقت گزر چکا ہے</div>`; clearInterval(countdownTimer); return; }
    const h = Math.floor(ms / 36e5), m = Math.floor(ms % 36e5 / 6e4), s = Math.floor(ms % 6e4 / 1e3);
    box.innerHTML = `<div class="countdown"><small>⏰ کٹ آف تک باقی وقت — ${esc(label)}</small><div class="t">${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}</div></div>`;
  };
  f(); countdownTimer = setInterval(f, 1000);
}

// ---------- order form (shop / admin) ----------
let orderDraft = {};
async function renderOrderForm() {
  await refreshCache();
  const isShop = ME.role === 'shop';
  const myShop = CACHE.shops.find(s => s.id === ME.shop_id);
  const shopOpts = isShop
    ? `<input type="hidden" id="ofShop" value="${ME.shop_id}"><div class="kbd">🏪 دکان: <b>${esc(myShop ? myShop.name : '')}</b></div>`
    : `<label>دکان<br><select id="ofShop">${CACHE.shops.filter(s => s.active).map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label>`;
  const routeOpts = CACHE.routes.filter(r => r.active).map(r =>
    `<option value="${r.id}" data-cd="${esc(r.cutoff_date || '')}" data-ct="${esc(r.cutoff_time || '')}">${esc(r.name)}</option>`).join('');
  const catsHtml = CACHE.cats.map(c => {
    const prods = CACHE.products.filter(p => p.active && p.category_id === c.id);
    if (!prods.length) return '';
    return `<div class="cathead">${esc(c.name)}</div>` + prods.map(p =>
      `<div class="prow"><span class="pn">${esc(p.name)}</span><span class="un">${esc(p.unit_name || '')}</span>
       <input type="number" min="0" step="any" data-pid="${p.id}" placeholder="0"></div>`).join('');
  }).join('');
  $('#v-order').innerHTML = `
    <h2 class="st">🧾 <span>نیا آرڈر</span></h2>
    <div id="ofCd"></div>
    <div class="formgrid">
      ${shopOpts}
      <label>روٹ<br><select id="ofRoute" onchange="orderRouteChanged()"><option value="">—</option>${routeOpts}</select></label>
      <label>ڈیلیوری تاریخ<br><input type="date" id="ofDate" value="${karachiToday()}"></label>
      <label>نوٹ<br><input id="ofNote" placeholder="اختیاری"></label>
    </div>
    ${catsHtml || '<p class="note">کوئی آئٹم نہیں — پہلے آئٹمز شامل کریں</p>'}
    <div class="err" id="ofErr"></div>
    <button class="btn green" onclick="submitOrder()">✅ آرڈر بھیجیں</button>`;
  orderRouteChanged();
}
function orderRouteChanged() {
  const sel = $('#ofRoute'); if (!sel) return;
  const o = sel.options[sel.selectedIndex];
  const box = $('#ofCd');
  if (o && o.dataset.cd) startCountdown(o.dataset.cd, o.dataset.ct, o.text, 'ofCd');
  else if (box) box.innerHTML = '';
}
async function submitOrder() {
  $('#ofErr').textContent = '';
  const items = [...document.querySelectorAll('#v-order input[data-pid]')]
    .map(i => ({ product_id: Number(i.dataset.pid), quantity: Number(i.value) || 0 }))
    .filter(i => i.quantity > 0);
  if (!items.length) { $('#ofErr').textContent = 'کم از کم ایک آئٹم کی مقدار لکھیں'; return; }
  try {
    await api('POST', '/api/orders', {
      shop_id: Number($('#ofShop').value), route_id: Number($('#ofRoute').value) || null,
      delivery_date: $('#ofDate').value, note: $('#ofNote').value, items,
    });
    alert('آرڈر محفوظ ہو گیا ✅');
    document.querySelectorAll('#v-order input[data-pid]').forEach(i => i.value = '');
  } catch (e) {
    $('#ofErr').textContent = e.message === 'cutoff_passed' ? '⏰ کٹ آف وقت گزر چکا — آرڈر بند ہے' : 'خرابی: ' + e.message;
  }
}

// ---------- orders list ----------
async function renderOrders() {
  const q = `date=${karachiToday()}`;
  const list = await api('GET', '/api/orders?' + q);
  const rows = list.map(o => `<tr><td>${o.id}</td><td>${esc(o.shop_name)}</td><td>${esc(o.route_name || '—')}</td>
    <td>${esc(o.delivery_date)}</td><td>${o.items.map(i => esc(i.product_name) + ': ' + esc(i.quantity) + ' ' + esc(i.unit_name || '')).join('<br>')}</td>
    <td>${can('orders', 'full') ? `<button class="btn small ghost" onclick="editOrder(${o.id})">✏</button>
    <button class="btn small danger" onclick="delOrder(${o.id})">🗑</button>` : ''}</td></tr>`).join('');
  $('#v-orders').innerHTML = `<h2 class="st">📦 <span>آرڈرز</span> <small class="note">(آج)</small></h2>
    <div class="formgrid"><label>تاریخ<br><input type="date" id="olDate" value="${karachiToday()}"></label>
    <label>روٹ<br><select id="olRoute"><option value="">تمام</option>${CACHE.routes.map(r => `<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select></label>
    <label><br><button class="btn small dark" onclick="filterOrders()">🔍 دیکھیں</button></label></div>
    <div id="olBody"><table><tr><th>#</th><th>دکان</th><th>روٹ</th><th>تاریخ</th><th>آئٹمز</th><th></th></tr>${rows || '<tr><td colspan=6>کوئی آرڈر نہیں</td></tr>'}</table></div>
    ${can('orders', 'full') ? '<button class="btn" onclick="showView(\'order\')">🧾 نیا آرڈر</button>' : ''}`;
}
async function filterOrders() {
  const d = $('#olDate').value, r = $('#olRoute').value;
  const list = await api('GET', `/api/orders?date=${d}${r ? '&route_id=' + r : ''}`);
  const rows = list.map(o => `<tr><td>${o.id}</td><td>${esc(o.shop_name)}</td><td>${esc(o.route_name || '—')}</td>
    <td>${esc(o.delivery_date)}</td><td>${o.items.map(i => esc(i.product_name) + ': ' + esc(i.quantity) + ' ' + esc(i.unit_name || '')).join('<br>')}</td>
    <td>${can('orders', 'full') ? `<button class="btn small ghost" onclick="editOrder(${o.id})">✏</button>
    <button class="btn small danger" onclick="delOrder(${o.id})">🗑</button>` : ''}</td></tr>`).join('');
  $('#olBody').innerHTML = `<table><tr><th>#</th><th>دکان</th><th>روٹ</th><th>تاریخ</th><th>آئٹمز</th><th></th></tr>${rows || '<tr><td colspan=6>کوئی آرڈر نہیں</td></tr>'}</table>`;
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
  $('#v-history').innerHTML = `<h2 class="st">🕘 <span>آرڈر ہسٹری</span></h2>` + (dates.map(d =>
    `<div class="histdate">📅 ${esc(d)}</div>` + g[d].map(o =>
      `<div class="kbd"><b>${esc(o.shop_name)}</b> — ${o.items.map(i => esc(i.product_name) + ': ' + esc(i.quantity) + ' ' + esc(i.unit_name || '')).join('، ')}</div>`
    ).join('')).join('') || '<p class="note">کوئی ہسٹری نہیں</p>');
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
  const list = await api('GET', '/api/' + endpoint);
  const rows = list.map(r => `<tr>${conf.fields.map(([f]) => `<td>${esc(r[f])}</td>`).join('')}
    <td>${r.active === 0 ? '<span class="badge off">بند</span>' : '<span class="badge">فعال</span>'}
    ${can(key, 'full') || can('shops', 'full') ? ` <button class="btn small ghost" onclick="masterEdit('${key}','${endpoint}',${r.id})">✏</button>
    <button class="btn small danger" onclick="masterDel('${endpoint}',${r.id},'${key}')">🗑</button>` : ''}</td></tr>`).join('');
  const form = (can(key, 'full') || (key === 'shops' && can('shops', 'full'))) ? `
    <div class="formgrid" id="mf-${key}">
      ${conf.fields.map(([f, l]) => `<label>${l}<br><input id="mf-${key}-${f}"></label>`).join('')}
      <label><br><button class="btn small green" onclick="masterAdd('${key}','${endpoint}')">➕ شامل کریں</button></label>
    </div>` : '';
  $('#v-' + key).innerHTML = `<h2 class="st">${conf.title}</h2>${form}
    <table><tr>${conf.cols.map(c => `<th>${c}</th>`).join('')}<th>حالت</th></tr>${rows || `<tr><td colspan=5>خالی</td></tr>`}</table>`;
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
  $('#rpPrint').innerHTML = `<a class="btn green" target="_blank" href="/print?date=${d}${r ? '&route_id=' + r : ''}">🖨 A4 پروڈکشن شیٹ کھولیں / پرنٹ</a>`;
}

// ---------- settings: users & access ----------
let setTabName = 'users';
function setTab(t, btn) {
  setTabName = t;
  document.querySelectorAll('.setpanel .tabs button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  $('#setUsers').style.display = t === 'users' ? 'block' : 'none';
  $('#setAccess').style.display = t === 'access' ? 'block' : 'none';
  if (t === 'users') renderSettingsUsers(); else renderSettingsAccess();
}
async function renderSettingsUsers() {
  const users = await api('GET', '/api/users');
  await refreshCache();
  const rows = users.map(u => `<tr><td>${esc(u.username)}</td><td>${{ super_admin: 'سپر ایڈمن', factory: 'فیکٹری', shop: 'دکان' }[u.role]}</td>
    <td>${esc(u.shop_name || '—')}</td><td>${u.active ? '<span class="badge">فعال</span>' : '<span class="badge off">بند</span>'}</td>
    <td><button class="btn small ghost" onclick="userEdit(${u.id})">✏</button>
    ${u.id !== ME.id ? `<button class="btn small danger" onclick="userDel(${u.id})">🗑</button>` : ''}</td></tr>`).join('');
  $('#setUsers').innerHTML = `<h3>👥 یوزرز / دکان اکاؤنٹس</h3>
    <table><tr><th>یوزر نام</th><th>رول</th><th>دکان</th><th>حالت</th><th></th></tr>${rows}</table>
    <h3>➕ نیا اکاؤنٹ</h3>
    <div class="formgrid">
      <label>یوزر نام<br><input id="nu-name"></label>
      <label>پاس ورڈ<br><input id="nu-pass" type="password"></label>
      <label>رول<br><select id="nu-role" onchange="$('#nu-shoprow').style.display=this.value==='shop'?'block':'none'">
        <option value="shop">دکان</option><option value="factory">فیکٹری یوزر</option><option value="super_admin">سپر ایڈمن</option></select></label>
      <label id="nu-shoprow">دکان<br><select id="nu-shop">${CACHE.shops.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label>
      <label><br><button class="btn small green" onclick="userAdd()">بنائیں</button></label>
    </div>`;
}
async function userAdd() {
  const role = $('#nu-role').value;
  await api('POST', '/api/users', { username: $('#nu-name').value.trim(), password: $('#nu-pass').value,
    role, shop_id: role === 'shop' ? Number($('#nu-shop').value) : null });
  renderSettingsUsers();
}
async function userDel(id) { if (!confirm('یوزر حذف کریں؟')) return; await api('DELETE', '/api/users/' + id); renderSettingsUsers(); }
async function userEdit(id) {
  const users = await api('GET', '/api/users');
  const u = users.find(x => x.id === id); if (!u) return;
  const role = prompt('رول (super_admin / factory / shop):', u.role); if (role === null) return;
  const active = confirm('اکاؤنٹ فعال رکھیں؟ (OK=فعال، Cancel=بند)');
  const pw = prompt('نیا پاس ورڈ (خالی چھوڑیں تو تبدیل نہیں ہوگا):', '');
  await api('PUT', '/api/users/' + id, { role: ['super_admin', 'factory', 'shop'].includes(role) ? role : u.role,
    shop_id: u.shop_id, active: active ? 1 : 0, ...(pw ? { password: pw } : {}) });
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
