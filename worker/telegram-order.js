// Air Chains order relay: receives an order from the website and forwards it
// to the owner's Telegram chat through the bot. Runs as a Cloudflare Worker.
//
// Settings (Worker → Settings → Variables and Secrets):
//   BOT_TOKEN       secret, the token from @BotFather (never put it in the website code)
//   CHAT_ID         where orders go (the owner's Telegram chat id)
//   ALLOWED_ORIGIN  the website address, e.g. https://diinliy.github.io

const MAX_TEXT = 3500;            // Telegram allows 4096 characters per message
const WINDOW_MS = 10 * 60 * 1000; // simple anti-spam: at most 5 orders per IP per 10 minutes
const MAX_PER_WINDOW = 5;
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

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
    const cors = {
      'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : (allowed[0] || '*'),
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method === 'GET') return json({ ok: true, service: 'air-chains-orders' }, 200, cors);
    if (request.method !== 'POST') return json({ ok: false, error: 'method' }, 405, cors);
    if (allowed.length && !allowed.includes(origin)) return json({ ok: false, error: 'origin' }, 403, cors);
    if (!env.BOT_TOKEN || !env.CHAT_ID) return json({ ok: false, error: 'not_configured' }, 500, cors);

    let body;
    try { body = await request.json(); } catch { return json({ ok: false, error: 'bad_json' }, 400, cors); }
    if (body.website) return json({ ok: true }, 200, cors); // honeypot field filled in: a bot, pretend success
    const text = String(body.text || '').trim().slice(0, MAX_TEXT);
    if (!text) return json({ ok: false, error: 'empty' }, 400, cors);
    if (tooMany(request.headers.get('CF-Connecting-IP') || 'unknown')) return json({ ok: false, error: 'rate_limited' }, 429, cors);

    const tg = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: env.CHAT_ID, text: '🛍 Нове замовлення з сайту\n\n' + text, disable_web_page_preview: true }),
    });
    const data = await tg.json().catch(() => ({}));
    if (!data.ok) return json({ ok: false, error: 'telegram' }, 502, cors);
    return json({ ok: true }, 200, cors);
  },
};
