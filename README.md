# Air Chains

Сайт браслетів з натурального каміння з конструктором.

- **Сайт:** https://diinliy.github.io/air_chains/
- **Замовлення (для власника):** https://diinliy.github.io/air_chains/admin/
- **Telegram-бот:** @airchains_bot

## Що де лежить

| Шлях | Що це |
|---|---|
| `src/index.html` | сторінка сайту: конструктор, каталог, оформлення замовлення |
| `index.html` | готовий сайт для GitHub Pages, збирається з `src/index.html` |
| `admin/index.html` | сторінка замовлень (вхід за паролем) |
| `worker/telegram-order.js` | сервер на Cloudflare: пересилає замовлення в Telegram і зберігає їх |
| `tools/build-site.py` | збирає `index.html` із `src/index.html` |

Після змін у `src/index.html` запустіть `python3 tools/build-site.py`.
Налаштування Cloudflare і бота описані в `worker/README.md`.
