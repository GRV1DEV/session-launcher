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
