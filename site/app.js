(function () {
  "use strict";

  var cfg = window.GLITCH_CONFIG || {};
  var apiUrl = cfg.appsScriptUrl || "";
  var demoMode = !apiUrl;

  var form = document.getElementById("signin-form");
  var memberSelect = document.getElementById("member");
  var codeInput = document.getElementById("code");
  var submitBtn = document.getElementById("submit");
  var statusEl = document.getElementById("status");

  form.addEventListener("submit", onSignIn);

  if (demoMode) {
    setStatus("Demo mode — no spreadsheet connected.", "busy");
    loadDemoMembers();
  } else {
    loadMembers();
  }

  function setStatus(text, kind) {
    statusEl.textContent = text || "";
    statusEl.className = "status" + (kind ? " " + kind : "");
  }

  function api(action, params) {
    return new Promise(function (resolve, reject) {
      var sep = apiUrl.indexOf("?") === -1 ? "?" : "&";
      var query = "action=" + encodeURIComponent(action);
      for (var key in params) {
        if (Object.prototype.hasOwnProperty.call(params, key)) {
          query += "&" + key + "=" + encodeURIComponent(params[key]);
        }
      }
      var cb = "__glitch_payload_" + Date.now() + "_" + Math.floor(Math.random() * 1e6);
      var timer = setTimeout(function () {
        cleanup();
        reject(new Error("No response from the server (timeout)."));
      }, 15000);

      function cleanup() {
        clearTimeout(timer);
        if (script.parentNode) script.parentNode.removeChild(script);
        delete window[cb];
      }

      var script = document.createElement("script");
      script.onerror = function () {
        cleanup();
        reject(new Error("Could not reach the server."));
      };
      window[cb] = function (payload) {
        cleanup();
        resolve(payload);
      };
      script.src = apiUrl + sep + query + "&callback=" + cb;
      document.head.appendChild(script);
    });
  }

  function loadDemoMembers() {
    memberSelect.innerHTML = "";
    memberSelect.appendChild(emptyOption("Select your name"));
    cfg.demoMembers.forEach(function (name) {
      memberSelect.appendChild(new Option(name, name));
    });
    memberSelect.disabled = false;
    submitBtn.disabled = false;
  }

  function loadMembers() {
    setStatus("Loading roster…", "busy");
    api("list", {})
      .then(function (payload) {
        if (!payload || !payload.ok || !Array.isArray(payload.members)) {
          throw new Error(payload && payload.error ? payload.error : "The roster could not be loaded.");
        }
        memberSelect.innerHTML = "";
        memberSelect.appendChild(emptyOption("Select your name"));
        payload.members.forEach(function (entry) {
          var name = typeof entry === "string" ? entry : entry.name;
          var label = typeof entry === "string" ? entry : entry.subteam ? name + " — " + entry.subteam : name;
          memberSelect.appendChild(new Option(label, name));
        });
        memberSelect.disabled = false;
        if (payload.members.length === 0) throw new Error("The roster is empty — add members to the Roster tab.");
        submitBtn.disabled = false;
        setStatus("", "");
      })
      .catch(function (err) {
        memberSelect.disabled = false;
        submitBtn.disabled = true;
        setStatus(err.message || "Could not load the roster.", "err");
      });
  }

  function emptyOption(text) {
    var opt = new Option(text, "");
    opt.disabled = true;
    opt.selected = true;
    return opt;
  }

  function onSignIn(event) {
    event.preventDefault();
    var name = memberSelect.value;
    var code = codeInput.value.trim();

    if (!name) {
      return fail("Select your name first.");
    }
    if (!code) {
      return fail("Enter today's code.");
    }
    if (code.length < 6) {
      return fail("That code looks too short — check the code box at the shop.");
    }

    submitBtn.disabled = true;
    setStatus("Signing you in…", "busy");

    if (demoMode) {
      setTimeout(function () {
        var ok = String(code).toUpperCase() === String(cfg.demoPasscode).toUpperCase();
        submitBtn.disabled = false;
        if (ok) {
          setStatus("Demo sign-in successful (" + name + ").", "ok");
          codeInput.value = "";
        } else {
          fail("Wrong demo code — try " + cfg.demoPasscode + ".", true);
        }
      }, 400);
      return;
    }

    api("signin", { member: name, code: code })
      .then(function (payload) {
        submitBtn.disabled = false;
        if (!payload || payload.ok !== true) {
          var msg = payload && payload.error ? payload.error : "Sign-in failed. Ask a mentor.";
          fail(msg, true);
          return;
        }
        setStatus("You're signed in, " + name + ". See you at practice!", "ok");
        codeInput.value = "";
      })
      .catch(function (err) {
        submitBtn.disabled = false;
        fail(err.message || "Network error — try again or ask a mentor.", true);
      });
  }

  function fail(message, shake) {
    setStatus(message, "err");
    if (shake) {
      form.classList.remove("shake");
      void form.offsetWidth;
      form.classList.add("shake");
    }
  }
})();