# Замовлення з сайту в Telegram

Сайт надсилає замовлення на невеликий сервер (Cloudflare Worker), а той пересилає його
в Telegram через бота @airchains_bot. Токен бота зберігається лише в налаштуваннях
Cloudflare. Ніколи не додавайте його в код сайту: репозиторій публічний.

## Налаштування Cloudflare (один раз)

1. Зареєструйтеся на https://dash.cloudflare.com (безкоштовний тариф).
2. **Workers & Pages → Create → Create Worker**. Назва: `air-chains-orders`. Натисніть **Deploy**.
3. **Edit code**: видаліть усе й вставте вміст файлу `worker/telegram-order.js`. Натисніть **Deploy**.
4. **Settings → Variables and Secrets → Add**:
   - `BOT_TOKEN`, тип **Secret**: токен від @BotFather;
   - `CHAT_ID`, тип **Text**: номер чату, куди надходитимуть замовлення;
   - `ALLOWED_ORIGIN`, тип **Text**: `https://diinliy.github.io`;
   - `ADMIN_KEY`, тип **Secret**: пароль для сторінки замовлень.
5. Скопіюйте адресу воркера (`https://air-chains-orders.<ваш-піддомен>.workers.dev`)
   і впишіть її в `ORDER_ENDPOINT` у файлі `druza/index.html`, потім запустіть `python3 tools/build-site.py`.

Перевірка: якщо відкрити адресу воркера в браузері, він має відповісти `{"ok":true,...}`.

## Як дізнатися CHAT_ID

Напишіть боту будь-яке повідомлення і відкрийте
`https://api.telegram.org/bot<ТОКЕН>/getUpdates`. Потрібне число в `"chat":{"id": ...}`.

## Сайт на GitHub Pages

**Settings → Pages → Build and deployment**: Source **Deploy from a branch**, гілка з сайтом, папка `/ (root)`.
Сайт буде за адресою https://diinliy.github.io/Orion/.
Після змін у `druza/index.html` запустіть `python3 tools/build-site.py`: він оновить `index.html` у корені.

## Сторінка замовлень (адмінка)

https://diinliy.github.io/Orion/admin/ показує всі замовлення: фото браслета, склад, контакти й статус.
Щоб замовлення зберігалися, підключіть до воркера сховище:

1. **Storage & Databases → Workers KV → Create**, назва `air-chains-orders`.
2. Воркер → **Settings → Bindings → Add binding → KV namespace**: Variable name `ORDERS`, оберіть створене сховище, **Deploy**.
3. Додайте секрет `ADMIN_KEY` (пароль для входу).

Без сховища замовлення, як і раніше, приходять у Telegram, але на сторінці їх не видно.
