// Gulshan Factory — multi-user online ordering system
// Node.js + Express + better-sqlite3. Serves frontend from ./public
const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, 'gulshan.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
// WhatsApp alerts settings
db.exec(`CREATE TABLE IF NOT EXISTS wa_settings (key TEXT PRIMARY KEY, value TEXT)`);
function waGet(k) { try { const r = db.prepare('SELECT value FROM wa_settings WHERE key=?').get(k); return r ? r.value : ''; } catch(e) { return ''; } }
function waSet(k, v) { db.prepare('INSERT INTO wa_settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, v); }
// Send WhatsApp message via Meta Graph API (fire-and-forget)
async function sendWhatsApp(to, message) {
  const pid = waGet('phone_number_id'), token = waGet('access_token');
  if (!pid || !token || !to || !message) return;
  try {
    const r = await fetch(`https://graph.facebook.com/v25.0/${pid}/messages`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: String(to).replace(/[^0-9]/g, ''), type: 'text', text: { body: String(message).slice(0, 4000) } })
    });
    if (!r.ok) console.log('[wa] send failed:', r.status, (await r.text()).slice(0, 200));
  } catch(e) { console.log('[wa] error:', e.message); }
}
function waAlert(msg) {
  const adminNum = waGet('admin_number');
  if (adminNum) sendWhatsApp(adminNum, '🏭 Gulshan Factory\n' + msg);
  emailAlert('🏭 Gulshan Factory Alert', msg);
}
// ---------- Email alerts (via Gmail SMTP) ----------
db.exec(`CREATE TABLE IF NOT EXISTS email_settings (key TEXT PRIMARY KEY, value TEXT)`);
function emailGet(k) { try { const r = db.prepare('SELECT value FROM email_settings WHERE key=?').get(k); return r ? r.value : ''; } catch(e) { return ''; } }
function emailSet(k, v) { db.prepare('INSERT INTO email_settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, v); }
// Pre-configure admin email
try { if (!emailGet('admin_email')) emailSet('admin_email', 'skui.bukhari@gmail.com'); } catch(e) {}
let _emailTransporter = null;
function emailTransporter() {
  if (_emailTransporter) return _emailTransporter;
  const user = emailGet('smtp_user'), pass = emailGet('smtp_pass');
  if (!user || !pass) return null;
  try {
    const nodemailer = require('nodemailer');
    _emailTransporter = nodemailer.createTransport({
      host: 'smtp.gmail.com', port: 587, secure: false,
      auth: { user, pass }
    });
    return _emailTransporter;
  } catch(e) { console.log('[email] nodemailer missing:', e.message); return null; }
}
function resetEmailTransporter() { _emailTransporter = null; }
async function sendEmail(to, subject, text) {
  if (!to || !subject) return false;
  const t = emailTransporter();
  if (!t) { console.log('[email] no SMTP configured'); return false; }
  try {
    await t.sendMail({ from: emailGet('smtp_user'), to, subject: String(subject).slice(0, 200), text: String(text).slice(0, 8000) });
    return true;
  } catch(e) { console.log('[email] send failed:', e.message); return false; }
}
function emailAlert(subject, msg) {
  const adminEmail = emailGet('admin_email');
  if (adminEmail) sendEmail(adminEmail, subject, '🏭 Gulshan Factory\n' + msg);
}
// MIGRATION: pre-configure WhatsApp (phone ID + admin number); token set via /api/wa-settings
try {
  if (!waGet('phone_number_id')) waSet('phone_number_id', '1351675744699144');
  if (!waGet('admin_number')) waSet('admin_number', '923350666338');
} catch(e) {}
// MIGRATION: daily_cat_access.category_id wrongly referenced categories(id); it holds daily_categories ids.
// Wrong FK made PUT /api/daily/access/:uid fail (whole transaction rolled back) -> access never saved.
try {
  const fk = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='daily_cat_access'").get();
  if (fk && fk.sql && fk.sql.includes('REFERENCES categories(id)')) {
    db.exec(`CREATE TABLE daily_cat_access_new (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category_id INTEGER NOT NULL REFERENCES daily_categories(id) ON DELETE CASCADE,
      UNIQUE(user_id, category_id)
    );`);
    db.exec(`INSERT INTO daily_cat_access_new (user_id, category_id)
             SELECT user_id, category_id FROM daily_cat_access
             WHERE category_id IN (SELECT id FROM daily_categories);`);
    db.exec(`DROP TABLE daily_cat_access;`);
    db.exec(`ALTER TABLE daily_cat_access_new RENAME TO daily_cat_access;`);
    console.log('[migration] daily_cat_access FK fixed to daily_categories');
  }
} catch(e) { console.log('[migration] daily_cat_access:', e.message); }
// MIGRATION: daily_shop_access.shop_id wrongly referenced shops(id) (fixed in 802c2e6 for new DBs only).
// Old FK makes PUT /api/daily/access/:uid fail when a daily shop id is absent from supply shops.
try {
  const fk = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='daily_shop_access'").get();
  if (fk && fk.sql && fk.sql.includes('REFERENCES shops(id)')) {
    db.exec(`CREATE TABLE daily_shop_access_new (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      shop_id INTEGER NOT NULL REFERENCES daily_shops(id) ON DELETE CASCADE,
      UNIQUE(user_id, shop_id)
    );`);
    db.exec(`INSERT INTO daily_shop_access_new (user_id, shop_id)
             SELECT user_id, shop_id FROM daily_shop_access
             WHERE shop_id IN (SELECT id FROM daily_shops);`);
    db.exec(`DROP TABLE daily_shop_access;`);
    db.exec(`ALTER TABLE daily_shop_access_new RENAME TO daily_shop_access;`);
    console.log('[migration] daily_shop_access FK fixed to daily_shops');
  }
} catch(e) { console.log('[migration] daily_shop_access:', e.message); }
// MIGRATION: daily_shop_items wrongly referenced shops(id)/products(id) (fixed in 802c2e6 for new DBs only).
try {
  const fk = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='daily_shop_items'").get();
  if (fk && fk.sql && (fk.sql.includes('REFERENCES shops(id)') || fk.sql.includes('REFERENCES products(id)'))) {
    db.exec(`CREATE TABLE daily_shop_items_new (
      shop_id INTEGER NOT NULL REFERENCES daily_shops(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES daily_products(id) ON DELETE CASCADE,
      UNIQUE(shop_id, product_id)
    );`);
    db.exec(`INSERT INTO daily_shop_items_new (shop_id, product_id)
             SELECT shop_id, product_id FROM daily_shop_items
             WHERE shop_id IN (SELECT id FROM daily_shops)
               AND product_id IN (SELECT id FROM daily_products);`);
    db.exec(`DROP TABLE daily_shop_items;`);
    db.exec(`ALTER TABLE daily_shop_items_new RENAME TO daily_shop_items;`);
    console.log('[migration] daily_shop_items FKs fixed to daily_*');
  }
} catch(e) { console.log('[migration] daily_shop_items:', e.message); }
// MIGRATION: daily_orders.shop_id wrongly referenced shops(id); fix by recreating table
try {
  const fk = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='daily_orders'").get();
  if (fk && fk.sql && fk.sql.includes('REFERENCES shops(id)')) {
    db.exec(`CREATE TABLE daily_orders_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_id INTEGER NOT NULL REFERENCES daily_shops(id) ON DELETE CASCADE,
      order_date TEXT NOT NULL,
      note TEXT DEFAULT '',
      created_by INTEGER REFERENCES users(id),
      created_at INTEGER NOT NULL,
      UNIQUE(shop_id, order_date)
    );`);
    db.exec(`INSERT INTO daily_orders_new (id, shop_id, order_date, note, created_by, created_at)
             SELECT id, shop_id, order_date, note, created_by, created_at FROM daily_orders;`);
    db.exec(`DROP TABLE daily_orders;`);
    db.exec(`ALTER TABLE daily_orders_new RENAME TO daily_orders;`);
    console.log('[migration] daily_orders FK fixed to daily_shops');
  }
} catch(e) { console.log('[migration] daily_orders fix skipped:', e.message); }

// ---------- Schema ----------
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('super_admin','factory','shop')),
  shop_id INTEGER REFERENCES shops(id) ON DELETE SET NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS shops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT DEFAULT '',
  address TEXT DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS vehicles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  plate TEXT DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS routes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
  supply_date TEXT DEFAULT '',
  cutoff_date TEXT DEFAULT '',
  cutoff_time TEXT DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  unit_id INTEGER REFERENCES units(id) ON DELETE SET NULL,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  route_id INTEGER REFERENCES routes(id) ON DELETE SET NULL,
  delivery_date TEXT NOT NULL,
  note TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS permissions (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  section TEXT NOT NULL,
  level TEXT NOT NULL CHECK(level IN ('none','view','full')),
  PRIMARY KEY (user_id, section)
);
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS otps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS webauthn_creds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cred_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
`);
try { db.exec(`ALTER TABLE users ADD COLUMN phone TEXT DEFAULT ''`); } catch (e) {}
try { db.exec(`ALTER TABLE users ADD COLUMN avatar TEXT DEFAULT ''`); } catch (e) {}
try { db.exec(`ALTER TABLE shops ADD COLUMN image TEXT DEFAULT ''`); } catch (e) {}
try { db.exec(`ALTER TABLE routes ADD COLUMN open_time TEXT DEFAULT '10:00'`); } catch (e) {}
try { db.exec(`ALTER TABLE users ADD COLUMN account_type TEXT DEFAULT ''`); } catch (e) {}
try { db.exec(`ALTER TABLE users ADD COLUMN daily_shop_id INTEGER`); } catch (e) {}
try { db.exec(`ALTER TABLE daily_products ADD COLUMN sort_order INTEGER DEFAULT 0`); } catch (e) {}

// ---------- Daily Orders (روزانہ آرڈر) — separate system, does not touch existing order flow ----------
db.exec(`CREATE TABLE IF NOT EXISTS daily_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id INTEGER NOT NULL REFERENCES daily_shops(id) ON DELETE CASCADE,
  order_date TEXT NOT NULL,
  note TEXT DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at INTEGER NOT NULL,
  UNIQUE(shop_id, order_date)
);
CREATE TABLE IF NOT EXISTS daily_order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES daily_orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity REAL NOT NULL DEFAULT 0,
  UNIQUE(order_id, product_id)
);
CREATE TABLE IF NOT EXISTS daily_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS daily_cat_access (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES daily_categories(id) ON DELETE CASCADE,
  UNIQUE(user_id, category_id)
);
CREATE TABLE IF NOT EXISTS daily_shop_access (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shop_id INTEGER NOT NULL REFERENCES daily_shops(id) ON DELETE CASCADE,
  UNIQUE(user_id, shop_id)
);
CREATE TABLE IF NOT EXISTS daily_shop_items (
  shop_id INTEGER NOT NULL REFERENCES daily_shops(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES daily_products(id) ON DELETE CASCADE,
  UNIQUE(shop_id, product_id)
);
CREATE TABLE IF NOT EXISTS daily_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS daily_units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS daily_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category_id INTEGER REFERENCES daily_categories(id),
  unit_id INTEGER REFERENCES daily_units(id),
  active INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS daily_shops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT DEFAULT '',
  address TEXT DEFAULT '',
  image TEXT DEFAULT '',
  active INTEGER DEFAULT 1
);`);
// --- Daily system: fully separate catalog (mukamal alag data) — one-time copy ---
// Same IDs so existing daily_orders/access rows stay valid; after this, independent.
if (!db.prepare(`SELECT value FROM daily_settings WHERE key='catalog_split'`).get()) {
  db.prepare(`INSERT OR IGNORE INTO daily_categories (id, name) SELECT id, name FROM categories`).run();
  db.prepare(`INSERT OR IGNORE INTO daily_units (id, name) SELECT id, name FROM units`).run();
  db.prepare(`INSERT OR IGNORE INTO daily_products (id, name, category_id, unit_id)
    SELECT id, name, category_id, unit_id FROM products`).run();
  db.prepare(`INSERT OR IGNORE INTO daily_shops (id, name, phone, address, image, active)
    SELECT id, name, phone, address, image, active FROM shops`).run();
  db.prepare(`INSERT INTO daily_settings (key, value) VALUES ('catalog_split', '1')`).run();
  // Existing shop users → link to their (copied) daily shop so daily access keeps working
  db.prepare(`UPDATE users SET daily_shop_id = shop_id WHERE role='shop' AND shop_id IS NOT NULL
    AND daily_shop_id IS NULL AND EXISTS (SELECT 1 FROM daily_shops WHERE id = users.shop_id)`).run();
}
// sort_order=0 wali purani rows ko tartib do (table banne ke baad)
db.prepare(`UPDATE daily_products SET sort_order = id * 10 WHERE sort_order = 0 OR sort_order IS NULL`).run();
db.prepare(`INSERT OR IGNORE INTO daily_settings (key, value) VALUES ('cutoff_time', '20:00')`).run();
// Supplier dashboard tables (2026-10-01)
try {
  db.exec(`CREATE TABLE IF NOT EXISTS supplier_shops (user_id INTEGER NOT NULL, shop_id INTEGER NOT NULL, PRIMARY KEY (user_id, shop_id))`);
  db.exec(`INSERT OR IGNORE INTO daily_settings (key, value) VALUES ('supplier_history_days', '2')`);
  db.exec(`INSERT OR IGNORE INTO daily_settings (key, value) VALUES ('shop_history_days', '30')`);
  db.exec(`INSERT OR IGNORE INTO daily_settings (key, value) VALUES ('daily_history_days', '30')`);
  db.exec(`INSERT OR IGNORE INTO daily_settings (key, value) VALUES ('vehicle_order_days', '7')`);
  db.exec(`INSERT OR IGNORE INTO daily_settings (key, value) VALUES ('app_theme', 'orange')`);
  db.exec(`CREATE TABLE IF NOT EXISTS supplier_schedule (user_id INTEGER NOT NULL, supply_date TEXT NOT NULL, cutoff_time TEXT DEFAULT '20:00', PRIMARY KEY (user_id, supply_date))`);
} catch(e) { console.log('supplier tables:', e.message); }
// Migration: account_type ke hisab se permissions fix karo (2026-10-01)
try {
  const ups = db.prepare(`INSERT OR REPLACE INTO permissions (user_id, section, level) VALUES (?, ?, ?)`).run;
  // daily_shop wale: supply none, daily full
  db.prepare(`SELECT id FROM users WHERE account_type='daily_shop'`).all().forEach(u => {
    for (const sec of ['dashboard','orders','order_history','reports','shops','products','categories','units','vehicles','routes'])
      db.prepare(`INSERT OR REPLACE INTO permissions (user_id, section, level) VALUES (?, ?, 'none')`).run(u.id, sec);
    db.prepare(`INSERT OR REPLACE INTO permissions (user_id, section, level) VALUES (?, 'daily', 'full')`).run(u.id);
  });
  // shop (supply) wale: daily none
  db.prepare(`SELECT id FROM users WHERE account_type='shop'`).all().forEach(u => {
    db.prepare(`INSERT OR REPLACE INTO permissions (user_id, section, level) VALUES (?, 'daily', 'none')`).run(u.id);
  });
} catch(e) { console.log('perm migration:', e.message); }
// Print settings defaults
const printDefaults = {
  'print_cols': '2',
  'print_title_size': '24', 'print_title_bold': '1', 'print_title_italic': '0',
  'print_sub_size': '13', 'print_sub_bold': '1',
  'print_cat_size': '17', 'print_cat_bold': '1',
  'print_table_size': '15',
  'print_name_size': '15', 'print_name_bold': '1',
  'print_num_size': '16', 'print_num_bold': '1',
  'print_margin': '6', 'print_gap': '10',
  'print_show_logo': '1', 'print_show_date': '1', 'print_show_user': '1',
  'print_font': 'Jameel Noori Nastaleeq',
  'print_cat_order': '',
  'print_shop_order': ''
};
for (const [k, v] of Object.entries(printDefaults)) {
  db.prepare(`INSERT OR IGNORE INTO daily_settings (key, value) VALUES (?, ?)`).run(k, v);
}

const SECTIONS = ['dashboard','orders','order_history','shops','products','categories','units','vehicles','routes','schedule','reports','users','daily'];

const DEFAULT_PERMS = {
  factory: { dashboard:'full', orders:'full', order_history:'full', shops:'view', products:'view', categories:'view', units:'view', vehicles:'view', routes:'view', schedule:'full', reports:'full', users:'none', daily:'full' },
  shop:    { dashboard:'view', orders:'full', order_history:'view', shops:'none', products:'none', categories:'none', units:'none', vehicles:'none', routes:'none', schedule:'view', reports:'none', users:'none', daily:'full' },
};

function seedPermissions(userId, role) {
  const defs = DEFAULT_PERMS[role] || {};
  const ins = db.prepare('INSERT OR REPLACE INTO permissions (user_id, section, level) VALUES (?,?,?)');
  for (const s of SECTIONS) ins.run(userId, s, defs[s] || 'none');
}
function getPermissions(userId) {
  const rows = db.prepare('SELECT section, level FROM permissions WHERE user_id=?').all(userId);
  const p = {};
  for (const s of SECTIONS) p[s] = 'none';
  for (const r of rows) p[r.section] = r.level;
  // 'daily' is new: users created before it existed have no row — fall back to role default
  // (existing saved settings are never overwritten)
  if (!rows.some(r => r.section === 'daily')) {
    const role = (db.prepare('SELECT role FROM users WHERE id=?').get(userId) || {}).role;
    p.daily = (DEFAULT_PERMS[role] || {}).daily || 'none';
  }
  return p;
}

// ---------- Web Push notifications (new order alerts on mobile) ----------
// VAPID keys are auto-generated once and stored in app_settings — no setup needed.
const webpush = require('web-push');
function appSetting(k, v) {
  if (v === undefined) { const r = db.prepare('SELECT value FROM app_settings WHERE key=?').get(k); return r ? r.value : null; }
  db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?,?)').run(k, v);
}
(function ensureVapid() {
  if (!appSetting('vapid_public') || !appSetting('vapid_private')) {
    const keys = webpush.generateVAPIDKeys();
    appSetting('vapid_public', keys.publicKey);
    appSetting('vapid_private', keys.privateKey);
  }
  webpush.setVapidDetails('mailto:gulshan-factory@local', appSetting('vapid_public'), appSetting('vapid_private'));
})();
// Send a push to every subscribed staff member (super_admin + factory), except the order creator.
function pushTo(subs, payload) {
  for (const s of subs) {
    webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload)
      .catch(e => { if (e.statusCode === 404 || e.statusCode === 410) db.prepare('DELETE FROM push_subscriptions WHERE id=?').run(s.id); });
  }
}
function notifyNewOrder(orderId, shopId, deliveryDate, itemCount, creatorId) {
  const shop = db.prepare('SELECT name FROM shops WHERE id=?').get(shopId);
  const payload = JSON.stringify({
    title: '🧾 نیا آرڈر — گلشن فیکٹری',
    body: `${shop ? shop.name : 'دکان'}: ${itemCount} آئٹمز | ڈیلیوری: ${deliveryDate}`,
    url: '/',
  });
  const subs = db.prepare(`SELECT ps.* FROM push_subscriptions ps JOIN users u ON u.id=ps.user_id
    WHERE u.active=1 AND u.role IN ('super_admin','factory') AND u.id != ?`).all(creatorId || 0);
  pushTo(subs, payload);
}
// Push to ALL subscribed users (any role) — e.g. route/supply changes shops must know about.
function notifyAll(title, body) {
  const payload = JSON.stringify({ title, body, url: '/' });
  const subs = db.prepare(`SELECT ps.* FROM push_subscriptions ps JOIN users u ON u.id=ps.user_id WHERE u.active=1`).all();
  pushTo(subs, payload);
}
// Login alerts -> only super_admins. Failed attempts throttled: max 1 alert per username per 10 min.
const lastFailAlert = {};
function notifyLogin(username, ok, excludeUserId) {
  if (!ok) {
    const now = Date.now();
    if (lastFailAlert[username] && now - lastFailAlert[username] < 10 * 60 * 1000) return;
    lastFailAlert[username] = now;
  }
  const payload = JSON.stringify({
    title: ok ? '🔑 لاگ اِن الرٹ' : '⚠️ ناکام لاگ اِن کوشش',
    body: ok ? `${username} نے لاگ اِن کیا` : `${username} — غلط یوزر نیم یا پاسورڈ`,
    url: '/',
  });
  const subs = db.prepare(`SELECT ps.* FROM push_subscriptions ps JOIN users u ON u.id=ps.user_id
    WHERE u.active=1 AND u.role='super_admin' AND u.id != ?`).all(excludeUserId || 0);
  pushTo(subs, payload);
  // WhatsApp alert
  waAlert(ok ? `🔑 لاگ اِن: ${username} نے لاگ اِن کیا` : `⚠️ ناکام لاگ اِن: ${username}`);
}

// Push to one specific user (all their subscribed devices).
function pushToUser(userId, payload) {
  const subs = db.prepare(`SELECT ps.* FROM push_subscriptions ps JOIN users u ON u.id=ps.user_id
    WHERE u.active=1 AND u.id=?`).all(userId);
  pushTo(subs, payload);
  return subs.length;
}

// ---------- App ----------
const app = express();

// GitHub auto-deploy webhook. Must be registered BEFORE express.json() so the
// raw body is available for signature verification.
// Setup: set DEPLOY_SECRET env on the server and the same secret in the GitHub
// webhook (Payload URL https://<site>/api/deploy, content type application/json).
// On every push to main it runs `git pull`. Frontend-only changes go live
// immediately (static files are read from disk); if server.js changed, restart
// the site from the panel once.
app.post('/api/deploy', express.raw({ type: 'application/json', limit: '1mb' }), (req, res) => {
  const secret = process.env.DEPLOY_SECRET;
  if (!secret) return res.status(500).json({ error: 'deploy_not_configured' });
  const sig = req.headers['x-hub-signature-256'] || '';
  const expected = 'sha256=' + require('crypto').createHmac('sha256', secret).update(req.body).digest('hex');
  if (sig.length !== expected.length || !require('crypto').timingSafeEqual(Buffer.from(sig), Buffer.from(expected)))
    return res.status(403).json({ error: 'bad_signature' });
  let ref = '';
  try { ref = JSON.parse(req.body.toString()).ref || ''; } catch (e) {}
  if (ref && ref !== 'refs/heads/main') return res.json({ ok: true, skipped: 'not_main' });
  require('child_process').execFile('git', ['pull', 'origin', 'main'], { cwd: __dirname, timeout: 60000 }, (err, stdout, stderr) => {
    const out = String(stdout || '') + String(stderr || '');
    if (err) return res.status(500).json({ error: 'pull_failed', log: out.slice(-500) });
    const needRestart = /server\.js/.test(out);
    const needInstall = /package\.json/.test(out);
    const done = (installLog) => res.json({ ok: true, server_restart_needed: needRestart, npm_install: installLog ? installLog.slice(-300) : undefined, log: out.slice(-300) });
    if (!needInstall) return done('');
    require('child_process').execFile('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], { cwd: __dirname, timeout: 180000 },
      (e2, so2, se2) => done(String(so2 || '') + String(se2 || '')));
  });
});

app.use(express.json({ limit: '1mb' }));
app.set('trust proxy', 1);
const sessSecret = process.env.SESSION_SECRET || 'gulshan-factory-dev-secret-change-me';
if (!process.env.SESSION_SECRET) console.warn('[warn] SESSION_SECRET not set — using dev default. Set it in production!');
app.use(session({
  name: 'gf.sid',
  secret: sessSecret,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === '1', maxAge: 1000 * 60 * 60 * 24 * 7 },
}));

function requireLogin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'login_required' });
  const u = db.prepare('SELECT id, username, role, shop_id, daily_shop_id, active FROM users WHERE id=?').get(req.session.userId);
  if (!u || !u.active) { req.session.destroy(() => {}); return res.status(401).json({ error: 'login_required' }); }
  req.user = u;
  next();
}
function can(user, section, min) {
  if (user.role === 'super_admin') return true;
  const lvl = (getPermissions(user.id)[section]) || 'none';
  const rank = { none: 0, view: 1, full: 2 };
  return (rank[lvl] || 0) >= (rank[min] || 0);
}
function requireSection(section, min = 'view') {
  return (req, res, next) => {
    if (!can(req.user, section, min)) return res.status(403).json({ error: 'forbidden' });
    next();
  };
}
const isAdmin = (req, res, next) => {
  if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'admin_only' });
  next();
};
// Shop users may only touch their own shop's data
function scopedShopId(req) {
  if (req.user.role === 'shop') return req.user.shop_id;
  return null; // admin/factory: not scoped by default
}

// ---------- Public: setup & auth ----------
// ---------- WhatsApp alerts config (super_admin only) ----------
app.get('/api/wa-settings', requireLogin, isAdmin, (req, res) => {
  res.json({ phone_number_id: waGet('phone_number_id'), admin_number: waGet('admin_number'), has_token: !!waGet('access_token') });
});
app.post('/api/wa-settings', requireLogin, isAdmin, (req, res) => {
  const b = req.body || {};
  if (b.phone_number_id !== undefined) waSet('phone_number_id', String(b.phone_number_id).trim());
  if (b.access_token) waSet('access_token', String(b.access_token).trim());
  if (b.admin_number !== undefined) waSet('admin_number', String(b.admin_number).trim());
  res.json({ ok: true });
});
app.post('/api/wa-test', requireLogin, isAdmin, async (req, res) => {
  const to = waGet('admin_number');
  if (!to) return res.status(400).json({ error: 'no_admin_number' });
  await sendWhatsApp(to, '✅ Gulshan Factory WhatsApp alerts test!');
  res.json({ ok: true });
});
// ---------- Email alert settings ----------
app.get('/api/email-settings', requireLogin, isAdmin, (req, res) => {
  res.json({ admin_email: emailGet('admin_email'), smtp_user: emailGet('smtp_user'), has_pass: !!emailGet('smtp_pass') });
});
app.post('/api/email-settings', requireLogin, isAdmin, (req, res) => {
  const b = req.body || {};
  if (b.admin_email !== undefined) emailSet('admin_email', String(b.admin_email).trim());
  if (b.smtp_user !== undefined) { emailSet('smtp_user', String(b.smtp_user).trim()); resetEmailTransporter(); }
  if (b.smtp_pass) { emailSet('smtp_pass', String(b.smtp_pass).trim()); resetEmailTransporter(); }
  res.json({ ok: true });
});
app.post('/api/email-test', requireLogin, isAdmin, async (req, res) => {
  const to = emailGet('admin_email');
  if (!to) return res.status(400).json({ error: 'no_admin_email' });
  const ok = await sendEmail(to, '✅ Gulshan Factory Email Test', '🏭 Gulshan Factory\nEmail alerts kaam kar rahe hain! 🎉');
  res.json({ ok });
});

app.get('/api/status', (req, res) => {
  const n = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  res.json({ setupRequired: n === 0, loggedIn: !!req.session.userId });
});
app.post('/api/setup', (req, res) => {
  const n = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  if (n > 0) return res.status(400).json({ error: 'already_setup' });
  const { username, password } = req.body || {};
  if (!username || !password || String(password).length < 4) return res.status(400).json({ error: 'bad_input' });
  const hash = bcrypt.hashSync(String(password), 10);
  const r = db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?,?, 'super_admin')").run(String(username).trim(), hash);
  req.session.userId = r.lastInsertRowid;
  res.json({ ok: true });
});
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const uname = String(username || '').trim();
  const u = db.prepare('SELECT * FROM users WHERE username=? AND active=1').get(uname);
  if (!u || !bcrypt.compareSync(String(password || ''), u.password_hash)) {
    notifyLogin(uname || 'نامعلوم', false, 0);
    return res.status(401).json({ error: 'bad_credentials' });
  }
  req.session.userId = u.id;
  notifyLogin(u.username, true, u.id);
  res.json({ ok: true });
});
app.post('/api/change-password', requireLogin, (req, res) => {
  const { current, next } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!u || !bcrypt.compareSync(String(current || ''), u.password_hash))
    return res.status(400).json({ error: 'wrong_current' });
  if (!next || String(next).length < 6) return res.status(400).json({ error: 'weak' });
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(String(next), 10), u.id);
  res.json({ ok: true });
});
// ---------- OTP password reset (code goes to the user's registered mobile via push) ----------
app.post('/api/forgot-password', (req, res) => {
  const { username } = req.body || {};
  const u = db.prepare('SELECT id, active FROM users WHERE username=?').get(String(username || '').trim());
  if (!u || !u.active) return res.json({ ok: true, sent: false }); // don't reveal
  const recent = db.prepare('SELECT COUNT(*) c FROM otps WHERE user_id=? AND created_at>?').get(u.id, Date.now() - 15 * 60 * 1000).c;
  if (recent >= 3) return res.status(429).json({ error: 'too_many' });
  const code = String(Math.floor(100000 + Math.random() * 900000));
  db.prepare('INSERT INTO otps (user_id, code_hash, expires_at, used, created_at) VALUES (?,?,?,?,?)')
    .run(u.id, bcrypt.hashSync(code, 10), Date.now() + 10 * 60 * 1000, 0, Date.now());
  const n = pushToUser(u.id, JSON.stringify({
    title: '🔑 پاس ورڈ ری سیٹ — گلشن فیکٹری',
    body: `آپ کا OTP: ${code} — 10 منٹ میں استعمال کریں`,
    url: '/',
  }));
  res.json({ ok: true, sent: n > 0 });
});
app.post('/api/reset-password', (req, res) => {
  const { username, code, password } = req.body || {};
  if (!password || String(password).length < 6) return res.status(400).json({ error: 'weak' });
  const u = db.prepare('SELECT id, active FROM users WHERE username=?').get(String(username || '').trim());
  if (!u || !u.active) return res.status(400).json({ error: 'bad_code' });
  const otp = db.prepare('SELECT * FROM otps WHERE user_id=? AND used=0 ORDER BY id DESC LIMIT 1').get(u.id);
  if (!otp || otp.expires_at < Date.now() || !bcrypt.compareSync(String(code || ''), otp.code_hash))
    return res.status(400).json({ error: 'bad_code' });
  db.prepare('UPDATE otps SET used=1 WHERE id=?').run(otp.id);
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(String(password), 10), u.id);
  waAlert(`🔐 پاسورڈ ری سیٹ: ${String(username).trim()} نے پاسورڈ تبدیل کیا`);
  res.json({ ok: true });
});
// ---------- WebAuthn biometric login (fingerprint / face) ----------
app.post('/api/webauthn/register-start', requireLogin, async (req, res) => {
  const wbn = loadWbn();
  if (!wbn) return res.status(500).json({ error: 'not_installed' });
  try {
    const existing = db.prepare('SELECT cred_id FROM webauthn_creds WHERE user_id=?').all(req.user.id);
    const opts = await wbn.generateRegistrationOptions({
      rpName: 'Gulshan Factory', rpID: rpIDOf(req),
      userID: new TextEncoder().encode('gf-' + req.user.id),
      userName: req.user.username,
      attestationType: 'none',
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'preferred' },
      excludeCredentials: existing.map(r => ({ id: r.cred_id, type: 'public-key' })),
    });
    req.session.wbnChallenge = opts.challenge;
    res.json({ options: opts });
  } catch (e) { res.status(500).json({ error: 'failed' }); }
});
app.post('/api/webauthn/register-finish', requireLogin, async (req, res) => {
  const wbn = loadWbn();
  if (!wbn) return res.status(500).json({ error: 'not_installed' });
  try {
    const { verified, registrationInfo } = await wbn.verifyRegistrationResponse({
      response: req.body.cred,
      expectedChallenge: req.session.wbnChallenge,
      expectedOrigin: originOf(req),
      expectedRPID: rpIDOf(req),
    });
    if (!verified || !registrationInfo) return res.status(400).json({ error: 'verify_failed' });
    const ncred = registrationInfo.credential || {};
    db.prepare(`INSERT OR REPLACE INTO webauthn_creds (user_id, cred_id, public_key, counter, created_at)
      VALUES (?,?,?,?,?)`).run(req.user.id, ncred.id,
      b64uE(ncred.publicKey), ncred.counter || 0, Date.now());
    delete req.session.wbnChallenge;
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: 'bad_request' }); }
});
app.post('/api/webauthn/login-start', async (req, res) => {
  const wbn = loadWbn();
  if (!wbn) return res.status(500).json({ error: 'not_installed' });
  const u = db.prepare('SELECT id, active FROM users WHERE username=?').get(String((req.body || {}).username || '').trim());
  if (!u || !u.active) return res.status(400).json({ error: 'no_bio' });
  const creds = db.prepare('SELECT cred_id FROM webauthn_creds WHERE user_id=?').all(u.id);
  if (!creds.length) return res.status(400).json({ error: 'no_bio' });
  try {
    const opts = await wbn.generateAuthenticationOptions({
      rpID: rpIDOf(req),
      allowCredentials: creds.map(c => ({ id: c.cred_id, type: 'public-key' })),
      userVerification: 'preferred',
    });
    req.session.wbnChallenge = opts.challenge;
    req.session.wbnUser = u.id;
    res.json({ options: opts });
  } catch (e) { res.status(500).json({ error: 'failed' }); }
});
app.post('/api/webauthn/login-finish', async (req, res) => {
  const wbn = loadWbn();
  if (!wbn) return res.status(500).json({ error: 'not_installed' });
  try {
    const { username, asrt } = req.body || {};
    const u = db.prepare('SELECT * FROM users WHERE username=?').get(String(username || '').trim());
    const cred = u && asrt && db.prepare('SELECT * FROM webauthn_creds WHERE user_id=? AND cred_id=?').get(u.id, asrt.id);
    if (!u || !u.active || !cred || req.session.wbnUser !== u.id || !req.session.wbnChallenge)
      return res.status(400).json({ error: 'bad_request' });
    const { verified, authenticationInfo } = await wbn.verifyAuthenticationResponse({
      response: asrt,
      expectedChallenge: req.session.wbnChallenge,
      expectedOrigin: originOf(req),
      expectedRPID: rpIDOf(req),
      credential: { id: cred.cred_id, publicKey: b64uD(cred.public_key), counter: cred.counter },
    });
    if (!verified) return res.status(400).json({ error: 'verify_failed' });
    db.prepare('UPDATE webauthn_creds SET counter=? WHERE id=?').run(authenticationInfo.newCounter, cred.id);
    req.session.userId = u.id;
    delete req.session.wbnChallenge; delete req.session.wbnUser;
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: 'bad_request' }); }
});
app.get('/api/webauthn/status', requireLogin, (req, res) => {
  const n = db.prepare('SELECT COUNT(*) c FROM webauthn_creds WHERE user_id=?').get(req.user.id).c;
  res.json({ on: n > 0 });
});
app.delete('/api/webauthn', requireLogin, (req, res) => {
  db.prepare('DELETE FROM webauthn_creds WHERE user_id=?').run(req.user.id);
  res.json({ ok: true });
});
// ---------- webauthn client debug log (diagnose login issues; in-memory) ----------
const wbnDebugLog = [];
app.post('/api/webauthn-debug', (req, res) => {
  wbnDebugLog.push({ t: new Date().toISOString(), ip: req.ip, ...(req.body || {}) });
  if (wbnDebugLog.length > 120) wbnDebugLog.splice(0, wbnDebugLog.length - 120);
  res.json({ ok: true });
});
app.get('/api/webauthn-debug', requireLogin, (req, res) => {
  if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'forbidden' });
  res.json(wbnDebugLog);
});

// ---------- Splash ads (super_admin uploads image/video shown at app start) ----------
const AD_DIR = path.join(DATA_DIR, 'ads');
fs.mkdirSync(AD_DIR, { recursive: true });
app.use('/ads', express.static(AD_DIR));
// ---------- profile / shop images ----------
const IMG_DIR = path.join(DATA_DIR, 'images');
fs.mkdirSync(IMG_DIR, { recursive: true });
app.use('/images', express.static(IMG_DIR));
function imageUpload(prefix) {
  if (!loadMulter()) return null;
  return multerLib({
    storage: multerLib.diskStorage({
      destination: IMG_DIR,
      filename: (req, file, cb) => cb(null, prefix + '-' + Date.now() + path.extname(file.originalname).toLowerCase()),
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      if (/^image\//.test(file.mimetype)) cb(null, true);
      else cb(new Error('bad_type'));
    },
  }).single('file');
}
app.post('/api/my-avatar', requireLogin, (req, res) => {
  const up = imageUpload('av');
  if (!up) return res.status(500).json({ error: 'upload_not_ready' });
  up(req, res, (err) => {
    if (err || !req.file) return res.status(400).json({ error: 'bad_file' });
    const old = (db.prepare('SELECT avatar FROM users WHERE id=?').get(req.user.id) || {}).avatar;
    if (old) fs.rmSync(path.join(IMG_DIR, old), { force: true });
    db.prepare('UPDATE users SET avatar=? WHERE id=?').run(req.file.filename, req.user.id);
    res.json({ ok: true, avatar: '/images/' + req.file.filename });
  });
});
app.post('/api/shops/:id/image', requireLogin, (req, res) => {
  if (!can(req.user, 'shops', 'full')) return res.status(403).json({ error: 'forbidden' });
  const up = imageUpload('shop');
  if (!up) return res.status(500).json({ error: 'upload_not_ready' });
  up(req, res, (err) => {
    if (err || !req.file) return res.status(400).json({ error: 'bad_file' });
    const old = (db.prepare('SELECT image FROM shops WHERE id=?').get(req.params.id) || {}).image;
    if (old) fs.rmSync(path.join(IMG_DIR, old), { force: true });
    db.prepare('UPDATE shops SET image=? WHERE id=?').run(req.file.filename, req.params.id);
    res.json({ ok: true, image: '/images/' + req.file.filename });
  });
});
// ---------- dependencies: self-install any missing npm package in background (no SSH needed) ----------
let installRunning = false;
function ensureDeps() {
  let missing = [];
  try {
    const deps = Object.keys(require('./package.json').dependencies || {});
    missing = deps.filter(d => { try { require.resolve(d); return false; } catch (e) { return true; } });
  } catch (e) {}
  if (!missing.length || installRunning) return false;
  installRunning = true;
  console.warn('[warn] missing deps: ' + missing.join(',') + ' — installing in background...');
  require('child_process').execFile('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], { cwd: __dirname, timeout: 300000 }, (err) => {
    installRunning = false;
    if (err) console.warn('[warn] auto npm install failed:', String(err && err.message || err).slice(0, 200));
    else console.log('[info] deps installed OK');
  });
  return true;
}
ensureDeps();
let multerLib = null, uploadHandler = null;
function loadMulter() {
  if (multerLib) return true;
  try { multerLib = require('multer'); return true; }
  catch (e) { ensureDeps(); return false; }
}
let wbnLib = null;
function loadWbn() {
  if (wbnLib) return wbnLib;
  try { wbnLib = require('@simplewebauthn/server'); }
  catch (e) { ensureDeps(); }
  return wbnLib;
}
// base64url helpers
const b64uE = (buf) => Buffer.from(buf).toString('base64url');
const b64uD = (s) => Buffer.from(String(s), 'base64url');
function originOf(req) {
  const proto = String(req.get('x-forwarded-proto') || req.protocol).split(',')[0].trim();
  return proto + '://' + req.get('host');
}
function rpIDOf(req) { return String(req.get('host')).split(':')[0]; }
function getUpload() {
  if (!loadMulter()) return null;
  if (!uploadHandler) uploadHandler = multerLib({
    storage: multerLib.diskStorage({
      destination: AD_DIR,
      filename: (req, file, cb) => cb(null, 'ad-' + Date.now() + path.extname(file.originalname).toLowerCase()),
    }),
    limits: { fileSize: 25 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      if (/^(image|video)\//.test(file.mimetype)) cb(null, true);
      else cb(new Error('bad_type'));
    },
  }).single('file');
  return uploadHandler;
}
app.get('/api/ad', (req, res) => {
  const file = appSetting('ad_file');
  if (!file || !fs.existsSync(path.join(AD_DIR, file))) return res.json({ enabled: false, hasAd: false });
  const start = appSetting('ad_start') || '', end = appSetting('ad_end') || '';
  const now = Date.now();
  const inWindow = (!start || now >= Date.parse(start)) && (!end || now <= Date.parse(end));
  const on = appSetting('ad_enabled') === '1';
  res.json({ enabled: on && inWindow, on, hasAd: true, type: appSetting('ad_type') || 'image',
    url: '/ads/' + file, duration: parseInt(appSetting('ad_duration') || '4'), start, end });
});
app.post('/api/ads', requireLogin, (req, res) => {
  if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'forbidden' });
  const up = getUpload();
  if (!up) return res.status(500).json({ error: 'ads_not_installed' });
  up(req, res, (err) => {
    if (err) return res.status(400).json({ error: 'bad_file' });
    const old = appSetting('ad_file');
    if (req.file) {
      if (old) fs.rmSync(path.join(AD_DIR, old), { force: true });
      appSetting('ad_file', req.file.filename);
      appSetting('ad_type', req.file.mimetype.startsWith('video') ? 'video' : 'image');
    }
    appSetting('ad_enabled', req.body.enabled === '1' ? '1' : '0');
    appSetting('ad_duration', String(Math.min(10, Math.max(2, parseInt(req.body.duration) || 4))));
    const start = String(req.body.start || ''), end = String(req.body.end || '');
    const ps = start ? Date.parse(start) : NaN, pe = end ? Date.parse(end) : NaN;
    if ((start && isNaN(ps)) || (end && isNaN(pe))) return res.status(400).json({ error: 'bad_date' });
    if (start && end && ps >= pe) return res.status(400).json({ error: 'bad_range' });
    appSetting('ad_start', start); appSetting('ad_end', end);
    res.json({ ok: true });
  });
});
app.delete('/api/ads', requireLogin, (req, res) => {
  if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'forbidden' });
  const old = appSetting('ad_file');
  if (old) fs.rmSync(path.join(AD_DIR, old), { force: true });
  appSetting('ad_file', ''); appSetting('ad_enabled', '0');
  appSetting('ad_start', ''); appSetting('ad_end', '');
  res.json({ ok: true });
});
app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/api/me', requireLogin, (req, res) => {
  const shop = req.user.shop_id ? db.prepare('SELECT id, name, image FROM shops WHERE id=?').get(req.user.shop_id) : null;
  const dshop = req.user.daily_shop_id ? db.prepare('SELECT id, name FROM daily_shops WHERE id=?').get(req.user.daily_shop_id) : null;
  const me = db.prepare('SELECT avatar, account_type FROM users WHERE id=?').get(req.user.id) || {};
  res.json({ id: req.user.id, username: req.user.username, role: req.user.role, shop_id: req.user.shop_id,
    daily_shop_id: req.user.daily_shop_id || null, account_type: me.account_type || '',
    shop_name: shop ? shop.name : null, shop_image: shop && shop.image ? '/images/' + shop.image : null,
    daily_shop_name: dshop ? dshop.name : null,
    avatar: me.avatar ? '/images/' + me.avatar : null,
    permissions: req.user.role === 'super_admin' ? Object.fromEntries(SECTIONS.map(s => [s, 'full'])) : getPermissions(req.user.id) });
});
app.get('/api/vapid-public-key', (req, res) => {
  res.json({ publicKey: appSetting('vapid_public') });
});
// Forgot-password device subscription (no login): user proves identity with their
// registered phone number, then this mobile can receive the OTP push.
const forgotSubHits = new Map();
app.post('/api/push-subscribe-forgot', (req, res) => {
  const now = Date.now();
  const hits = (forgotSubHits.get(req.ip) || []).filter(t => now - t < 3600000);
  if (hits.length >= 8) return res.status(429).json({ error: 'too_many' });
  hits.push(now); forgotSubHits.set(req.ip, hits);
  const { username, phone, subscription } = req.body || {};
  const s = subscription || {};
  if (!s.endpoint || !s.keys || !s.keys.p256dh || !s.keys.auth) return res.status(400).json({ error: 'bad_input' });
  const u = db.prepare('SELECT id, active, phone FROM users WHERE username=?').get(String(username || '').trim());
  if (!u || !u.active) return res.json({ ok: true }); // don't reveal
  const regPhone = String(u.phone || '').replace(/\D/g, '');
  const givenPhone = String(phone || '').replace(/\D/g, '');
  if (!regPhone || !givenPhone || regPhone.slice(-10) !== givenPhone.slice(-10))
    return res.status(400).json({ error: 'phone_mismatch' });
  db.prepare(`INSERT OR REPLACE INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?,?,?,?)`)
    .run(u.id, s.endpoint, s.keys.p256dh, s.keys.auth);
  res.json({ ok: true });
});
app.post('/api/push-subscribe', requireLogin, (req, res) => {
  const s = (req.body || {}).subscription || req.body || {};
  if (!s.endpoint || !s.keys || !s.keys.p256dh || !s.keys.auth) return res.status(400).json({ error: 'bad_input' });
  db.prepare(`INSERT OR REPLACE INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?,?,?,?)`)
    .run(req.user.id, s.endpoint, s.keys.p256dh, s.keys.auth);
  res.json({ ok: true });
});
app.post('/api/push-unsubscribe', requireLogin, (req, res) => {
  const ep = ((req.body || {}).endpoint) || '';
  if (ep) db.prepare('DELETE FROM push_subscriptions WHERE user_id=? AND endpoint=?').run(req.user.id, ep);
  res.json({ ok: true });
});
app.get('/api/push-status', requireLogin, (req, res) => {
  if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'forbidden' });
  const subs = db.prepare(`SELECT ps.created_at, u.username FROM push_subscriptions ps
    JOIN users u ON u.id=ps.user_id WHERE u.role='super_admin' ORDER BY ps.created_at DESC`).all();
  res.json({ count: subs.length, devices: subs });
});
app.post('/api/push-test', requireLogin, (req, res) => {
  if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'forbidden' });
  const payload = JSON.stringify({ title: '🔔 ٹیسٹ نوٹیفکیشن', body: 'مبارک ہو! اطلاعات کا نظام کام کر رہا ہے۔', url: '/' });
  const subs = db.prepare(`SELECT ps.* FROM push_subscriptions ps JOIN users u ON u.id=ps.user_id
    WHERE u.active=1 AND u.role='super_admin'`).all();
  pushTo(subs, payload);
  res.json({ ok: true, sent: subs.length });
});

// Catalog needed to place an order: active categories, products and routes.
// Any user who may place orders can read it (ordering must not depend on catalog-management permissions).
app.get('/api/order-catalog', requireLogin, requireSection('orders', 'view'), (req, res) => {
  const cats = db.prepare('SELECT id, name FROM categories ORDER BY sort, name').all();
  const products = db.prepare(`SELECT p.id, p.name, p.category_id, u.name AS unit_name
    FROM products p LEFT JOIN units u ON u.id = p.unit_id WHERE p.active = 1 ORDER BY p.name`).all();
  const routes = db.prepare('SELECT id, name, supply_date, cutoff_date, cutoff_time, open_time FROM routes WHERE active = 1 ORDER BY id DESC').all();
  res.json({ cats, products, routes });
});

// ---------- Supply calendar ----------
// Supply days are routes with a supply_date. Admin/factory tap calendar days to announce them;
// shops get a push and order against the nearest open supply day (no date picking).
function supplyDayInfo(from, to) {
  return db.prepare(`SELECT r.*, v.name AS vehicle_name,
    (SELECT COUNT(*) FROM orders o WHERE o.route_id=r.id) AS order_count
    FROM routes r LEFT JOIN vehicles v ON v.id=r.vehicle_id
    WHERE r.active=1 AND r.supply_date >= ? AND r.supply_date <= ? ORDER BY r.supply_date`).all(from, to);
}
app.get('/api/supply-days', requireLogin, (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'range_required' });
  res.json(supplyDayInfo(from, to));
});
app.get('/api/supply-default', requireLogin, requireSection('routes', 'full'), (req, res) => {
  res.json({ cutoff_time: appSetting('default_cutoff_time') || '20:00',
             open_time: appSetting('default_open_time') || '10:00' });
});
app.post('/api/supply-days', requireLogin, requireSection('routes', 'full'), (req, res) => {
  const { date, cutoff_time, open_time } = req.body || {};
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return res.status(400).json({ error: 'bad_date' });
  if (db.prepare('SELECT id FROM routes WHERE active=1 AND supply_date=?').get(date))
    return res.status(400).json({ error: 'already_exists' });
  const given = cutoff_time && /^\d{2}:\d{2}$/.test(String(cutoff_time)) ? cutoff_time : null;
  const ct = given || appSetting('default_cutoff_time') || '20:00';
  if (given) appSetting('default_cutoff_time', given); // remember last saved time
  const givenOpen = open_time && /^\d{2}:\d{2}$/.test(String(open_time)) ? open_time : null;
  const ot = givenOpen || appSetting('default_open_time') || '10:00';
  if (givenOpen) appSetting('default_open_time', givenOpen); // remember last saved time
  const cd = new Date(date + 'T12:00:00'); cd.setDate(cd.getDate() - 1);
  const cutoff_date = cd.toISOString().slice(0, 10);
  const veh = db.prepare('SELECT id FROM vehicles WHERE active=1 ORDER BY id LIMIT 1').get();
  const r = db.prepare(`INSERT INTO routes (name, vehicle_id, supply_date, cutoff_date, cutoff_time, open_time, active)
    VALUES (?,?,?,?,?,?,1)`).run('🚚 سپلائی ' + date, veh ? veh.id : null, date, cutoff_date, ct, ot);
  notifyAll('🗓 نئی سپلائی — گلشن فیکٹری', `سپلائی: ${date} | آرڈر: ${cutoff_date} ${ot} سے | کٹ آف: ${cutoff_date} ${ct} — آرڈر بنا لیں`);
  res.json({ ok: true, id: r.lastInsertRowid });
});
app.put('/api/supply-days/:id', requireLogin, requireSection('routes', 'full'), (req, res) => {
  const { cutoff_time, open_time } = req.body || {};
  const sets = [], args = [];
  if (cutoff_time && /^\d{2}:\d{2}$/.test(String(cutoff_time))) {
    sets.push('cutoff_time=?'); args.push(cutoff_time);
    appSetting('default_cutoff_time', cutoff_time); // remember last saved time
  }
  if (open_time && /^\d{2}:\d{2}$/.test(String(open_time))) {
    sets.push('open_time=?'); args.push(open_time);
    appSetting('default_open_time', open_time); // remember last saved time
  }
  if (!sets.length) return res.status(400).json({ error: 'bad_time' });
  args.push(req.params.id);
  db.prepare(`UPDATE routes SET ${sets.join(',')} WHERE id=?`).run(...args);
  const r = db.prepare('SELECT supply_date, cutoff_date, cutoff_time, open_time FROM routes WHERE id=?').get(req.params.id);
  if (r) notifyAll('⏰ وقت اپڈیٹ — گلشن فیکٹری', `سپلائی ${r.supply_date}: آرڈر ${r.open_time} سے، کٹ آف ${r.cutoff_date} ${r.cutoff_time}`);
  res.json({ ok: true });
});
app.delete('/api/supply-days/:id', requireLogin, requireSection('routes', 'full'), (req, res) => {
  const id = Number(req.params.id);
  const moveTo = Number(req.query.move_to) || 0;
  const n = db.prepare('SELECT COUNT(*) c FROM orders WHERE route_id=?').get(id).c;
  if (n > 0 && !moveTo) return res.status(400).json({ error: 'has_orders', count: n });
  if (n > 0 && moveTo) {
    const t = db.prepare('SELECT supply_date FROM routes WHERE id=? AND active=1').get(moveTo);
    if (!t) return res.status(400).json({ error: 'bad_target' });
    db.prepare('UPDATE orders SET route_id=?, delivery_date=? WHERE route_id=?').run(moveTo, t.supply_date, id);
  }
  db.prepare('UPDATE routes SET active=0 WHERE id=?').run(id);
  res.json({ ok: true, moved: n });
});

// ==================== DAILY ORDERS (روزانہ آرڈر) ====================
function dailyCutoffTime() {
  return (db.prepare(`SELECT value FROM daily_settings WHERE key='cutoff_time'`).get() || {}).value || '20:00';
}
function khiNow() { return new Date(Date.now() + 5 * 3600e3); } // Karachi wall-clock via UTC fields
function dailyCutoffParts() {
  const [h, m] = dailyCutoffTime().split(':').map(Number);
  return { h: Number.isFinite(h) ? h : 20, m: Number.isFinite(m) ? m : 0 };
}
// Production date shops order for: tomorrow if before today's cutoff, else day after tomorrow
function dailyOrderDate() {
  const now = khiNow();
  const { h, m } = dailyCutoffParts();
  const cut = new Date(now); cut.setUTCHours(h, m, 0, 0);
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() + (now < cut ? 1 : 2));
  return d.toISOString().slice(0, 10);
}
function dailyCutoffPassed() {
  const now = khiNow();
  const { h, m } = dailyCutoffParts();
  const cut = new Date(now); cut.setUTCHours(h, m, 0, 0);
  return now >= cut;
}
// Scope: shop users -> own shop; viewers/suppliers -> configured categories/shops; admin -> all
function dailyScope(req) {
  const u = req.user;
  if (u.role === 'super_admin') return { shopId: null, catIds: null, shopIds: null };
  // Daily shop users are scoped to their DAILY shop (separate from supply shops).
  // A supply-only shop (no daily_shop_id) sees nothing in daily — clean separation.
  const shopId = (u.role === 'shop') ? (u.daily_shop_id || -1) : null;
  const catRows = db.prepare('SELECT category_id FROM daily_cat_access WHERE user_id=?').all(u.id);
  const shopRows = db.prepare('SELECT shop_id FROM daily_shop_access WHERE user_id=?').all(u.id);
  return {
    shopId,
    catIds: catRows.length ? catRows.map(r => r.category_id) : null,
    shopIds: (!shopId && shopRows.length) ? shopRows.map(r => r.shop_id) : null,
  };
}
function dailyShopFilter(sc, alias) {
  if (sc.shopId) return { clause: ` AND ${alias}.shop_id=?`, args: [sc.shopId] };
  if (sc.shopIds) return { clause: ` AND ${alias}.shop_id IN (${sc.shopIds.map(() => '?').join(',')})`, args: [...sc.shopIds] };
  return { clause: '', args: [] };
}

app.get('/api/daily/date', requireLogin, requireSection('daily', 'view'), (req, res) => {
  res.json({ order_date: dailyOrderDate(), cutoff_time: dailyCutoffTime(), cutoff_passed: dailyCutoffPassed() });
});
// Print settings (admin)
app.get('/api/daily/print-settings', requireLogin, (req, res) => {
  if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'forbidden' });
  const rows = db.prepare(`SELECT key, value FROM daily_settings WHERE key LIKE 'print_%'`).all();
  const out = {};
  rows.forEach(r => out[r.key] = r.value);
  res.json(out);
});
app.post('/api/daily/print-settings', requireLogin, (req, res) => {
  if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'forbidden' });
  const allowed = ['print_cols','print_title_size','print_title_bold','print_title_italic','print_sub_size','print_sub_bold','print_cat_size','print_cat_bold','print_table_size','print_name_size','print_name_bold','print_num_size','print_num_bold','print_margin','print_gap','print_show_logo','print_show_date','print_show_user','print_font','print_cat_order','print_shop_order'];
  for (const k of allowed) {
    if (req.body[k] !== undefined) {
      db.prepare(`INSERT OR REPLACE INTO daily_settings (key, value) VALUES (?, ?)`).run(k, String(req.body[k]));
    }
  }
  res.json({ ok: true });
});
// Shop's allowed products (null = all visible)
app.get('/api/daily/my-items', requireLogin, requireSection('daily', 'view'), (req, res) => {
  const sc = dailyScope(req);
  if (!sc.shopId) return res.json(null);
  const rows = db.prepare('SELECT product_id FROM daily_shop_items WHERE shop_id=?').all(sc.shopId);
  res.json(rows.length ? rows.map(r => r.product_id) : null);
});

app.get('/api/daily/catalog', requireLogin, requireSection('daily', 'view'), (req, res) => {
  const sc = dailyScope(req);
  let catSql = 'SELECT id, name FROM daily_categories WHERE active=1';
  let prodSql = `SELECT p.id, p.name, p.category_id, u.name AS unit_name
    FROM daily_products p LEFT JOIN daily_units u ON u.id=p.unit_id WHERE p.active=1`;
  let args = [];
  if (sc.catIds) {
    const ph = sc.catIds.map(() => '?').join(',');
    catSql += ` AND id IN (${ph})`;
    prodSql += ` AND p.category_id IN (${ph})`;
    args = sc.catIds;
  }
  const cats = db.prepare(catSql + ' ORDER BY name').all(...args);
  const prods = db.prepare(prodSql + ' ORDER BY p.sort_order, p.name').all(...args);
  res.json(cats.map(c => ({ ...c, products: prods.filter(p => p.category_id === c.id) })));
});

app.get('/api/daily/orders', requireLogin, requireSection('daily', 'view'), (req, res) => {
  const sc = dailyScope(req);
  const date = req.query.date || dailyOrderDate();
  const sf = dailyShopFilter(sc, 'do');
  const orders = db.prepare(`SELECT do.id, do.shop_id, do.order_date, do.note, s.name AS shop_name,
      u.username AS created_by FROM daily_orders do
    JOIN daily_shops s ON s.id=do.shop_id LEFT JOIN users u ON u.id=do.created_by
    WHERE do.order_date=?${sf.clause} ORDER BY s.name`).all(date, ...sf.args);
  const itemQ = sc.catIds
    ? db.prepare(`SELECT di.order_id, di.product_id, di.quantity, p.name AS product_name, p.category_id,
        c.name AS category_name, un.name AS unit_name FROM daily_order_items di
      JOIN daily_products p ON p.id=di.product_id LEFT JOIN daily_categories c ON c.id=p.category_id
      LEFT JOIN daily_units un ON un.id=p.unit_id
      WHERE di.order_id=? AND p.category_id IN (${sc.catIds.map(() => '?').join(',')}) ORDER BY p.sort_order, p.name`)
    : db.prepare(`SELECT di.order_id, di.product_id, di.quantity, p.name AS product_name, p.category_id,
        c.name AS category_name, un.name AS unit_name FROM daily_order_items di
      JOIN daily_products p ON p.id=di.product_id LEFT JOIN daily_categories c ON c.id=p.category_id
      LEFT JOIN daily_units un ON un.id=p.unit_id WHERE di.order_id=? ORDER BY p.sort_order, p.name`);
  res.json(orders.map(o => ({ ...o, items: sc.catIds ? itemQ.all(o.id, ...sc.catIds) : itemQ.all(o.id) })));
});

app.post('/api/daily/orders', requireLogin, requireSection('daily', 'full'), (req, res) => {
try {
  const b = req.body || {};
  let order_date = b.order_date;
  if (!order_date) {
    try { order_date = dailyOrderDate(); } catch(e) { order_date = new Date().toISOString().slice(0,10); }
  }
  const shop_id = Number(b.shop_id) || 0;
  // Shop user apna daily_shop_id automatic use kare
  const effective_shop_id = (req.user.role === 'shop' && req.user.daily_shop_id) ? req.user.daily_shop_id : shop_id;
  if (!effective_shop_id) return res.status(400).json({ error: 'shop_required' });
  const shopExists = db.prepare('SELECT id FROM daily_shops WHERE id=?').get(effective_shop_id);
  if (!shopExists) return res.status(400).json({ error: 'bad_shop' });
  const items = b.items || {};
  const now = Date.now();
  let order = db.prepare('SELECT id FROM daily_orders WHERE shop_id=? AND order_date=?').get(effective_shop_id, order_date);
  if (!order) {
    const r = db.prepare('INSERT INTO daily_orders (shop_id, order_date, note, created_by, created_at) VALUES (?,?,?,?,?)')
      .run(effective_shop_id, order_date, b.note || '', req.user.id, now);
    order = { id: r.lastInsertRowid };
  } else {
    db.prepare('UPDATE daily_orders SET note=?, created_by=? WHERE id=?').run(b.note || '', req.user.id, order.id);
    db.prepare('DELETE FROM daily_order_items WHERE order_id=?').run(order.id);
  }
  const ins = db.prepare('INSERT INTO daily_order_items (order_id, product_id, quantity) VALUES (?,?,?)');
  for (const [pid, q] of Object.entries(items)) {
    const qty = Number(q) || 0;
    const nid = Number(pid) || 0;
    if (qty > 0 && nid > 0) {
      try { ins.run(order.id, nid, qty); } catch(e) {}
    }
  }
  const shopName = (db.prepare('SELECT name FROM daily_shops WHERE id=?').get(effective_shop_id) || {}).name || effective_shop_id;
  const itemCount = Object.keys(items).length;
  waAlert(`📝 ڈیلی آرڈر: ${shopName} - ${itemCount} آئٹم (${order_date})`);
  res.json({ ok: true, id: order.id });
} catch(e) { console.error('ORDER ERR:', e.message); res.status(500).json({ error: 'server_error', detail: e.message }); }
});

app.delete('/api/daily/orders/:id', requireLogin, requireSection('daily', 'full'), (req, res) => {
  const sc = dailyScope(req);
  const o = db.prepare('SELECT * FROM daily_orders WHERE id=?').get(req.params.id);
  if (!o) return res.status(404).json({ error: 'not_found' });
  if (sc.shopId && o.shop_id !== sc.shopId) return res.status(403).json({ error: 'forbidden' });
  if (sc.shopId && o.order_date === dailyOrderDate() && dailyCutoffPassed())
    return res.status(400).json({ error: 'cutoff_passed' });
  db.prepare('DELETE FROM daily_orders WHERE id=?').run(o.id);
  res.json({ ok: true });
});

// ---------- Supplier dashboard (supply system) ----------
// Assign shops to supplier
app.get('/api/supplier/shops/:userId', requireLogin, (req, res) => {
  if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'forbidden' });
  const rows = db.prepare('SELECT shop_id FROM supplier_shops WHERE user_id=?').all(req.params.userId);
  res.json(rows.map(r => r.shop_id));
});
app.post('/api/supplier/shops/:userId', requireLogin, (req, res) => {
  if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'forbidden' });
  const shopIds = (req.body.shop_ids || []).map(Number).filter(Boolean);
  db.transaction(() => {
    db.prepare('DELETE FROM supplier_shops WHERE user_id=?').run(req.params.userId);
    const ins = db.prepare('INSERT INTO supplier_shops (user_id, shop_id) VALUES (?, ?)');
    shopIds.forEach(id => ins.run(req.params.userId, id));
  })();
  res.json({ ok: true });
});
// Supplier dashboard data
// Admin: kisi vehicle ka schedule manage karo
app.get('/api/supplier/schedule/:userId', requireLogin, (req, res) => {
  if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'forbidden' });
  const rows = db.prepare('SELECT supply_date, cutoff_time FROM supplier_schedule WHERE user_id=? ORDER BY supply_date').all(req.params.userId);
  res.json(rows);
});
app.post('/api/supplier/schedule/:userId', requireLogin, (req, res) => {
  if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'forbidden' });
  const { supply_date, cutoff_time } = req.body || {};
  if (!supply_date) return res.status(400).json({ error: 'bad_input' });
  db.prepare('INSERT OR REPLACE INTO supplier_schedule (user_id, supply_date, cutoff_time) VALUES (?, ?, ?)')
    .run(req.params.userId, supply_date, cutoff_time || '20:00');
  res.json({ ok: true });
});
app.delete('/api/supplier/schedule/:userId/:date', requireLogin, (req, res) => {
  if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'forbidden' });
  db.prepare('DELETE FROM supplier_schedule WHERE user_id=? AND supply_date=?').run(req.params.userId, req.params.date);
  res.json({ ok: true });
});
// Supplier: apna supply schedule dekho (sirf view)
app.get('/api/supplier/schedule', requireLogin, (req, res) => {
  // Main supply calendar se lao (admin ne jo set kiya)
  const today = new Date().toISOString().slice(0, 10);
  const rows = db.prepare(`SELECT r.supply_date, r.cutoff_time, r.cutoff_date, r.name AS route_name
    FROM routes r WHERE r.active=1 AND r.supply_date >= ? ORDER BY r.supply_date LIMIT 10`).all(today);
  res.json(rows.map(r => ({ supply_date: r.supply_date, cutoff_time: r.cutoff_time, cutoff_date: r.cutoff_date, label: r.route_name })));
});
app.post('/api/supplier/schedule', requireLogin, (req, res) => {
  const { supply_date, cutoff_time } = req.body || {};
  if (!supply_date) return res.status(400).json({ error: 'bad_input' });
  db.prepare('INSERT OR REPLACE INTO supplier_schedule (user_id, supply_date, cutoff_time) VALUES (?, ?, ?)')
    .run(req.user.id, supply_date, cutoff_time || '20:00');
  res.json({ ok: true });
});
app.delete('/api/supplier/schedule/:date', requireLogin, (req, res) => {
  db.prepare('DELETE FROM supplier_schedule WHERE user_id=? AND supply_date=?').run(req.user.id, req.params.date);
  res.json({ ok: true });
});
// Supplier: manual order (shop ki taraf se) - cutoff ke baad nahi!
app.post('/api/supplier/order', requireLogin, async (req, res) => {
  const { shop_id, items, delivery_date, note } = req.body || {};
  if (!shop_id || !items) return res.status(400).json({ error: 'bad_input' });
  // Date validation: sirf future dates (kal se)
  const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  if (!delivery_date || delivery_date < tomorrow) {
    return res.status(400).json({ error: 'bad_date', message: 'صرف آنے والی تاریخوں کے لیے آرڈر دیں!' });
  }
  // Max days check (admin setting)
  const maxDays = parseInt((db.prepare(`SELECT value FROM daily_settings WHERE key='vehicle_order_days'`).get() || {}).value || '7');
  const maxDate = new Date(Date.now() + maxDays * 864e5).toISOString().slice(0, 10);
  if (delivery_date > maxDate) {
    return res.status(400).json({ error: 'bad_date', message: `صرف ${maxDays} دن تک کے لیے آرڈر دیں!` });
  }
  // Cutoff check: vehicle ke schedule ka cutoff
  if (req.user.account_type === 'vehicle') {
    const sched = db.prepare(`SELECT cutoff_time FROM supplier_schedule WHERE user_id=? AND supply_date>=date('now') ORDER BY supply_date LIMIT 1`).get(req.user.id);
    if (sched) {
      const now = new Date();
      const cutoff = new Date();
      const [h, m] = (sched.cutoff_time || '20:00').split(':').map(Number);
      cutoff.setHours(h, m, 0, 0);
      if (now > cutoff) {
        return res.status(400).json({ error: 'cutoff_passed', message: 'کٹ آف ٹائم گزر گیا! صرف دکان یا ایڈمن آرڈر دے سکتا ہے۔' });
      }
    }
  }
  // Check: ye shop supplier ki hai?
  if (req.user.role !== 'super_admin') {
    const allowed = db.prepare('SELECT 1 FROM supplier_shops WHERE user_id=? AND shop_id=?').get(req.user.id, shop_id);
    if (!allowed) return res.status(403).json({ error: 'forbidden' });
  }
  try {
    const r = db.prepare('INSERT INTO orders (shop_id, delivery_date, note, status, created_by) VALUES (?,?,?,?,?)')
      .run(shop_id, delivery_date || new Date().toISOString().slice(0,10), note || '', 'new', req.user.id);
    const ins = db.prepare('INSERT INTO order_items (order_id, product_id, quantity) VALUES (?,?,?)');
    for (const [pid, qty] of Object.entries(items)) {
      if (Number(qty) > 0) ins.run(r.lastInsertRowid, Number(pid), Number(qty));
    }
    res.json({ ok: true, id: r.lastInsertRowid });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
// Admin: history days set karo (all types)
app.post('/api/history-days', requireLogin, (req, res) => {
  if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'forbidden' });
  const { key, days } = req.body || {};
  if (!['supplier_history_days', 'shop_history_days', 'daily_history_days', 'vehicle_order_days'].includes(key)) return res.status(400).json({ error: 'bad_key' });
  const d = Math.max(1, Math.min(365, parseInt(days) || 30));
  db.prepare(`INSERT OR REPLACE INTO daily_settings (key, value) VALUES (?, ?)`).run(key, String(d));
  res.json({ ok: true, days: d });
});
app.get('/api/app-theme', (req, res) => {
  const t = (db.prepare(`SELECT value FROM daily_settings WHERE key='app_theme'`).get() || {}).value || 'orange';
  res.json({ theme: t });
});
app.post('/api/app-theme', requireLogin, (req, res) => {
  if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'forbidden' });
  const themes = ['orange', 'green', 'blue', 'purple', 'pink'];
  const t = String(req.body.theme || 'orange');
  if (!themes.includes(t)) return res.status(400).json({ error: 'bad_theme' });
  db.prepare(`INSERT OR REPLACE INTO daily_settings (key, value) VALUES ('app_theme', ?)`).run(t);
  res.json({ ok: true });
});
app.get('/api/history-days', requireLogin, (req, res) => {
  if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'forbidden' });
  const g = k => (db.prepare(`SELECT value FROM daily_settings WHERE key=?`).get(k) || {}).value;
  res.json({
    supplier_history_days: g('supplier_history_days') || '2',
    shop_history_days: g('shop_history_days') || '30',
    daily_history_days: g('daily_history_days') || '30',
    vehicle_order_days: g('vehicle_order_days') || '7'
  });
});
// Admin: history days set karo
app.post('/api/supplier/history-days', requireLogin, (req, res) => {
  if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'forbidden' });
  const days = Math.max(1, Math.min(30, parseInt(req.body.days) || 2));
  db.prepare(`INSERT OR REPLACE INTO daily_settings (key, value) VALUES ('supplier_history_days', ?)`).run(String(days));
  res.json({ ok: true, days });
});
// Supplier: order status update (sirf apni shops ke)
app.post('/api/supplier/order/:id/status', requireLogin, (req, res) => {
  const status = String(req.body.status || '');
  if (!['new', 'collected', 'delivered'].includes(status)) return res.status(400).json({ error: 'bad_status' });
  // Check: ye order supplier ki shop ka hai?
  const order = db.prepare('SELECT shop_id FROM orders WHERE id=?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'not_found' });
  if (req.user.role !== 'super_admin') {
    const allowed = db.prepare('SELECT 1 FROM supplier_shops WHERE user_id=? AND shop_id=?').get(req.user.id, order.shop_id);
    if (!allowed) return res.status(403).json({ error: 'forbidden' });
  }
  db.prepare('UPDATE orders SET status=? WHERE id=?').run(status, req.params.id);
  res.json({ ok: true });
});
app.get('/api/supplier/dashboard', requireLogin, (req, res) => {
  const days = parseInt((db.prepare(`SELECT value FROM daily_settings WHERE key='supplier_history_days'`).get() || {}).value || '2');
  const cutoff = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  let shopIds;
  if (req.user.role === 'super_admin') {
    shopIds = null; // all
  } else {
    shopIds = db.prepare('SELECT shop_id FROM supplier_shops WHERE user_id=?').all(req.user.id).map(r => r.shop_id);
  }
  const sf = shopIds ? `AND o.shop_id IN (${shopIds.map(() => '?').join(',')})` : '';
  const args = shopIds || [];
  // ALL assigned shops (order ho ya na ho)
  let allShops = [];
  if (shopIds) {
    allShops = db.prepare(`SELECT id, name FROM shops WHERE id IN (${shopIds.map(() => '?').join(',')}) AND active=1 ORDER BY name`).all(...shopIds);
  } else {
    allShops = db.prepare(`SELECT id, name FROM shops WHERE active=1 ORDER BY name`).all();
  }
  // Shop-wise orders (sirf aaj aur future - past nahi)
  const today = new Date().toISOString().slice(0, 10);
  const shopOrders = db.prepare(`SELECT s.name AS shop_name, s.id AS shop_id, o.id, o.delivery_date, o.created_at, o.status,
      (SELECT SUM(oi.quantity) FROM order_items oi WHERE oi.order_id=o.id) AS total_qty
    FROM orders o JOIN shops s ON s.id=o.shop_id
    WHERE o.delivery_date >= ? AND o.delivery_date >= ? ${sf} ORDER BY o.delivery_date DESC, o.id DESC LIMIT 50`).all(cutoff, today, ...args);
  // Kaunsi shop ka order aaya, kaunsi ka nahi
  const orderedShopIds = new Set(shopOrders.map(o => o.shop_id));
  const shopsStatus = allShops.map(sh => {
    const ord = shopOrders.find(o => o.shop_id === sh.id);
    return { shop_id: sh.id, shop_name: sh.name, has_order: !!ord, order: ord || null };
  });
  // Item-wise totals
  const itemTotals = db.prepare(`SELECT p.name AS product_name, c.name AS category_name, SUM(oi.quantity) AS total_qty,
      COUNT(DISTINCT o.shop_id) AS shop_count
    FROM order_items oi JOIN orders o ON o.id=oi.order_id
    JOIN products p ON p.id=oi.product_id LEFT JOIN categories c ON c.id=p.category_id
    WHERE o.delivery_date >= ? AND o.delivery_date >= ? ${sf} GROUP BY p.id ORDER BY total_qty DESC`).all(cutoff, today, ...args);
  res.json({ shopOrders, shopsStatus, itemTotals, history_days: days, cutoff_date: cutoff });
});
app.get('/api/daily/totals', requireLogin, requireSection('daily', 'view'), (req, res) => {
  const sc = dailyScope(req);
  const date = req.query.date || dailyOrderDate();
  const sf = dailyShopFilter(sc, 'do');
  let sql = `SELECT p.id AS product_id, p.name AS product_name, p.category_id, c.name AS category_name,
      un.name AS unit_name, COALESCE(SUM(CASE WHEN do.order_date=? THEN di.quantity ELSE 0 END),0) AS total_qty,
      COUNT(DISTINCT CASE WHEN do.order_date=? THEN do.shop_id END) AS shop_count
    FROM daily_products p
    LEFT JOIN daily_order_items di ON di.product_id=p.id
    LEFT JOIN daily_orders do ON do.id=di.order_id${sf.clause}
    LEFT JOIN daily_categories c ON c.id=p.category_id LEFT JOIN daily_units un ON un.id=p.unit_id
    WHERE p.active=1`;
  const args = [date, date, ...sf.args];
  if (sc.catIds) { sql += ` AND p.category_id IN (${sc.catIds.map(() => '?').join(',')})`; args.push(...sc.catIds); }
  sql += ' GROUP BY p.id ORDER BY p.sort_order, p.name';
  res.json(db.prepare(sql).all(...args));
});

app.get('/api/daily/access/:uid', requireLogin, isAdmin, (req, res) => {
  const uid = Number(req.params.uid);
  res.json({
    categories: db.prepare('SELECT category_id FROM daily_cat_access WHERE user_id=?').all(uid).map(r => r.category_id),
    shops: db.prepare('SELECT shop_id FROM daily_shop_access WHERE user_id=?').all(uid).map(r => r.shop_id),
  });
});
app.put('/api/daily/access/:uid', requireLogin, isAdmin, (req, res) => {
  const uid = Number(req.params.uid);
  const b = req.body || {};
  db.transaction(() => {
    db.prepare('DELETE FROM daily_cat_access WHERE user_id=?').run(uid);
    db.prepare('DELETE FROM daily_shop_access WHERE user_id=?').run(uid);
    const ic = db.prepare('INSERT OR IGNORE INTO daily_cat_access (user_id, category_id) VALUES (?,?)');
    const is = db.prepare('INSERT OR IGNORE INTO daily_shop_access (user_id, shop_id) VALUES (?,?)');
    for (const c of (b.categories || [])) ic.run(uid, Number(c));
    for (const s of (b.shops || [])) is.run(uid, Number(s));
  })();
  res.json({ ok: true });
});
// Tracker: kin shops ka order aaya / kin ka baqi hai (department ke liye)
app.get('/api/daily/tracker', requireLogin, requireSection('daily', 'view'), (req, res) => {
  const sc = dailyScope(req);
  const date = req.query.date || dailyOrderDate();
  let shops;
  if (sc.shopId && sc.shopId > 0) shops = db.prepare('SELECT id, name FROM daily_shops WHERE id=?').all(sc.shopId);
  else if (sc.shopIds) shops = db.prepare(`SELECT id, name FROM daily_shops WHERE id IN (${sc.shopIds.map(() => '?').join(',')}) ORDER BY name`).all(...sc.shopIds);
  else shops = db.prepare('SELECT id, name FROM daily_shops WHERE active=1 ORDER BY name').all();
  const ord = db.prepare('SELECT created_at FROM daily_orders WHERE shop_id=? AND order_date=?');
  const nItems = db.prepare(`SELECT COUNT(*) c FROM daily_order_items
    WHERE order_id=(SELECT id FROM daily_orders WHERE shop_id=? AND order_date=?)`);
  const out = shops.map(s => {
    const o = ord.get(s.id, date);
    return { id: s.id, name: s.name, ordered: !!o, at: o ? o.created_at : null, items: o ? nItems.get(s.id, date).c : 0 };
  });
  res.json({ date, shops: out, received: out.filter(s => s.ordered).length, total: out.length });
});
app.put('/api/daily/settings', requireLogin, isAdmin, (req, res) => {
  const ct = String((req.body || {}).cutoff_time || '').trim();
  if (!/^\d{2}:\d{2}$/.test(ct)) return res.status(400).json({ error: 'bad_time' });
  db.prepare(`INSERT INTO daily_settings (key, value) VALUES ('cutoff_time', ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(ct);
  res.json({ ok: true, cutoff_time: ct });
});
// Per-shop product visibility (empty = all products visible)
app.get('/api/daily/shop-items/:shopId', requireLogin, isAdmin, (req, res) => {
  const rows = db.prepare('SELECT product_id FROM daily_shop_items WHERE shop_id=?').all(req.params.shopId);
  res.json(rows.map(r => r.product_id));
});
app.put('/api/daily/shop-items/:shopId', requireLogin, isAdmin, (req, res) => {
  const sid = Number(req.params.shopId);
  if (!db.prepare('SELECT id FROM daily_shops WHERE id=?').get(sid)) return res.status(400).json({ error: 'bad_shop' });
  const prods = (req.body || {}).products || [];
  db.transaction(() => {
    db.prepare('DELETE FROM daily_shop_items WHERE shop_id=?').run(sid);
    const ins = db.prepare('INSERT OR IGNORE INTO daily_shop_items (shop_id, product_id) VALUES (?,?)');
    const ok = db.prepare('SELECT 1 FROM daily_products WHERE id=?');
    for (const p of prods) { const pid = Number(p); if (pid > 0 && ok.get(pid)) ins.run(sid, pid); }
  })();
  res.json({ ok: true });
});

// ---------- Generic CRUD helper ----------
function cleanVals(table_cols, body) {
  return table_cols.map(c => {
    let v = (body || {})[c];
    if (v === undefined || v === null || v === '') {
      if (c === 'active') return 1;          // default active
      if (c.endsWith('_id')) return null;    // FK columns: null, not ''
      return '';
    }
    return v;
  });
}
function crud(path, table, section, cols, hooks) {
  app.get('/api/' + path, requireLogin, requireSection(section, 'view'), (req, res) => {
    res.json(db.prepare(`SELECT * FROM ${table} ORDER BY id DESC`).all());
  });
  app.post('/api/' + path, requireLogin, requireSection(section, 'full'), (req, res) => {
    const vals = cleanVals(cols, req.body);
    const r = db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...vals);
    if (hooks && hooks.afterWrite) hooks.afterWrite('create', r.lastInsertRowid, null);
    res.json({ ok: true, id: r.lastInsertRowid });
  });
  app.put('/api/' + path + '/:id', requireLogin, requireSection(section, 'full'), (req, res) => {
    const old = (hooks && hooks.needOld) ? db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(req.params.id) : null;
    const vals = cleanVals(cols, req.body);
    db.prepare(`UPDATE ${table} SET ${cols.map(c => `${c}=?`).join(',')} WHERE id=?`).run(...vals, req.params.id);
    if (hooks && hooks.afterWrite) hooks.afterWrite('update', req.params.id, old);
    res.json({ ok: true });
  });
  app.delete('/api/' + path + '/:id', requireLogin, requireSection(section, 'full'), (req, res) => {
    db.prepare(`DELETE FROM ${table} WHERE id=?`).run(req.params.id);
    res.json({ ok: true });
  });
}
crud('vehicles', 'vehicles', 'vehicles', ['name', 'plate', 'active']);
crud('routes', 'routes', 'routes', ['name', 'vehicle_id', 'supply_date', 'cutoff_date', 'cutoff_time', 'active'], {
  needOld: true,
  afterWrite(method, id, old) {
    const row = db.prepare('SELECT * FROM routes WHERE id=?').get(id);
    if (!row) return;
    const sched = `سپلائی: ${row.supply_date || '—'} | کٹ آف: ${row.cutoff_date || ''} ${row.cutoff_time || ''}`;
    if (method === 'create') {
      notifyAll('🚚 نیا روٹ', `${row.name} — ${sched}`);
    } else if (old) {
      const changed = [];
      if (String(old.supply_date || '') !== String(row.supply_date || '')) changed.push(`نئی سپلائی تاریخ: ${row.supply_date}`);
      if (String(old.cutoff_date || '') !== String(row.cutoff_date || '') || String(old.cutoff_time || '') !== String(row.cutoff_time || ''))
        changed.push(`نیا کٹ آف: ${row.cutoff_date} ${row.cutoff_time}`);
      if (changed.length) notifyAll('🚚 روٹ اپڈیٹ', `${row.name} — ${changed.join(' | ')}`);
    }
  }
});
crud('categories', 'categories', 'categories', ['name', 'sort']);
crud('units', 'units', 'units', ['name']);
crud('shops', 'shops', 'shops', ['name', 'phone', 'address', 'active']);
// ---------- Daily catalog management (fully separate from supply catalog) ----------
crud('daily-categories', 'daily_categories', 'daily', ['name', 'active']);
crud('daily-units', 'daily_units', 'daily', ['name']);
crud('daily-shops', 'daily_shops', 'daily', ['name', 'phone', 'address', 'active']);
app.get('/api/daily-products', requireLogin, requireSection('daily', 'view'), (req, res) => {
  res.json(db.prepare(`SELECT p.*, c.name AS category_name, u.name AS unit_name
    FROM daily_products p LEFT JOIN daily_categories c ON c.id=p.category_id LEFT JOIN daily_units u ON u.id=p.unit_id
    ORDER BY c.id, p.name`).all());
});
app.post('/api/daily-products', requireLogin, requireSection('daily', 'full'), (req, res) => {
  const b = req.body || {};
  const nm = (b.name || '').trim();
  if (!nm) return res.status(400).json({ error: 'name_required' });
  // Duplicate check: same name in same category
  const dup = db.prepare('SELECT id FROM daily_products WHERE TRIM(name)=? AND category_id IS ?')
    .get(nm, b.category_id || null);
  if (dup) return res.status(400).json({ error: 'duplicate', message: 'Ye item pehle se hai!' });
  const r = db.prepare('INSERT INTO daily_products (name, category_id, unit_id, active) VALUES (?,?,?,?)')
    .run(nm, b.category_id || null, b.unit_id || null, b.active ?? 1);
  res.json({ ok: true, id: r.lastInsertRowid });
});
app.put('/api/daily-products/:id', requireLogin, requireSection('daily', 'full'), (req, res) => {
  const b = req.body || {};
  const nm = (b.name || '').trim();
  if (!nm) return res.status(400).json({ error: 'name_required' });
  const dup = db.prepare('SELECT id FROM daily_products WHERE TRIM(name)=? AND category_id IS ? AND id != ?')
    .get(nm, b.category_id || null, req.params.id);
  if (dup) return res.status(400).json({ error: 'duplicate', message: 'Ye item pehle se hai!' });
  db.prepare('UPDATE daily_products SET name=?, category_id=?, unit_id=?, active=? WHERE id=?')
    .run(nm, b.category_id || null, b.unit_id || null, b.active ?? 1, req.params.id);
  res.json({ ok: true });
});
// Duplicates dhoondo
app.get('/api/daily-products/duplicates', requireLogin, requireSection('daily', 'full'), (req, res) => {
  const dups = db.prepare(`SELECT TRIM(name) as nm, category_id, COUNT(*) as cnt, GROUP_CONCAT(id) as ids
    FROM daily_products GROUP BY TRIM(name), category_id HAVING COUNT(*) > 1`).all();
  res.json(dups);
});
// Duplicates auto-clean: pehla rakho, baqi ko deactivate karo
app.post('/api/daily-products/clean-duplicates', requireLogin, requireSection('daily', 'full'), (req, res) => {
  const dups = db.prepare(`SELECT TRIM(name) as nm, category_id, GROUP_CONCAT(id) as ids
    FROM daily_products GROUP BY TRIM(name), category_id HAVING COUNT(*) > 1`).all();
  let cleaned = 0;
  dups.forEach(d => {
    const ids = d.ids.split(',').map(Number).sort((a,b) => a-b);
    // Pehla rakho, baqi ko deactivate
    const toDeactivate = ids.slice(1);
    toDeactivate.forEach(id => {
      db.prepare('UPDATE daily_products SET active=0 WHERE id=?').run(id);
      cleaned++;
    });
  });
  res.json({ ok: true, cleaned });
});
app.delete('/api/daily-products/:id', requireLogin, requireSection('daily', 'full'), (req, res) => {
  db.prepare('DELETE FROM daily_products WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});
// ---------- Daily: supply se select karke import (dobara type nahi karna) ----------
app.post('/api/daily/import/:kind', requireLogin, requireSection('daily', 'full'), (req, res) => {
  const kind = req.params.kind;
  const ids = ((req.body || {}).ids || []).map(Number).filter(n => n > 0);
  if (!ids.length) return res.status(400).json({ error: 'no_ids' });
  if (!['categories', 'units', 'products', 'shops'].includes(kind)) return res.status(400).json({ error: 'bad_kind' });
  const ph = ids.map(() => '?').join(',');
  db.transaction(() => {
    if (kind === 'categories') {
      db.prepare(`INSERT OR IGNORE INTO daily_categories (id, name) SELECT id, name FROM categories WHERE id IN (${ph})`).run(...ids);
    } else if (kind === 'units') {
      db.prepare(`INSERT OR IGNORE INTO daily_units (id, name) SELECT id, name FROM units WHERE id IN (${ph})`).run(...ids);
    } else if (kind === 'products') {
      // pehle unki categories/units bhi le aao taake link na toote
      db.prepare(`INSERT OR IGNORE INTO daily_categories (id, name) SELECT id, name FROM categories WHERE id IN (SELECT category_id FROM products WHERE id IN (${ph}))`).run(...ids);
      db.prepare(`INSERT OR IGNORE INTO daily_units (id, name) SELECT id, name FROM units WHERE id IN (SELECT unit_id FROM products WHERE id IN (${ph}))`).run(...ids);
      db.prepare(`INSERT OR IGNORE INTO daily_products (id, name, category_id, unit_id) SELECT id, name, category_id, unit_id FROM products WHERE id IN (${ph})`).run(...ids);
    } else if (kind === 'shops') {
      db.prepare(`INSERT OR IGNORE INTO daily_shops (id, name, phone, address, image, active)
        SELECT id, name, phone, address, image, active FROM shops WHERE id IN (${ph})`).run(...ids);
    }
  })();
  res.json({ ok: true });
});
// ---------- Daily: main screens se tick karke select (separate data me copy) ----------
app.post('/api/daily/toggle/:kind/:id', requireLogin, requireSection('daily', 'full'), (req, res) => {
  const kind = req.params.kind, id = Number(req.params.id), on = !!(req.body || {}).on;
  if (!['category', 'unit', 'product', 'shop'].includes(kind) || !id) return res.status(400).json({ error: 'bad_input' });
  try {
    db.transaction(() => {
      if (on) {
        if (kind === 'category') db.prepare(`INSERT OR IGNORE INTO daily_categories (id, name) SELECT id, name FROM categories WHERE id=?`).run(id);
        else if (kind === 'unit') db.prepare(`INSERT OR IGNORE INTO daily_units (id, name) SELECT id, name FROM units WHERE id=?`).run(id);
        else if (kind === 'shop') db.prepare(`INSERT OR IGNORE INTO daily_shops (id, name, phone, address, image, active) SELECT id, name, phone, address, image, active FROM shops WHERE id=?`).run(id);
        else if (kind === 'product') {
          const p = db.prepare('SELECT * FROM products WHERE id=?').get(id);
          if (!p) throw new Error('not_found');
          if (p.category_id) db.prepare(`INSERT OR IGNORE INTO daily_categories (id, name) SELECT id, name FROM categories WHERE id=?`).run(p.category_id);
          if (p.unit_id) db.prepare(`INSERT OR IGNORE INTO daily_units (id, name) SELECT id, name FROM units WHERE id=?`).run(p.unit_id);
          const mx = db.prepare('SELECT COALESCE(MAX(sort_order),0) m FROM daily_products').get().m;
          db.prepare(`INSERT OR IGNORE INTO daily_products (id, name, category_id, unit_id, sort_order) SELECT id, name, category_id, unit_id, ? FROM products WHERE id=?`).run(mx + 1, id);
        }
      } else {
        const tbl = { category: 'daily_categories', unit: 'daily_units', product: 'daily_products', shop: 'daily_shops' }[kind];
        db.prepare(`DELETE FROM ${tbl} WHERE id=?`).run(id);
      }
    })();
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message === 'not_found' ? 'not_found' : 'in_use' });
  }
});
// ---------- Daily: item sequence (↑↓) ----------
app.post('/api/daily/products/:id/move', requireLogin, requireSection('daily', 'full'), (req, res) => {
  const id = Number(req.params.id), dir = (req.body || {}).dir;
  if (!id || !['up', 'down'].includes(dir)) return res.status(400).json({ error: 'bad_input' });
  const cur = db.prepare('SELECT id, sort_order FROM daily_products WHERE id=?').get(id);
  if (!cur) return res.status(404).json({ error: 'not_found' });
  const neighbor = dir === 'up'
    ? db.prepare('SELECT id, sort_order FROM daily_products WHERE sort_order < ? ORDER BY sort_order DESC, id DESC LIMIT 1').get(cur.sort_order)
    : db.prepare('SELECT id, sort_order FROM daily_products WHERE sort_order > ? ORDER BY sort_order ASC, id ASC LIMIT 1').get(cur.sort_order);
  if (!neighbor) return res.json({ ok: true, moved: false });
  db.transaction(() => {
    db.prepare('UPDATE daily_products SET sort_order=? WHERE id=?').run(neighbor.sort_order, cur.id);
    db.prepare('UPDATE daily_products SET sort_order=? WHERE id=?').run(cur.sort_order, neighbor.id);
  })();
  res.json({ ok: true, moved: true });
});
app.post('/api/products/:id/move', requireLogin, requireSection('products', 'full'), (req, res) => {
  const id = Number(req.params.id), dir = (req.body || {}).dir;
  if (!id || !['up', 'down'].includes(dir)) return res.status(400).json({ error: 'bad_input' });
  const cur = db.prepare('SELECT id, sort_order FROM products WHERE id=?').get(id);
  if (!cur) return res.status(404).json({ error: 'not_found' });
  const neighbor = dir === 'up'
    ? db.prepare('SELECT id, sort_order FROM products WHERE sort_order < ? ORDER BY sort_order DESC, id DESC LIMIT 1').get(cur.sort_order)
    : db.prepare('SELECT id, sort_order FROM products WHERE sort_order > ? ORDER BY sort_order ASC, id ASC LIMIT 1').get(cur.sort_order);
  if (!neighbor) return res.json({ ok: true, moved: false });
  db.transaction(() => {
    db.prepare('UPDATE products SET sort_order=? WHERE id=?').run(neighbor.sort_order, cur.id);
    db.prepare('UPDATE products SET sort_order=? WHERE id=?').run(cur.sort_order, neighbor.id);
  })();
  res.json({ ok: true, moved: true });
});
app.get('/api/products', requireLogin, requireSection('products', 'view'), (req, res) => {
  res.json(db.prepare(`SELECT p.*, c.name AS category_name, u.name AS unit_name
    FROM products p LEFT JOIN categories c ON c.id=p.category_id LEFT JOIN units u ON u.id=p.unit_id
    ORDER BY c.sort, c.id, p.name`).all());
});
app.post('/api/products', requireLogin, requireSection('products', 'full'), (req, res) => {
  const b = req.body || {};
  const nm = (b.name || '').trim();
  if (!nm) return res.status(400).json({ error: 'name_required' });
  const dup = db.prepare('SELECT id FROM products WHERE TRIM(name)=? AND category_id IS ?').get(nm, b.category_id || null);
  if (dup) return res.status(400).json({ error: 'duplicate', message: 'Ye item pehle se hai!' });
  const r = db.prepare('INSERT INTO products (name, category_id, unit_id, active) VALUES (?,?,?,?)')
    .run(nm, b.category_id || null, b.unit_id || null, b.active ?? 1);
  res.json({ ok: true, id: r.lastInsertRowid });
});
app.put('/api/products/:id', requireLogin, requireSection('products', 'full'), (req, res) => {
  const b = req.body || {};
  const nm = (b.name || '').trim();
  if (!nm) return res.status(400).json({ error: 'name_required' });
  const dup = db.prepare('SELECT id FROM products WHERE TRIM(name)=? AND category_id IS ? AND id != ?').get(nm, b.category_id || null, req.params.id);
  if (dup) return res.status(400).json({ error: 'duplicate', message: 'Ye item pehle se hai!' });
  db.prepare('UPDATE products SET name=?, category_id=?, unit_id=?, active=? WHERE id=?')
    .run(nm, b.category_id || null, b.unit_id || null, b.active ?? 1, req.params.id);
  res.json({ ok: true });
});
app.post('/api/products/clean-duplicates', requireLogin, requireSection('products', 'full'), (req, res) => {
  const dups = db.prepare(`SELECT TRIM(name) as nm, category_id, GROUP_CONCAT(id) as ids
    FROM products GROUP BY TRIM(name), category_id HAVING COUNT(*) > 1`).all();
  let cleaned = 0;
  dups.forEach(d => {
    const ids = d.ids.split(',').map(Number).sort((a,b) => a-b);
    ids.slice(1).forEach(id => {
      db.prepare('UPDATE products SET active=0 WHERE id=?').run(id);
      cleaned++;
    });
  });
  res.json({ ok: true, cleaned });
});
app.delete('/api/products/:id', requireLogin, requireSection('products', 'full'), (req, res) => {
  db.prepare('DELETE FROM products WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- Users & permissions (super admin) ----------
app.get('/api/users', requireLogin, isAdmin, (req, res) => {
  const users = db.prepare(`SELECT u.id, u.username, u.role, u.shop_id, u.daily_shop_id, u.active, u.created_at, u.phone, u.account_type,
      COALESCE(s.name, ds.name) AS shop_name
    FROM users u LEFT JOIN shops s ON s.id=u.shop_id LEFT JOIN daily_shops ds ON ds.id=u.daily_shop_id ORDER BY u.id`).all();
  res.json(users.map(u => ({ ...u, permissions: u.role === 'super_admin' ? Object.fromEntries(SECTIONS.map(s => [s, 'full'])) : getPermissions(u.id) })));
});
// Public app version — clients detect updates against this.
app.get('/api/version', (req, res) => res.json({ version: require('./package.json').version }));
app.post('/api/users', requireLogin, isAdmin, (req, res) => {
  const { username, password, role, shop_id, daily_shop_id, phone, account_type } = req.body || {};
  if (!username || !password || !['super_admin', 'factory', 'shop'].includes(role)) return res.status(400).json({ error: 'bad_input' });
  const atype = String(account_type || '').trim().slice(0, 20);
  try {
    const r = db.prepare('INSERT INTO users (username, password_hash, role, shop_id, daily_shop_id, phone, account_type) VALUES (?,?,?,?,?,?,?)')
      .run(String(username).trim(), bcrypt.hashSync(String(password), 10), role, shop_id || null, daily_shop_id || null, String(phone || ''), atype);
    if (role !== 'super_admin') seedPermissions(r.lastInsertRowid, role);
    // department / supplier / viewer / vehicle: daily sirf view (kuch add/edit nahi)
    if (['department', 'supplier', 'viewer', 'vehicle'].includes(atype))
      db.prepare(`INSERT OR REPLACE INTO permissions (user_id, section, level) VALUES (?, 'daily', 'view')`).run(r.lastInsertRowid);
    // daily_shop: sirf daily, supply bilkul nahi
    if (atype === 'daily_shop') {
      const upd = db.prepare(`INSERT OR REPLACE INTO permissions (user_id, section, level) VALUES (?, ?, 'none')`);
      for (const sec of ['dashboard', 'orders', 'order_history', 'reports', 'shops', 'products', 'categories', 'units', 'vehicles', 'routes']) upd.run(r.lastInsertRowid, sec);
      db.prepare(`INSERT OR REPLACE INTO permissions (user_id, section, level) VALUES (?, 'daily', 'full')`).run(r.lastInsertRowid);
    }
    // shop (supply): daily bilkul nahi
    if (atype === 'shop') {
      db.prepare(`INSERT OR REPLACE INTO permissions (user_id, section, level) VALUES (?, 'daily', 'none')`).run(r.lastInsertRowid);
    }
    waAlert(`👤 نیا اکاؤنٹ: ${String(username).trim()} (${role}) بنایا گیا`);
    res.json({ ok: true, id: r.lastInsertRowid });
  } catch (e) { res.status(400).json({ error: 'username_taken' }); }
});
app.put('/api/users/:id', requireLogin, isAdmin, (req, res) => {
  const { role, shop_id, daily_shop_id, active, password, phone, account_type } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'not_found' });
  if (role) db.prepare('UPDATE users SET role=?, shop_id=?, daily_shop_id=? WHERE id=?').run(role, shop_id || null, daily_shop_id || null, u.id);
  if (active !== undefined) db.prepare('UPDATE users SET active=? WHERE id=?').run(active ? 1 : 0, u.id);
  if (password) db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(String(password), 10), u.id);
  if (phone !== undefined) db.prepare('UPDATE users SET phone=? WHERE id=?').run(String(phone), u.id);
  if (account_type !== undefined) db.prepare('UPDATE users SET account_type=? WHERE id=?').run(String(account_type).trim().slice(0, 20), u.id);
  res.json({ ok: true });
});
app.delete('/api/users/:id', requireLogin, isAdmin, (req, res) => {
  if (Number(req.params.id) === req.user.id) return res.status(400).json({ error: 'cannot_delete_self' });
  db.prepare('DELETE FROM users WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});
app.put('/api/users/:id/permissions', requireLogin, isAdmin, (req, res) => {
  const perms = (req.body || {}).permissions || {};
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!u || u.role === 'super_admin') return res.status(400).json({ error: 'bad_input' });
  const ins = db.prepare('INSERT OR REPLACE INTO permissions (user_id, section, level) VALUES (?,?,?)');
  for (const s of SECTIONS) {
    const lvl = perms[s];
    if (['none', 'view', 'full'].includes(lvl)) ins.run(u.id, s, lvl);
  }
  res.json({ ok: true });
});
app.get('/api/sections', requireLogin, (req, res) => res.json(SECTIONS));

// ---------- Cutoff helper (Asia/Karachi) ----------
function cutoffPassed(route) {
  if (!route || !route.cutoff_date) return false;
  const t = route.cutoff_time || '23:59';
  // interpret cutoff in Asia/Karachi
  const dt = new Date(`${route.cutoff_date}T${t}:00+05:00`);
  return Date.now() > dt.getTime();
}
function notOpenYet(route) {
  if (!route || !route.cutoff_date) return false;
  const t = route.open_time || appSetting('default_open_time') || '10:00';
  // ordering opens on the cutoff date at open_time (Asia/Karachi)
  const dt = new Date(`${route.cutoff_date}T${t}:00+05:00`);
  return Date.now() < dt.getTime();
}

// ---------- Orders ----------
app.get('/api/orders', requireLogin, requireSection('orders', 'view'), (req, res) => {
  const { date, route_id } = req.query;
  let sql = `SELECT o.*, s.name AS shop_name, s.image AS shop_image, r.name AS route_name FROM orders o
    JOIN shops s ON s.id=o.shop_id LEFT JOIN routes r ON r.id=o.route_id WHERE 1=1`;
  const args = [];
  const own = scopedShopId(req);
  if (own) { sql += ' AND o.shop_id=?'; args.push(own); }
  if (date) { sql += ' AND o.delivery_date=?'; args.push(date); }
  if (route_id) { sql += ' AND o.route_id=?'; args.push(route_id); }
  sql += ' ORDER BY o.delivery_date DESC, o.id DESC';
  const orders = db.prepare(sql).all(...args);
  const items = db.prepare(`SELECT oi.*, p.name AS product_name, u.name AS unit_name, c.name AS category_name
    FROM order_items oi JOIN products p ON p.id=oi.product_id
    LEFT JOIN units u ON u.id=p.unit_id LEFT JOIN categories c ON c.id=p.category_id
    WHERE oi.order_id=?`);
  res.json(orders.map(o => ({ ...o, items: items.all(o.id) })));
});
app.post('/api/orders', requireLogin, requireSection('orders', 'full'), (req, res) => {
  const b = req.body || {};
  let shop_id = b.shop_id;
  const own = scopedShopId(req);
  if (own) shop_id = own; // shop users can only order for themselves
  if (!shop_id || !b.delivery_date || !Array.isArray(b.items)) return res.status(400).json({ error: 'bad_input' });
  if (!b.route_id) return res.status(400).json({ error: 'route_required' }); // cutoff is per-route: route is mandatory
  const route = db.prepare('SELECT * FROM routes WHERE id=?').get(b.route_id);
  if (!route) return res.status(400).json({ error: 'route_required' });
  const override = req.user.role === 'super_admin' && b.override_cutoff;
  if (route && cutoffPassed(route) && !override) return res.status(400).json({ error: 'cutoff_passed' });
  if (route && notOpenYet(route) && !override) return res.status(400).json({ error: 'not_open_yet' });
  const ins = db.transaction(() => {
    const r = db.prepare('INSERT INTO orders (shop_id, route_id, delivery_date, note, created_by) VALUES (?,?,?,?,?)')
      .run(shop_id, b.route_id || null, b.delivery_date, b.note || '', req.user.id);
    const ii = db.prepare('INSERT INTO order_items (order_id, product_id, quantity) VALUES (?,?,?)');
    for (const it of b.items) {
      if (it.product_id && Number(it.quantity) > 0) ii.run(r.lastInsertRowid, it.product_id, Number(it.quantity));
    }
    return r.lastInsertRowid;
  });
  const orderId = ins();
  const itemCount = b.items.filter(it => it.product_id && Number(it.quantity) > 0).length;
  notifyNewOrder(orderId, shop_id, b.delivery_date, itemCount, req.user.id);
  res.json({ ok: true, id: orderId });
});
app.put('/api/orders/:id', requireLogin, requireSection('orders', 'full'), (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (!o) return res.status(404).json({ error: 'not_found' });
  const own = scopedShopId(req);
  if (own && o.shop_id !== own) return res.status(403).json({ error: 'forbidden' });
  const b = req.body || {};
  const route = b.route_id ? db.prepare('SELECT * FROM routes WHERE id=?').get(b.route_id) : null;
  const override = req.user.role === 'super_admin' && b.override_cutoff;
  if (route && cutoffPassed(route) && !override && req.user.role === 'shop') return res.status(400).json({ error: 'cutoff_passed' });
  if (route && notOpenYet(route) && !override && req.user.role === 'shop') return res.status(400).json({ error: 'not_open_yet' });
  db.transaction(() => {
    db.prepare('UPDATE orders SET route_id=?, delivery_date=?, note=? WHERE id=?')
      .run(b.route_id ?? o.route_id, b.delivery_date || o.delivery_date, b.note ?? o.note, o.id);
    if (Array.isArray(b.items)) {
      db.prepare('DELETE FROM order_items WHERE order_id=?').run(o.id);
      const ii = db.prepare('INSERT INTO order_items (order_id, product_id, quantity) VALUES (?,?,?)');
      for (const it of b.items) if (it.product_id && Number(it.quantity) > 0) ii.run(o.id, it.product_id, Number(it.quantity));
    }
  })();
  res.json({ ok: true });
});
app.delete('/api/orders/:id', requireLogin, requireSection('orders', 'full'), (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (!o) return res.status(404).json({ error: 'not_found' });
  const own = scopedShopId(req);
  if (own && o.shop_id !== own) return res.status(403).json({ error: 'forbidden' });
  db.prepare('DELETE FROM orders WHERE id=?').run(o.id);
  res.json({ ok: true });
});
// Shop order history grouped by delivery date (own only)
app.get('/api/order-history', requireLogin, requireSection('order_history', 'view'), (req, res) => {
  const own = scopedShopId(req);
  const shopFilter = own ? 'AND o.shop_id=' + own : (req.query.shop_id ? 'AND o.shop_id=' + Number(req.query.shop_id) : '');
  // Shop users: sirf itne din purana data
  let dateFilter = '';
  if (own) {
    const days = parseInt((db.prepare(`SELECT value FROM daily_settings WHERE key='shop_history_days'`).get() || {}).value || '30');
    const cutoff = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
    dateFilter = ` AND o.delivery_date >= '${cutoff}'`;
  }
  const orders = db.prepare(`SELECT o.*, s.name AS shop_name FROM orders o JOIN shops s ON s.id=o.shop_id
    WHERE 1=1 ${shopFilter}${dateFilter} ORDER BY o.delivery_date DESC, o.id DESC`).all();
  const items = db.prepare(`SELECT oi.*, p.name AS product_name, u.name AS unit_name FROM order_items oi
    JOIN products p ON p.id=oi.product_id LEFT JOIN units u ON u.id=p.unit_id WHERE oi.order_id=?`);
  const groups = {};
  for (const o of orders) {
    (groups[o.delivery_date] = groups[o.delivery_date] || []).push({ ...o, items: items.all(o.id) });
  }
  res.json(groups);
});
// Item-wise totals for production
app.get('/api/totals', requireLogin, requireSection('reports', 'view'), (req, res) => {
  const { date, route_id } = req.query;
  let f = 'WHERE 1=1'; const args = [];
  if (date) { f += ' AND o.delivery_date=?'; args.push(date); }
  if (route_id) { f += ' AND o.route_id=?'; args.push(route_id); }
  const rows = db.prepare(`SELECT p.id AS product_id, p.name AS product_name, c.name AS category_name, u.name AS unit_name,
      SUM(oi.quantity) AS total_qty, COUNT(DISTINCT o.shop_id) AS shop_count
    FROM order_items oi JOIN orders o ON o.id=oi.order_id JOIN products p ON p.id=oi.product_id
    LEFT JOIN categories c ON c.id=p.category_id LEFT JOIN units u ON u.id=p.unit_id
    ${f} GROUP BY p.id ORDER BY c.sort, c.id, p.name`).all(...args);
  res.json(rows);
});
app.get('/api/dashboard', requireLogin, requireSection('dashboard'), (req, res) => {
  const own = scopedShopId(req);
  const sf = own ? `AND shop_id=${own}` : '';
  const sfj = own ? `AND o.shop_id=${own}` : ''; // JOINed queries (orders+users both have shop_id)
  const today = new Date().toISOString().slice(0, 10);
  const ktoday = new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10); // Karachi date
  const shopName = own ? (db.prepare('SELECT name FROM shops WHERE id=?').get(own) || {}).name || '' : '';
  const upcoming = db.prepare(`SELECT r.*, v.name AS vehicle_name,
      (SELECT COUNT(*) FROM orders o WHERE o.route_id=r.id) AS order_count FROM routes r
      LEFT JOIN vehicles v ON v.id=r.vehicle_id
      WHERE r.active=1 AND r.supply_date > ? ORDER BY r.supply_date LIMIT 5`).all(ktoday);
  // Recent orders: scoped to the NEXT upcoming supply date (auto-refreshes when supply moves)
  const nextSupply = upcoming.length ? upcoming[0].supply_date : null;
  const recentDateFilter = nextSupply ? `o.delivery_date = '${nextSupply}'` : `o.delivery_date >= '${ktoday}'`;
  // Dashboard counts: today = created today (Karachi), upcoming = next supply date only
  const todayOrdersQ = db.prepare(`SELECT COUNT(*) c FROM orders WHERE date(created_at, '+5 hours') = date('now', '+5 hours') ${sf}`).get().c;
  const upcomingOrdersQ = nextSupply
    ? db.prepare(`SELECT COUNT(*) c FROM orders WHERE delivery_date = ? ${sf}`).get(nextSupply).c
    : db.prepare(`SELECT COUNT(*) c FROM orders WHERE delivery_date >= ? ${sf}`).get(ktoday).c;
  const dailyRows = db.prepare(`SELECT date(created_at, '+5 hours') d, COUNT(*) c FROM orders
    WHERE date(created_at, '+5 hours') >= date('now', '+5 hours', '-6 days') ${sf} GROUP BY d`).all();
  const daily = [];
  for (let i = 6; i >= 0; i--) {
    const key = new Date(Date.now() + 5 * 3600e3 - i * 864e5).toISOString().slice(0, 10);
    const r = dailyRows.find(x => x.d === key);
    daily.push(r ? r.c : 0);
  }
  res.json({
    scope: own ? 'shop' : 'admin',
    shop_name: shopName,
    daily,
    today_orders: todayOrdersQ,
    total_orders: upcomingOrdersQ,
    daily_today: db.prepare(`SELECT COUNT(*) c FROM daily_orders WHERE order_date=?`).get(dailyOrderDate()).c,
    daily_total: db.prepare(`SELECT COUNT(*) c FROM daily_orders`).get().c,
    shops: own ? undefined : db.prepare('SELECT COUNT(*) c FROM shops WHERE active=1').get().c,
    vehicles: own ? undefined : db.prepare('SELECT COUNT(*) c FROM vehicles WHERE active=1').get().c,
    routes: own ? undefined : db.prepare('SELECT COUNT(*) c FROM routes WHERE active=1').get().c,
    products: own ? undefined : db.prepare('SELECT COUNT(*) c FROM products WHERE active=1').get().c,
    users: own ? undefined : db.prepare('SELECT COUNT(*) c FROM users WHERE active=1').get().c,
    recent_orders: db.prepare(`SELECT o.id, o.created_at, o.delivery_date, s.name AS shop_name,
      s.image AS shop_image, u.username AS created_by, u.avatar AS user_avatar,
      (SELECT COUNT(*) FROM order_items WHERE order_id=o.id) AS items
      FROM orders o JOIN shops s ON s.id=o.shop_id LEFT JOIN users u ON u.id=o.created_by WHERE ${recentDateFilter} ${sfj} ORDER BY o.id DESC LIMIT 10`).all(),
    upcoming,
  });
});

// ---------- assetlinks (PWABuilder APK: net.alwaysdata.kashf.twa) ----------
app.get('/.well-known/assetlinks.json', (req, res) => {
  res.json([{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: 'net.alwaysdata.kashf.twa',
      sha256_cert_fingerprints: ['D5:15:E3:01:60:5D:D8:A3:C4:52:A8:AC:2C:1C:68:47:DD:53:78:DC:24:02:44:38:C7:F2:8B:02:C4:4E:3E:1E']
    }
  }]);
});

// ---------- Printable A4 sheets (server-rendered) ----------
// ?type=totals — item-wise production sheet (kul miqdar)
// ?type=shops  — shop-wise packing slips (har dukan alag A4 page)
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
app.get('/print', requireLogin, (req, res) => {
  const { date, route_id, type, shop_id } = req.query;
  const own = scopedShopId(req);
  const isHistory = type === 'shop_history' || type === 'date_history';
  if (isHistory) {
    if (!can(req.user, 'reports', 'view') && !can(req.user, 'order_history', 'view')) return res.status(403).send('forbidden');
  } else if (!can(req.user, 'reports', 'view')) return res.status(403).send('forbidden');
  const printBtn = `<br><button class="printbtn" onclick="window.print()" style="padding:10px 24px;font-size:16px">پرنٹ کریں</button>`;
  const css = `<style>
 @page{size:A4;margin:10mm} *{box-sizing:border-box}
 body{font-family:'Noto Nastaliq Urdu','Jameel Noori Nastaleeq',serif;direction:rtl;color:#111;margin:0;padding:10mm}
 .head{display:flex;align-items:center;gap:12px;border-bottom:3px solid #e8721c;padding-bottom:8px;margin-bottom:10px}
 .head img{height:64px} .head h1{margin:0;font-size:26px;color:#1a1a1a} .head h1 span{color:#e8721c}
 .meta{color:#2e7d32;font-size:14px;margin-bottom:8px}
 table{width:100%;border-collapse:collapse;font-size:14px;margin-bottom:14px}
 th{background:#1a1a1a;color:#fff;padding:6px} td{border:1px solid #999;padding:5px 8px}
 tr:nth-child(even) td{background:#fdf3e7}
 .catrow td{background:#e8721c !important;color:#fff;font-size:15px}
 .slip{break-inside:avoid}
 .slip h2.shopname{font-size:24px;color:#e8721c;margin:0 0 4px}
 .slip .smeta{color:#555;font-size:14px;margin-bottom:8px}
 .hdate{background:#1a1a1a;color:#fff;font-size:18px;padding:6px 14px;border-radius:8px;margin:16px 0 8px;break-after:avoid}
 .hshop{font-size:19px;color:#b3540e;margin:10px 0 4px;border-bottom:2px solid #e8721c;padding-bottom:2px;break-after:avoid}
 .sig{display:flex;justify-content:space-between;margin-top:26px;font-size:14px}
 .sig div{border-top:1px solid #333;padding-top:4px;width:40%;text-align:center}
 .note{background:#fdf3e7;border:1px dashed #e8721c;padding:6px 10px;margin:8px 0;font-size:13px}
 @media print{ .printbtn{display:none} .pagebreak{break-after:page} }
</style>`;
  // rozana print — DB settings se dynamic CSS
  function getPrintCss() {
    const g = k => (db.prepare(`SELECT value FROM daily_settings WHERE key=?`).get(k) || {}).value;
    const cols = g('print_cols') || '2';
    const titleSize = g('print_title_size') || '18';
    const titleBold = (g('print_title_bold') || '1') === '1' ? 'bold' : 'normal';
    const titleItalic = (g('print_title_italic') || '0') === '1' ? 'italic' : 'normal';
    const subSize = g('print_sub_size') || '10';
    const subBold = (g('print_sub_bold') || '1') === '1' ? 'bold' : 'normal';
    const catSize = g('print_cat_size') || '12';
    const catBold = (g('print_cat_bold') || '1') === '1' ? 'bold' : 'normal';
    const nameSize = g('print_name_size') || '10';
    const nameBold = (g('print_name_bold') || '1') === '1' ? 'bold' : 'normal';
    const numSize = g('print_num_size') || '11';
    const numBold = (g('print_num_bold') || '1') === '1' ? 'bold' : 'normal';
    const margin = g('print_margin') || '5';
    const fontFam = g('print_font') || 'Jameel Noori Nastaleeq';
    const gap = g('print_gap') || '6';
    return `<style> @page{size:A4 landscape;margin:5mm}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'${fontFam}','Jameel Noori Nastaleeq',serif;direction:rtl;padding:5mm;color:#111}
.phead{border-bottom:2px solid #e8721c;padding:0;margin:0;overflow:hidden}
.plogo{width:36px;height:36px;float:right;margin-left:10px}
.ptitle{font-size:${titleSize}px;font-weight:${titleBold};font-style:${titleItalic}}
.psub{font-size:${subSize}px;color:#e8721c;font-weight:${subBold}}
.pmeta{font-size:8px;color:#444;float:left;text-align:left}
.dcols{column-count:${cols};column-gap:${gap}px}
.cat-block{break-inside:avoid;margin-bottom:8px;border:1.5px solid #111;border-radius:4px;overflow:hidden;display:inline-block;width:100%}
.cat-head{background:#111;color:#fff;font-size:${catSize}px;font-weight:${catBold};text-align:center;padding:5px}
.cat-head .total{color:#ffb74d}
table{width:100%;border-collapse:collapse}
th{background:#e0e0e0;font-size:10px;padding:4px;border:1px solid #111}
td{padding:4px 6px;border:1px solid #666;font-size:${nameSize}px;font-weight:${nameBold}}
td.num{text-align:center;font-size:${numSize}px;font-weight:${numBold}}
.printbtn{position:fixed;top:10px;left:10px;z-index:99}
@media print{.printbtn{display:none}}</style>`;
  }
  const dcss = getPrintCss();
  const head = (title, extra) => `<div class="head"><img src="/logo.png" alt="logo"><div><h1>گلشن فیکٹری <span>Gulshan Factory</span></h1><div class="meta">${esc(title)}${extra ? ' — ' + esc(extra) : ''}</div></div></div>`;
  const itemsByOrder = db.prepare(`SELECT p.name AS product_name, u.name AS unit_name, oi.quantity
    FROM order_items oi JOIN products p ON p.id=oi.product_id LEFT JOIN units u ON u.id=p.unit_id WHERE oi.order_id=? ORDER BY p.name`);
  const orderTable = (o) => {
    const its = itemsByOrder.all(o.id);
    const rows = its.map((it, i) => `<tr><td>${i + 1}</td><td>${esc(it.product_name)}</td><td><b>${esc(it.quantity)} ${esc(it.unit_name || '')}</b></td></tr>`).join('')
      || '<tr><td colspan=3>کوئی آئٹم نہیں</td></tr>';
    return `<table><tr><th style="width:40px">#</th><th>آئٹم</th><th>مقدار</th></tr>${rows}</table>${o.note ? `<div class="note">نوٹ: ${esc(o.note)}</div>` : ''}`;
  };
  // ---------- shop-wise full order history (grouped by date) ----------
  if (type === 'shop_history') {
    const sid = own || parseInt(shop_id, 10) || 0;
    if (!sid) return res.status(400).send('shop_required');
    const shop = db.prepare('SELECT name FROM shops WHERE id=?').get(sid);
    if (!shop) return res.status(404).send('shop_not_found');
    const dates = db.prepare(`SELECT DISTINCT delivery_date FROM orders WHERE shop_id=? ORDER BY delivery_date DESC`).all(sid);
    const ordersByDate = db.prepare(`SELECT o.id, o.delivery_date, o.note, r.name AS route_name FROM orders o
      LEFT JOIN routes r ON r.id=o.route_id WHERE o.shop_id=? AND o.delivery_date=? ORDER BY o.id DESC`);
    const body = dates.map((d, di) => {
      const orders = ordersByDate.all(sid, d.delivery_date);
      return `<div class="hdate">📅 ${esc(d.delivery_date)}</div>` + orders.map((o, oi) =>
        `<div class="slip${(di < dates.length - 1 || oi < orders.length - 1) ? ' pagebreak' : ''}">
          <div class="hshop">🧾 آرڈر #${o.id} ${o.route_name ? '| روٹ: ' + esc(o.route_name) : ''}</div>
          ${orderTable(o)}
        </div>`).join('');
    }).join('');
    return res.send(`<!DOCTYPE html><html lang="ur" dir="rtl"><head><meta charset="utf-8"><title>آرڈر ہسٹری — ${esc(shop.name)}</title>${css}</head><body>
${head('دکان وائز آرڈر ہسٹری', shop.name)}${body || '<p>کوئی آرڈر نہیں</p>'}${printBtn}</body></html>`);
  }
  // ---------- date-wise order history (grouped by shop) ----------
  if (type === 'date_history') {
    if (!date) return res.status(400).send('date_required');
    const sf = own ? 'AND o.shop_id=' + own : '';
    const shops = db.prepare(`SELECT DISTINCT s.id, s.name FROM orders o JOIN shops s ON s.id=o.shop_id
      WHERE o.delivery_date=? ${sf} ORDER BY s.name`).all(date);
    const ordersByShop = db.prepare(`SELECT o.id, o.delivery_date, o.note, r.name AS route_name FROM orders o
      LEFT JOIN routes r ON r.id=o.route_id WHERE o.shop_id=? AND o.delivery_date=? ${sf} ORDER BY o.id DESC`);
    const body = shops.map((s, si) => {
      const orders = ordersByShop.all(s.id, date);
      return `<div class="hshop">🏪 ${esc(s.name)}</div>` + orders.map((o, oi) =>
        `<div class="slip${(si < shops.length - 1 || oi < orders.length - 1) ? ' pagebreak' : ''}">
          <div class="smeta">🧾 آرڈر #${o.id}${o.route_name ? ' | روٹ: ' + esc(o.route_name) : ''}</div>
          ${orderTable(o)}
        </div>`).join('');
    }).join('');
    return res.send(`<!DOCTYPE html><html lang="ur" dir="rtl"><head><meta charset="utf-8"><title>آرڈر ہسٹری — ${esc(date)}</title>${css}</head><body>
${head('تاریخ وائز آرڈر ہسٹری', 'تاریخ: ' + date)}${body || '<p>کوئی آرڈر نہیں</p>'}${printBtn}</body></html>`);
  }
  // ---------- DAILY: total production sheet (category-wise, scoped) ----------
  // ---------- DAILY: DEMAND DASHBOARD (RateVault pattern) ----------
  const ddCss = (() => {
    const g = k => (db.prepare(`SELECT value FROM daily_settings WHERE key=?`).get(k) || {}).value;
    const cols = g('print_cols') || '2';
    const gap = g('print_gap') || '6';
    const titleSize = g('print_title_size') || '18';
    const titleBold = (g('print_title_bold') || '1') === '1' ? 'bold' : 'normal';
    const titleItalic = (g('print_title_italic') || '0') === '1' ? 'italic' : 'normal';
    const subSize = g('print_sub_size') || '10';
    const subBold = (g('print_sub_bold') || '1') === '1' ? 'bold' : 'normal';
    const catSize = g('print_cat_size') || '12';
    const catBold = (g('print_cat_bold') || '1') === '1' ? 'bold' : 'normal';
    const nameSize = g('print_name_size') || '10';
    const nameBold = (g('print_name_bold') || '1') === '1' ? 'bold' : 'normal';
    const numSize = g('print_num_size') || '11';
    const numBold = (g('print_num_bold') || '1') === '1' ? 'bold' : 'normal';
    const fontFam = g('print_font') || 'Jameel Noori Nastaleeq';
    return `<style>
 @page{size:A4 landscape;margin:5mm} *{box-sizing:border-box;margin:0;padding:0}
 body{font-family:'${fontFam}','Jameel Noori Nastaleeq',serif;direction:rtl;color:#111;padding:5mm;font-size:15px}
 .phead{border-bottom:2px solid #e8721c;padding:0;margin:0;overflow:hidden}
 .plogo{width:36px;height:36px;float:right;margin-left:10px}
 .ptitle{font-size:${titleSize}px;font-weight:${titleBold};font-style:${titleItalic}}
 .psub{font-size:${subSize}px;color:#e8721c;font-weight:${subBold}}
 .pmeta{font-size:8px;color:#444;float:left;text-align:left}
 .dcols{column-count:${cols};column-gap:${gap}px;width:100%}
 .shopcols{column-count:2;column-gap:14px;width:100%;direction:rtl}
 .shopcols .cat-block td{padding:6px 8px;font-size:14px}
 .shopcols .cat-head{font-size:16px;padding:8px 4px}
 .shopcols .cat-block table{font-size:14px}
 .cat-block{break-inside:avoid;margin:0 0 8px;padding:0;border:1.5px solid #111;overflow:hidden}
 .cat-head{background:#111;color:#fff;text-align:center;font-size:16px;font-weight:bold;padding:8px 4px;font-family:'Jameel Noori Nastaleeq',serif}
 .cat-block table{width:100%;border-collapse:collapse;font-size:14px}
 .cat-block th{background:#ddd;border:1px solid #111;padding:3px;font-size:11px;font-family:Arial,sans-serif;font-weight:bold}
 .cat-block th.mid{font-size:12px}
 .cat-block th.total-h{color:#e8721c;text-align:center}
 .cat-block th.num-h{color:#555;text-align:center}
 .cat-block td{border:1px solid #888;padding:6px 8px}
 .cat-block tr:nth-child(even) td{background:#fafafa}
 .cat-block td.num{width:28px;text-align:center;color:#333;font-size:11px;font-weight:bold;background:#f0f0f0}
 .cat-block td.name{text-align:right}
 .cat-block td.total{width:44px;text-align:center;font-weight:bold;font-size:12px;background:#fff8f0}
 .shoptitle{text-align:center;font-size:24px;font-weight:bold;margin:0 0 8px;color:#fff;background:#111;padding:8px 4px;letter-spacing:.5px}
 .shoptitle .em{color:#e8721c}
 .shoppage{page-break-inside:avoid}
 .slip{break-inside:avoid;border:1.5px solid #111;margin:10px 0;padding:8px;page-break-before:always}
 .slip h2.shopname{font-size:20px;color:#e8721c;margin:0 0 4px;text-align:center}
 .slip table{width:100%;border-collapse:collapse;font-size:12px;margin:6px 0}
 .slip th{background:#111;color:#fff;padding:4px;font-size:12px}
 .slip td{border:1px solid #999;padding:3px 6px}
 .slip .catrow td{background:#e8721c !important;color:#fff;font-size:13px}
 .sig{display:flex;justify-content:space-between;margin-top:14px;font-size:11px}
 .sig div{border-top:1px solid #333;padding-top:4px;width:40%;text-align:center}
 .note{background:#fdf3e7;border:1px dashed #e8721c;padding:4px 8px;margin:6px 0;font-size:11px}
 .cat-block{break-inside:avoid;margin:0 0 8px;padding:0;border:1.5px solid #111;overflow:hidden;display:inline-block;width:100%}
 .cat-head{background:#111;color:#fff;text-align:center;font-size:${catSize}px;font-weight:${catBold};padding:3px;line-height:1.2}
 .cat-block table{width:100%;border-collapse:collapse}
 .cat-block th{background:#ddd;border:1px solid #111;padding:2px;font-size:10px;font-weight:bold;line-height:1.2}
 .cat-block td{border:1px solid #888;padding:1px 3px;font-size:${nameSize}px;font-weight:${nameBold};line-height:1.2}
 .cat-block td.num{width:24px;text-align:center;font-size:${numSize}px;font-weight:${numBold};background:#f0f0f0;line-height:1.2}
 .cat-block td.name{text-align:right}
 .cat-block td.total{width:50px;text-align:center;font-weight:bold;background:#fff8f0}
 @media print{ .printbtn{display:none} }
</style>`; })();

  // ========== NAYA PRINT SYSTEM (Complete Reset) ==========
  // Simple, clean, guaranteed 1-page A4 landscape
  function newPrintCss() {
    return `<style>
@page{size:A4 portrait;margin:5mm}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Jameel Noori Nastaleeq',serif;direction:rtl;color:#1a1a1a;padding:2mm;background:#fff}
.np-top{background:linear-gradient(135deg,#e8721c,#f0953a);color:#fff;border-radius:8px;padding:7px 14px;margin-bottom:6px;display:flex;align-items:center;justify-content:space-between}
.np-top .t1{font-size:19px;font-weight:900}
.np-top .t2{font-size:13px;opacity:.95}
.np-top .meta{font-size:11px;text-align:left;line-height:1.6;background:rgba(255,255,255,.2);padding:6px 12px;border-radius:8px}
.np-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;align-items:start}
.np-card{border:2px solid #e8721c;border-radius:10px;overflow:hidden;break-inside:avoid}
.np-cardhead{background:#1a1a1a;color:#fff;padding:8px 10px;font-size:16px;font-weight:900;display:flex;justify-content:space-between;align-items:center}
.np-cardhead .dt{background:#e8721c;color:#fff;font-size:10px;padding:2px 8px;border-radius:10px}
.np-card table{width:100%;border-collapse:collapse}
.np-card th{background:#fff3e6;color:#e8721c;font-size:10px;padding:4px;border-bottom:2px solid #e8721c}
.np-card td{padding:1px 5px;font-size:14px;font-weight:800;border-bottom:1px solid #f0e0cc;line-height:1.15}
.np-card td.n{text-align:center;width:26px;color:#999;font-size:10px}
.np-card td.t{text-align:center;width:48px;font-weight:900;font-size:16px;color:#d35400;background:#fff0dd}
.np-card tr:last-child td{border-bottom:none}
.np-btn{position:fixed;top:10px;left:10px;z-index:99;background:#e8721c;color:#fff;border:none;border-radius:8px;padding:12px 24px;font-size:16px;font-weight:bold;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.3)}
@media print{.np-btn{display:none}body{padding:0}}
</style>`;
  }
  function newPrintHead(ddate, username) {
    const now = new Date();
    const p = n => String(n).padStart(2,'0');
    const pd = `${p(now.getDate())}-${p(now.getMonth()+1)}-${now.getFullYear()} ${p(now.getHours())}:${p(now.getMinutes())}`;
    const M = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    const dp = String(ddate).split('-');
    const fd = dp.length===3 ? `${dp[2]} ${M[+dp[1]-1]} ${dp[0]}` : ddate;
    return `<div class="np-top"><div><div class="t1">🏭 گلشن فیکٹری</div><div class="t2">روزانہ ڈیمانڈ شیٹ</div></div><div class="meta">📅 ${fd}<br>👤 ${esc(username)}<br>🕐 ${pd}</div></div>`;
  }
  function newDemandBlocks(rows, ddate) {
    const cats = {}, order = [];
    rows.forEach(r => {
      const k = r.category_name || 'متفرق';
      if (!cats[k]) { cats[k] = []; order.push(k); }
      cats[k].push(r);
    });
    const want = ['بریڈ','ڈرائی','نمکین','فریش'];
    const sorted = [];
    want.forEach(w => { if (order.includes(w)) sorted.push(w); });
    order.forEach(o => { if (!sorted.includes(o)) sorted.push(o); });
    const M = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    const dp = String(ddate).split('-');
    const fd = dp.length===3 ? `${dp[2]} ${M[+dp[1]-1]} ${dp[0]}` : ddate;
    const icons = {'بریڈ':'🍞','ڈرائی':'🥜','نمکین':'🧂','فریش':'🥛'};
    return sorted.map(cn => {
      const total = cats[cn].reduce((a,r) => a + (+r.total_qty || 0), 0);
      const trs = cats[cn].map((r,i) =>
        `<tr><td class="n">${i+1}</td><td>${esc(r.product_name)}</td><td class="t">${esc(r.total_qty||0)}</td></tr>`).join('');
      return `<div class="np-card"><div class="np-cardhead"><span>${icons[cn]||'📦'} ${esc(cn)} (کل: ${total})</span><span class="dt">${fd}</span></div><table><tr><th>#</th><th>آئٹم</th><th>ٹوٹل</th></tr>${trs}</table></div>`;
    }).join('');
  }
  function newShopBlocks(shopName, rows, ddate) {
    const cats = {}, order = [];
    rows.forEach(r => {
      const k = r.category_name || 'متفرق';
      if (!cats[k]) { cats[k] = []; order.push(k); }
      cats[k].push(r);
    });
    const want = ['بریڈ','ڈرائی','نمکین','فریش'];
    const sorted = [];
    want.forEach(w => { if (order.includes(w)) sorted.push(w); });
    order.forEach(o => { if (!sorted.includes(o)) sorted.push(o); });
    const M = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    const dp = String(ddate).split('-');
    const fd = dp.length===3 ? `${dp[2]} ${M[+dp[1]-1]} ${dp[0]}` : ddate;
    return sorted.map(cn => {
      const trs = cats[cn].map((r,i) =>
        `<tr><td class="n">${i+1}</td><td>${esc(r.product_name)}</td><td class="t">${r.qty != null ? esc(r.qty) : 0}</td></tr>`).join('');
      return `<div class="np-card"><div class="np-cardhead"><span>📦 ${esc(cn)}</span><span class="dt">${fd}</span></div><table><tr><th>#</th><th>${esc(shopName)}</th><th>مقدار</th></tr>${trs}</table></div>`;
    }).join('');
  }
  // ========== END NAYA PRINT SYSTEM ==========

  function printHead(ddate, username) {
    const now = new Date();
    const pd = String(now.getDate()).padStart(2, '0') + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + now.getFullYear();
    const pt = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    return `<div class="phead"><img src="/logo.png" class="plogo"><div class="pmeta">📅 ${fmtD(ddate)} | 👤 ${esc(username)} | 🕐 ${pd} ${pt}</div><div class="ptitle">گلشن فیکٹری</div><div class="psub">روزانہ ڈیمانڈ شیٹ</div></div>`;
  }
  const fmtD = d => { const M = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']; const p = String(d).split('-'); return p.length === 3 ? `${p[2]} ${M[Number(p[1]) - 1]} ${p[0]}` : d; };
  // category blocks builder (RateVault pattern) — rows: [{product_name, total_qty}]
  function demandBlocks(rows, ddate) {
    const cats = {}, order = [];
    rows.forEach(r => { const k = r.category_name || 'متفرق'; if (!cats[k]) { cats[k] = []; order.push(k); } cats[k].push(r); });
    // Custom category order from settings
    try {
      const co = db.prepare(`SELECT value FROM daily_settings WHERE key='print_cat_order'`).get();
      if (co && co.value) {
        const customOrder = JSON.parse(co.value);
        order.sort((a, b) => {
          const ia = customOrder.indexOf(a), ib = customOrder.indexOf(b);
          return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
        });
      }
    } catch(e) {}
    // 2x2 layout: [Bread, Namkeen, Dry, Fresh] -> HTML: [Bread, Dry, Namkeen, Fresh]
    // taake column 1 me Bread+Dry, column 2 me Namkeen+Fresh aaye
    let printOrder = order;
    try {
      const cols = db.prepare(`SELECT value FROM daily_settings WHERE key='print_cols'`).get();
      if ((cols && cols.value || '2') === '2' && order.length === 4) {
        printOrder = [order[0], order[2], order[1], order[3]];
      }
    } catch(e) {}
    const dstr = fmtD(ddate);
    return printOrder.map(cn => {
      const trs = cats[cn].map((r, i) =>
        `<tr><td class="num">${i + 1}</td><td class="name">${esc(r.product_name)}</td><td class="total">${esc(r.total_qty || 0)}</td></tr>`).join('');
      return `<div class="cat-block"><div class="cat-head">${esc(cn)} — <span dir="ltr">${dstr}</span></div>
        <table><tr><th class="num-h">#</th><th>آئٹم</th><th class="total-h">ٹوٹل</th></tr>${trs}</table></div>`;
    }).join('');
  }
  // shop RateVault blocks — rows: [{product_name, category_name, qty}], header: CATEGORY — DATE, mid col: shop name, left: QTY
  function shopDemandBlocks(shopName, rows, ddate) {
    const cats = {}, order = [];
    rows.forEach(r => { const k = r.category_name || 'متفرق'; if (!cats[k]) { cats[k] = []; order.push(k); } cats[k].push(r); });
    const dstr = fmtD(ddate);
    return order.map(cn => {
      const trs = cats[cn].map((r, i) =>
        `<tr><td class="num">${i + 1}</td><td class="name">${esc(r.product_name)}</td><td class="total">${r.qty != null ? esc(r.qty) : ''}</td></tr>`).join('');
      return `<div class="cat-block"><div class="cat-head">${esc(cn)} — <span dir="ltr">${dstr}</span></div>
        <table><tr><th class="num-h">#S</th><th class="mid">${esc(shopName)}</th><th class="total-h">QTY</th></tr>${trs}</table></div>`;
    }).join('');
  }
  if (type === 'daily_total') {
    if (!can(req.user, 'daily', 'view')) return res.status(403).send('forbidden');
    const sc = dailyScope(req);
    const ddate = date || dailyOrderDate();
    const sf = dailyShopFilter(sc, 'do');
    let sql = `SELECT p.name AS product_name, c.name AS category_name,
        COALESCE(SUM(CASE WHEN do.order_date=? THEN di.quantity ELSE 0 END), 0) AS total_qty
      FROM daily_products p
      LEFT JOIN daily_order_items di ON di.product_id=p.id
      LEFT JOIN daily_orders do ON do.id=di.order_id${sf.clause}
      LEFT JOIN daily_categories c ON c.id=p.category_id
      WHERE p.active=1`;
    const args = [ddate, ...sf.args];
    if (sc.catIds) { sql += ` AND p.category_id IN (${sc.catIds.map(() => '?').join(',')})`; args.push(...sc.catIds); }
    sql += ' GROUP BY p.id ORDER BY p.sort_order, p.name';
    const rows = db.prepare(sql).all(...args);
    const blocks = newDemandBlocks(rows, ddate);
    return res.send(`<!DOCTYPE html><html lang="ur" dir="rtl"><head><meta charset="utf-8"><title>روزانہ ڈیمانڈ شیٹ — ${esc(ddate)}</title>${newPrintCss()}</head><body>
${newPrintHead(ddate, req.user.username)}
<div class="np-grid">${blocks || '<p>کوئی آئٹم نہیں</p>'}</div><button class="np-btn" onclick="window.print()">🖨 پرنٹ</button></body></html>`);
  }
  // ---------- DAILY: per-shop (RateVault pattern) ----------
  if (type === 'daily_shop') {
    if (!can(req.user, 'daily', 'view')) return res.status(403).send('forbidden');
    const sc = dailyScope(req);
    const ddate = date || dailyOrderDate();
    const sidParam = sc.shopId ? String(sc.shopId) : (shop_id || '');
    let shops = [];
    if (sc.shopId) {
      const s = db.prepare('SELECT id, name FROM daily_shops WHERE id=?').get(sc.shopId);
      if (s) shops = [s];
    } else if (!sidParam || sidParam === 'all') {
      shops = db.prepare(`SELECT id, name FROM daily_shops WHERE active=1${sc.shopIds ? ` AND id IN (${sc.shopIds.map(() => '?').join(',')})` : ''} ORDER BY name`).all(...(sc.shopIds || []));
    } else {
      const sid = Number(sidParam);
      if (sc.shopIds && !sc.shopIds.includes(sid)) return res.status(403).send('forbidden');
      const s = db.prepare('SELECT id, name FROM daily_shops WHERE id=?').get(sid);
      if (!s) return res.status(404).send('shop_not_found');
      shops = [s];
    }
    if (!shops.length) return res.status(404).send('shop_not_found');
    const allProds = db.prepare(`SELECT p.id, p.name AS product_name, c.name AS category_name
      FROM daily_products p LEFT JOIN daily_categories c ON c.id=p.category_id
      WHERE p.active=1${sc.catIds ? ` AND p.category_id IN (${sc.catIds.map(() => '?').join(',')})` : ''}
      ORDER BY p.sort_order, p.name`).all(...(sc.catIds || []));
    const pages = shops.map((shop, si) => {
      const o = db.prepare('SELECT id, note FROM daily_orders WHERE shop_id=? AND order_date=?').get(shop.id, ddate);
      const qtyMap = {};
      if (o) db.prepare('SELECT product_id, quantity FROM daily_order_items WHERE order_id=?').all(o.id).forEach(r => { qtyMap[r.product_id] = r.quantity; });
      const rows = allProds.map(p => ({ product_name: p.product_name, category_name: p.category_name, qty: qtyMap[p.id] }));
      const blocks = newShopBlocks(shop.name, rows, ddate);
      const note = o && o.note ? `<div style="background:#fdf3e7;border:1px dashed #e8721c;padding:4px;margin:4px 0">نوٹ: ${esc(o.note)}</div>` : '';
      return `<div${si > 0 ? ' style="page-break-before:always"' : ''}>${newPrintHead(ddate, req.user.username)}
        <div style="text-align:center;font-size:18px;font-weight:900;margin:4px 0;color:#fff;background:#111;padding:6px">🏪 ${esc(shop.name)}</div>
        <div class="np-grid">${blocks || '<p>کوئی آئٹم نہیں</p>'}</div>${note}</div>`;
    }).join('');
    return res.send(`<!DOCTYPE html><html lang="ur" dir="rtl"><head><meta charset="utf-8"><title>روزانہ سلپ — ${esc(ddate)}</title>${newPrintCss()}</head><body>${pages}<button class="np-btn" onclick="window.print()">🖨 پرنٹ</button></body></html>`);
  }

  // ---------- DAILY: per-shop (RateVault pattern) ----------
  if (type === 'daily_shop') {
    if (!can(req.user, 'daily', 'view')) return res.status(403).send('forbidden');
    const sc = dailyScope(req);
    const ddate = date || dailyOrderDate();
    const sidParam = sc.shopId ? String(sc.shopId) : (shop_id || '');
    let shops = [];
    if (sc.shopId) {
      const s = db.prepare('SELECT id, name FROM daily_shops WHERE id=?').get(sc.shopId);
      if (s) shops = [s];
    } else if (!sidParam || sidParam === 'all') {
      shops = db.prepare(`SELECT id, name FROM daily_shops WHERE active=1${sc.shopIds ? ` AND id IN (${sc.shopIds.map(() => '?').join(',')})` : ''} ORDER BY name`).all(...(sc.shopIds || []));
    } else {
      const sid = Number(sidParam);
      if (sc.shopIds && !sc.shopIds.includes(sid)) return res.status(403).send('forbidden');
      const s = db.prepare('SELECT id, name FROM daily_shops WHERE id=?').get(sid);
      if (!s) return res.status(404).send('shop_not_found');
      shops = [s];
    }
    if (!shops.length) return res.status(404).send('shop_not_found');
    const allProds = db.prepare(`SELECT p.id, p.name AS product_name, c.name AS category_name
      FROM daily_products p LEFT JOIN daily_categories c ON c.id=p.category_id
      WHERE p.active=1${sc.catIds ? ` AND p.category_id IN (${sc.catIds.map(() => '?').join(',')})` : ''}
      ORDER BY p.sort_order, p.name`).all(...(sc.catIds || []));
    const pages = shops.map((shop, si) => {
      const o = db.prepare('SELECT id, note FROM daily_orders WHERE shop_id=? AND order_date=?').get(shop.id, ddate);
      const qtyMap = {};
      if (o) db.prepare('SELECT product_id, quantity FROM daily_order_items WHERE order_id=?').all(o.id).forEach(r => { qtyMap[r.product_id] = r.quantity; });
      const rows = allProds.map(p => ({ product_name: p.product_name, category_name: p.category_name, qty: qtyMap[p.id] }));
      const blocks = shopDemandBlocks(shop.name, rows, ddate);
      const note = o && o.note ? `<div class="note">نوٹ: ${esc(o.note)}</div>` : '';
      return `<div class="shoppage"${si > 0 ? ' style="page-break-before:always"' : ''}>${printHead(ddate, req.user.username)}
        <div class="shoptitle"><span class="em">🏪</span> ${esc(shop.name)}</div>
        <div class="dcols shopcols">${blocks || '<p>کوئی آئٹم نہیں</p>'}</div>${note}</div>`;
    }).join('');
    return res.send(`<!DOCTYPE html><html lang="ur" dir="rtl"><head><meta charset="utf-8"><title>روزانہ سلپ — ${esc(ddate)}</title>${ddCss}</head><body>${pages}${printBtn}</body></html>`);
  }
  // ---------- DAILY: sab kuch ek saath (کل پیداوار + تمام دکانوں کی سلپس) ----------
  // ---------- Item catalog print (category-wise) ----------
  if (type === 'catalog') {
    if (!can(req.user, 'products', 'view')) return res.status(403).send('forbidden');
    const prods = db.prepare(`SELECT p.name AS product_name, c.name AS category_name, un.name AS unit_name
      FROM products p LEFT JOIN categories c ON c.id=p.category_id LEFT JOIN units un ON un.id=p.unit_id
      WHERE p.active=1 ORDER BY c.name, p.name`).all();
    const cats = {}, order = [];
    prods.forEach(r => {
      const k = r.category_name || 'متفرق';
      if (!cats[k]) { cats[k] = []; order.push(k); }
      cats[k].push(r);
    });
    const blocks = order.map(cn => {
      const trs = cats[cn].map((r,i) =>
        `<tr><td class="n">${i+1}</td><td>${esc(r.product_name)}</td><td class="t">${esc(r.unit_name || '—')}</td></tr>`).join('');
      return `<div class="np-card"><div class="np-cardhead"><span>📂 ${esc(cn)} (${cats[cn].length})</span></div><table><tr><th>#</th><th>آئٹم</th><th>یونٹ</th></tr>${trs}</table></div>`;
    }).join('');
    return res.send(`<!DOCTYPE html><html lang="ur" dir="rtl"><head><meta charset="utf-8"><title>آئٹم کیٹلاگ</title>${newPrintCss()}</head><body>
${newPrintHead('catalog', req.user.username)}
<div class="np-grid">${blocks}</div><button class="np-btn" onclick="window.print()">🖨 پرنٹ</button></body></html>`);
  }
  if (type === 'daily_all') {
    if (!can(req.user, 'daily', 'view')) return res.status(403).send('forbidden');
    const sc = dailyScope(req);
    const ddate = date || dailyOrderDate();
    const sf = dailyShopFilter(sc, 'do');
    // Totals — tamam active items (DEMAND DASHBOARD pattern)
    let tsql = `SELECT p.name AS product_name, c.name AS category_name,
        COALESCE(SUM(CASE WHEN do.order_date=? THEN di.quantity ELSE 0 END), 0) AS total_qty
      FROM daily_products p
      LEFT JOIN daily_order_items di ON di.product_id=p.id
      LEFT JOIN daily_orders do ON do.id=di.order_id${sf.clause}
      LEFT JOIN daily_categories c ON c.id=p.category_id
      WHERE p.active=1`;
    const targs = [ddate, ...sf.args];
    if (sc.catIds) { tsql += ` AND p.category_id IN (${sc.catIds.map(() => '?').join(',')})`; targs.push(...sc.catIds); }
    tsql += ' GROUP BY p.id ORDER BY p.sort_order, p.name';
    const trows = db.prepare(tsql).all(...targs);
    const totBody = newDemandBlocks(trows, ddate);
    // Per-shop slips — SAARE active shops (order ho ya na ho)
    let allShops = db.prepare(`SELECT id AS shop_id, name AS shop_name FROM daily_shops WHERE active=1${sc.shopIds ? ` AND id IN (${sc.shopIds.map(() => '?').join(',')})` : ''} ORDER BY name`).all(...(sc.shopIds || []));
    let orders = allShops.map(sh => {
      const o = db.prepare(`SELECT id, note FROM daily_orders WHERE shop_id=? AND order_date=?`).get(sh.shop_id, ddate);
      return { id: o ? o.id : null, shop_id: sh.shop_id, note: o ? o.note : null, shop_name: sh.shop_name };
    });
    // Custom shop print order
    try {
      const so = db.prepare(`SELECT value FROM daily_settings WHERE key='print_shop_order'`).get();
      if (so && so.value) {
        const shopOrder = JSON.parse(so.value);
        orders.sort((a, b) => {
          const ia = shopOrder.indexOf(a.shop_name), ib = shopOrder.indexOf(b.shop_name);
          return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
        });
      }
    } catch(e) {}
    const allProds = db.prepare(`SELECT p.id, p.name AS product_name, c.name AS category_name
      FROM daily_products p LEFT JOIN daily_categories c ON c.id=p.category_id
      WHERE p.active=1${sc.catIds ? ` AND p.category_id IN (${sc.catIds.map(() => '?').join(',')})` : ''}
      ORDER BY p.sort_order, p.name`).all(...(sc.catIds || []));
    const qByOrder = db.prepare('SELECT product_id, quantity FROM daily_order_items WHERE order_id=?');
    const slips = orders.map(o => {
      const qtyMap = {};
      if (o.id) qByOrder.all(o.id).forEach(r => { qtyMap[r.product_id] = r.quantity; });
      const rows = allProds.map(pp => ({ product_name: pp.product_name, category_name: pp.category_name, qty: qtyMap[pp.id] }));
      const blocks = newShopBlocks(o.shop_name, rows, ddate);
      return `<div style="page-break-before:always">${newPrintHead(ddate, req.user.username)}
        <div style="text-align:center;font-size:18px;font-weight:900;margin:4px 0;color:#fff;background:#111;padding:6px">🏪 ${esc(o.shop_name)}</div>
        <div class="np-grid">${blocks || '<p>کوئی آئٹم نہیں</p>'}</div>
        ${o.note ? `<div style="background:#fdf3e7;border:1px dashed #e8721c;padding:4px;margin:4px 0">نوٹ: ${esc(o.note)}</div>` : ''}</div>`;
    }).join('');
    return res.send(`<!DOCTYPE html><html lang="ur" dir="rtl"><head><meta charset="utf-8"><title>روزانہ مکمل — ${esc(ddate)}</title>${newPrintCss()}</head><body>
${newPrintHead(ddate, req.user.username)}
<div class="np-grid">${totBody || '<p>کوئی آئٹم نہیں</p>'}</div>${slips}<button class="np-btn" onclick="window.print()">🖨 پرنٹ</button></body></html>`);
  }
  const mode = type === 'shops' ? 'shops' : 'totals';
  let f = 'WHERE 1=1'; const args = [];
  if (date) { f += ' AND o.delivery_date=?'; args.push(date); }
  if (route_id) { f += ' AND o.route_id=?'; args.push(route_id); }
  const routeName = route_id ? (db.prepare('SELECT name FROM routes WHERE id=?').get(route_id) || {}).name : 'تمام روٹس';
  const dateLabel = date || 'تمام';
  if (mode === 'shops') {
    const orders = db.prepare(`SELECT o.id, o.delivery_date, o.note, s.name AS shop_name, r.name AS route_name FROM orders o
      JOIN shops s ON s.id=o.shop_id LEFT JOIN routes r ON r.id=o.route_id ${f} ORDER BY s.name`).all(...args);
    const slips = orders.map((o, idx) => {
      const its = itemsByOrder.all(o.id);
      const rows = its.map((it, i) => `<tr><td>${i + 1}</td><td>${esc(it.product_name)}</td><td><b>${esc(it.quantity)} ${esc(it.unit_name || '')}</b></td></tr>`).join('')
        || '<tr><td colspan=4>کوئی آئٹم نہیں</td></tr>';
      return `<div class="slip${idx < orders.length - 1 ? ' pagebreak' : ''}">
        ${head('ڈیلیوری سلپ', 'تاریخ: ' + dateLabel + ' | روٹ: ' + routeName)}
        <h2 class="shopname">${esc(o.shop_name)}</h2>
        <div class="smeta">تاریخ: ${esc(o.delivery_date)} | روٹ: ${esc(o.route_name || '—')}</div>
        <table><tr><th>#</th><th>آئٹم</th><th>مقدار</th></tr>${rows}</table>
        ${o.note ? `<div class="note">نوٹ: ${esc(o.note)}</div>` : ''}
        <div class="sig"><div>فیکٹری (دستخط)</div><div>وصول کنندہ (دستخط)</div></div>
      </div>`;
    }).join('');
    return res.send(`<!DOCTYPE html><html lang="ur" dir="rtl"><head><meta charset="utf-8"><title>دکان وائز سلپس — گلشن فیکٹری</title>${css}</head><body>${slips || '<p>کوئی آرڈر نہیں</p>'}${printBtn}</body></html>`);
  }
  const totals = db.prepare(`SELECT p.name AS product_name, c.name AS category_name, u.name AS unit_name, SUM(oi.quantity) AS total_qty,
      COUNT(DISTINCT o.shop_id) AS shop_count
    FROM order_items oi JOIN orders o ON o.id=oi.order_id JOIN products p ON p.id=oi.product_id
    LEFT JOIN categories c ON c.id=p.category_id LEFT JOIN units u ON u.id=p.unit_id
    ${f} GROUP BY p.id ORDER BY c.sort, c.id, p.name`).all(...args);
  const rows = totals.map(t => `<tr><td>${esc(t.category_name || '')}</td><td>${esc(t.product_name)}</td><td><b>${esc(t.total_qty)} ${esc(t.unit_name || '')}</b></td><td>${t.shop_count} دکان</td></tr>`).join('');
  res.send(`<!DOCTYPE html><html lang="ur" dir="rtl"><head><meta charset="utf-8"><title>پروڈکشن شیٹ — گلشن فیکٹری</title>${css}</head><body>
${head('پروڈکشن شیٹ — آئٹم وائز کل مقدار', 'تاریخ: ' + dateLabel + ' | روٹ: ' + routeName)}
<table><tr><th>کیٹیگری</th><th>آئٹم</th><th>کل مقدار</th><th>دکانیں</th></tr>${rows || '<tr><td colspan=4>کوئی آرڈر نہیں</td></tr>'}</table>
${printBtn}</body></html>`);
});

app.use(express.static(path.join(__dirname, 'public'), {
  // Frontend files (app.js etc.) hamesha fresh — purana cache masla khatam
  setHeaders(res, filePath) {
    if (/\.(js|css|html)$/.test(filePath)) res.set('Cache-Control', 'no-cache');
  }
}));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`Gulshan Factory online on :${PORT}`));
