# Storing scores in Google Sheets (no database, no disk)

By default the game persists to local CSV files. If you'd rather have gameplay
data land **directly in a Google Sheet** you own — and skip the need for a paid
persistent disk — turn on the Google Sheets backend. It uses a small Apps Script
webhook: **no Google Cloud project, no service-account keys.**

When enabled, every completed game and every answer is appended to your Sheet,
and the in-app leaderboard and admin exports read from it. The app still keeps a
local CSV copy per instance as a fallback.

## Setup (~5 minutes, one time)

1. **Create a Google Sheet.** A blank one is fine; tabs named `sessions` and
   `answers` are created automatically on first write.
2. **Open the script editor:** in the Sheet, **Extensions ▸ Apps Script**.
3. **Paste the script:** copy the contents of
   [`scripts/google-apps-script.gs`](scripts/google-apps-script.gs) into the
   editor (replace the default `Code.gs`).
4. **Set a secret:** change the `SECRET` line at the top to a long random string.
   Generate one with:
   ```bash
   node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
   ```
5. **Deploy as a Web App:** **Deploy ▸ New deployment ▸** gear icon **▸ Web app**.
   - **Execute as:** Me
   - **Who has access:** Anyone
   - Click **Deploy**, authorize when prompted, and **copy the Web app URL**
     (it looks like `https://script.google.com/macros/s/AKfy.../exec`).
6. **Point the server at it** — set two environment variables:
   ```
   SHEETS_WEBHOOK_URL=<the Web app URL from step 5>
   SHEETS_SECRET=<the same SECRET from step 4>
   ```
   Locally that's in `.env`; on a host it's the service's environment settings.

On startup the server logs `[persistence] Google Sheets backend enabled.` and
your Sheet fills up as people play.

## How it behaves

- **Writes** go to both the Sheet (source of truth) and a local CSV mirror. A
  Sheet hiccup never blocks or fails a player's submission — it's logged for you.
- **Reads** (leaderboard, admin exports) come from the Sheet, so they survive
  restarts and redeploys even with no persistent disk.
- **Security:** every request carries the shared secret in the request body
  (never the URL); the script rejects mismatches. Keep the URL + secret private.
- **Quotas:** Apps Script has generous free daily quotas; leaderboard reads are
  cached for a few seconds to stay well under them.

## Hosting with no disk

Because durable data lives in the Sheet, the app needs **no persistent disk** —
the host's filesystem can be ephemeral. Deploy to any Node host, set
`SHEETS_WEBHOOK_URL` + `SHEETS_SECRET` (plus `ADMIN_PASSWORD` and
`ADMIN_TOKEN_SECRET`), and the leaderboard and exports read straight from your
Sheet across restarts and redeploys.

## Getting the data out

You already have it — open your Google Sheet. The admin dashboard's CSV exports
still work too (they read from the Sheet). To pull a spreadsheet directly from
Sheets: **File ▸ Download ▸ Comma-separated values**.
