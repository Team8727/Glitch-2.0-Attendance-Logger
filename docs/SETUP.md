# Setup runbook — Glitch 2.0 Attendance Logger

Implements `.kilo/plans/1793111143564-bot-api-rotating-team-code.md`. Two components:

```
QR poster at the shop → https://team8727.github.io/Glitch-2.0-Attendance-Logger/
        → display shows a rotating 4-digit code (a real FRC team number, 60s window)
          and that team's name + City, ST from The Blue Alliance
        → students type the number into /signin in the team Discord
        → the bot validates the 60-second window and appends a row to data/signins.json
        → the display's "Today" and "Season" panels update on the next poll (20s)
```

The bot process (on Replit) is the backend **and** the code generator; the site is a
static GitHub Pages display. There is no Google Sheet, no Apps Script, and no sign-in
form on the site.

---

## Step 1 — Get a The Blue Alliance API key

1. Create an account at https://www.thebluealliance.com.
2. Go to https://www.thebluealliance.com/account → **Authentication Keys** → create
   one (or view the read key shown there).
3. Copy the key — it goes into the bot's `TBA_AUTH_KEY` secret (Step 4).

The bot calls `GET https://www.thebluealliance.com/api/v3/team/frc{n}` once per window
(and caches results for 30 days), which is far below TBA's rate limits.

## Step 2 — Create the Discord application

1. Go to https://discord.com/developers/applications and sign in.
2. **New Application** → name it (e.g. `Glitch Attendance`) → **Create**.
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
- Only **Name** and **Subteam** are used by the bot; the rest is documentation.
- The bot re-reads the file on **every `/link`** — new members work immediately, and
  the file is version-controlled so it survives Replit resets.

Set `ROSTER_CSV` (Step 4) only if you keep the roster somewhere else.

## Step 4 — Host the bot on Replit

1. https://replit.com → **Create** → **Import from GitHub** → paste this repo's URL.
   Replit reads `.replit` (`cd bot && npm install && npm start`), so the Run button
   starts the bot **and** the display API in one process.
2. Open **Tools → Secrets** and add:

   | Secret | Value |
   |---|---|
   | `DISCORD_TOKEN` | Step 2 |
   | `CLIENT_ID` | Step 2 |
   | `GUILD_ID` | Step 2 (recommended) |
   | `TBA_AUTH_KEY` | Step 1 |
   | `TZ` | `America/Chicago` (or your region) — controls practice-day boundaries |
   | `SIGNIN_LOG_CHANNEL_ID` | optional — channel for public "X signed in" messages |
   | `ROSTER_CSV` | optional — alternate roster path |

   `PORT` is set by Replit automatically; locally it defaults to 3000.
3. Press **Run**. Expected log:

   ```
   [startup] Roster loaded — N members.
   [server] display API listening on port 3000
   [codes] window 12345678: team 8727
   [startup] Registered 3 commands (guild 123…).
   [bot] Logged in as Glitch Attendance#0000.
   ```
4. Note the Replit **web URL** (the Webview URL shown above the preview, e.g.
   `https://glitch-attendance.yourname.repl.co`) — that is the API root for Step 5.
5. Keep it online: a Discord bot's persistent connection normally keeps a free Repl
   awake. Use Replit **Deploy** (autoscale/reserved VM) for an always-on setup.

## Step 5 — Point the site at the bot

Edit `site/config.js`:

```js
window.GLITCH_CONFIG = {
  botApiUrl: "https://glitch-attendance.yourname.repl.co",
  ...
};
```

No trailing path — just the root; the site calls `${botApiUrl}/api/state`. Leave
`botApiUrl` empty to run the display in **demo mode** (sample data, no network).

The API sends `Access-Control-Allow-Origin: *`, so the Pages site can fetch it
cross-origin with plain `fetch`.

## Step 6 — Deploy to GitHub Pages

`.github/workflows/pages.yml` already publishes the `site/` folder on every push.

1. Push the repo to GitHub.
2. **Settings → Pages** → Build and deployment → **Source: GitHub Actions** (one-time).
3. The site appears at `https://<org>.github.io/<repo>/`. Check **Settings → Pages**
   for the exact URL.

## Step 7 — QR code and poster

1. Generate the poster from the final Pages URL:
   ```
   pip install -r tools/requirements.txt
   python3 tools/generate_qr_poster.py "https://team8727.github.io/Glitch-2.0-Attendance-Logger/"
   ```
   Outputs `poster/qr-code.png` and `poster/attendance-poster.png` (A4).
2. Print two copies: shop entrance and the display/sign-in table. There is **no code
   to write on the poster** anymore — the code is live on the display.
3. `poster/attendance-poster.svg` is the editable source if you want to restyle.

## Step 8 — Validation checklist

Local (no Discord needed):

- [ ] `node --check bot/*.js site/app.js` passes.
- [ ] `WEB_ONLY=1 node bot/index.js` starts the API and `GET /api/state` returns the
      documented shape (with a cached team, you get a code + team info).
- [ ] Open `site/index.html` with an empty `botApiUrl` → demo data renders.

On Replit with real secrets:

- [ ] `/link <roster name>` works; a garbage name is rejected (roster CSV respected).
- [ ] The display shows a 4-digit number and, under it, a real team name + City, ST.
- [ ] The number flips every 60s; the countdown bar reaches 0 exactly at the flip.
- [ ] `/signin` with a wrong number → rejected; with the current number → success, and
      a `{ ts, name, code }` row lands in `bot/data/signins.json`.
- [ ] The display's "Today" panel shows the sign-in within one poll (≤20s).
- [ ] `/signin` with the previous window's number right after a flip → accepted (grace).
- [ ] Same member, same day again → "already signed in for today" (no duplicate row).
- [ ] Restart the Repl mid-window → the current code is unchanged (persisted in
      `data/code-state.json`) and `/status` still shows links.

Degraded mode (optional but recommended to verify):

- [ ] Set a bogus `TBA_AUTH_KEY` → the bot stays up, the display keeps showing the
      cached team (or a fallback), and `/signin` still validates the displayed number.
- [ ] Stop the Repl → the display shows the offline banner; it recovers when the Repl
      resumes.

---

## API reference (`GET /api/state`)

```json
{
  "ok": true,
  "code": { "teamNumber": 8727, "secondsRemaining": 42 },
  "team": { "number": 8727, "name": "Glitch", "city": "Rochester", "state": "MN" },
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

- `code` is `null` while the bot hasn't picked a team yet (cold start with TBA down
  and no cache) — the display shows `----` and sign-ins wait.
- `team` info comes from the TBA cache; `name`/`city`/`state` can be `null`, which the
  site renders as "Team info unavailable".
- `today` lists the current local day's sign-ins sorted by time; `season` is computed
  on read (distinct practice dates, per-member counts, sorted by count).
- Response headers: `Access-Control-Allow-Origin: *`, `Cache-Control: no-store`.

## Operations

- **Before each practice:** nothing to prepare — the code is live on the display.
  Just make sure the Repl is running.
- **Backups:** periodically download `bot/data/signins.json` from the Repl (it holds
  all attendance history). The roster is safe in git; the JSON stores are not.
- **Timezone:** set `TZ` (e.g. `America/Chicago`) so "today" and season practice
  dates follow your local day. Changing it mid-season can re-tag historical days.
- **Emergency roster:** the display's "Today" list works as an evacuation roll.
- **Grant time:** screenshot the Season panel, or export `signins.json` and summarize.
- **Season rollover (May):** archive `signins.json`, then start a fresh one (empty
  array) so season stats reset; keep the old file in Drive for audit.

## Failure modes and mitigations

| Problem | Mitigation |
|---|---|
| Display shows "Offline" | The Repl is asleep/stopped — open it and press Run, or use Replit Deploy. |
| `/signin` says the code is wrong | Codes rotate every 60s; re-read the display. The previous window's number still works for a moment after a flip. |
| Display shows `----` / "Waiting" | The bot can't reach TBA and has no cached team yet — check `TBA_AUTH_KEY` and the Repl log. |
| Display shows "Team info unavailable" | The team number validated but no cached name — TBA was reachable without returning details; it clears on the next rotation. |
| Bogus `TBA_AUTH_KEY` | The bot degrades: it keeps the last known/cached team, and sign-ins keep validating that displayed number. |
| Duplicate sign-in message | Per-member, per-local-day dedupe is intentional (guards double taps). |
| Replit reset wiped links/sign-ins | Re-run `/link`; restore `signins.json` from your backup. |
| Roster name rejected | Names must match `data/roster.csv` exactly (case-insensitive). Edit the CSV and retry — no restart needed. |
| Pages shows stale content | Push again or run the **Deploy to GitHub Pages** workflow; check the Actions log. |
