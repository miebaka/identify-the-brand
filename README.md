# IDENTIFY THE BRAND

A fast-paced fragmented-logo recognition game. 20 modified brand logos, one at
a time, 15 seconds each. Server-authoritative timing and scoring, CSV
persistence, and an admin export dashboard.

**Stack:** Node.js + Express (no framework on the client), vanilla HTML/CSS/JS,
SVG artwork, CSV files for persistence. No database.

---

## Quick start

```bash
cd identify-the-brand
npm install
cp .env.example .env          # then edit ADMIN_PASSWORD + ADMIN_TOKEN_SECRET
npm start
```

Open <http://localhost:3000>. Admin dashboard: <http://localhost:3000/admin>.

For local development you can pass secrets inline:

```bash
ADMIN_PASSWORD=devpass1234 ADMIN_TOKEN_SECRET=devsecret123456 npm run dev
```

Validate the logo registry at any time (also use this to gate a deploy):

```bash
npm run validate:logos
```

---

## Scoring model

| Difficulty | Qty | Points | Subtotal |
|---|---:|---:|---:|
| Easy | 8 | 1 | 8 |
| Medium | 7 | 2 | 14 |
| Hard | 6 | 3 | 18 |
| **Total** | **21** | | **40** |

> **Maximum is 40, from 21 logos (8 easy / 7 medium / 6 hard).** The original
> brief's 8/6/6 distribution summed to only 38 (40 is impossible with 8/6/6 and
> 1/2/3 points); adding a 7th medium reaches the intended 40 cleanly. The maximum
> is **derived** from the distribution in `src/server/config.js` (never
> hard-coded), so a perfect game always reads `40 / 40 = 100%`. Change the
> distribution or points there and the whole app (UI, exports, validation)
> follows automatically.

---

## How it works

### Server-authoritative timing (anti-cheat)

The browser timer governs the UX only. The server stamps `questionStartedAt`
when a question is served and, on submit, computes `elapsed = now - startedAt`.
A client-sent `timeRemainingMs` is never trusted. A small `graceMs` (750ms)
covers network latency. See `src/server/store.js` → `recordSubmission`.

### The answer key never reaches the browser

`data/logos.json` holds `acceptableAnswers` and the brand name. During play the
client receives only the **rasterized fragment** and the point value. The full
logo and brand name are returned **after** submission, for the reveal and
results review.

> **Fragments are rasterized server-side (via `sharp`).** The masked fragment is
> rendered to a PNG and sent as a bitmap wrapped in a minimal SVG, so **no vector
> path data — and therefore no recoverable visual answer — is ever serialized to
> the browser**. Rendered fragments are cached (deterministic). If `sharp` is
> unavailable, the server logs a warning and falls back to vector fragments (the
> masked-out geometry would then be inspectable); install it with `npm i sharp`.
> A single logo that fails to rasterize degrades to vector for that logo only,
> never failing the request.

### Answer matching

Normalized (trim, lowercase, Unicode fold, strip harmless punctuation), then:
exact match always wins; Levenshtein distance 1 is allowed only for accepted
answers ≥ 6 characters, to avoid false positives on short brands. See
`src/server/game.js`.

### CSV integrity

`src/server/csv.js` provides one serialized write-queue per file (no torn
read-modify-write), RFC-4180 quoting, formula-injection neutralization (cells
starting with `= + - @` are prefixed with `'`), and a UTF-8 BOM on exports for
Excel. Headers are validated at startup; missing files are created; backups are
copied to `data/backups/` after every 50 writes and on each completion.

### Race conditions

- Double submit → `409 Conflict`, points never awarded twice (idempotent on
  `logoId`).
- Submit for a non-active question → `409` (stale), ignored by the client.
- Late network responses → discarded via a per-question nonce on the client.
- Timeout vs. submit tie → server decides by authoritative elapsed time; a
  duplicate timeout after a submit returns an idempotent reveal.

---

## Providing real logo artwork

The repo ships with geometric SVG reconstructions so the game is fully
playable out of the box. To drop in your own artwork **without touching code**,
add a file at:

```
public/assets/logos/<id>.svg      e.g. public/assets/logos/nike-001.svg
```

Contract for a clean drop-in (`src/server/logos.js`):

- Author artwork on the **800×800** canvas so the `reveal` mask lines up.
- Use `fill`/`stroke="currentColor"` for theming (the app draws logos in
  phosphor white; timer states never recolour the logo).
- The file may be a full `<svg>…</svg>` (its inner markup is extracted) or just
  the raw inner markup (paths/shapes).
- If your source uses a different viewBox, rescale to 800×800 **or** update that
  logo's `reveal` regions in `data/logos.json` to match its coordinate space.

Re-run `npm run validate:logos` after any change.

---

## API

Public gameplay (`src/server/routes/api.js`):

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/register` | create session (firstName, surname, consent) |
| POST | `/api/start` | begin game, first question |
| POST | `/api/submit` | submit an answer (server scores it) |
| POST | `/api/timeout` | mark active question timed out |
| POST | `/api/next` | advance, or finish + return results |
| GET | `/api/results/:sessionId` | re-fetch results (idempotent) |
| GET | `/api/leaderboard?sessionId=` | top 50 + this player's placement |

Admin (`src/server/routes/admin.js`, all except login require `Bearer` token):

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/admin/login` | exchange credentials for an 8h token (rate-limited) |
| GET | `/api/admin/stats` | players / completed / avg / high |
| GET | `/api/admin/players` | completed-player table |
| GET | `/api/admin/export/players` | scores CSV (one row per player) |
| GET | `/api/admin/export/answers` | answers CSV (one row per question) |
| GET | `/api/admin/export/full` | session joined with all answers |
| GET | `/api/admin/export/raw` | raw answers persistence file |

---

## Persistence files

```
data/
├── logos.json      # registry + acceptableAnswers (server-only) + reveal masks
├── sessions.csv    # one row per session at completion
├── answers.csv     # one row per submitted answer
└── backups/        # timestamped copies (never web-exposed)
```

In-memory session state is the source of truth **during** play (needed for
authoritative timing). CSV is the durable record. A browser refresh loses the
in-memory session (the leaderboard and exports survive because they read CSV);
this is a documented limitation, not silent data loss.

---

## Security

- Helmet (incl. a strict CSP: only self scripts, inline styles for tokens, no
  third-party origins), compression, and rate limiting (240 req/min gameplay,
  20 login attempts / 15 min).
- Admin credentials come from env vars only; passwords are never hard-coded.
  Tokens are HMAC-signed and compared in constant time (`src/server/auth.js`).
- Player names are validated (letters/marks/space/`'`/`-`/`.`, 1–60 chars) and
  rendered with `textContent`/escaped HTML. No passwords, email, or IP are
  stored in gameplay data.
- In production (`NODE_ENV=production`) the server **refuses to start** without a
  strong `ADMIN_PASSWORD` (≥12 chars) and `ADMIN_TOKEN_SECRET` (≥16 chars).

---

## Deployment

Any Node host with **persistent** storage (Railway, Render, Fly, a VPS). Do not
put the authoritative CSV on ephemeral storage. Set `DATA_DIR` to a mounted
volume, or adapt `csv.js` to object storage (S3/R2) if the platform has no
volume. Set `TRUST_PROXY=1` behind a reverse proxy so rate limiting sees real
client IPs. Serve over HTTPS.

```bash
NODE_ENV=production ADMIN_PASSWORD=... ADMIN_TOKEN_SECRET=... DATA_DIR=/data npm start
```

---

## Accessibility

WCAG-AA oriented: semantic HTML, visible focus rings, an `aria-live` region that
announces 10/5/2 seconds and "time's up" (never the answer), a permanent numeric
timer alongside the arc, non-colour-only feedback, and full
`prefers-reduced-motion` support (score ticker, bars, pulses collapse to instant;
the timer stays a readable number).

---

## Legal / privacy

The game displays third-party trademarks in transformed form for a recognition
challenge. Before any public or commercial deployment, obtain legal advice on
trademark use, and have the privacy notice reviewed against current Nigerian
(NDPA) requirements. A consent checkbox is not, by itself, legal compliance.
