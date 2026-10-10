// ===== Home-screen widget endpoints (widget.js) =====
// Prototype for Oct 2026 widget plan: real Android widgets need a native app,
// but generic Play-Store widget apps ("Web Widget for Android", "Widgetify")
// can show any website URL on the home screen. These endpoints give each
// user a secret, login-free URL: /widget/<token> — a compact auto-refreshing
// page scoped to that user's own data. The phone needs only: install the
// widget app, add widget, paste URL. No Android Studio, no builds, no keys.
const crypto = require('crypto');

function tokenTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS widget_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token TEXT UNIQUE NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id)
  )`);
}

function fmtCountdown(ms) {
  if (ms <= 0) return 'ختم';
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60), mm = m % 60;
  return h > 0 ? `${h} گھنٹے ${mm} منٹ` : `${mm} منٹ`;
}

// Next upcoming supply day (regular supply flow): date, cutoff, order count
function nextSupply(db, khiNow) {
  const ktoday = khiNow().toISOString().slice(0, 10);
  const row = db.prepare(`SELECT id, supply_date, cutoff_date, cutoff_time FROM routes
    WHERE active=1 AND supply_date >= ? ORDER BY supply_date LIMIT 1`).get(ktoday);
  if (!row) return null;
  const cnt = db.prepare(`SELECT COUNT(*) c FROM orders WHERE route_id=?`).get(row.id).c;
  return { date: row.supply_date, orders: cnt, cutoff: row.cutoff_time || null, cutoff_date: row.cutoff_date || null };
}

function dailyTracker(db, helpers, shopIds) {
  const date = helpers.dailyOrderDate();
  let shops;
  if (shopIds && shopIds.length) {
    shops = db.prepare(`SELECT id, name FROM daily_shops WHERE id IN (${shopIds.map(() => '?').join(',')}) ORDER BY name`).all(...shopIds);
  } else {
    shops = db.prepare(`SELECT id, name FROM daily_shops WHERE active=1 ORDER BY name`).all();
  }
  const hasOrder = db.prepare(`SELECT 1 FROM daily_orders WHERE shop_id=? AND order_date=?`);
  const received = shops.filter(s => hasOrder.get(s.id, date)).length;
  return { date, received, total: shops.length };
}

function cutoffCountdown(helpers) {
  if (helpers.dailyCutoffPassed()) return { text: 'آج کا کٹ آف ختم', ms: 0 };
  const now = helpers.khiNow();
  const { h, m } = helpers.dailyCutoffTime().split(':').map(Number);
  const cut = new Date(now); cut.setUTCHours(h || 20, m || 0, 0, 0);
  return { text: fmtCountdown(cut - now) + ' باقی', ms: cut - now };
}

function catTotals(db, helpers, sc) {
  const date = helpers.dailyOrderDate();
  const sf = helpers.dailyShopFilter(sc, 'do');
  let sql = `SELECT p.name AS n, c.name AS cat, un.name AS unit,
      COALESCE(SUM(CASE WHEN do.order_date=? THEN di.quantity ELSE 0 END),0) AS q
    FROM daily_products p
    LEFT JOIN daily_order_items di ON di.product_id=p.id
    LEFT JOIN daily_orders do ON do.id=di.order_id${sf.clause}
    LEFT JOIN daily_categories c ON c.id=p.category_id
    LEFT JOIN daily_units un ON un.id=p.unit_id
    WHERE p.active=1`;
  const args = [date, ...sf.args];
  if (sc.catIds) { sql += ` AND p.category_id IN (${sc.catIds.map(() => '?').join(',')})`; args.push(...sc.catIds); }
  sql += ' GROUP BY p.id HAVING q>0 ORDER BY c.name, p.sort_order, p.name';
  return db.prepare(sql).all(...args);
}

function page(title, body, refreshSecs = 900) {
  return `<!DOCTYPE html><html lang="ur" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="${refreshSecs}">
<title>${title}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Noto Nastaliq Urdu','Jameel Noori Nastaleeq',system-ui,sans-serif;
 background:linear-gradient(135deg,#1e1b4b 0%,#312e81 45%,#0e7490 100%);
 color:#f5f3ff;padding:12px;min-height:100vh}
.card{background:rgba(255,255,255,.07);
 -webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);
 border:1px solid rgba(212,175,55,.5);border-radius:20px;
 box-shadow:0 8px 32px rgba(0,0,0,.4),inset 0 1px 0 rgba(255,255,255,.12);
 padding:14px 16px;margin-bottom:10px;position:relative;overflow:hidden}
.card::before{content:'';position:absolute;top:-40px;left:-40px;width:120px;height:120px;
 background:radial-gradient(circle,rgba(212,175,55,.25),transparent 70%);pointer-events:none}
.head{display:flex;align-items:center;gap:10px;margin-bottom:8px;position:relative}
.head .logo{width:40px;height:40px;border-radius:50%;
 background:linear-gradient(135deg,#d4af37,#f7e08b);color:#1e1b4b;
 display:flex;align-items:center;justify-content:center;font-weight:700;font-size:20px;
 box-shadow:0 2px 12px rgba(212,175,55,.55)}
.head h1{font-size:18px;color:#ffffff} .head h1 span{color:#f5d67b}
.sub{font-size:12px;color:#c4b5fd}
.big{font-size:32px;font-weight:700;
 background:linear-gradient(135deg,#fde68a,#d4af37);
 -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.big small{font-size:13px;font-weight:400;color:#c4b5fd;-webkit-text-fill-color:#c4b5fd}
.ok{color:#4ade80;font-weight:700} .warn{color:#fbbf24;font-weight:700} .bad{color:#f87171;font-weight:700}
.row{display:flex;justify-content:space-between;align-items:center;padding:7px 2px;
 border-bottom:1px dashed rgba(196,181,253,.25);font-size:14px;color:#ede9fe}
.row:last-child{border-bottom:none}
.count{font-weight:700;color:#f5d67b}
.foot{font-size:11px;color:#a78bfa;text-align:center;margin-top:8px}
</style></head><body>
<div class="card"><div class="head"><div class="logo">گ</div>
<div><h1>گلشن <span>فیکٹری</span></h1><div class="sub">${title}</div></div></div>
${body}
<div class="foot">🔄 خودکار تازہ کاری</div></div>
</body></html>`;
}

function registerWidget(app, db, H) {
  tokenTable(db);

  // ---- admin: generate / list / revoke tokens ----
  app.get('/api/widget-tokens', H.requireLogin, H.isAdmin, (req, res) => {
    res.json(db.prepare(`SELECT wt.id, wt.token, wt.created_at, u.username, u.role, u.account_type
      FROM widget_tokens wt JOIN users u ON u.id=wt.user_id ORDER BY wt.id DESC`).all());
  });
  app.post('/api/widget-tokens', H.requireLogin, H.isAdmin, (req, res) => {
    const uid = Number((req.body || {}).user_id);
    const u = db.prepare('SELECT id, username FROM users WHERE id=?').get(uid);
    if (!u) return res.status(400).json({ error: 'bad_user' });
    const token = crypto.randomBytes(24).toString('base64url');
    db.prepare(`INSERT INTO widget_tokens (user_id, token) VALUES (?,?)
      ON CONFLICT(user_id) DO UPDATE SET token=excluded.token, created_at=datetime('now')`).run(uid, token);
    res.json({ ok: true, token, url: '/widget/' + token });
  });
  app.delete('/api/widget-tokens/:id', H.requireLogin, H.isAdmin, (req, res) => {
    db.prepare('DELETE FROM widget_tokens WHERE id=?').run(Number(req.params.id));
    res.json({ ok: true });
  });

  // ---- the public widget page ----
  app.get('/widget/:token', (req, res) => {
    const t = db.prepare(`SELECT u.* FROM widget_tokens wt JOIN users u ON u.id=wt.user_id
      WHERE wt.token=? AND u.active=1`).get(String(req.params.token || ''));
    if (!t) return res.status(404).send('غلط لنک');
    const u = t; const date = H.dailyOrderDate();
    const fakeReq = { user: u };
    let body = '';

    if (u.role === 'super_admin' || (u.role === 'factory' && !u.account_type)) {
      const tr = dailyTracker(db, H, null);
      const cc = cutoffCountdown(H);
      const ns = nextSupply(db, H.khiNow);
      const pct = tr.total ? Math.round(tr.received * 100 / tr.total) : 0;
      body = `<div class="big">${tr.received}<small> / ${tr.total} دکانوں کا آرڈر</small></div>
        <div class="sub">روزانہ آرڈر (${date}) — ${pct}%</div><br>
        <div class="row"><span>⏰ کٹ آف</span><span class="${cc.ms > 0 ? 'warn' : 'bad'}">${cc.text}</span></div>
        ${ns ? `<div class="row"><span>🚚 اگلی سپلائی (${ns.date})</span><span class="count">${ns.orders} آرڈر</span></div>` : `<div class="row"><span>🚚 اگلی سپلائی</span><span>اعلان باقی</span></div>`}`;
      return res.send(page('ایڈمن ویجٹ', body));
    }

    if (u.role === 'shop' && u.daily_shop_id) {
      const s = db.prepare('SELECT name FROM daily_shops WHERE id=?').get(u.daily_shop_id);
      const ord = db.prepare('SELECT id, created_at FROM daily_orders WHERE shop_id=? AND order_date=?').get(u.daily_shop_id, date);
      const cc = cutoffCountdown(H);
      const st = ord ? `<span class="ok">✅ ہو گیا</span>` : `<span class="warn">⏳ ابھی باقی</span>`;
      body = `<div class="big">${H.esc((s || {}).name || '')}</div>
        <div class="sub">آج کا روزانہ آرڈر (${date}): ${st}</div><br>
        <div class="row"><span>⏰ کٹ آف</span><span class="${cc.ms > 0 ? 'warn' : 'bad'}">${cc.text}</span></div>
        <div class="row"><span>📦 آئٹمز</span><span class="count">${ord ? db.prepare('SELECT COUNT(*) c FROM daily_order_items WHERE order_id=?').get(ord.id).c : 0}</span></div>`;
      return res.send(page('دکان ویجٹ', body));
    }

    // supplier / vehicle: assigned shops status (before dept check — role is 'factory')
    if (u.account_type === 'supplier' || u.account_type === 'vehicle') {
      const rows = db.prepare('SELECT shop_id FROM supplier_shops WHERE user_id=?').all(u.id);
      const shopIds = rows.map(r => r.shop_id);
      const tr = dailyTracker(db, H, shopIds.length ? shopIds : [-1]);
      const hasOrder = db.prepare('SELECT 1 FROM daily_orders WHERE shop_id=? AND order_date=?');
      const names = (shopIds.length
        ? db.prepare(`SELECT id, name FROM daily_shops WHERE id IN (${shopIds.map(() => '?').join(',')})`).all(...shopIds)
        : []);
      const list = names.map(s => `<div class="row"><span>${H.esc(s.name)}</span><span class="${hasOrder.get(s.id, date) ? 'ok' : 'warn'}">${hasOrder.get(s.id, date) ? '✅' : '⏳'}</span></div>`).join('');
      body = `<div class="big">${tr.received}<small> / ${tr.total} دکانیں</small></div>
        <div class="sub">آج کے آرڈر (${date})</div><br>${list || '<div class="sub">کوئی دکان منسلک نہیں</div>'}`;
      return res.send(page(u.account_type === 'vehicle' ? 'ڈرائیور ویجٹ' : 'سپلائر ویجٹ', body));
    }

    // department (category viewer) or any daily-view user with category access
    const sc = H.dailyScope(fakeReq);
    if (sc.catIds || u.role === 'factory') {
      const items = catTotals(db, H, sc);
      const tr = dailyTracker(db, H, sc.shopIds);
      const cc = cutoffCountdown(H);
      const top = items.slice(0, 8).map(i =>
        `<div class="row"><span>${H.esc(i.n)} <small>(${H.esc(i.cat || '')})</small></span><span class="count">${i.q} ${H.esc(i.unit || '')}</span></div>`).join('');
      body = `<div class="big">${tr.received}<small> / ${tr.total} دکانوں کا آرڈر</small></div>
        <div class="sub">روزانہ پیداوار (${date}) — کٹ آف: ${cc.text}</div><br>${top || '<div class="sub">ابھی کوئی آرڈر نہیں</div>'}`;
      return res.send(page('ڈیپارٹمنٹ ویجٹ', body));
    }

    // fallback: generic shop-status view
    body = '<div class="sub">اس اکاؤنٹ کے لیے ویجٹ ترتیب نہیں ہے</div>';
    return res.send(page('ویجٹ', body));
  });
}

module.exports = { registerWidget, tokenTable };
