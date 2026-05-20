// popup.js — Session Launcher v0.5
//
// Architecture:
//   popup.js     — UI only: reads/builds DOM, calls storage, sends messages
//   background.js — all Chrome API calls (windows, displays, storage writes)

document.addEventListener("DOMContentLoaded", async () => {

  // ── DOM refs ──────────────────────────────────────────────────────────────
  const nameInput     = document.getElementById("session-name");
  const btnSave       = document.getElementById("btn-save");
  const sessionsList  = document.getElementById("sessions-list");
  const sessionsCount = document.getElementById("sessions-count");

  // ── Initial render ────────────────────────────────────────────────────────
  await renderSessions();

  // ── Clear error state on any input ───────────────────────────────────────
  nameInput.addEventListener("input", () => {
    nameInput.classList.remove("input-error");
  });

  // ── Enter key → save ──────────────────────────────────────────────────────
  nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") btnSave.click();
  });

  // ── Save button ───────────────────────────────────────────────────────────
  btnSave.addEventListener("click", async () => {

    const name = nameInput.value.trim();
    if (!name) {
      nameInput.classList.add("input-error");
      nameInput.focus();
      return;
    }
    nameInput.classList.remove("input-error");

    btnSave.disabled = true;
    btnSave.textContent = "SAVING…";

    try {
      const captured = await chrome.runtime.sendMessage({ type: "CAPTURE_SESSION" });
      if (captured.error) throw new Error(captured.error);

      const session = {
        id:       crypto.randomUUID(),
        name,
        savedAt:  new Date().toISOString(),
        windows:  captured.windows,
        displays: captured.displays,
      };

      const stored   = await chrome.storage.local.get(["sessions"]);
      const sessions = stored.sessions || [];
      sessions.push(session);
      await chrome.storage.local.set({ sessions });

      nameInput.value = "";
      await renderSessions();

    } catch (err) {
      console.error("save failed:", err);
      nameInput.classList.add("input-error");
    } finally {
      btnSave.disabled = false;
      btnSave.textContent = "SAVE";
    }
  });

  // ── renderSessions ────────────────────────────────────────────────────────
  // Reads storage and rebuilds the list. Called on open, save, and delete.
  async function renderSessions() {
    const stored   = await chrome.storage.local.get(["sessions"]);
    const sessions = stored.sessions || [];

    // Update count badge
    if (sessions.length > 0) {
      sessionsCount.textContent = sessions.length;
    } else {
      sessionsCount.textContent = "";
    }

    sessionsList.textContent = "";

    if (sessions.length === 0) {
      const empty = document.createElement("p");
      empty.className = "sessions-empty";
      empty.textContent = "No saved sessions yet.\nName one above and hit SAVE.";
      sessionsList.appendChild(empty);
      return;
    }

    sessions.slice().reverse().forEach((session) => {
      sessionsList.appendChild(buildSessionRow(session));
    });
  }

  // ── buildSessionRow ───────────────────────────────────────────────────────
  // Returns a DOM element for one session. Does NOT mutate the DOM itself.
  // Uses createElement + textContent throughout — never innerHTML — to avoid XSS.
  function buildSessionRow(session) {

    const row = document.createElement("div");
    row.className = "session-row";

    // Left: name + meta
    const info    = document.createElement("div");
    info.className = "session-info";

    const nameEl  = document.createElement("span");
    nameEl.className = "session-name";
    nameEl.textContent = session.name;

    const metaEl  = document.createElement("span");
    metaEl.className = "session-meta";

    const winCount = session.windows.length;
    const tabCount = session.windows.reduce(
      (acc, win) => acc + (win.tabs ? win.tabs.length : 0), 0
    );
    const dateStr = new Date(session.savedAt).toLocaleDateString(undefined, {
      month: "short", day: "numeric",
    });

    const winLabel = winCount === 1 ? "win"  : "wins";
    const tabLabel = tabCount === 1 ? "tab"  : "tabs";
    metaEl.textContent = `${winCount} ${winLabel} · ${tabCount} ${tabLabel} · ${dateStr}`;

    info.appendChild(nameEl);
    info.appendChild(metaEl);

    // Right: Launch + Delete buttons
    const btnLaunch = document.createElement("button");
    btnLaunch.className = "btn-launch";
    btnLaunch.textContent = "LAUNCH";
    btnLaunch.setAttribute("aria-label", "Launch " + session.name);

    const btnDelete = document.createElement("button");
    btnDelete.className = "btn-delete";
    btnDelete.textContent = "DEL";
    btnDelete.setAttribute("aria-label", "Delete " + session.name);

    btnLaunch.addEventListener("click", async () => {
      btnLaunch.disabled = true;
      btnDelete.disabled = true;
      btnLaunch.textContent = "LAUNCHING…";

      const response = await chrome.runtime.sendMessage({
        type:    "RESTORE_SESSION",
        session: session,
      });

      if (response.error) {
        console.error("launch failed:", response.error);
        btnLaunch.textContent = "FAILED";
        setTimeout(() => {
          btnLaunch.textContent = "LAUNCH";
          btnLaunch.disabled = false;
          btnDelete.disabled = false;
        }, 2000);
        return;
      }

      btnLaunch.classList.add("launched");
      btnLaunch.textContent = "LAUNCHED!";
      setTimeout(() => {
        btnLaunch.textContent = "LAUNCH";
        btnLaunch.classList.remove("launched");
        btnLaunch.disabled = false;
        btnDelete.disabled = false;
      }, 2000);
    });

    btnDelete.addEventListener("click", async () => {
      btnDelete.disabled = true;
      const stored   = await chrome.storage.local.get(["sessions"]);
      const sessions = stored.sessions || [];
      await chrome.storage.local.set({
        sessions: sessions.filter((s) => s.id !== session.id),
      });
      await renderSessions();
    });

    const actions = document.createElement("div");
    actions.className = "row-actions";
    actions.appendChild(btnLaunch);
    actions.appendChild(btnDelete);

    row.appendChild(info);
    row.appendChild(actions);

    return row;
  }

});
