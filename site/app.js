(function () {
  "use strict";

  var cfg = window.GLITCH_CONFIG || {};
  var apiUrl = String(cfg.botApiUrl || "").replace(/\/+$/, "");
  var demoMode = !apiUrl;
  var POLL_MS = 20000;
  var FETCH_TIMEOUT_MS = 15000;
  var WINDOW_SECONDS = 60;

  var codeEl = document.getElementById("code");
  var barEl = document.getElementById("countdown-bar");
  var secondsEl = document.getElementById("countdown-seconds");
  var teamInfoEl = document.getElementById("team-info");
  var todayCountEl = document.getElementById("today-count");
  var todayListEl = document.getElementById("today-list");
  var seasonPracticesEl = document.getElementById("season-practices");
  var seasonSigninsEl = document.getElementById("season-signins");
  var seasonListEl = document.getElementById("season-list");
  var offlineEl = document.getElementById("offline");
  var statusEl = document.getElementById("status");

  var deadline = 0;
  var fetching = false;
  var everLoaded = false;

  setInterval(tickCountdown, 1000);

  if (demoMode) {
    render(cfg.demoState);
    setStatus("Demo mode — showing sample data.", "busy");
  } else {
    poll();
    setInterval(poll, POLL_MS);
  }

  function poll() {
    if (fetching) return;
    fetching = true;
    var controller = new AbortController();
    var timer = setTimeout(function () {
      controller.abort();
    }, FETCH_TIMEOUT_MS);
    fetch(apiUrl + "/api/state", { cache: "no-store", signal: controller.signal })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (state) {
        clearTimeout(timer);
        fetching = false;
        everLoaded = true;
        hideOffline();
        render(state);
        setStatus("Updated " + clockNow(), "ok");
      })
      .catch(function () {
        clearTimeout(timer);
        fetching = false;
        showOffline();
      });
  }

  function render(state) {
    if (!state || state.ok !== true) {
      showOffline();
      return;
    }

    if (state.code) {
      deadline = Date.now() + state.code.secondsRemaining * 1000;
      codeEl.textContent = String(state.code.teamNumber);
      codeEl.className = "code";
    } else {
      deadline = 0;
      codeEl.textContent = "----";
      codeEl.className = "code muted";
      setStatus("Waiting for the bot to pick a team code…", "busy");
    }

    renderTeam(state.team, !!state.code);
    renderToday(state.today);
    renderSeason(state.season);
    tickCountdown();
  }

  function renderTeam(team, hasCode) {
    if (team && team.name) {
      var place = team.city
        ? team.state
          ? team.city + ", " + team.state
          : team.city
        : "";
      teamInfoEl.textContent = place ? team.name + " — " + place : team.name;
      teamInfoEl.className = "team-info";
      return;
    }
    teamInfoEl.textContent = hasCode ? "Team info unavailable" : "";
    teamInfoEl.className = "team-info muted";
  }

  function renderToday(today) {
    var members = (today && today.members) || [];
    todayCountEl.textContent = String(members.length);
    todayListEl.innerHTML = "";
    if (members.length === 0) {
      todayListEl.appendChild(emptyRow("No one has signed in yet."));
      return;
    }
    members.forEach(function (member) {
      todayListEl.appendChild(row(member.name, member.at));
    });
  }

  function renderSeason(season) {
    seasonPracticesEl.textContent = String((season && season.practices) || 0);
    seasonSigninsEl.textContent = String((season && season.signins) || 0);
    seasonListEl.innerHTML = "";
    var members = (season && season.members) || [];
    if (members.length === 0) {
      seasonListEl.appendChild(emptyRow("No sign-ins recorded yet."));
      return;
    }
    members.forEach(function (member) {
      seasonListEl.appendChild(row(member.name, member.count));
    });
  }

  function row(name, value) {
    var li = document.createElement("li");
    var label = document.createElement("span");
    label.textContent = name == null ? "" : String(name);
    var meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = value == null ? "" : String(value);
    li.appendChild(label);
    li.appendChild(meta);
    return li;
  }

  function emptyRow(text) {
    var li = document.createElement("li");
    li.className = "empty";
    li.textContent = text;
    return li;
  }

  function tickCountdown() {
    if (deadline === 0) {
      secondsEl.textContent = "--";
      barEl.style.width = "0%";
      return;
    }
    var remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    secondsEl.textContent = String(remaining);
    barEl.style.width =
      Math.max(0, Math.min(1, remaining / WINDOW_SECONDS)) * 100 + "%";
    if (remaining === 0) {
      if (demoMode) {
        deadline = Date.now() + WINDOW_SECONDS * 1000;
      } else if (!fetching) {
        poll();
      }
    }
  }

  function showOffline() {
    offlineEl.className = "offline";
    setStatus(
      everLoaded
        ? "Connection lost — retrying every 20 seconds."
        : "Connecting to the display server…",
      everLoaded ? "err" : "busy"
    );
  }

  function hideOffline() {
    offlineEl.className = "offline hidden";
  }

  function setStatus(text, kind) {
    statusEl.textContent = text || "";
    statusEl.className = "status" + (kind ? " " + kind : "");
  }

  function clockNow() {
    var now = new Date();
    return [now.getHours(), now.getMinutes(), now.getSeconds()]
      .map(function (part) {
        return String(part).padStart(2, "0");
      })
      .join(":");
  }
})();
