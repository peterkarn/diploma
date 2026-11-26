'use strict';
// Універсальний парсер сторінки товару: JSON-LD → OpenGraph/мікророзмітка → <title>.
const decode = s => String(s || '')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).trim();

function meta(html, key) {
  const re = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${key}["'][^>]*>`, 'i');
  const tag = (html.match(re) || [])[0];
  if (!tag) return '';
  return decode((tag.match(/content=["']([^"']*)["']/i) || [])[1]);
}

function walk(node, out) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) return node.forEach(n => walk(n, out));
  const t = [].concat(node['@type'] || []);
  if (t.includes('Product')) out.push(node);
  Object.values(node).forEach(v => walk(v, out));
}

function toPrice(v) {
  const n = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function parseHtml(html, url) {
  let name = '', price = 0, image = '';
  const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const products = [];
  for (const b of blocks) { try { walk(JSON.parse(b[1]), products); } catch { /* ignore */ } }
  const prod = products[0];
  if (prod) {
    name = decode(prod.name);
    const img = [].concat(prod.image || [])[0];
    image = typeof img === 'object' ? img?.url || '' : img || '';
    const offers = [].concat(prod.offers || [])[0] || {};
    price = toPrice(offers.price ?? offers.lowPrice ?? offers.priceSpecification?.price);
  }
  if (!name) name = meta(html, 'og:title') || decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]);
  if (!image) image = meta(html, 'og:image');
  if (!price) price = toPrice(meta(html, 'product:price:amount') || meta(html, 'og:price:amount') || meta(html, 'price'));
  if (image) { try { image = new URL(image, url).href; } catch { image = ''; } }
  return { name: name.slice(0, 160), price, image, url };
}

async function parseProduct(url) {
  const r = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(8000),
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; coffee-split/1.0)', 'accept-language': 'uk,en;q=0.8', accept: 'text/html' },
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const html = (await r.text()).slice(0, 2_000_000);
  const res = parseHtml(html, url);
  if (!res.name || !res.price) res.warning = 'Не все вдалося зчитати автоматично — перевірте назву та ціну нижче.';
  return res;
}

module.exports = { parseProduct, parseHtml };
