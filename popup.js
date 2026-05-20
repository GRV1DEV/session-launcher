// popup.js — runs when the user opens the extension popup
//
// In MV3, this script executes in an "isolated world":
//   - It CAN access the Chrome extension APIs (chrome.tabs, chrome.storage, etc.)
//   - It CANNOT access JavaScript variables from the web page the user is looking at
//   - It shares NO state with background.js (each popup open = fresh script run)
//
// The script is loaded at the bottom of popup.html, so the DOM is already built
// by the time this code runs — we don't need to wait for DOMContentLoaded.

// ── DOMContentLoaded guard ────────────────────────────────────────────────────
// Even though the script tag is at the bottom of <body>, wrapping code in this
// event listener is a defensive habit: it ensures DOM elements exist before we
// query them. If you ever move the script tag to <head>, this protects you.
document.addEventListener("DOMContentLoaded", () => {
  // "DOMContentLoaded" fires when the HTML has been fully parsed into DOM nodes.
  // The arrow function () => { ... } is the callback Chrome calls when that happens.

  // ── Log startup ────────────────────────────────────────────────────────────
  // console.log() writes to the popup's DevTools console.
  // To open it: right-click the extension popup → "Inspect" → Console tab.
  // This line is useful during development; remove it before shipping.
  console.log("Session Launcher popup opened.");

  // ── Query the active tab ────────────────────────────────────────────────────
  // chrome.tabs.query() asks Chrome for a list of tabs matching a filter object.
  // { active: true, currentWindow: true } means: the focused tab in the current window.
  // This requires the "tabs" permission we declared in manifest.json.
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    // The callback receives an array of matching Tab objects.
    // We asked for the single active tab, so tabs[0] is what we want.

    const activeTab = tabs[0];
    // Destructure the first element. const means this variable won't be reassigned.

    if (activeTab) {
      // Guard: if for some reason no active tab is found, skip the log.
      // This can happen during extension startup races — always check before accessing.

      console.log("Active tab URL:", activeTab.url);
      // activeTab.url is the full URL string of the current page.
      // Note: reading .url requires the "tabs" permission. Without it, .url is undefined.

      console.log("Active tab title:", activeTab.title);
      // activeTab.title is the page <title> text shown in the browser tab.
    }
  });
  // End of chrome.tabs.query callback.
  // Everything inside the callback runs ASYNCHRONOUSLY — Chrome fetches the tab
  // data and calls our function when it's ready. Code after this block runs first!

});
// End of DOMContentLoaded listener.
