/* Glitch 2.0 attendance config.
 *
 * Set appsScriptUrl to your deployed Google Apps Script web app URL
 * (see backend/README.md). Leave it empty to run the UI in demo mode:
 * members load from a sample list and the passcode "GL-0000" always
 * works (nothing touches the spreadsheet).
 */
window.GLITCH_CONFIG = {
  appsScriptUrl: "",
  teamName: "GLITCH ROBOTICS",
  requirePasscode: true,
  demoPasscode: "GL-0000",
  demoMembers: [
    "Camila R",
    "Devon L",
    "Alex T",
    "Jordan M",
    "Sasha K",
  ],
};