# Setup runbook — Glitch 2.0 Attendance Logger

Two components, two repos:

```
QR poster at the shop → https://team8727.github.io/Glitch-2.0-Attendance-Logger/
        → display shows a rotating 4-digit code (a real FRC team number, 60s window)
          and that team's name + City, ST from The Blue Alliance
        → students type the number into /signin in the team Discord
        → the Discord bot calls the attendance service
        → the service appends a row to service/data/signins.json
        → the display's "Today" and "Season" panels update on the next poll (20s)
```

- **This repo** (`Glitch-2.0-Attendance-Logger`) owns the attendance service and the
  static display site.
- **`glitch-2.0-discord-bot`** owns the Discord bot and the attendance connector module.

The service is the only writer of attendance data. The bot authenticates to the
service with a shared `BOT_API_KEY`.

---

## Step 1 — Get a The Blue Alliance API key

1. Create an account at https://www.thebluealliance.com.
2. Go to https://www.thebluealliance.com/account → **Authentication Keys** → create
   one (or view the read key shown there).
3. Copy the key — it goes into the service's `TBA_AUTH_KEY`.

The service calls `GET https://www.thebluealliance.com/api/v3/team/frc{n}` once per
window (and caches results for 30 days), which is far below TBA's rate limits.

## Step 2 — Create the Discord application

1. Go to https://discord.com/developers/applications and sign in.
2. **New Application** → name it (e.g. `Glitch 2.0`) → **Create**.
3. **General Information**: copy the **Application ID** — this is `CLIENT_ID`.
4. **Bot** → **Add Bot** → **Reset Token** → copy the token — this is `DISCORD_TOKEN`.
   Keep it secret.
5. **OAuth2 → URL Generator**: scopes `bot` + `applications.commands`; bot permissions
   `Send Messages`, `Embed Links`, `View Channels`, `Read Message History`. Open the
   generated URL and authorize the bot into your team server.
6. Optional: enable Developer Mode (User Settings → Advanced), right-click your server
   → **Copy Server ID** — this is `GUILD_ID` (makes commands appear instantly).

No privileged Gateway intents are needed — slash commands only.

## Step 3 — Fill in the roster CSV

Edit `data/roster.csv` at the repo root (created from `templates/roster.csv`). Header:

```
Name,Student ID,Subteam,Role,Email
```

Rules that keep everything working:

- **Names unique**, no apostrophes (`O'Brien` → `OBrien`).
- Only **Name** and **Subteam** are used by the service; the rest is documentation.
- The service re-reads the file on **every `/link`** — new members work immediately,
  and the file is version-controlled so it survives redeploys.

Set `ROSTER_CSV` only if you keep the roster somewhere else.

## Step 4 — Host the attendance service

The service must be reachable by:

- the GitHub Pages display site (public `GET /api/state`), and
- the Discord bot (internal `POST /api/link`, `POST /api/signin`).

It should **not** be routed through NordVPN. Only the bot goes through the VPN.

### Local / this machine

```bash
cd service
cp .env.example .env
# edit .env: BOT_API_KEY, TBA_AUTH_KEY, TZ
npm start
```

The service binds `127.0.0.1:3000` by default. Put a tunnel or reverse proxy in front
of it for the public display API (see Step 5).

To run it as a systemd service:

```bash
sudo ./deploy/install-service.sh
sudo systemctl enable --now glitch-attendance
```

### Environment

| Variable | Required | Meaning |
|---|---|---|
| `BOT_API_KEY` | yes | Shared secret for the bot's internal API calls. |
| `TBA_AUTH_KEY` | yes | The Blue Alliance key. |
| `TZ` | recommended | e.g. `America/Chicago` — practice-day boundaries. |
| `HOST` | no | Bind address (default `127.0.0.1`). |
| `PORT` | no | API port (default `3000`). |
| `ROSTER_CSV` | no | Alternate roster path. |
| `LINKS_FILE` | no | Alternate links store path. |

## Step 5 — Expose the public display API

The display site is static GitHub Pages, so it needs a public HTTPS URL for
`GET /api/state`. Recommended: a **Cloudflare Tunnel** to `http://127.0.0.1:3000`
(no inbound ports, no public IP required). Alternatives: a reverse proxy with a
domain + TLS, or a small VPS.

Set the resulting URL in `site/config.js`:

```js
window.GLITCH_CONFIG = {
  botApiUrl: "https://attendance.example.com",
  ...
};
```

No trailing path — just the root; the site calls `${botApiUrl}/api/state`. Leave
`botApiUrl` empty to run the display in **demo mode** (sample data, no network).

The public API sends `Access-Control-Allow-Origin: *`, so the Pages site can fetch it
cross-origin with plain `fetch`.

## Step 6 — Deploy the Discord bot

Follow `glitch-2.0-discord-bot/README.md`. The bot needs:

| Variable | Meaning |
|---|---|
| `DISCORD_TOKEN` | Step 2 |
| `CLIENT_ID` | Step 2 |
| `GUILD_ID` | Step 2 (recommended) |
| `ATTENDANCE_API_URL` | The service URL, e.g. `http://127.0.0.1:3000` |
| `ATTENDANCE_API_KEY` | Same value as the service's `BOT_API_KEY` |
| `DISCORD_PROXY_URL` | Optional NordVPN proxy for the bot only |

## Step 7 — Deploy to GitHub Pages

`.github/workflows/pages.yml` publishes the `site/` folder on every push.

1. Push the repo to GitHub.
2. **Settings → Pages** → Build and deployment → **Source: GitHub Actions** (one-time).
3. The site appears at `https://<org>.github.io/<repo>/`. Check **Settings → Pages**
   for the exact URL.

## Step 8 — QR code and poster

1. Generate the poster from the final Pages URL:
   ```
   pip install -r tools/requirements.txt
   python3 tools/generate_qr_poster.py "https://team8727.github.io/Glitch-2.0-Attendance-Logger/"
   ```
   Outputs `poster/qr-code.png` and `poster/attendance-poster.png` (A4).
2. Print two copies: shop entrance and the display/sign-in table. There is **no code
   to write on the poster** — the code is live on the display.
3. `poster/attendance-poster.svg` is the editable source if you want to restyle.

## Step 9 — Validation checklist

Local (no Discord needed):

- [ ] `cd service && npm run check` passes.
- [ ] `BOT_API_KEY=test TBA_AUTH_KEY=... npm start` starts the API.
- [ ] `GET /api/state` returns the documented shape (with a cached team, you get a
      code + team info).
- [ ] `GET /api/link/123` without the key → `401`; with `X-Bot-Key: test` → `200`.
- [ ] Open `site/index.html` with an empty `botApiUrl` → demo data renders.

With the bot and real secrets:

- [ ] `/link <roster name>` works; a garbage name is rejected (roster CSV respected).
- [ ] The display shows a 4-digit number and, under it, a real team name + City, ST.
- [ ] The number flips every 60s; the countdown bar reaches 0 exactly at the flip.
- [ ] `/signin` with a wrong number → rejected; with the current number → success, and
      a `{ ts, name, code }` row lands in `service/data/signins.json`.
- [ ] The display's "Today" panel shows the sign-in within one poll (≤20s).
- [ ] `/signin` with the previous window's number right after a flip → accepted (grace).
- [ ] Same member, same day again → "already signed in for today" (no duplicate row).
- [ ] Restart the service mid-window → the current code is unchanged (persisted in
      `data/code-state.json`) and `/status` still shows links.

Degraded mode (optional but recommended to verify):

- [ ] Set a bogus `TBA_AUTH_KEY` → the service stays up, the display keeps showing the
      cached team (or a fallback), and `/signin` still validates the displayed number.
- [ ] Stop the service → the display shows the offline banner; it recovers when the
      service resumes.

---

## API reference

### `GET /api/state` (public)

```json
{
  "ok": true,
  "code": { "teamNumber": 8727, "secondsRemaining": 42 },
  "team": { "number": 8727, "name": "Glitch", "city": "Asheville", "state": "NC" },
  "today": {
    "date": "2026-10-27",
    "count": 2,
    "members": [{ "name": "Jaxon M", "at": "15:02" }]
  },
  "season": {
    "practices": 12,
    "signins": 143,
    "members": [{ "name": "Milo P", "count": 11 }]
  }
}
```

- `code` is `null` while the service hasn't picked a team yet (cold start with TBA down
  and no cache) — the display shows `----` and sign-ins wait.
- `team` info comes from the TBA cache; `name`/`city`/`state` can be `null`, which the
  site renders as "Team info unavailable".
- `today` lists the current local day's sign-ins sorted by time; `season` is computed
  on read (distinct practice dates, per-member counts, sorted by count).
- Response headers: `Access-Control-Allow-Origin: *`, `Cache-Control: no-store`.

### Internal routes (require `BOT_API_KEY`)

| Method | Path | Body | Result |
|---|---|---|---|
| `POST` | `/api/link` | `{ "discordId": "...", "name": "..." }` | `{ ok, name, subteam }` or `{ ok:false, error }` |
| `GET` | `/api/link/:discordId` | — | `{ ok, linked, name }` |
| `POST` | `/api/signin` | `{ "discordId": "...", "code": "8727" }` | `{ ok, name }` or `{ ok:false, error, message }` |

Send the key as `X-Bot-Key: <key>` or `Authorization: Bearer <key>`.

---

## Operations

- **Before each practice:** nothing to prepare — the code is live on the display.
  Just make sure the service and bot are running.
- **Backups:** periodically copy `service/data/signins.json` (it holds all attendance
  history). The roster is safe in git; the JSON stores are not.
- **Timezone:** set `TZ` (e.g. `America/Chicago`) so "today" and season practice
  dates follow your local day. Changing it mid-season can re-tag historical days.
- **Emergency roster:** the display's "Today" list works as an evacuation roll.
- **Grant time:** screenshot the Season panel, or export `signins.json` and summarize.
- **Season rollover (May):** archive `signins.json`, then start a fresh one (empty
  array) so season stats reset; keep the old file in Drive for audit.

## Failure modes and mitigations

| Problem | Mitigation |
|---|---|
| Display shows "Offline" | The service or tunnel is down — check the service process and tunnel. |
| `/signin` says the code is wrong | Codes rotate every 60s; re-read the display. The previous window's number still works for a moment after a flip. |
| Display shows `----` / "Waiting" | The service can't reach TBA and has no cached team yet — check `TBA_AUTH_KEY` and the service log. |
| Display shows "Team info unavailable" | The team number validated but no cached name — TBA was reachable without returning details; it clears on the next rotation. |
| Bot says "attendance service unavailable" | Check `ATTENDANCE_API_URL`, `ATTENDANCE_API_KEY`, and that the service is running. |
| Duplicate sign-in message | Per-member, per-local-day dedupe is intentional (guards double taps). |
| Roster name rejected | Names must match `data/roster.csv` exactly (case-insensitive). Edit the CSV and retry — no restart needed. |
| Pages shows stale content | Push again or run the **Deploy to GitHub Pages** workflow; check the Actions log. |
