"use strict";

(function () {
  const form = document.getElementById("signin-form");
  const nameSelect = document.getElementById("name");
  const codeInput = document.getElementById("code");
  const pinSection = document.getElementById("pin-section");
  const pinInput = document.getElementById("pin");
  const setPinSection = document.getElementById("set-pin-section");
  const subteamSelect = document.getElementById("subteam");
  const newPinInput = document.getElementById("new-pin");
  const confirmPinInput = document.getElementById("confirm-pin");
  const submitButton = document.getElementById("submit-button");
  const statusEl = document.getElementById("status");
  const showRegister = document.getElementById("show-register");
  const registerForm = document.getElementById("register-form");
  const regFirst = document.getElementById("reg-first");
  const regLast = document.getElementById("reg-last");
  const regSubteam = document.getElementById("reg-subteam");
  const regPin = document.getElementById("reg-pin");
  const regConfirm = document.getElementById("reg-confirm");
  const registerStatus = document.getElementById("register-status");
  const cancelRegister = document.getElementById("cancel-register");
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token") || "";
  const testMode = params.get("test") === "1";
  if (testMode) document.title = "Glitch 2.0 Sign-In (TEST)";

  let members = [];

  function setStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.className = "status" + (kind ? " " + kind : "");
  }

  function setRegisterStatus(text, kind) {
    registerStatus.textContent = text;
    registerStatus.className = "status" + (kind ? " " + kind : "");
  }

  function showRegisterForm() {
    form.classList.add("hidden");
    registerForm.classList.remove("hidden");
    showRegister.classList.add("hidden");
  }

  function hideRegisterForm() {
    registerForm.classList.add("hidden");
    form.classList.remove("hidden");
    showRegister.classList.remove("hidden");
  }

  function selectedMember() {
    return members.find((member) => member.name === nameSelect.value) || null;
  }

  function updatePinFields() {
    const member = selectedMember();
    if (!member) {
      pinSection.classList.add("hidden");
      setPinSection.classList.add("hidden");
      submitButton.textContent = "Sign in";
      return;
    }
    if (member.hasPin) {
      pinSection.classList.remove("hidden");
      setPinSection.classList.add("hidden");
      submitButton.textContent = "Sign in";
    } else {
      pinSection.classList.add("hidden");
      setPinSection.classList.remove("hidden");
      subteamSelect.value = member.subteam || "";
      submitButton.textContent = "Set PIN & sign in";
    }
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
      members = data.members || [];
      nameSelect.innerHTML = "";
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = members.length ? "Select your name" : "No unlinked members";
      nameSelect.appendChild(placeholder);
      for (const member of members) {
        const option = document.createElement("option");
        option.value = member.name;
        option.textContent = member.subteam ? `${member.name} (${member.subteam})` : member.name;
        nameSelect.appendChild(option);
      }
      updatePinFields();
    } catch (err) {
      setStatus(err.message, "err");
    }
  }

  nameSelect.addEventListener("change", updatePinFields);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const member = selectedMember();
    const code = codeInput.value.trim();
    if (!member) return setStatus("Select your name first.", "err");
    if (!/^\d{4}$/.test(code)) return setStatus("Enter the 4-digit code from the display.", "err");

    let endpoint = "/api/kiosk/signin";
    let body = { token, name: member.name, code, test: testMode };

    if (member.hasPin) {
      const pin = pinInput.value.trim();
      if (!/^\d{4,6}$/.test(pin)) return setStatus("Enter your 4–6 digit PIN.", "err");
      body.pin = pin;
    } else {
      const subteam = subteamSelect.value;
      const pin = newPinInput.value.trim();
      const confirm = confirmPinInput.value.trim();
      if (!subteam) return setStatus("Select your subteam.", "err");
      if (!/^\d{4,6}$/.test(pin)) return setStatus("Choose a 4–6 digit PIN.", "err");
      if (pin !== confirm) return setStatus("The PINs don't match.", "err");
      endpoint = "/api/kiosk/set-pin";
      body.subteam = subteam;
      body.pin = pin;
    }

    submitButton.disabled = true;
    setStatus("Signing in…");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.message || data.error || "Sign-in failed.");
      const first = String(data.name || "").trim().split(/\s+/)[0] || "";
      if (data.already) {
        setStatus(`PIN set. You're already signed in for today, ${first}.`, "ok");
      } else {
        setStatus(`You're signed in, ${first}. See you at practice!`, "ok");
      }
      codeInput.value = "";
      pinInput.value = "";
      newPinInput.value = "";
      confirmPinInput.value = "";
      subteamSelect.value = "";
      nameSelect.value = "";
      await loadRoster();
    } catch (err) {
      setStatus(err.message, "err");
    } finally {
      submitButton.disabled = false;
    }
  });

  showRegister.addEventListener("click", showRegisterForm);
  cancelRegister.addEventListener("click", hideRegisterForm);

  registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const firstName = regFirst.value.trim();
    const lastName = regLast.value.trim();
    const subteam = regSubteam.value;
    const pin = regPin.value.trim();
    const confirm = regConfirm.value.trim();
    if (!firstName || !lastName) return setRegisterStatus("Enter your first and last name.", "err");
    if (!subteam) return setRegisterStatus("Select your subteam.", "err");
    if (!/^\d{4,6}$/.test(pin)) return setRegisterStatus("Choose a 4–6 digit PIN.", "err");
    if (pin !== confirm) return setRegisterStatus("The PINs don't match.", "err");

    const button = registerForm.querySelector('button[type="submit"]');
    button.disabled = true;
    setRegisterStatus("Creating account…");
    try {
      const response = await fetch("/api/kiosk/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, firstName, lastName, subteam, pin, test: testMode }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.message || data.error || "Registration failed.");
      }
      await loadRoster();
      nameSelect.value = data.name;
      updatePinFields();
      regFirst.value = "";
      regLast.value = "";
      regSubteam.value = "";
      regPin.value = "";
      regConfirm.value = "";
      hideRegisterForm();
      setStatus(`Registered as ${data.name}. Enter the code to sign in.`, "ok");
    } catch (err) {
      setRegisterStatus(err.message, "err");
    } finally {
      button.disabled = false;
    }
  });

  loadRoster();
})();
