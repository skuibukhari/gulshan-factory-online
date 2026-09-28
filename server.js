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
`);

const SECTIONS = ['dashboard','orders','order_history','shops','products','categories','units','vehicles','routes','schedule','reports','users'];

const DEFAULT_PERMS = {
  factory: { dashboard:'full', orders:'full', order_history:'full', shops:'view', products:'view', categories:'view', units:'view', vehicles:'view', routes:'view', schedule:'full', reports:'full', users:'none' },
  shop:    { dashboard:'view', orders:'full', order_history:'view', shops:'none', products:'none', categories:'none', units:'none', vehicles:'none', routes:'none', schedule:'view', reports:'none', users:'none' },
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
  return p;
}

// ---------- App ----------
const app = express();
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
  const u = db.prepare('SELECT id, username, role, shop_id, active FROM users WHERE id=?').get(req.session.userId);
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
  const u = db.prepare('SELECT * FROM users WHERE username=? AND active=1').get(String(username || '').trim());
  if (!u || !bcrypt.compareSync(String(password || ''), u.password_hash)) return res.status(401).json({ error: 'bad_credentials' });
  req.session.userId = u.id;
  res.json({ ok: true });
});
app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/api/me', requireLogin, (req, res) => {
  const shop = req.user.shop_id ? db.prepare('SELECT id, name FROM shops WHERE id=?').get(req.user.shop_id) : null;
  res.json({ id: req.user.id, username: req.user.username, role: req.user.role, shop_id: req.user.shop_id, shop_name: shop ? shop.name : null, permissions: req.user.role === 'super_admin' ? Object.fromEntries(SECTIONS.map(s => [s, 'full'])) : getPermissions(req.user.id) });
});

// Catalog needed to place an order: active categories, products and routes.
// Any user who may place orders can read it (ordering must not depend on catalog-management permissions).
app.get('/api/order-catalog', requireLogin, requireSection('orders', 'view'), (req, res) => {
  const cats = db.prepare('SELECT id, name FROM categories ORDER BY sort, name').all();
  const products = db.prepare(`SELECT p.id, p.name, p.category_id, u.name AS unit_name
    FROM products p LEFT JOIN units u ON u.id = p.unit_id WHERE p.active = 1 ORDER BY p.name`).all();
  const routes = db.prepare('SELECT id, name, supply_date, cutoff_date, cutoff_time FROM routes WHERE active = 1 ORDER BY id DESC').all();
  res.json({ cats, products, routes });
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
function crud(path, table, section, cols) {
  app.get('/api/' + path, requireLogin, requireSection(section, 'view'), (req, res) => {
    res.json(db.prepare(`SELECT * FROM ${table} ORDER BY id DESC`).all());
  });
  app.post('/api/' + path, requireLogin, requireSection(section, 'full'), (req, res) => {
    const vals = cleanVals(cols, req.body);
    const r = db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...vals);
    res.json({ ok: true, id: r.lastInsertRowid });
  });
  app.put('/api/' + path + '/:id', requireLogin, requireSection(section, 'full'), (req, res) => {
    const vals = cleanVals(cols, req.body);
    db.prepare(`UPDATE ${table} SET ${cols.map(c => `${c}=?`).join(',')} WHERE id=?`).run(...vals, req.params.id);
    res.json({ ok: true });
  });
  app.delete('/api/' + path + '/:id', requireLogin, requireSection(section, 'full'), (req, res) => {
    db.prepare(`DELETE FROM ${table} WHERE id=?`).run(req.params.id);
    res.json({ ok: true });
  });
}
crud('vehicles', 'vehicles', 'vehicles', ['name', 'plate', 'active']);
crud('routes', 'routes', 'routes', ['name', 'vehicle_id', 'supply_date', 'cutoff_date', 'cutoff_time', 'active']);
crud('categories', 'categories', 'categories', ['name', 'sort']);
crud('units', 'units', 'units', ['name']);
crud('shops', 'shops', 'shops', ['name', 'phone', 'address', 'active']);
app.get('/api/products', requireLogin, requireSection('products', 'view'), (req, res) => {
  res.json(db.prepare(`SELECT p.*, c.name AS category_name, u.name AS unit_name
    FROM products p LEFT JOIN categories c ON c.id=p.category_id LEFT JOIN units u ON u.id=p.unit_id
    ORDER BY c.sort, c.id, p.name`).all());
});
app.post('/api/products', requireLogin, requireSection('products', 'full'), (req, res) => {
  const b = req.body || {};
  const r = db.prepare('INSERT INTO products (name, category_id, unit_id, active) VALUES (?,?,?,?)')
    .run(b.name || '', b.category_id || null, b.unit_id || null, b.active ?? 1);
  res.json({ ok: true, id: r.lastInsertRowid });
});
app.put('/api/products/:id', requireLogin, requireSection('products', 'full'), (req, res) => {
  const b = req.body || {};
  db.prepare('UPDATE products SET name=?, category_id=?, unit_id=?, active=? WHERE id=?')
    .run(b.name || '', b.category_id || null, b.unit_id || null, b.active ?? 1, req.params.id);
  res.json({ ok: true });
});
app.delete('/api/products/:id', requireLogin, requireSection('products', 'full'), (req, res) => {
  db.prepare('DELETE FROM products WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- Users & permissions (super admin) ----------
app.get('/api/users', requireLogin, isAdmin, (req, res) => {
  const users = db.prepare(`SELECT u.id, u.username, u.role, u.shop_id, u.active, u.created_at, s.name AS shop_name
    FROM users u LEFT JOIN shops s ON s.id=u.shop_id ORDER BY u.id`).all();
  res.json(users.map(u => ({ ...u, permissions: u.role === 'super_admin' ? Object.fromEntries(SECTIONS.map(s => [s, 'full'])) : getPermissions(u.id) })));
});
app.post('/api/users', requireLogin, isAdmin, (req, res) => {
  const { username, password, role, shop_id } = req.body || {};
  if (!username || !password || !['super_admin', 'factory', 'shop'].includes(role)) return res.status(400).json({ error: 'bad_input' });
  try {
    const r = db.prepare('INSERT INTO users (username, password_hash, role, shop_id) VALUES (?,?,?,?)')
      .run(String(username).trim(), bcrypt.hashSync(String(password), 10), role, shop_id || null);
    if (role !== 'super_admin') seedPermissions(r.lastInsertRowid, role);
    res.json({ ok: true, id: r.lastInsertRowid });
  } catch (e) { res.status(400).json({ error: 'username_taken' }); }
});
app.put('/api/users/:id', requireLogin, isAdmin, (req, res) => {
  const { role, shop_id, active, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'not_found' });
  if (role) db.prepare('UPDATE users SET role=?, shop_id=? WHERE id=?').run(role, shop_id || null, u.id);
  if (active !== undefined) db.prepare('UPDATE users SET active=? WHERE id=?').run(active ? 1 : 0, u.id);
  if (password) db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(String(password), 10), u.id);
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

// ---------- Orders ----------
app.get('/api/orders', requireLogin, requireSection('orders', 'view'), (req, res) => {
  const { date, route_id } = req.query;
  let sql = `SELECT o.*, s.name AS shop_name, r.name AS route_name FROM orders o
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
  const route = b.route_id ? db.prepare('SELECT * FROM routes WHERE id=?').get(b.route_id) : null;
  const override = req.user.role === 'super_admin' && b.override_cutoff;
  if (route && cutoffPassed(route) && !override) return res.status(400).json({ error: 'cutoff_passed' });
  const ins = db.transaction(() => {
    const r = db.prepare('INSERT INTO orders (shop_id, route_id, delivery_date, note, created_by) VALUES (?,?,?,?,?)')
      .run(shop_id, b.route_id || null, b.delivery_date, b.note || '', req.user.id);
    const ii = db.prepare('INSERT INTO order_items (order_id, product_id, quantity) VALUES (?,?,?)');
    for (const it of b.items) {
      if (it.product_id && Number(it.quantity) > 0) ii.run(r.lastInsertRowid, it.product_id, Number(it.quantity));
    }
    return r.lastInsertRowid;
  });
  res.json({ ok: true, id: ins() });
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
  const orders = db.prepare(`SELECT o.*, s.name AS shop_name FROM orders o JOIN shops s ON s.id=o.shop_id
    WHERE 1=1 ${shopFilter} ORDER BY o.delivery_date DESC, o.id DESC`).all();
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
  const today = new Date().toISOString().slice(0, 10);
  const shopName = own ? (db.prepare('SELECT name FROM shops WHERE id=?').get(own) || {}).name || '' : '';
  const upcoming = own
    ? db.prepare(`SELECT DISTINCT r.*, v.name AS vehicle_name FROM routes r
        LEFT JOIN vehicles v ON v.id=r.vehicle_id
        JOIN orders o ON o.route_id=r.id AND o.shop_id=?
        WHERE r.active=1 ORDER BY r.supply_date LIMIT 5`).all(own)
    : db.prepare(`SELECT r.*, v.name AS vehicle_name FROM routes r LEFT JOIN vehicles v ON v.id=r.vehicle_id
        WHERE r.active=1 ORDER BY r.supply_date LIMIT 5`).all();
  res.json({
    scope: own ? 'shop' : 'admin',
    shop_name: shopName,
    today_orders: db.prepare(`SELECT COUNT(*) c FROM orders WHERE delivery_date=? ${sf}`).get(today).c,
    total_orders: db.prepare(`SELECT COUNT(*) c FROM orders WHERE 1=1 ${sf}`).get().c,
    shops: own ? undefined : db.prepare('SELECT COUNT(*) c FROM shops WHERE active=1').get().c,
    vehicles: own ? undefined : db.prepare('SELECT COUNT(*) c FROM vehicles WHERE active=1').get().c,
    routes: own ? undefined : db.prepare('SELECT COUNT(*) c FROM routes WHERE active=1').get().c,
    products: own ? undefined : db.prepare('SELECT COUNT(*) c FROM products WHERE active=1').get().c,
    upcoming,
  });
});

// ---------- Printable A4 production sheet (server-rendered) ----------
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
app.get('/print', requireLogin, (req, res) => {
  if (!can(req.user, 'reports', 'view')) return res.status(403).send('forbidden');
  const { date, route_id } = req.query;
  let f = 'WHERE 1=1'; const args = [];
  if (date) { f += ' AND o.delivery_date=?'; args.push(date); }
  if (route_id) { f += ' AND o.route_id=?'; args.push(route_id); }
  const totals = db.prepare(`SELECT p.name AS product_name, c.name AS category_name, u.name AS unit_name, SUM(oi.quantity) AS total_qty
    FROM order_items oi JOIN orders o ON o.id=oi.order_id JOIN products p ON p.id=oi.product_id
    LEFT JOIN categories c ON c.id=p.category_id LEFT JOIN units u ON u.id=p.unit_id
    ${f} GROUP BY p.id ORDER BY c.sort, c.id, p.name`).all(...args);
  const orders = db.prepare(`SELECT o.id, o.delivery_date, s.name AS shop_name, r.name AS route_name FROM orders o
    JOIN shops s ON s.id=o.shop_id LEFT JOIN routes r ON r.id=o.route_id ${f} ORDER BY s.name`).all(...args);
  const itemsByOrder = db.prepare(`SELECT oi.order_id, p.name AS product_name, u.name AS unit_name, oi.quantity
    FROM order_items oi JOIN products p ON p.id=oi.product_id LEFT JOIN units u ON u.id=p.unit_id WHERE oi.order_id=?`);
  const routeName = route_id ? (db.prepare('SELECT name FROM routes WHERE id=?').get(route_id) || {}).name : 'تمام روٹس';
  const rows = totals.map(t => `<tr><td>${esc(t.category_name || '')}</td><td>${esc(t.product_name)}</td><td>${esc(t.total_qty)} ${esc(t.unit_name || '')}</td></tr>`).join('');
  const shopBlocks = orders.map(o => {
    const its = itemsByOrder.all(o.id).map(i => `<div class="si"><span>${esc(i.product_name)}</span><b>${esc(i.quantity)} ${esc(i.unit_name || '')}</b></div>`).join('');
    return `<div class="shop"><h3>${esc(o.shop_name)} <small>${esc(o.delivery_date)}</small></h3>${its}</div>`;
  }).join('');
  res.send(`<!DOCTYPE html><html lang="ur" dir="rtl"><head><meta charset="utf-8"><title>پروڈکشن شیٹ — گلشن فیکٹری</title>
<style>
 @page{size:A4;margin:10mm} *{box-sizing:border-box}
 body{font-family:'Noto Nastaliq Urdu','Jameel Noori Nastaleeq',serif;direction:rtl;color:#111;margin:0;padding:10mm}
 .head{display:flex;align-items:center;gap:12px;border-bottom:3px solid #e8721c;padding-bottom:8px;margin-bottom:10px}
 .head img{height:64px} .head h1{margin:0;font-size:26px;color:#1a1a1a} .head h1 span{color:#e8721c}
 .meta{color:#2e7d32;font-size:14px;margin-bottom:8px}
 table{width:100%;border-collapse:collapse;font-size:14px;margin-bottom:14px}
 th{background:#1a1a1a;color:#fff;padding:6px} td{border:1px solid #999;padding:5px 8px}
 tr:nth-child(even) td{background:#fdf3e7}
 .shop{break-inside:avoid;border:1px solid #ccc;border-radius:6px;padding:6px 10px;margin-bottom:8px}
 .shop h3{margin:0 0 4px;font-size:15px;color:#e8721c} .shop h3 small{color:#555}
 .si{display:flex;justify-content:space-between;font-size:13px;border-top:1px dotted #ccc;padding:2px 0}
 .nb{display:none} @media print{.nb{display:none} .printbtn{display:none}}
</style></head><body>
<div class="head"><img src="/logo.png" alt="logo"><div><h1>گلشن فیکٹری <span>Gulshan Factory</span></h1><div class="meta">پروڈکشن شیٹ — تاریخ: ${esc(date || 'تمام')} | روٹ: ${esc(routeName)}</div></div></div>
<h2 style="color:#2e7d32">آئٹم وائز کل مقدار</h2>
<table><tr><th>کیٹیگری</th><th>آئٹم</th><th>کل مقدار</th></tr>${rows || '<tr><td colspan=3>کوئی آرڈر نہیں</td></tr>'}</table>
<h2 style="color:#2e7d32">دکان وائز آرڈر</h2>${shopBlocks || '<p>کوئی آرڈر نہیں</p>'}
<br><button class="printbtn" onclick="window.print()" style="padding:10px 24px;font-size:16px">پرنٹ کریں</button>
</body></html>`);
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`Gulshan Factory online on :${PORT}`));
