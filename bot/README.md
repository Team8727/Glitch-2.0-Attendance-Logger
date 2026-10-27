# Glitch 2.0 Attendance — Discord Bot + Display API

Lets students sign in to attendance **from the team Discord**, and serves the JSON API
that the GitHub Pages **display site** polls. The bot is the backend: it stores
attendance in `bot/data/signins.json` on Replit's disk. Google Sheets and Apps Script
are no longer used.

```
Display site (GitHub Pages) ── GET /api/state every 20s ──► this process
Discord /signin <number> ─────────────────────────────────► this process
                                                             │
                                                             └─► The Blue Alliance API
                                                                 (team name + City, ST)
```

## How the rotating code works

- Every 60 seconds the bot picks a random 4-digit number (1000–9999) and confirms with
  The Blue Alliance that it is a real FRC team. That number **is** the sign-in code.
- ~30 seconds before the flip it pre-fetches the next team so the swap is instant.
- `/signin` accepts the **current** window's number and the **previous** window's
  (grace for a student who read the display right before a flip).
- The current + previous numbers are saved to `data/code-state.json`, so a restart
  mid-window doesn't strand anyone.
- If TBA is unreachable at a flip, the bot degrades: it reuses the last known valid
  team, so sign-ins keep working (the display shows the cached team info).

## Flow for a student

1. Once: `/link <your roster name>` — the bot checks the name against `data/roster.csv`
   and binds it to your Discord account (`bot/data/links.json`).
2. Every practice: read the 4-digit number on the display site and run
   `/signin <that number>`.
3. `/status` shows which roster name you're linked to.

All bot replies are ephemeral (only you see them). If `SIGNIN_LOG_CHANNEL_ID` is set, a
public "**Name** signed in." message appears in that channel after each sign-in.

## Repo layout

- `bot/package.json` — dependencies (discord.js v14; Node 18+; no other packages).
- `bot/index.js` — the bot: env loading, command registration, `/link` `/signin`
  `/status`, and startup of the API + code loop.
- `bot/codes.js` — the 60-second window state machine, pre-fetch, and validation.
- `bot/tba.js` — The Blue Alliance client + `data/tba-cache.json` (30-day TTL).
- `bot/attendance.js` — `data/signins.json` (array of `{ ts, name, code }`), per-day
  dedupe, today + season summaries.
- `bot/roster.js` — reads `data/roster.csv` (repo root) on every `/link`.
- `bot/server.js` — the HTTP API (`GET /api/state`).
- `bot/store.js` — Discord-ID → roster-name links (`data/links.json`).
- `bot/.env.example` — documents every config value.
- `.replit` (repo root) — runs `cd bot && npm install && npm start`.

---

# Part A — Create the Discord application

1. Go to https://discord.com/developers/applications and sign in.
2. **New Application** → name it (e.g. `Glitch Attendance`) → **Create**.
3. **General Information**: copy the **Application ID** — this is `CLIENT_ID`.
4. Left menu → **Bot** → **Add Bot** → **Reset Token** → copy the token — this is
   `DISCORD_TOKEN`. Keep it secret; anyone with it can control the bot.
5. Left menu → **OAuth2 → URL Generator**:
   - **Scopes**: check `bot` and `applications.commands`.
   - **Bot permissions**: `Send Messages`, `Embed Links`, `View Channels`,
     `Read Message History`.
   - Copy the generated **URL** at the bottom and open it in a browser. Pick your team
     server → **Authorize**. (You need "Manage Server" to invite bots.)
6. Get your server ID: Discord → **User Settings → Advanced → enable Developer Mode**,
   then right-click your server name → **Copy Server ID** — this is `GUILD_ID`
   (optional, but makes commands appear instantly).

You do **not** need any privileged Gateway intents — slash commands only. You also need
a **The Blue Alliance API key** (https://www.thebluealliance.com/account → Authentication
Keys) for `TBA_AUTH_KEY`.

---

# Part B — Set up on Replit

1. Go to https://replit.com and create/log in to an account.
2. Click **Create** (top-left) → **Import from GitHub**.
3. Paste this repository's URL and import it. Replit clones the repo and reads the
   `.replit` file, which already points the Run button at the bot:
   ```
   run = "cd bot && npm install && npm start"
   ```
   The first run installs dependencies automatically.
4. Add your secrets (the environment variables):
   - Left sidebar → **Tools** → **Secrets** (or the **padlock / key** icon).
   - Add each value from `bot/.env.example`:

     | Secret | Required | Notes |
     |---|---|---|
     | `DISCORD_TOKEN` | yes | Part A step 4 |
     | `CLIENT_ID` | yes | Part A step 3 |
     | `GUILD_ID` | recommended | Part A step 6 — instant command registration |
     | `TBA_AUTH_KEY` | yes | The Blue Alliance key; without it the bot runs degraded |
     | `TZ` | recommended | e.g. `America/Chicago` — practice-day boundaries |
     | `SIGNIN_LOG_CHANNEL_ID` | optional | channel for public "signed in" messages |
     | `ROSTER_CSV` | optional | alternate roster path (default `data/roster.csv`) |
     | `WEB_ONLY` | optional | `1` = API only, no Discord login (local testing) |

5. Press **Run**. You should see:
   ```
   [startup] Roster loaded — N members.
   [server] display API listening on port 3000
   [codes] window 12345678: team 8727
   [startup] Registered 3 commands (guild 123…).
   [bot] Logged in as Glitch Attendance#0000.
   ```
6. Copy the Replit **web URL** (Webview URL) into `site/config.js` as `botApiUrl`
   (see `docs/SETUP.md` Step 5).
7. Back in Discord, `/link`, `/signin`, and `/status` should appear within a few seconds.

### Keeping the bot online

- A Discord bot holds an active connection, which keeps a free Replit Repl from sleeping
  in normal use — and the API needs the same process alive for the display to work.
- If the Repl goes idle, the display shows an **offline banner** and sign-ins fail until
  you open the Repl and press **Run** again, or deploy it with Replit's **Deploy**
  feature for always-on hosting.
- `bot/data/*.json` lives on Replit's disk, so it survives restarts. A full project
  **reset/delete** wipes it — download `data/signins.json` periodically as a backup and
  re-run `/link` after a reset.

---

# Part C — Local testing (optional, on any computer)

No Discord token needed — run the API on its own:

```
cd bot
cp .env.example .env          # optional: set TBA_AUTH_KEY + TZ
npm install
WEB_ONLY=1 npm start          # Windows PowerShell: $env:WEB_ONLY=1; npm start
curl http://localhost:3000/api/state
```

Open `site/index.html` in a browser with `botApiUrl` set to `http://localhost:3000` to
see the display against live data. `node --check bot/*.js` sanity-checks syntax only.

### Commands

| Command | What it does |
|---|---|
| `/link <name>` | Binds your Discord account to a roster name (case-insensitive match). |
| `/signin <code>` | Validates the 4-digit number against the current/previous window, dedupes per day, records the row. |
| `/status` | Shows the roster name you're linked to. |

### Environment variables

| Variable | Meaning |
|---|---|
| `DISCORD_TOKEN` | Bot token (required unless `WEB_ONLY=1`). |
| `CLIENT_ID` | Discord application ID (required unless `WEB_ONLY=1`). |
| `GUILD_ID` | Optional — registers commands to one server instantly. |
| `TBA_AUTH_KEY` | The Blue Alliance API key. Missing → degraded mode (cached team only). |
| `TZ` | IANA timezone for day boundaries (e.g. `America/Chicago`). |
| `SIGNIN_LOG_CHANNEL_ID` | Optional public sign-in log channel. |
| `LINKS_FILE` | Optional path override for `data/links.json`. |
| `ROSTER_CSV` | Optional path override for `data/roster.csv`. |
| `WEB_ONLY` | `1` = serve the API without logging in to Discord. |
| `PORT` | API port (default 3000; Replit sets it). |

### Data files (all under `bot/data/`, gitignored)

| File | Contents |
|---|---|
| `signins.json` | Array of `{ ts, name, code }` — the attendance record. Back this up. |
| `links.json` | Object map of Discord ID → roster name. |
| `code-state.json` | `{ windowStart, current, previous }` — survives restarts mid-window. |
| `tba-cache.json` | Team info cache (name/city/state), 30-day TTL. |

---

# Adding / changing roster members

Edit `data/roster.csv` **in the repo** (or at `ROSTER_CSV` if you overrode it). The bot
re-reads the file on every `/link`, so new names are available immediately — no bot
restart needed, and a Replit reset can't lose it. Names must be unique; avoid
apostrophes.

# Practice day routine (mentors)

Nothing to prepare. Confirm the Repl is running before practice and that the display
shows a number with a team name under it. The code rotates on its own every 60 seconds.

---

# Verification checklist

- [ ] Bot starts and logs `Roster loaded`, `display API listening`, and a first
      `[codes] window …` line.
- [ ] The display site (with `botApiUrl` set) shows a 4-digit number + team name.
- [ ] `/link <your roster name>` → ephemeral confirmation with your linked name.
- [ ] `/link <garbage>` → rejected with "isn't on the roster".
- [ ] `/signin` before linking → "You're not linked yet".
- [ ] `/signin` with a wrong number → "not the current team number".
- [ ] `/signin` with the displayed number → success; a row lands in `data/signins.json`
      and the display's Today panel updates.
- [ ] The same user signs in again the same day → "already signed in for today".
- [ ] The number flips at 0 on the countdown; the previous number still works briefly.
- [ ] With `SIGNIN_LOG_CHANNEL_ID` set → a public message appears.
- [ ] Restart the process mid-window → the current code is unchanged (persisted).
- [ ] Bogus `TBA_AUTH_KEY` → bot stays up, display shows cached/fallback team info,
      sign-ins still validate the displayed number.

# Troubleshooting

| Symptom | Fix |
|---|---|
| `Missing required environment variables` at startup | Add `DISCORD_TOKEN` and `CLIENT_ID` as secrets (or set `WEB_ONLY=1` to test the API alone). |
| Display shows "Offline" | The Repl isn't running — press Run, or use Replit Deploy for always-on. |
| Display shows `----` / "Waiting for the bot to pick a team code" | The bot has no valid team yet: check `TBA_AUTH_KEY` and the log for `[codes]` errors. With a bad key and no cache, sign-ins legitimately wait. |
| Display shows "Team info unavailable" | TBA returned the team but without details, or the cache entry is gone; it clears on the next rotation. |
| Commands don't show up | The invite URL must include `applications.commands`. With `GUILD_ID` set, guild commands appear almost instantly; global commands can take up to an hour. |
| `"name" isn't on the roster` | The name must match `data/roster.csv` (case-insensitive). Edit the CSV and retry; no restart needed. |
| Sign-in says already signed in, but the student says they didn't | Per-member, per-day dedupe is intentional — someone using their name already signed in today. |
| Codes repeat often | Expected occasionally, but the bot skips numbers used in the last 20 windows; repeats get rarer as the bot runs. |
| `TBA_AUTH_KEY` warning at startup | Add a valid key from https://www.thebluealliance.com/account. Until then the bot only signs in against a cached team. |
| Replit reset wiped data | Restore `data/signins.json` from a backup and re-run `/link` (each student once). |
