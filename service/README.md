# Glitch 2.0 Attendance Service

The attendance backend. It owns the rotating team-number code, the roster, the
JSON stores, and the HTTP API. It does **not** connect to Discord — the bot lives
in the separate [`glitch-2.0-discord-bot`](https://github.com/Team8727/glitch-2.0-discord-bot)
repo and calls the internal API routes.

```
GitHub Pages display ── GET /api/state ──► this service
Discord bot          ── POST /api/link, /api/signin ──► this service
                                                         │
                                                         └─► The Blue Alliance API
```

## Run

```bash
cd service
cp .env.example .env      # fill in BOT_API_KEY and TBA_AUTH_KEY
npm start
```

Node 20+ is required. There are no npm dependencies.

## systemd

From the repo root:

```bash
sudo ./deploy/install-service.sh
sudo systemctl enable --now glitch-attendance
```

The unit runs as the invoking user and reads `service/.env`. It binds
`127.0.0.1:3000` by default; expose it through Cloudflare Tunnel or a reverse
proxy for the public display API.

## API

### Public

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/state` | Display data: rotating code, team info, today + season attendance. CORS enabled. |
| `GET` | `/api/health` | Liveness probe. CORS enabled. |

### Internal (requires `BOT_API_KEY`)

Send the key as `X-Bot-Key: <key>` or `Authorization: Bearer <key>`.

| Method | Path | Body | Purpose |
|---|---|---|---|
| `POST` | `/api/link` | `{ "discordId": "...", "name": "..." }` | Validate a roster name and bind it to a Discord ID. |
| `GET` | `/api/link/:discordId` | — | Look up the linked roster name. |
| `POST` | `/api/signin` | `{ "discordId": "...", "code": "8727" }` | Validate the current code and record attendance. |

If `BOT_API_KEY` is unset, the internal routes return `503` and the public display
continues to work.

## Data files

All under `service/data/` (gitignored):

| File | Contents |
|---|---|
| `signins.json` | Array of `{ ts, name, code }` — the attendance record. Back this up. |
| `links.json` | Object map of Discord ID → roster name. |
| `code-state.json` | `{ windowStart, current, previous }` — survives restarts mid-window. |
| `tba-cache.json` | Team info cache (name/city/state), 30-day TTL. |
| `pins.json` | Kiosk PINs, stored as scrypt hashes with per-member salts. |

The roster is `data/roster.csv` at the repo root (override with `ROSTER_CSV`).

## Google Sheets

The service can append new sign-ins to a Google Sheet through an Apps Script
webhook. See `docs/GOOGLE-SHEETS.md` for the full setup.

## Environment

| Variable | Meaning |
|---|---|
| `BOT_API_KEY` | Shared secret for the internal bot routes. Required for `/link` and `/signin`. |
| `TBA_AUTH_KEY` | The Blue Alliance API key. Missing → degraded mode (cached team only). |
| `TZ` | IANA timezone for day boundaries (e.g. `America/Chicago`). |
| `HOST` | Bind address (default `127.0.0.1`). |
| `PORT` | API port (default `3000`). |
| `LINKS_FILE` | Optional path override for `data/links.json`. |
| `ROSTER_CSV` | Optional path override for `data/roster.csv`. |

## How the rotating code works

- Every 60 seconds the service picks a random 4-digit number (1000–9999) and
  confirms with The Blue Alliance that it is a real FRC team. That number **is**
  the sign-in code.
- ~30 seconds before the flip it pre-fetches the next team so the swap is instant.
- `/api/signin` accepts the current window's number and the previous window's
  (grace for a student who read the display right before a flip).
- The current + previous numbers are saved to `data/code-state.json`, so a restart
  mid-window doesn't strand anyone.
- If TBA is unreachable at a flip, the service reuses the last known valid team.

## Verification

```bash
npm run check
BOT_API_KEY=test TBA_AUTH_KEY=... npm start
curl http://127.0.0.1:3000/api/state
curl -H 'X-Bot-Key: test' http://127.0.0.1:3000/api/link/123
```
