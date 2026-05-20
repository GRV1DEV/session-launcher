// popup.js — Phase 3: save, load, and delete named sessions
//
// New APIs and concepts introduced this phase:
//   chrome.storage.local.get/set  — persist data that survives popup close/reopen
//   chrome.runtime.sendMessage    — CAPTURE_SESSION message to background.js
//   crypto.randomUUID()           — generate a collision-free unique ID
//   document.createElement()      — build DOM nodes safely (no innerHTML, no XSS)
//   Array.filter()                — remove one item from an array by ID
//   Array.slice().reverse()       — show newest sessions first without mutating storage
//   Closures in event listeners   — each Delete button "remembers" its own session
//
// Architecture note:
//   popup.js  — UI only: reads DOM, builds DOM, calls storage, sends messages
//   background.js — Chrome API calls: windows, displays, storage writes from save
//   The popup has NO idea how the data is fetched — it just sends a message and
//   receives a plain object back. This separation makes each file easier to change.

// ─────────────────────────────────────────────────────────────────────────────
// DOMContentLoaded — entry point for all popup logic
// ─────────────────────────────────────────────────────────────────────────────
// NOTE: the callback is marked "async" so we can use "await" directly inside it.
// DOMContentLoaded ignores the return value of its callback, so async is safe.
document.addEventListener("DOMContentLoaded", async () => {

  // ── Grab every DOM element we will need ─────────────────────────────────────
  // We query the DOM once at startup and store references in variables.
  // Querying the DOM is relatively slow; storing the result avoids repeating it.

  const nameInput     = document.getElementById("session-name");
  // The <input type="text"> where the user types the session name.

  const btnSave       = document.getElementById("btn-save");
  // The green "Save" button next to the input.

  const sessionsList  = document.getElementById("sessions-list");
  // The <div> that renderSessions() fills with session rows (or empty state).

  const btnScan       = document.getElementById("btn-scan");
  // The blue "Show Current Setup" button from Phase 2.

  const outputSection = document.getElementById("output-section");
  // The JSON output panel (hidden by default, toggled by btnScan).

  const outputPre     = document.getElementById("output-pre");
  // The <pre> element inside the output panel that holds the JSON string.

  const btnCopy       = document.getElementById("btn-copy");
  // The small "Copy" button inside the output panel header.

  // ── Load saved sessions immediately when the popup opens ───────────────────
  await renderSessions();
  // This is the first thing that runs after we have DOM references.
  // By awaiting it here, the sessions list is fully built before any
  // event handlers fire — the user sees their sessions instantly.

  // ── "Enter" key on the input triggers Save ─────────────────────────────────
  nameInput.addEventListener("keydown", (e) => {
    // "keydown" fires on every key press while the input is focused.
    // e is the KeyboardEvent object; e.key is a string like "Enter", "a", "Shift".

    if (e.key === "Enter") {
      // Calling .click() on the button programmatically fires its "click" event,
      // running all the same save logic without duplicating any code.
      btnSave.click();
    }
  });

  // ── Save button ─────────────────────────────────────────────────────────────
  btnSave.addEventListener("click", async () => {

    // ── Validate input ───────────────────────────────────────────────────────
    const name = nameInput.value.trim();
    // .value reads the current text in the input field as a string.
    // .trim() removes leading and trailing whitespace.
    // Without trim(), a name of "   " (only spaces) would pass the check below.

    if (!name) {
      // !name is true when name is an empty string "" (falsy in JavaScript).
      // Falsy values: false, 0, "", null, undefined, NaN — all treated as false.
      nameInput.classList.add("input-error");
      // Adds the CSS class that turns the border red — visual error signal.
      nameInput.focus();
      // Moves keyboard focus back to the input so the user can start typing.
      return;
      // Exit the handler immediately — do NOT proceed with saving.
    }

    nameInput.classList.remove("input-error");
    // Clear any previous error state now that we have a valid name.

    // ── Loading state ────────────────────────────────────────────────────────
    btnSave.disabled = true;
    btnSave.textContent = "Saving…";
    // … is the Unicode escape for the ellipsis character "…"
    // Using the escape avoids potential encoding issues in some editors.

    try {

      // ── Ask background.js to capture windows + displays ───────────────────
      // CAPTURE_SESSION is a new message type we added to background.js.
      // Background runs Promise.all([windows, displays]) and sends both back.
      // We use one message instead of two to get a consistent snapshot in time
      // and to keep all Chrome API calls in one place (background.js).
      const captured = await chrome.runtime.sendMessage({ type: "CAPTURE_SESSION" });
      // "captured" will be either:
      //   { windows: [...], displays: [...] }  — success
      //   { error: "message string" }          — failure

      if (captured.error) {
        // Background sends { error: "..." } when the Promise.all rejects.
        // We throw a real Error object so our catch block below handles it.
        throw new Error(captured.error);
      }

      // ── Build the session object ──────────────────────────────────────────
      const session = {

        id: crypto.randomUUID(),
        // crypto.randomUUID() generates a UUID v4 string — e.g.:
        // "f47ac10b-58cc-4372-a567-0e02b2c3d479"
        // UUIDs are random 128-bit values; the probability of a collision is
        // astronomically small (you would need to generate billions to get one).
        //
        // WHY use a UUID instead of an array index?
        // When we delete a session, we filter the array by ID.
        // If we used array index, deleting item 2 would shift indices 3,4,5...
        // down to 2,3,4 — and any stored index references would be wrong.
        // A UUID is permanently attached to the session object, never shifts.

        name: name,
        // The trimmed string from the input field. Stored as-is.

        savedAt: new Date().toISOString(),
        // new Date() creates a Date object representing right now.
        // .toISOString() converts it to a string: "2026-05-20T01:23:45.678Z"
        // We store it as a string because JSON.stringify(new Date()) gives a
        // string anyway, and new Date(stringFromStorage) parses it back correctly.

        windows: captured.windows,
        // Array of Window objects, each with a nested .tabs array.
        // Shape: [{ id, state, type, top, left, width, height, tabs: [{...}] }]

        displays: captured.displays,
        // Array of DisplayInfo objects — one per connected monitor.
        // Stored for future use (e.g. Phase 4 restore could reposition windows
        // to match the monitors that were present when the session was saved).
      };

      // ── Read → modify → write ─────────────────────────────────────────────
      // chrome.storage.local does not have an "append" operation.
      // The pattern is always: read the current value, modify it in memory, write it back.

      const stored = await chrome.storage.local.get(["sessions"]);
      // .get() accepts an array of key names to retrieve.
      // It returns a Promise that resolves to a plain object containing those keys.
      // e.g. if "sessions" exists: { sessions: [{...}, {...}] }
      //      if "sessions" is absent: {}  (empty object, NOT an error)

      const sessions = stored.sessions || [];
      // "stored.sessions" might be undefined if the key doesn't exist yet
      // (e.g. the onInstalled handler hasn't run, or storage was cleared).
      // The || operator returns the right side when the left is falsy.
      // So: undefined || []  →  []    (start fresh)
      //     [{...}]  || []   →  [{...}] (use existing array)

      sessions.push(session);
      // .push() appends the new session to the END of the array.
      // "sessions" is a reference to the array we just read; push modifies it in place.

      await chrome.storage.local.set({ sessions });
      // .set() takes a plain object and merges its keys into storage.
      // { sessions } is ES6 shorthand for { sessions: sessions }.
      // This REPLACES the "sessions" key with our updated array.
      // Returns a Promise that resolves once Chrome confirms the write to disk.

      // ── Reset UI ──────────────────────────────────────────────────────────
      nameInput.value = "";
      // Clear the input so the user can save another session without retyping.

      await renderSessions();
      // Rebuild the sessions list — the new session should now appear at the top.

    } catch (err) {
      console.error("save failed:", err);
      nameInput.classList.add("input-error");
      // Show the red border as a general error signal.
    } finally {
      // finally runs ALWAYS — success or failure — so the button always resets.
      btnSave.disabled = false;
      btnSave.textContent = "Save";
    }
  });
  // End of save handler.

  // ── renderSessions ──────────────────────────────────────────────────────────
  // Reads all saved sessions from storage and rebuilds the sessions-list div.
  // Called: on popup open, after every save, after every delete.
  // Using "async function" (not arrow) so it is hoisted and callable before its
  // definition — though in this file it is always defined before it is called.
  async function renderSessions() {

    const stored = await chrome.storage.local.get(["sessions"]);
    // Fresh read every time — we never cache sessions in a variable because
    // storage can be written by background.js too (in later phases).

    const sessions = stored.sessions || [];
    // Default to empty array if nothing is stored yet.

    // ── Clear the list ───────────────────────────────────────────────────────
    sessionsList.textContent = "";
    // Setting .textContent = "" removes all child nodes at once.
    // Faster than .innerHTML = "" because it skips the HTML parser.
    // We clear and fully rebuild on every render — simple and always correct.
    // (With hundreds of sessions a diff/patch would be better; a handful is fine.)

    // ── Empty state ──────────────────────────────────────────────────────────
    if (sessions.length === 0) {
      const empty = document.createElement("p");
      // document.createElement() creates a new element NOT yet in the DOM.
      // It only becomes visible when we call .appendChild() below.

      empty.className = "sessions-empty";
      // Apply the CSS class for the centred, grey placeholder style.

      empty.textContent = "No saved sessions yet. Name one above and click Save.";
      // textContent is always safe for user-facing strings — no HTML parsing,
      // no XSS risk. The string is displayed as-is.

      sessionsList.appendChild(empty);
      // Insert the <p> into the DOM as the last child of #sessions-list.
      return;
      // Nothing else to render — exit the function.
    }

    // ── Render sessions newest-first ─────────────────────────────────────────
    const newest = sessions.slice().reverse();
    // .slice() with no arguments creates a SHALLOW COPY of the array.
    // WHY copy first? Because .reverse() mutates the array in place.
    // If we called sessions.reverse() directly, we would reverse the array
    // that is about to be written back to storage — corrupting the save order.
    // .slice().reverse() reverses the copy; the original stays in insertion order.

    for (const session of newest) {
      // "for...of" iterates over every element of an iterable (Array, Set, Map...).
      // "session" is the current element on each loop iteration.
      const row = buildSessionRow(session);
      // buildSessionRow() creates the full DOM subtree for one session.
      // It does NOT touch the DOM — it just returns a disconnected element.
      sessionsList.appendChild(row);
      // NOW it enters the DOM. The user can see it.
    }
  }
  // End of renderSessions.

  // ── buildSessionRow ──────────────────────────────────────────────────────────
  // Creates the DOM structure for a single saved session entry.
  // Returns a <div> element (not yet attached to the DOM).
  //
  // IMPORTANT: we use document.createElement + .textContent everywhere here,
  // NOT innerHTML. "session.name" comes from user input — if someone typed
  // "<img src=x onerror=alert(1)>" as a session name, innerHTML would execute it.
  // textContent treats that string as plain text and displays it literally. Safe.
  function buildSessionRow(session) {

    // ── Outer row ────────────────────────────────────────────────────────────
    const row = document.createElement("div");
    row.className = "session-row";
    // Flex container: [info block left] [delete button right]

    // ── Info block (left side) ────────────────────────────────────────────────
    const info = document.createElement("div");
    info.className = "session-info";
    // flex-direction:column — name stacked above metadata.

    // Session name (top line)
    const nameEl = document.createElement("span");
    nameEl.className = "session-name";
    nameEl.textContent = session.name;
    // textContent escapes any HTML characters in the name — XSS-safe.

    // Metadata (bottom line): window count, tab count, save date
    const metaEl = document.createElement("span");
    metaEl.className = "session-meta";

    const winCount = session.windows.length;
    // Number of browser windows captured in this session.

    const tabCount = session.windows.reduce(
      (acc, win) => acc + (win.tabs ? win.tabs.length : 0),
      0
    );
    // .reduce() sums tab counts across all windows.
    // acc  = running total (starts at 0, the second argument).
    // win  = current Window object in each iteration.
    // win.tabs guard: populate:true should always give us .tabs, but defensive
    // coding means we never crash if an edge case produces a window without tabs.

    const dateStr = new Date(session.savedAt).toLocaleDateString(undefined, {
      month: "short",
      day:   "numeric",
    });
    // new Date(isoString) re-parses the stored ISO 8601 string into a Date object.
    // .toLocaleDateString() formats it using the browser's current locale:
    //   en-US → "May 20"    fr-FR → "20 mai"    de-DE → "20. Mai"
    // First argument "undefined" means "use the browser's detected locale".
    // The options object picks just month+day — no year, no time.

    const winLabel = winCount === 1 ? "window"  : "windows";
    const tabLabel = tabCount === 1 ? "tab"     : "tabs";
    // Ternary: condition ? valueIfTrue : valueIfFalse
    // Ensures "1 window" (not "1 windows") and "1 tab" (not "1 tabs").

    metaEl.textContent = `${winCount} ${winLabel} · ${tabCount} ${tabLabel} · ${dateStr}`;
    //   is a non-breaking space — it prevents the browser from line-wrapping
    // between the number and the word (e.g. "3 windows" never breaks to "3\nwindows").
    // · is the middle dot · — a clean separator that reads better than a pipe.
    // Template literals (backticks) interpolate ${expression} inline.

    info.appendChild(nameEl);
    info.appendChild(metaEl);
    // nameEl is appended first → appears on top. metaEl → appears below.

    // ── Launch button ─────────────────────────────────────────────────────────
    // Phase 4: sends a RESTORE_SESSION message to background.js, which recreates
    // all saved windows and tabs using chrome.windows.create + chrome.tabs.create.
    const btnLaunch = document.createElement("button");
    btnLaunch.className = "btn-launch";
    btnLaunch.textContent = "Launch";
    btnLaunch.setAttribute("aria-label", "Launch session " + session.name);
    // aria-label: screen readers will say "Launch session Work Setup, button".

    btnLaunch.addEventListener("click", async () => {
      // ── Closure ───────────────────────────────────────────────────────────
      // Like buildSessionRow's other handlers, this captures "session" from the
      // enclosing scope — each Launch button knows exactly which session it
      // belongs to without us passing arguments or using data attributes.
      // It also captures "btnDelete" (declared below) so we can disable it
      // while the restore is running.

      btnLaunch.disabled = true;
      btnDelete.disabled = true;
      // Disable BOTH action buttons during the restore.
      // - Disabling Launch prevents a double-launch.
      // - Disabling Delete prevents the user from deleting the session
      //   while its windows are in the middle of being created.
      // NOTE: btnDelete is used before its declaration line in the source,
      // but that is fine because JavaScript hoists function-scoped var declarations.
      // Here we use const, which is NOT hoisted — however, the click handler is a
      // closure that runs LATER (when clicked), by which time btnDelete is fully
      // initialised. Closures capture the variable binding, not the current value,
      // so this is safe even though btnDelete appears after btnLaunch in the code.

      btnLaunch.textContent = "Launching…";
      // … is the Unicode code point for the ellipsis character "…"
      // Using the escape avoids any charset encoding issues in this source file.

      const response = await chrome.runtime.sendMessage({
        type:    "RESTORE_SESSION",
        session: session,
        // We send the entire saved session object so background.js has everything:
        // session.windows  — array of Window objects to recreate
        // session.displays — monitor layout at save time (used in future phases)
        // session.name     — for logging / debugging in the service worker
      });
      // background.js receives this, runs restoreSession(message.session),
      // and replies with { ok: true } or { error: "..." }.

      if (response.error) {
        // Something failed in background.js (API error, permission denied, etc.)
        console.error("launch failed:", response.error);
        btnLaunch.textContent = "Failed";
        setTimeout(() => {
          // Reset after 2 s so the user can try again or check the error in console.
          btnLaunch.textContent = "Launch";
          btnLaunch.disabled = false;
          btnDelete.disabled = false;
        }, 2000);
        return;
        // Exit early — don't fall through to the success block.
      }

      // ── Success ───────────────────────────────────────────────────────────
      btnLaunch.classList.add("launched");
      // The .launched CSS class turns the button green — matches the Save button's
      // "success" colour to create a consistent visual language across the extension.

      btnLaunch.textContent = "Launched!";
      // The windows are now opening in Chrome. We give brief visual confirmation
      // rather than closing the popup immediately, so the user can launch another
      // session or make other changes before closing.

      setTimeout(() => {
        btnLaunch.textContent = "Launch";
        btnLaunch.classList.remove("launched");
        // Remove the green class so the button returns to its normal navy colour.
        btnLaunch.disabled = false;
        btnDelete.disabled = false;
        // Re-enable both buttons — the restore is complete.
      }, 2000);
    });
    // End of launch click handler.

    // ── Delete button ─────────────────────────────────────────────────────────
    const btnDelete = document.createElement("button");
    btnDelete.className = "btn-delete";
    btnDelete.textContent = "Delete";
    btnDelete.setAttribute("aria-label", "Delete session " + session.name);
    // aria-label: "Delete session Work Setup, button" for screen readers.

    btnDelete.addEventListener("click", async () => {
      // Each Delete button closes over its own "session" variable (closure).
      // See the Launch button's closure comment above for the full explanation.

      btnDelete.disabled = true;
      // Prevent double-clicks from triggering two concurrent deletes.

      const stored = await chrome.storage.local.get(["sessions"]);
      const sessions = stored.sessions || [];

      const updated = sessions.filter((s) => s.id !== session.id);
      // Array.filter() returns a NEW array keeping only items where the callback
      // returns true. We keep every session whose ID is NOT the one being deleted.
      // filter() never mutates the original array — it always returns a new one.
      // This is the immutable-update pattern: read → derive new state → write back.

      await chrome.storage.local.set({ sessions: updated });
      // Write the array-minus-deleted-item back to storage.

      await renderSessions();
      // Rebuild the list — the deleted row is absent because it is no longer in storage.
    });
    // End of delete click handler.

    // ── Assemble and return ───────────────────────────────────────────────────
    const actions = document.createElement("div");
    actions.className = "row-actions";
    // .row-actions is a flex container (see popup.css) that groups Launch + Delete
    // side by side. Grouping them as one element makes the row's space-between
    // layout work correctly: .session-info pushes left, .row-actions pushes right,
    // and both buttons stay together as a unit.

    actions.appendChild(btnLaunch);
    actions.appendChild(btnDelete);
    // Launch is first (leftmost in the group) — positive actions before destructive ones.
    // Delete is last — users are less likely to accidentally click the rightmost button.

    row.appendChild(info);
    row.appendChild(actions);
    // Row final structure: [.session-info] [.row-actions → [Launch][Delete]]

    return row;
    // Return the assembled element to renderSessions(), which appends it to the DOM.
  }
  // End of buildSessionRow.

  // ── "Show Current Setup" scan handler (Phase 2, unchanged) ─────────────────
  btnScan.addEventListener("click", async () => {
    btnScan.disabled = true;
    btnScan.textContent = "Loading…";
    outputPre.textContent = "";

    try {
      const windows = await chrome.windows.getAll({ populate: true });
      // chrome.windows IS available in popup context — no message needed.

      const displays = await chrome.runtime.sendMessage({ type: "GET_DISPLAY_INFO" });
      // chrome.system is NOT available in popup context — must go through background.

      if (displays && displays.error) {
        throw new Error("Display query failed: " + displays.error);
      }

      const result = {
        timestamp:  new Date().toISOString(),
        summary: {
          windowCount:  windows.length,
          tabCount:     windows.reduce((acc, w) => acc + (w.tabs ? w.tabs.length : 0), 0),
          displayCount: displays.length,
        },
        windows,
        displays,
      };

      outputPre.textContent = JSON.stringify(result, null, 2);
      outputSection.classList.remove("hidden");

    } catch (error) {
      outputPre.textContent = "Error: " + error.message;
      outputSection.classList.remove("hidden");
      console.error("scan failed:", error);
    } finally {
      btnScan.disabled = false;
      btnScan.textContent = "Show Current Setup";
    }
  });

  // ── Copy button handler (Phase 2, unchanged) ─────────────────────────────────
  btnCopy.addEventListener("click", async () => {
    const text = outputPre.textContent;
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
      btnCopy.textContent = "Copied!";
      btnCopy.classList.add("copied");
      setTimeout(() => {
        btnCopy.textContent = "Copy";
        btnCopy.classList.remove("copied");
      }, 1500);
    } catch (err) {
      btnCopy.textContent = "Failed";
      console.error("clipboard write failed:", err);
    }
  });

});
// End of DOMContentLoaded.