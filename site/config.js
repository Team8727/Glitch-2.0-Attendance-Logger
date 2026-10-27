/* Glitch 2.0 attendance display config.
 *
 * Set botApiUrl to the web URL of the bot process (the Replit web URL root,
 * e.g. "https://glitch-attendance.yourname.repl.co"). Leave it empty to run
 * the display in demo mode: sample data below, no network calls.
 *
 * demoState must match the /api/state response shape exactly so the same
 * render code path serves both demo and live data.
 */
window.GLITCH_CONFIG = {
  botApiUrl: "",
  title: "Glitch 2.0 Attendance",
  demoState: {
    ok: true,
    code: { teamNumber: 8727, secondsRemaining: 42 },
    team: { number: 8727, name: "Glitch 2.0", city: "Asheville", state: "NC" },
    today: {
      date: "2026-10-27",
      count: 3,
      members: [
        { name: "Jaxon M", at: "15:02" },
        { name: "Milo P", at: "15:19" },
        { name: "Camila R", at: "16:40" },
      ],
    },
    season: {
      practices: 12,
      signins: 143,
      members: [
        { name: "Milo P", count: 11 },
        { name: "Jaxon M", count: 10 },
        { name: "Camila R", count: 9 },
        { name: "Audrey S", count: 8 },
        { name: "Devon L", count: 7 },
      ],
    },
  },
};
