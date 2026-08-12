# Deploying to Render

This app is a stateful Node/Express server (in-memory sessions for
server-authoritative timing + CSV persistence), so it needs a real Node host
with a persistent disk — not a serverless/static platform. Render fits.

The repo ships a Blueprint (`render.yaml`) that wires everything up.

## One-time setup (~3 minutes)

1. Go to **https://dashboard.render.com/blueprints** and click
   **New Blueprint Instance**.
2. Connect GitHub and pick **`miebaka/identify-the-brand`** (branch `main`).
   Render reads `render.yaml` automatically.
3. When prompted, set the one secret it can't generate:
   - **`ADMIN_PASSWORD`** — a strong password (≥12 chars). This gates the admin
     dashboard and all CSV exports. (`ADMIN_TOKEN_SECRET` is auto-generated;
     everything else is preset.)
4. Click **Apply**. Render provisions a Starter web service + a 1 GB disk
   mounted at `/var/data`, runs `npm install` (which builds `sharp`), and starts
   `node server.js`.

The service comes up at `https://identify-the-brand.onrender.com` (Render shows
the exact URL). Admin dashboard: `…/admin`. Health check: `…/healthz`.

## Why these settings

| Setting | Reason |
|---|---|
| `plan: starter` + `disk` at `/var/data` | Persistent CSV storage. `DATA_DIR=/var/data` (outside the repo) so the disk never shadows the committed `data/logos.json`. |
| `NODE_ENV=production` | The server refuses to start without a strong `ADMIN_PASSWORD` — a deploy-time safety check. |
| `TRUST_PROXY=1` | Render sits behind a proxy; this lets rate-limiting see real client IPs. No IPs are stored in gameplay CSV. |
| `ADMIN_TOKEN_SECRET: generateValue` | Render generates it once and keeps it stable, so admin tokens survive restarts. |
| `healthCheckPath: /healthz` | Render only routes traffic once the app reports healthy. |

## Free tier + Google Sheets (recommended if you want to skip the paid disk)

Render disks require a paid instance (~$7/mo). To run on the **free** tier with
durable data, store gameplay in a **Google Sheet** instead of on disk (see
[SHEETS.md](SHEETS.md) — a copy-paste Apps Script webhook, no Google Cloud, no
keys). Then:

1. In `render.yaml`, set `plan: free` and delete the `disk:` block (and you can
   drop the `DATA_DIR` var — local CSV becomes an ephemeral mirror only).
2. In the Render dashboard's **Environment** tab, add `SHEETS_WEBHOOK_URL` and
   `SHEETS_SECRET` from the Sheets setup.

Now the leaderboard and exports read from the Sheet, so they survive restarts
and redeploys with zero persistent disk — and the operator sees every score
directly in Google Sheets.

### Free tier without Google Sheets (ephemeral)

If you skip both the disk and Sheets, the game still runs, but the CSV lives on
ephemeral storage and **resets on every restart/redeploy** — fine for a quick
demo only. Export scores from the admin dashboard before any redeploy.

## After deploy — smoke test

1. Open the URL, play a full game, confirm the score screen and leaderboard.
2. Open `…/admin`, sign in with `admin` / your `ADMIN_PASSWORD`, click
   **Export Scores** and confirm the CSV downloads.
3. Trigger a manual redeploy and confirm the leaderboard persists (paid plan).

## Updating

`autoDeployTrigger: commit` is on, so every push to `main` redeploys:

```bash
git add -A && git commit -m "your message" && git push
```
