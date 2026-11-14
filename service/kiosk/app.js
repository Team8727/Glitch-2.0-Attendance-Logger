"use strict";

(function () {
  const form = document.getElementById("signin-form");
  const nameSelect = document.getElementById("name");
  const codeInput = document.getElementById("code");
  const statusEl = document.getElementById("status");
  const token = new URLSearchParams(window.location.search).get("token") || "";

  function setStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.className = "status" + (kind ? " " + kind : "");
  }

  async function loadRoster() {
    if (!token) {
      setStatus("This sign-in link is missing its token. Ask a mentor for the QR code.", "err");
      return;
    }
    try {
      const response = await fetch(`/api/kiosk/roster?token=${encodeURIComponent(token)}`, {
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Could not load the roster.");
      nameSelect.innerHTML = "";
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = data.members.length ? "Select your name" : "No unlinked members";
      nameSelect.appendChild(placeholder);
      for (const member of data.members) {
        const option = document.createElement("option");
        option.value = member.name;
        option.textContent = member.subteam ? `${member.name} (${member.subteam})` : member.name;
        nameSelect.appendChild(option);
      }
    } catch (err) {
      setStatus(err.message, "err");
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = nameSelect.value;
    const code = codeInput.value.trim();
    if (!name) return setStatus("Select your name first.", "err");
    if (!/^\d{4}$/.test(code)) return setStatus("Enter the 4-digit code from the display.", "err");

    const button = form.querySelector("button");
    button.disabled = true;
    setStatus("Signing in…");
    try {
      const response = await fetch("/api/kiosk/signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, name, code }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.message || data.error || "Sign-in failed.");
      setStatus(`You're signed in, ${data.name}. See you at practice!`, "ok");
      codeInput.value = "";
      nameSelect.value = "";
    } catch (err) {
      setStatus(err.message, "err");
    } finally {
      button.disabled = false;
    }
  });

  loadRoster();
})();
