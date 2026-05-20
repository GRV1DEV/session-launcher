// background.js — the extension's service worker
//
// What is a service worker?
//   A service worker is a JavaScript file that runs in the BACKGROUND, separate
//   from any web page or popup. Chrome starts it when it's needed and stops it
//   when it's idle (to save memory/battery). This means:
//     ✓ It wakes up to handle events (tab changes, alarms, messages from popup)
//     ✓ It goes back to sleep between events
//     ✗ It has NO access to the DOM (no document, no window)
//     ✗ It cannot store data in regular variables between wake-ups
//       (use chrome.storage instead for persistence)
//
// In MV2 (the old standard), this was a "background page" — a persistent HTML
// page running in the background. MV3 replaced that with service workers for
// better performance and privacy.

// ── Installation event ────────────────────────────────────────────────────────
// chrome.runtime.onInstalled fires when:
//   1. The extension is installed for the first time
//   2. The extension is updated to a new version
//   3. Chrome is updated (rarely used)
// This is the right place to set up initial data in chrome.storage or create alarms.
chrome.runtime.onInstalled.addListener((details) => {
  // "details" is an object with info about why onInstalled fired:
  //   details.reason === "install"  → first-time install
  //   details.reason === "update"   → version bump
  //   details.reason === "chrome_update" → Chrome itself updated

  console.log("Session Launcher installed. Reason:", details.reason);
  // This log appears in the SERVICE WORKER DevTools console, NOT the popup console.
  // To see it: chrome://extensions → Session Launcher → "Service Worker" link → Console.

  if (details.reason === "install") {
    // Only run setup logic on the very first install, not on every update.
    // This prevents overwriting data the user has saved in previous versions.

    // chrome.storage.local.set() saves key-value pairs to local storage.
    // Data persists across browser restarts (unlike regular JS variables).
    // The second argument is a callback that runs when the save completes.
    chrome.storage.local.set({ sessions: [] }, () => {
      // { sessions: [] } stores an empty array under the key "sessions".
      // In later phases, we'll push saved session objects into this array.
      console.log("Initialized empty sessions store.");
    });
  }
});
// End of onInstalled listener.

// ── Message listener ──────────────────────────────────────────────────────────
// chrome.runtime.onMessage fires whenever any part of the extension calls
// chrome.runtime.sendMessage(). It is the backbone of communication between:
//   popup.js  <-->  background.js  (and content scripts, if we add them later)
//
// The listener receives three arguments:
//   message    — the plain object the sender passed to sendMessage()
//   sender     — metadata about who sent the message (tab, frame, extension id)
//   sendResponse — a function you call to send data back to the sender
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // We use message.type as a routing key — a convention that scales well
  // when the extension has many different message types in later phases.
  // Think of it like an HTTP method+path: "what action are you requesting?"

  if (message.type === "RESTORE_SESSION") {
    // ── Why we use an async IIFE here ────────────────────────────────────────
    // restoreSession() is an async function — it needs to await multiple Chrome
    // API calls in sequence (create window, then create each tab, then update
    // window state). We can't make the onMessage listener itself async because
    // that would return a Promise instead of the literal "true" Chrome needs
    // to keep the message channel open (same constraint as GET_DISPLAY_INFO).
    //
    // The solution: an IIFE (Immediately Invoked Function Expression).
    //   (async () => { ... })()
    //   ^^^^^^^^^^^^^^^^^^^^^^^^^
    //   This creates an async arrow function and calls it immediately.
    //   The IIFE runs asynchronously in the background.
    //   The outer listener function reaches "return true" synchronously,
    //   satisfying Chrome's channel-keep-open check.
    //   When the IIFE eventually calls sendResponse, the channel is still open.
    (async () => {
      try {
        await restoreSession(message.session);
        // message.session is the full session object sent from popup.js.
        // restoreSession() iterates over session.windows and recreates each
        // window with its tabs, position, size, and state.

        sendResponse({ ok: true });
        // Tell popup.js the restore completed successfully.
        // popup.js shows "Launched!" feedback on receiving { ok: true }.

      } catch (err) {
        sendResponse({ error: err.message });
        // If restoreSession() throws (e.g. a Chrome API call rejects),
        // forward the error message to popup.js for display.
        console.error("RESTORE_SESSION failed:", err);
      }
    })();
    // The IIFE starts here. The outer function continues synchronously below.

    return true;
    // Synchronous return true — keeps the channel open while the IIFE runs.
  }

  if (message.type === "CAPTURE_SESSION") {
    // ── Why we handle both queries here, not just the display one ────────────
    // chrome.system.display is unavailable in popup context (Phase 2 lesson).
    // We could call chrome.windows.getAll from popup.js — that API IS available
    // there — but bundling both into one background message is better because:
    //   1. One sendMessage round-trip instead of two (faster, fewer moving parts)
    //   2. Promise.all runs both queries at the SAME instant (truly parallel),
    //      so the captured snapshot is as consistent as possible.
    //   3. All Chrome API calls live in background.js — popup.js stays UI-only.

    Promise.all([
      // Promise.all() takes an array of Promises and returns a new Promise that:
      //   - resolves when ALL of them resolve (with an array of their results)
      //   - rejects immediately if ANY of them reject (fail-fast behaviour)
      // The two queries run in parallel — Chrome doesn't wait for the first
      // to finish before starting the second.

      chrome.windows.getAll({ populate: true }),
      // populate:true includes the nested .tabs array on each Window object.
      // Without it, windows would only have IDs and state — no tab data.

      chrome.system.display.getInfo(),
      // Returns an array of DisplayInfo objects, one per connected monitor.
      // Only available in service worker context — that's why we're here.
    ])
    .then(([windows, displays]) => {
      // Array destructuring: the resolved value of Promise.all is an array
      // [result0, result1] matching the order of the input array.
      // [windows, displays] unpacks that array into two named variables.
      sendResponse({ windows, displays });
      // Send both results back as a plain object.
      // { windows, displays } is ES6 shorthand for { windows: windows, displays: displays }.
      // popup.js receives this as the resolved value of its await sendMessage().
    })
    .catch((err) => {
      sendResponse({ error: err.message });
      // If either query rejects, send the error message back.
      // popup.js checks for .error and throws it as a real Error.
    });

    return true;
    // CRITICAL: synchronous return true keeps the message channel open
    // while Promise.all is running. Same reason as GET_DISPLAY_INFO above.
  }

  if (message.type === "GET_DISPLAY_INFO") {
    // ── Why this handler cannot be "async" ──────────────────────────────
    // You might expect to write:  addListener(async (message, ...) => { ... })
    // That looks clean, but it breaks the response mechanism.
    //
    // Chrome checks the RETURN VALUE of this listener function to decide
    // whether to keep the message channel open:
    //   return true  → "I will call sendResponse later, keep the channel open"
    //   return false / undefined → "I'm done, close the channel now"
    //
    // An async function ALWAYS returns a Promise object (even "return true"
    // becomes Promise<true>). Chrome sees a non-boolean truthy value and
    // closes the channel immediately — sendResponse is then called on a dead
    // channel and the popup's awaited Promise never resolves.
    //
    // The correct pattern: synchronous listener + .then() for the async work
    // + explicit "return true" so Chrome holds the channel open.

    chrome.system.display.getInfo()
      // .then() is the Promise callback style — equivalent to await but usable
      // inside a synchronous function. It runs when getInfo() resolves.
      .then((displays) => {
        // "displays" is the array of DisplayInfo objects from the Chrome platform.
        sendResponse(displays);
        // sendResponse() sends "displays" back to whoever called sendMessage().
        // In popup.js, the awaited Promise resolves to this value.
      })
      .catch((err) => {
        // .catch() runs if getInfo() rejects (e.g. permission missing at runtime).
        sendResponse({ error: err.message });
        // We send back a plain object with an "error" key instead of throwing,
        // because sendResponse cannot propagate a real Error across the message
        // channel — it only serialises plain JSON-compatible values.
        // popup.js checks for { error: "..." } and re-throws it as a real Error.
        console.error("GET_DISPLAY_INFO failed:", err);
      });

    return true;
    // ^^^ CRITICAL: this synchronous "return true" tells Chrome:
    // "this listener will call sendResponse asynchronously — keep the port open."
    // Without it, the message channel closes before .then() fires,
    // and popup.js receives undefined instead of the display array.
  }
  // If message.type is anything else, we fall through without returning true,
  // which tells Chrome this listener doesn't handle that message type.
});
// End of onMessage listener.

// ── isRestorable ──────────────────────────────────────────────────────────────
// Returns true if a URL can be opened by a Chrome extension via chrome.tabs.create
// or chrome.windows.create. Extensions cannot navigate to internal Chrome URLs,
// browser-generated pages, or script pseudo-protocols.
function isRestorable(url) {
  if (!url) return false;
  // An empty or undefined URL is not restorable — nothing to navigate to.

  if (url.startsWith("chrome://"))            return false;
  // chrome:// is Chrome's internal URL scheme: settings, flags, extensions, newtab, etc.
  // Extensions can't open these (except Chrome opens newtab automatically when url
  // is undefined in tabs.create — that's our fallback).

  if (url.startsWith("chrome-extension://"))  return false;
  // chrome-extension:// URLs belong to specific installed extensions.
  // Opening another extension's page would be a security boundary violation.

  if (url.startsWith("about:"))               return false;
  // about:blank, about:newtab, etc. — browser-internal pseudo-pages.

  if (url.startsWith("data:"))                return false;
  // data: URIs can be huge blobs and won't restore meaningful content.

  if (url.startsWith("javascript:"))          return false;
  // javascript: pseudo-protocol — opening one would execute arbitrary code.

  return true;
  // All other schemes (https://, http://, file://) are safe to open.
  // Note: file:// requires the user to grant "Allow access to file URLs" in
  // chrome://extensions for the extension — it will silently fail without it.
}

// ── restoreSession ─────────────────────────────────────────────────────────────
// Recreates all windows and tabs from a saved session.
// Called by the RESTORE_SESSION message handler above.
// "async" because we await multiple chrome.windows and chrome.tabs API calls.
async function restoreSession(session) {

  for (const win of session.windows) {
    // Iterate over every window that was open when the session was saved.
    // "win" is a Window object from chrome.windows.getAll({ populate: true }):
    //   { id, type, state, focused, left, top, width, height, tabs: [...] }

    if (win.type === "devtools") continue;
    // Skip DevTools windows — restoring them opens a useless blank devtools panel.
    // We do restore "popup" type windows (e.g. OAuth flows, picture-in-picture)
    // because those are legitimate content windows the user might want back.

    const rawTabs = win.tabs || [];
    // win.tabs exists because we saved with populate:true. The || [] is a safety net
    // against malformed data (e.g. a session saved by an older version of the extension).

    if (rawTabs.length === 0) continue;
    // A window with no tabs can't be meaningfully restored — skip it.

    // ── Map each tab to a restorable form ──────────────────────────────────
    const tabs = rawTabs.map((tab) => ({
      url:    isRestorable(tab.url) ? tab.url : undefined,
      // isRestorable() filters out chrome://, about:, etc.
      // undefined is intentional: chrome.tabs.create with url:undefined opens
      // the new tab page, which is better than an error or a blank page.

      active: !!tab.active,
      // !! coerces to a strict boolean. tab.active should already be boolean
      // but Chrome storage round-trips through JSON, so this is defensive.

      pinned: !!tab.pinned,
      // Pinned tabs are anchored to the left of the tab strip and can't be closed
      // by accident. Preserve the user's pinned state.

      index: tab.index,
      // The saved position in the tab strip (0-based left-to-right).
      // Chrome uses this as a hint when creating tabs; the final order may
      // shift slightly if tabs are created in a race, but is usually correct.
    }));

    // ── Build window creation options ───────────────────────────────────────
    const createOpts = {
      url:     tabs[0].url,
      // The first tab's URL. undefined → new tab page.
      // chrome.windows.create requires at least a url (or nothing for new tab page).

      focused: false,
      // Don't steal focus from the popup or the user's current window as we
      // create restored windows in the background. The user can click in when ready.
    };

    if (win.state === "normal") {
      // Only restore pixel position and size for normal (non-maximized) windows.
      // For maximized/fullscreen windows, left/top/width/height are meaningless
      // and passing them can confuse the window manager on some OS.
      createOpts.left   = win.left;
      createOpts.top    = win.top;
      // left and top can be NEGATIVE on multi-monitor setups where a secondary
      // monitor sits to the left of or above the primary. Chrome handles this correctly.
      createOpts.width  = win.width;
      createOpts.height = win.height;
    }

    // ── Create the window with its first tab ───────────────────────────────
    const newWin = await chrome.windows.create(createOpts);
    // chrome.windows.create() returns a Promise resolving to the new Window object.
    // We await it so we have newWin.id before creating the remaining tabs below.
    // newWin.id is Chrome's integer ID for the newly created window — it's different
    // from win.id (which was the ID at save time and is now stale/closed).

    // ── Add remaining tabs one by one ──────────────────────────────────────
    // We use a sequential for loop rather than Promise.all so tabs are created
    // in index order. With Promise.all, all creates start simultaneously and
    // Chrome may assign positions out of order.
    for (let i = 1; i < tabs.length; i++) {
      await chrome.tabs.create({
        windowId: newWin.id,
        // Links this tab to the window we just created. Without this, the tab
        // would open in Chrome's currently focused window instead.

        url:      tabs[i].url,
        // undefined → new tab page for any non-restorable saved URL.

        active:   tabs[i].active,
        // true for the tab that was active when the session was saved.
        // Only one tab per window should have active:true — the saved data
        // ensures this because Chrome always marks exactly one tab active.

        pinned:   tabs[i].pinned,
        // Restore the pinned state.

        index:    tabs[i].index,
        // Hint to Chrome where to place this tab in the strip.
      });
    }

    // ── Restore window state (maximized / fullscreen / minimized) ──────────
    if (win.state && win.state !== "normal") {
      await chrome.windows.update(newWin.id, { state: win.state });
      // chrome.windows.update() modifies an existing window.
      // We apply the state AFTER all tabs are created because:
      //   1. Maximizing before tabs load can cause layout flicker on some OS.
      //   2. chrome.windows.create with state:"maximized" isn't reliably supported.
      // "maximized"  → fills the screen (OS window manager handles it)
      // "fullscreen" → browser enters fullscreen mode
      // "minimized"  → window collapses to the taskbar
    }
  }
  // All windows (and their tabs) have been recreated.
}

// ── Tab update listener ───────────────────────────────────────────────────────
// chrome.tabs.onUpdated fires every time a tab changes state.
// "changeInfo" tells you WHAT changed (loading status, URL, title, favicon, etc.)
// "tab" is the full Tab object with all current properties.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // tabId: the integer ID Chrome assigned to this tab
  // changeInfo: an object with only the properties that changed this event
  // tab: the full Tab object (same shape as what chrome.tabs.query returns)

  // changeInfo.status === "complete" means the page has finished loading.
  // We filter to "complete" so we don't fire on every intermediate loading event.
  if (changeInfo.status === "complete") {
    console.log(`Tab ${tabId} finished loading: ${tab.url}`);
    // Template literals (backtick strings) let you embed variables with ${}.
    // This is just a placeholder log; Phase 2 will add real session tracking here.
  }
});
// End of onUpdated listener.
