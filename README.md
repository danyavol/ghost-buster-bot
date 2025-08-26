# Ghost Buster Bot (Telegram)

Minimal MVP: kick inactive members from group chats with 1-day prior warning.
Built on Cloudflare Workers + D1.

## Features (MVP)
- Records message activity per user (after bot is added)
- Daily cron sweep:
  - Warns users inactive for (windowDays - 1) days
  - Kicks users inactive for windowDays days, only if warned earlier
- Per-chat defaults: windowDays=60, graceDays=7

## Requirements
- Cloudflare account
- `wrangler` CLI
- Telegram bot token (BotFather)

## Setup

1. Install deps
```bash
npm i
```

2. Create D1 database and apply migration
```bash
wrangler d1 create ghost-buster-bot
wrangler d1 migrations apply ghost-buster-bot --remote
```

3. Configure secrets
```bash
wrangler secrets put TELEGRAM_BOT_TOKEN
wrangler secrets put TELEGRAM_WEBHOOK_SECRET
```

4. Deploy
```bash
wrangler deploy
```

5. Set Telegram webhook
- Your worker URL will look like: `https://ghost-buster-bot.<account>.workers.dev/webhook`
- Webhook is verified with header `X-Telegram-Bot-Api-Secret-Token`

Set via API:
```bash
curl -X POST "https://api.telegram.org/bot<YOUR_TOKEN>/setWebhook" \
  -H 'content-type: application/json' \
  -d '{"url":"https://<your-worker>/webhook","secret_token":"<YOUR_SECRET>"}'
```

## Bot permissions
- Add the bot to the group and make it admin with `can_restrict_members`.

## Notes
- Only activity after adding the bot is visible.
- To identify old lurkers, post a message asking to react or say hi.

## Dev
```bash
wrangler dev --local
```
