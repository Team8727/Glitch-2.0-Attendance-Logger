# Glitch 2.0 Attendance Service

The attendance backend. **PostgreSQL is the source of truth** for members,
Discord links, PINs, subteams, and attendance. The service also owns the rotating
team-number code and the HTTP API. It does **not** connect to Discord — the bot
lives in the separate
[`glitch-2.0-discord-bot`](https://github.com/Team8727/glitch-2.0-discord-bot)
repo and calls the internal API routes.

```
GitHub Pages display ── GET /api/state ──► this service ──► PostgreSQL
Discord bot          ── POST /api/link, /api/signin ──► this service
Kiosk                ── POST /api/kiosk/* ──► this service
                                                         │
                                                         └─► The Blue Alliance API
                                                         └─► Google Sheets (one-way report)
```

## Run

```bash
cd service
sudo ../deploy/install-postgres.sh   # one-time: installs Postgres, writes DATABASE_URL
npm install
npm run migrate                      # imports roster.csv + existing JSON data
npm start
```

Node 20+ is required.

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
| `POST` | `/api/link` | `{ "discordId": "...", "name": "...", "subteam": "..." }` | Bind a Discord ID to a member and set their subteam. |
| `GET` | `/api/link/:discordId` | — | Look up the linked member. |
| `POST` | `/api/signin` | `{ "discordId": "...", "code": "8727" }` | Validate the current code and record attendance. |
| `GET` | `/api/mentor/roster` | — | All members with subteam/PIN/Discord status. |
| `POST` | `/api/mentor/signin` | `{ "name": "..." }` | Force sign-in without the code. |
| `POST` | `/api/mentor/reset-pin` | `{ "name": "..." }` | Clear a member's kiosk PIN. |
| `POST` | `/api/mentor/sync-roster` | — | Push member status to Google Sheets. |

### Kiosk (requires `KIOSK_TOKEN`)

| Method | Path | Body | Purpose |
|---|---|---|---|
| `GET` | `/api/kiosk/roster?token=...` | — | Unlinked members with PIN status. |
| `POST` | `/api/kiosk/signin` | `{ token, name, code, pin }` | Sign in with a PIN. |
| `POST` | `/api/kiosk/set-pin` | `{ token, name, code, pin, subteam }` | First-time PIN + subteam setup, then sign in. |

## Database

PostgreSQL tables:

- `members` — first/last name, subteam, Discord ID, scrypt PIN hash/salt
- `attendance` — member, timestamp, practice date, source, code

The migration script imports:

- `data/roster.csv` → `members`
- `service/data/links.json` → `members.discord_id`
- `service/data/pins.json` → `members.pin_salt/pin_hash`
- `service/data/subteams.json` → `members.subteam`
- `service/data/signins.json` → `attendance`

Run it with `npm run migrate`. It is idempotent.

## Remaining JSON files

| File | Contents |
|---|---|
| `data/code-state.json` | `{ windowStart, current, previous }` — survives restarts mid-window. |
| `data/tba-cache.json` | Team info cache (name/city/state), 30-day TTL. |
| `data/sheet-sync.json` | Last attendance row pushed to Google Sheets. |

## Google Sheets

Google Sheets is a **one-way report**. The service pushes new attendance rows to
`Sign-ins` and member status to `Roster`. It never reads roster data back from
Sheets. See `docs/GOOGLE-SHEETS.md`.

## Environment

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string. Written by `deploy/install-postgres.sh`. |
| `BOT_API_KEY` | Shared secret for the internal bot routes. |
| `KIOSK_TOKEN` | Shared token for the kiosk page/API. |
| `TBA_AUTH_KEY` | The Blue Alliance API key. Missing → degraded mode. |
| `TZ` | IANA timezone for day boundaries (e.g. `America/New_York`). |
| `HOST` | Bind address (default `127.0.0.1`). |
| `PORT` | API port (default `3000`). |
| `SHEETS_WEBHOOK_URL` | Google Apps Script web app URL. |
| `SHEETS_WEBHOOK_SECRET` | Shared secret for the Sheets webhook. |
| `SHEETS_SYNC_INTERVAL_MS` | Attendance sync interval (default 60000). |

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
npm run migrate
npm start
curl http://127.0.0.1:3000/api/state
curl -H 'X-Bot-Key: test' http://127.0.0.1:3000/api/mentor/roster
```
