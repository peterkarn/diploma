// Швидкий тест: вигадана сторінка товару + повний сценарій API.
const http = require('http'), assert = require('assert');
const prod = http.createServer((q, r) => { r.setHeader('content-type','text/html');
  r.end(`<html><head><title>x</title><script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Ефіопія Гуджі 250г","image":"/a.jpg","offers":{"@type":"Offer","price":"389.00","priceCurrency":"UAH"}}</script></head></html>`); }).listen(4001);
process.env.PORT = '4000'; process.env.ALLOWED_HOSTS = 'localhost'; process.env.DATA_FILE = '/tmp/smoke-data.json';
require('fs').rmSync('/tmp/smoke-data.json', { force: true });
require('../server').start();
const call = async (m, p, b, h = {}) => { const r = await fetch('http://localhost:4000/api' + p, { method: m, headers: { 'content-type': 'application/json', ...h }, body: b && JSON.stringify(b) }); return { s: r.status, j: await r.json() }; };
(async () => {
  await new Promise(r => setTimeout(r, 300));
  const c = await call('POST', '/orders', { title: 'T', organizer: 'Петро', minPacks: 16, shipping: 100, payment: { card: '4441' } });
  const id = c.j.id, A = { 'x-admin-key': c.j.adminKey };
  const pv = await call('POST', '/preview', { url: 'http://localhost:4001/p' });
  assert.equal(pv.j.name, 'Ефіопія Гуджі 250г'); assert.equal(pv.j.price, 389); assert(pv.j.image.endsWith('/a.jpg'));
  assert.equal((await call('POST', '/preview', { url: 'https://evil.com/' })).s, 400);
  await call('POST', `/orders/${id}/items`, { person: 'Аня', name: pv.j.name, price: 389, qty: 3 }, { 'x-token': 'ta' });
  const b = await call('POST', `/orders/${id}/items`, { person: 'Борис', name: 'X', price: 300, qty: 1 }, { 'x-token': 'tb' });
  assert.equal(b.j.items.length, 2); assert.equal(b.j.items.filter(i => i.mine).length, 1);
  assert.equal((await call('DELETE', `/orders/${id}/items/${b.j.items[0].id}`, null, { 'x-token': 'tb' })).s, 403);
  assert.equal((await call('POST', `/orders/${id}/paid`, { person: 'Аня', paid: true }, { 'x-token': 'tb' })).s, 403);
  assert.equal((await call('POST', `/orders/${id}/paid`, { person: 'Аня', paid: true }, A)).j.paid['Аня'], true);
  assert.equal((await call('GET', `/orders/${id}`)).j.adminKey, undefined);
  console.log('OK'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
