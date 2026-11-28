// Спільне замовлення кави: сервер без залежностей (Node 18+).
// Зберігає стан у JSON-файлі, віддає фронтенд і API.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseProduct } = require('./lib/parse');

const PORT = Number(process.env.PORT || 2345);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'data.json');
// Із яких сайтів дозволено підтягувати товари (підрядок у hostname). Захист від SSRF.
const ALLOWED_HOSTS = (process.env.ALLOWED_HOSTS || 'madheads').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const INDEX = path.join(__dirname, 'public', 'index.html');

fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
let db = { orders: {} };
try { db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { /* перший запуск */ }

// Нова пошта: публічні довідники працюють і без ключа; NP_API_KEY — за бажанням.
async function novaPoshta(calledMethod, methodProperties) {
  const r = await fetch('https://api.novaposhta.ua/v2.0/json/', {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(8000),
    body: JSON.stringify({ apiKey: process.env.NP_API_KEY || '', modelName: 'AddressGeneral', calledMethod, methodProperties }),
  });
  const j = await r.json();
  if (!j.success) throw new Error((j.errors || []).join('; ') || 'Нова пошта не відповідає');
  return j.data || [];
}

let saving = false, dirty = false;
function save() {
  if (saving) { dirty = true; return; }
  saving = true;
  const tmp = DATA_FILE + '.tmp';
  fs.writeFile(tmp, JSON.stringify(db), err => {
    if (!err) fs.rename(tmp, DATA_FILE, () => done()); else done();
  });
  function done() { saving = false; if (dirty) { dirty = false; save(); } }
}

const rid = n => crypto.randomBytes(n).toString('base64url');
const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const num = (v, d = 0) => { const x = Number(String(v).replace(',', '.')); return Number.isFinite(x) ? x : d; };

function publicOrder(o, token, isAdmin) {
  return {
    id: o.id, title: o.title, organizer: o.organizer, address: o.address, np: o.np || null,
    payment: o.payment, minPacks: o.minPacks, shipping: o.shipping, currency: o.currency,
    paid: o.paid, isAdmin,
    items: o.items.map(i => ({ id: i.id, person: i.person, url: i.url, name: i.name, price: i.price, retail: i.retail || 0, qty: i.qty, image: i.image, mine: !!token && i.token === token })),
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', c => { s += c; if (s.length > 100_000) { reject(new Error('too big')); req.destroy(); } });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

function applySettings(o, b) {
  o.title = clip(b.title, 80) || 'Спільне замовлення кави';
  o.organizer = clip(b.organizer, 60);
  o.address = clip(b.address, 400);
  const np = b.np || {};
  o.np = np.warehouseRef ? { city: clip(np.city, 120), cityRef: clip(np.cityRef, 60), warehouse: clip(np.warehouse, 200), warehouseRef: clip(np.warehouseRef, 60),
    recipient: clip(np.recipient, 80), phone: clip(np.phone, 20) } : null;
  o.minPacks = Math.max(1, Math.round(num(b.minPacks, 16)));
  o.shipping = Math.max(0, num(b.shipping, 0));
  o.currency = clip(b.currency, 6) || '₴';
  const p = b.payment || {};
  o.payment = { card: clip(p.card, 40), holder: clip(p.holder, 80), link: clip(p.link, 300), note: clip(p.note, 300) };
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const token = clip(req.headers['x-token'], 60);
  const adminKey = clip(req.headers['x-admin-key'], 60);

  if (req.method === 'GET' && (p === '/' || p.startsWith('/o/'))) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
    return res.end(fs.readFileSync(INDEX));
  }
  if (!p.startsWith('/api/')) { res.writeHead(404); return res.end('Not found'); }

  try {
    if (req.method === 'POST' && p === '/api/orders') {
      const b = await readBody(req);
      const o = { id: rid(6), adminKey: rid(16), createdAt: Date.now(), items: [], paid: {} };
      applySettings(o, b);
      db.orders[o.id] = o; save();
      return send(res, 200, { id: o.id, adminKey: o.adminKey });
    }

    if (req.method === 'GET' && p === '/api/np/cities') {
      const q = clip(url.searchParams.get('q'), 50);
      if (q.length < 2) return send(res, 200, []);
      const d = await novaPoshta('searchSettlements', { CityName: q, Limit: '15', Page: '1' });
      const list = ((d[0] && d[0].Addresses) || []).filter(a => a.Warehouses > 0)
        .map(a => ({ ref: a.DeliveryCity, name: a.Present }));
      return send(res, 200, list);
    }
    if (req.method === 'GET' && p === '/api/np/warehouses') {
      const city = clip(url.searchParams.get('city'), 60), q = clip(url.searchParams.get('q'), 50);
      if (!/^[\w-]{36}$/.test(city)) return send(res, 400, { error: 'Спочатку оберіть місто.' });
      const d = await novaPoshta('getWarehouses', { CityRef: city, FindByString: q, Limit: '30', Page: '1' });
      return send(res, 200, d.map(w => ({ ref: w.Ref, name: w.Description })));
    }

    if (req.method === 'POST' && p === '/api/preview') {
      const b = await readBody(req);
      let u;
      try { u = new URL(String(b.url).trim()); } catch { return send(res, 400, { error: 'Це не схоже на посилання. Скопіюйте адресу сторінки товару повністю.' }); }
      if (!/^https?:$/.test(u.protocol)) return send(res, 400, { error: 'Потрібне посилання, що починається з https://' });
      const host = u.hostname.toLowerCase();
      if (!ALLOWED_HOSTS.some(h => host.includes(h))) return send(res, 400, { error: 'Посилання має вести на сайт MadHeads.' });
      try { return send(res, 200, await parseProduct(u.href)); }
      catch (e) { return send(res, 200, { name: '', price: 0, image: '', url: u.href, warning: 'Не вдалося автоматично прочитати сторінку. Впишіть назву та ціну вручну.' }); }
    }

    const m = p.match(/^\/api\/orders\/([\w-]+)(?:\/(items|paid|refresh)(?:\/([\w-]+))?)?$/);
    if (!m) return send(res, 404, { error: 'not found' });
    const o = db.orders[m[1]];
    if (!o) return send(res, 404, { error: 'Замовлення не знайдено. Перевірте посилання.' });
    const isAdmin = !!adminKey && adminKey === o.adminKey;

    if (!m[2]) {
      if (req.method === 'GET') return send(res, 200, publicOrder(o, token, isAdmin));
      if (req.method === 'PUT') {
        if (!isAdmin) return send(res, 403, { error: 'Лише організатор може змінювати налаштування.' });
        applySettings(o, await readBody(req)); save();
        return send(res, 200, publicOrder(o, token, true));
      }
    }

    if (m[2] === 'items') {
      if (req.method === 'POST' && !m[3]) {
        const b = await readBody(req);
        const person = clip(b.person, 40), name = clip(b.name, 160);
        const price = num(b.price), qty = Math.round(num(b.qty, 1));
        if (!person) return send(res, 400, { error: 'Вкажіть своє імʼя.' });
        if (!name) return send(res, 400, { error: 'Вкажіть назву кави.' });
        if (!(price > 0)) return send(res, 400, { error: 'Вкажіть ціну за пачку.' });
        if (!(qty >= 1 && qty <= 100)) return send(res, 400, { error: 'Кількість має бути від 1 до 100.' });
        if (!token) return send(res, 400, { error: 'no token' });
        o.items.push({ id: rid(5), token, person, url: clip(b.url, 500), name, price, retail: Math.max(0, num(b.retail)), qty, image: clip(b.image, 500) });
        save();
        return send(res, 200, publicOrder(o, token, isAdmin));
      }
      const it = o.items.find(i => i.id === m[3]);
      if (!it) return send(res, 404, { error: 'Позицію не знайдено.' });
      if (!(isAdmin || (token && it.token === token))) return send(res, 403, { error: 'Це не ваша позиція.' });
      if (req.method === 'DELETE') { o.items = o.items.filter(i => i !== it); save(); return send(res, 200, publicOrder(o, token, isAdmin)); }
      if (req.method === 'PATCH') {
        const q = Math.round(num((await readBody(req)).qty));
        if (!(q >= 1 && q <= 100)) return send(res, 400, { error: 'Кількість має бути від 1 до 100.' });
        it.qty = q; save(); return send(res, 200, publicOrder(o, token, isAdmin));
      }
    }

    if (m[2] === 'refresh' && req.method === 'POST') {
      if (!isAdmin) return send(res, 403, { error: 'Лише організатор оновлює ціни.' });
      const urls = [...new Set(o.items.map(i => i.url).filter(Boolean))];
      let updated = 0;
      for (const u of urls) {
        try {
          const pr = await parseProduct(u);
          if (pr.price > 0) for (const i of o.items) if (i.url === u) { if (i.price !== pr.price) updated++; i.price = pr.price; i.retail = pr.retail || 0; }
        } catch { /* лишаємо стару ціну */ }
      }
      save();
      return send(res, 200, { ...publicOrder(o, token, true), updated });
    }

    if (m[2] === 'paid' && req.method === 'POST') {
      if (!isAdmin) return send(res, 403, { error: 'Лише організатор відмічає оплати.' });
      const b = await readBody(req);
      const person = clip(b.person, 40);
      if (b.paid) o.paid[person] = true; else delete o.paid[person];
      save(); return send(res, 200, publicOrder(o, token, true));
    }
    send(res, 405, { error: 'method not allowed' });
  } catch (e) {
    send(res, 400, { error: p.startsWith('/api/np/') ? 'Нова пошта зараз не відповідає, спробуйте ще раз.' : 'Некоректний запит' });
  }
}

function start() {
  return http.createServer((req, res) => { handle(req, res).catch(() => { res.writeHead(500); res.end(); }); })
    .listen(PORT, HOST, () => console.log(`MadHeads-складчина: http://localhost:${PORT}`));
}
module.exports = { start };
if (require.main === module) start();
