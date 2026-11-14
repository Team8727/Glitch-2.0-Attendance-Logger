# Google Sheets sync

The attendance service can append every new sign-in to a Google Sheet through a
Google Apps Script webhook. The sync runs in the background and never blocks the
bot or kiosk. If Sheets is down, rows stay in `service/data/signins.json` and are
retried.

## 1. Create the sheet

Create a Google Sheet. The script will create two tabs:

**Sign-ins**

| Timestamp | Name | Code | Source |
|---|---|---|---|

`Source` is `discord`, `kiosk`, or `mentor`.

**Roster**

| First Name | Last Name | Subteam | PIN Set | Discord Linked | Discord ID |
|---|---|---|---|---|---|

Fill in only `First Name` and `Last Name` as the roster. Members set their
`Subteam` when they link Discord or set up their kiosk PIN. After the service is
connected, a mentor can click **Sync roster from Sheets** on the dashboard. That:

1. Reads the `Roster` tab into the attendance service
2. Writes `Subteam`, `PIN Set`, `Discord Linked`, and `Discord ID` back to the sheet

The sheet becomes the roster source after the first sync. `data/roster.csv` is
only a fallback if the sheet roster cache does not exist yet.

## 2. Add the Apps Script

1. Open the sheet → **Extensions → Apps Script**.
2. Replace the default code with `service/google-apps-script/Code.gs`.
3. Set:
   - `SHEET_ID` — the long ID from the sheet URL:
     `https://docs.google.com/spreadsheets/d/<SHEET_ID>/edit`
   - `SECRET` — the value of `SHEETS_WEBHOOK_SECRET` in `service/.env`.
     View it with:
     ```bash
     grep '^SHEETS_WEBHOOK_SECRET=' service/.env
     ```
4. Save.

## 3. Deploy the web app

1. **Deploy → New deployment**.
2. Type: **Web app**.
3. Execute as: **Me**.
4. Who has access: **Anyone**.
5. Deploy and authorize.
6. Copy the **Web app URL**.

## 4. Point the service at it

Edit `service/.env`:

```bash
SHEETS_WEBHOOK_URL=https://script.google.com/macros/s/.../exec
SHEETS_WEBHOOK_SECRET=<same secret as the Apps Script>
SHEETS_SYNC_INTERVAL_MS=60000
```

Restart:

```bash
systemctl --user restart glitch-attendance
```

Check the log:

```bash
journalctl --user -u glitch-attendance -f | grep sheets
```

## 5. Test

1. Open the dashboard → **Mentor force sign-in** → **Sync roster from Sheets**.
2. Confirm the roster names appear in the dropdown and the `Roster` tab gets
   `PIN Set` / `Discord Linked` / `Discord ID` filled in.
3. Sign in through Discord, the kiosk, or mentor force sign-in.
4. Within one sync interval (60s) the row should appear in the `Sign-ins` tab.

## Notes

- The Apps Script dedupes by timestamp + name, so retries are safe.
- Sync progress is stored in `service/data/sheet-sync.json`.
- To force a full resync, delete `service/data/sheet-sync.json` and restart the
  service. The Apps Script will skip rows that already exist.
- The webhook secret is the only protection on the Apps Script URL. Keep it
  private and rotate it if it leaks.
