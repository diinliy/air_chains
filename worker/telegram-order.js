// Air Chains order relay: receives an order from the website, forwards it to the
// owner's Telegram chat through the bot, and keeps it for the admin page.
// Runs as a Cloudflare Worker.
//
// Settings (Worker → Settings → Variables and Secrets):
//   BOT_TOKEN       secret, the token from @BotFather (never put it in the website code)
//   CHAT_ID         where orders go (the owner's Telegram chat id)
//   ALLOWED_ORIGIN  the website address, e.g. https://diinliy.github.io
//   ADMIN_KEY       secret, the password for the admin page
// Binding (Worker → Settings → Bindings):
//   ORDERS          a KV namespace where orders are stored (optional: without it orders only go to Telegram)

const MAX_TEXT = 30000;           // a whole cart; longer orders are cut here
const PART = 3900;                // Telegram allows 4096 characters per message, so long orders go in parts
const MAX_IMAGE = 3_000_000;      // base64 length of the bracelet picture (~2 MB)
const WINDOW_MS = 10 * 60 * 1000; // simple anti-spam: at most 5 orders per IP per 10 minutes
const MAX_PER_WINDOW = 5;
const STATUSES = ['new', 'work', 'sent', 'done', 'cancel'];
const hits = new Map();

function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
}

function tooMany(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < WINDOW_MS);
  list.push(now);
  hits.set(ip, list);
  return list.length > MAX_PER_WINDOW;
}

function sameText(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function isAdmin(request, env) {
  // the page sends the password URI-encoded, so it may contain any letters (headers are ASCII-only)
  let given = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  try { given = decodeURIComponent(given); } catch { return false; }
  return !!env.ADMIN_KEY && sameText(given, env.ADMIN_KEY.trim());
}

const clip = (v, n) => String(v ?? '').trim().slice(0, n);

// Splits an order into Telegram-sized messages, preferring the blank lines between bracelets.
function splitText(text, limit = PART) {
  const parts = [];
  let cur = '';
  const push = () => { if (cur) parts.push(cur); cur = ''; };
  for (const block of text.split('\n\n')) {
    const joined = cur ? cur + '\n\n' + block : block;
    if (joined.length <= limit) { cur = joined; continue; }
    push();
    if (block.length <= limit) { cur = block; continue; }
    for (const line of block.split('\n')) {
      const j = cur ? cur + '\n' + line : line;
      if (j.length <= limit) { cur = j; continue; }
      push();
      for (let i = 0; i < line.length; i += limit) { cur = line.slice(i, i + limit); if (i + limit < line.length) push(); }
    }
  }
  push();
  return parts;
}

// Sends the bracelet picture; returns the Telegram message id, or 0 if it could not be sent.
async function sendPhoto(env, dataUrl, caption) {
  const m = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
  if (!m || m[2].length > MAX_IMAGE) return 0;
  const bytes = Uint8Array.from(atob(m[2]), ch => ch.charCodeAt(0));
  const form = new FormData();
  form.append('chat_id', env.CHAT_ID);
  form.append('caption', caption.slice(0, 1000));
  form.append('photo', new Blob([bytes], { type: 'image/' + m[1] }), m[1] === 'png' ? 'bracelet.png' : 'bracelet.jpg');
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendPhoto`, { method: 'POST', body: form });
  const d = await r.json().catch(() => ({}));
  return d.ok ? d.result.message_id : 0;
}

// Keys sort newest first: o:<reversed time>-<random>
function newId() {
  const rev = String(9_999_999_999_999 - Date.now()).padStart(13, '0');
  return rev + '-' + Math.random().toString(36).slice(2, 6);
}

async function saveOrder(env, body, text) {
  if (!env.ORDERS) return;
  const id = newId();
  const m = body.meta && typeof body.meta === 'object' ? body.meta : {};
  const order = {
    id, createdAt: new Date().toISOString(), status: 'new', text,
    name: clip(m.name, 80), phone: clip(m.phone, 40), contact: clip(m.contact, 80),
    total: clip(m.total, 20), beads: clip(m.beads, 40),
    hasImage: /^data:image\/(jpeg|png);base64,/.test(body.image || '') && body.image.length <= MAX_IMAGE,
  };
  const meta = { t: order.createdAt, st: 'new', n: order.name, p: order.phone, s: order.total, b: order.beads, img: order.hasImage ? 1 : 0 };
  await env.ORDERS.put('o:' + id, JSON.stringify(order), { metadata: meta });
  if (order.hasImage) await env.ORDERS.put('i:' + id, body.image);
}

async function handleAdmin(request, env, url, cors) {
  if (!isAdmin(request, env)) return json({ ok: false, error: 'unauthorized' }, 401, cors);
  if (!env.ORDERS) return json({ ok: false, error: 'no_storage' }, 500, cors);
  const parts = url.pathname.split('/').filter(Boolean); // ['orders', id?, 'image'?]
  const id = parts[1];

  if (!id && request.method === 'GET') {
    const page = await env.ORDERS.list({ prefix: 'o:', limit: 50, cursor: url.searchParams.get('cursor') || undefined });
    const orders = page.keys.map(k => ({ id: k.name.slice(2), ...k.metadata }));
    return json({ ok: true, orders, cursor: page.list_complete ? null : page.cursor }, 200, cors);
  }
  if (!id || !/^[0-9]{13}-[a-z0-9]{1,8}$/.test(id)) return json({ ok: false, error: 'bad_id' }, 400, cors);

  if (parts[2] === 'image' && request.method === 'GET') {
    const img = await env.ORDERS.get('i:' + id);
    if (!img) return json({ ok: false, error: 'not_found' }, 404, cors);
    const m = /^data:(image\/(?:jpeg|png));base64,(.+)$/.exec(img);
    const bytes = Uint8Array.from(atob(m[2]), ch => ch.charCodeAt(0));
    return new Response(bytes, { headers: { ...cors, 'Content-Type': m[1], 'Cache-Control': 'private, max-age=86400' } });
  }

  const raw = await env.ORDERS.get('o:' + id);
  if (!raw) return json({ ok: false, error: 'not_found' }, 404, cors);
  const order = JSON.parse(raw);

  if (request.method === 'GET') return json({ ok: true, order }, 200, cors);
  if (request.method === 'PATCH') {
    const body = await request.json().catch(() => ({}));
    if (!STATUSES.includes(body.status)) return json({ ok: false, error: 'bad_status' }, 400, cors);
    order.status = body.status;
    const meta = { t: order.createdAt, st: order.status, n: order.name, p: order.phone, s: order.total, b: order.beads, img: order.hasImage ? 1 : 0 };
    await env.ORDERS.put('o:' + id, JSON.stringify(order), { metadata: meta });
    return json({ ok: true, order }, 200, cors);
  }
  if (request.method === 'DELETE') {
    await env.ORDERS.delete('o:' + id);
    await env.ORDERS.delete('i:' + id);
    return json({ ok: true }, 200, cors);
  }
  return json({ ok: false, error: 'method' }, 405, cors);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
    const cors = {
      'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : (allowed[0] || '*'),
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Vary': 'Origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    if (url.pathname.startsWith('/orders')) return handleAdmin(request, env, url, cors);

    if (request.method === 'GET') return json({ ok: true, service: 'air-chains-orders', storage: !!env.ORDERS }, 200, cors);
    if (request.method !== 'POST') return json({ ok: false, error: 'method' }, 405, cors);
    if (allowed.length && !allowed.includes(origin)) return json({ ok: false, error: 'origin' }, 403, cors);
    if (!env.BOT_TOKEN || !env.CHAT_ID) return json({ ok: false, error: 'not_configured' }, 500, cors);

    let body;
    try { body = await request.json(); } catch { return json({ ok: false, error: 'bad_json' }, 400, cors); }
    if (body.website) return json({ ok: true }, 200, cors); // honeypot field filled in: a bot, pretend success
    const text = String(body.text || '').trim().slice(0, MAX_TEXT);
    if (!text) return json({ ok: false, error: 'empty' }, 400, cors);
    if (tooMany(request.headers.get('CF-Connecting-IP') || 'unknown')) return json({ ok: false, error: 'rate_limited' }, 429, cors);

    // picture first, then the full order as a reply to it; the text still goes out if the picture fails
    const summary = String(body.summary || '').slice(0, 200);
    const photoId = await sendPhoto(env, body.image, '🛍 Нове замовлення з сайту' + (summary ? '\n' + summary : ''));
    const parts = splitText((photoId ? '' : '🛍 Нове замовлення з сайту\n\n') + text);
    let data = { ok: true };
    for (let i = 0; i < parts.length && data.ok; i++) {
      const message = { chat_id: env.CHAT_ID, text: (i ? `(продовження ${i + 1}/${parts.length})\n\n` : '') + parts[i], disable_web_page_preview: true };
      if (photoId) message.reply_parameters = { message_id: photoId };
      const tg = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
      });
      data = await tg.json().catch(() => ({}));
    }

    // keep the order for the admin page even if Telegram failed, so nothing is lost
    try { await saveOrder(env, body, text); } catch (e) { /* storage problems must not block the order */ }

    if (!data.ok) return json({ ok: false, error: 'telegram' }, 502, cors);
    return json({ ok: true }, 200, cors);
  },
};
