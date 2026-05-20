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
