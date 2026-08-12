# Netlify deployment

This project is configured to deploy the static game UI from `public/` and the Express API through Netlify Functions.

## Netlify site settings

The committed `netlify.toml` supplies:

- Publish directory: `public`
- Functions directory: `netlify/functions`
- Build command: logo validation + function dependency installation
- `/api/*` → Netlify Function `api`
- `/healthz` → Netlify Function health endpoint
- SPA fallback for client-side routes

Do not set a different publish directory in the Netlify UI unless you intentionally override the committed configuration.

## Required environment variables

Set these in **Netlify → Project configuration → Environment variables** and make sure their scope includes **Functions**:

```text
NODE_ENV=production
ADMIN_USER=<admin username>
ADMIN_PASSWORD=<12+ character password>
ADMIN_TOKEN_SECRET=<long random secret, 32+ characters recommended>
SHEETS_WEBHOOK_URL=<Google Apps Script webhook URL>
SHEETS_SECRET=<shared webhook secret>
TRUST_PROXY=true
RETENTION_DAYS=90
```

`SHEETS_WEBHOOK_URL` and `SHEETS_SECRET` are required if Google Sheets is the production persistence backend. Without them the app falls back to local CSV, which is not durable across serverless instances.

## Important serverless behaviour

Netlify Functions are ephemeral. The current 30-minute in-memory session store is retained for the lifetime of a warm function instance and supports refresh recovery while that instance remains available. It is **not a durable cross-instance session store**.

Google Sheets is the durable record of completed sessions and answers. If cross-instance resume becomes a requirement, move session state to a durable Netlify/Redis/KV store rather than relying on process memory.

## Deployment

1. Connect the GitHub repository `miebaka/identify-the-brand` to Netlify.
2. Keep the production branch set to `main`.
3. Add the environment variables above.
4. Trigger a deploy.
5. Verify:
   - `/` loads the game.
   - `/healthz` returns `{ "ok": true }`.
   - `/api/leaderboard` returns JSON.
   - registration creates a session.
   - `/admin` loads and admin authentication works.

Netlify automatically rebuilds when new commits reach `main`.
