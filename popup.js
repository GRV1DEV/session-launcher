// popup.js — Phase 2: query windows + displays and render as JSON
//
// New Chrome APIs used this phase:
//   chrome.windows.getAll()        — returns every open browser window and its tabs
//   chrome.system.display.getInfo() — returns every connected monitor's properties
//
// Key concept: Promises vs Callbacks
//   The older Chrome extension APIs use callbacks:
//     chrome.tabs.query({}, function(results) { ... })
//   Modern Chrome also supports the same APIs returning Promises:
//     const results = await chrome.tabs.query({})
//   We use the Promise / async-await style here because it reads top-to-bottom
//   like synchronous code, making it much easier to follow for a learning dev.

// ─────────────────────────────────────────────────────────────────────────────
// Entry point: wait for the DOM to be ready before we touch any elements.
// ─────────────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  // This fires once Chrome has finished parsing popup.html into DOM nodes.
  // Everything below is safe to run because all elements now exist.

  // ── Grab DOM references ────────────────────────────────────────────────────
  // We look up elements ONCE here and store them in variables.
  // This is faster than calling getElementById() repeatedly on every click.

  const btnScan = document.getElementById("btn-scan");
  // getElementById() searches the DOM for the element with id="btn-scan".
  // Returns the element object, or null if nothing matches.
  // We named our variable with the "btn" prefix to make its role obvious.

  const outputSection = document.getElementById("output-section");
  // The container div that wraps the header bar + JSON block.
  // Starts hidden via the "hidden" CSS class; we will remove that class on click.

  const outputPre = document.getElementById("output-pre");
  // The <pre> element where the formatted JSON string will be placed.

  const btnCopy = document.getElementById("btn-copy");
  // The small "Copy" button inside the output header bar.

  // ── Button click handler ────────────────────────────────────────────────────
  // addEventListener() registers a function to call when an event fires.
  // "click" is the event name; the arrow function is the handler.
  btnScan.addEventListener("click", async () => {
    // "async" marks this function as asynchronous.
    // Inside an async function we can use "await" to pause and wait for a
    // Promise to resolve before continuing, without blocking the browser.

    // ── Loading state ──────────────────────────────────────────────────────
    btnScan.disabled = true;
    // Setting .disabled = true adds the HTML "disabled" attribute to the button.
    // This triggers the .btn-primary:disabled CSS rule (greyed out, no-pointer cursor)
    // AND prevents the click event from firing again while we are loading.

    btnScan.textContent = "Loading…";
    // .textContent replaces the visible text inside the element.
    // … is the Unicode ellipsis character (…) — safer than a raw "…" in source.

    outputPre.textContent = "";
    // Clear any previous results so stale data does not flash before new data arrives.

    try {
      // try/catch is how JavaScript handles errors from asynchronous operations.
      // If any "await" inside the try block throws, execution jumps to the catch block.

      // ── Query 1: All windows and their tabs ──────────────────────────────
      // chrome.windows.getAll() returns a Promise that resolves to an array of
      // Window objects. Each Window represents a separate Chrome browser window.
      //
      // The options object { populate: true } is the key argument:
      //   populate: true  -> include the "tabs" array inside each Window object
      //   populate: false -> (default) the "tabs" array is absent, saving memory
      //
      // Without populate:true you would only get window IDs and state — no tab info.
      // The "tabs" permission in manifest.json is required to see tab .url and .title.
      const windows = await chrome.windows.getAll({ populate: true });
      // After this await resolves, "windows" is an array like:
      // [
      //   {
      //     id: 1,
      //     focused: true,
      //     state: "normal",       // "normal" | "minimized" | "maximized" | "fullscreen"
      //     type: "normal",        // "normal" | "popup" | "devtools"
      //     tabs: [
      //       { id: 10, url: "https://...", title: "...", active: true, index: 0 },
      //       { id: 11, url: "https://...", title: "...", active: false, index: 1 }
      //     ]
      //   }
      // ]

      // ── Query 2: Display info via message to background ──────────────────
      // WHY we can't call chrome.system.display here directly:
      //   chrome.system is only available in the service worker (background.js).
      //   Extension popup pages run in a different, more restricted context where
      //   that namespace simply does not exist — hence the original error:
      //   "Cannot read properties of undefined (reading 'display')".
      //
      // The fix: Chrome's message passing system.
      //   popup.js  →  chrome.runtime.sendMessage({ type: "GET_DISPLAY_INFO" })
      //   background.js receives it, calls chrome.system.display.getInfo(), replies.
      //   popup.js  ←  the reply lands here as the resolved value of the Promise.
      //
      // chrome.runtime.sendMessage() in MV3 returns a Promise (no callback needed).
      // We "await" it so execution pauses here until background.js calls sendResponse.
      const displays = await chrome.runtime.sendMessage({ type: "GET_DISPLAY_INFO" });
      // "displays" is now whatever background.js passed to sendResponse().
      // If background.js sent back an error object, the check below catches it.
      //
      // Shape of each DisplayInfo object (set by the Chrome platform, not us):
      // {
      //   id: "DP-1",
      //   name: "HP Z27k G3 4K",
      //   isPrimary: true,
      //   isEnabled: true,
      //   bounds:    { left: 0, top: 0, width: 3840, height: 2160 },
      //   workArea:  { left: 0, top: 40, width: 3840, height: 2120 },
      //   dpiX: 163, dpiY: 163,
      //   rotation: 0
      // }
      // bounds   = full physical pixel dimensions of the screen.
      // workArea = usable area after subtracting the OS taskbar / dock.

      if (displays && displays.error) {
        // background.js wraps errors in { error: "message string" } before sending.
        // We turn that into a real thrown Error so the catch block below handles it
        // the same way it handles any other failure in this try block.
        throw new Error("Display query failed: " + displays.error);
      }

      // ── Build the result object ──────────────────────────────────────────
      // We wrap both results in a single object so the JSON output is organised.
      const result = {

        // new Date().toISOString() gives an ISO 8601 timestamp, e.g.:
        // "2026-05-20T00:45:23.412Z"  — the "Z" means UTC time zone.
        timestamp: new Date().toISOString(),

        summary: {
          windowCount: windows.length,
          // .length on an array returns how many items are in it.

          tabCount: windows.reduce((acc, win) => acc + (win.tabs ? win.tabs.length : 0), 0),
          // .reduce() iterates the array and accumulates a single value.
          // acc = running total, win = current window in each iteration.
          // win.tabs can be undefined if populate failed, so we guard with a ternary.
          // The ", 0" at the end sets the accumulator starting value to 0.

          displayCount: displays.length,
        },

        windows: windows,
        // The full windows array — all Window objects including nested tab arrays.

        displays: displays,
        // The full displays array — all DisplayInfo objects.
      };

      // ── Format as pretty JSON ────────────────────────────────────────────
      // JSON.stringify() converts a JavaScript object to a JSON string.
      // Arguments:
      //   1. The value to convert — our result object.
      //   2. replacer — null means include all properties (no filtering).
      //   3. indent  — 2 means 2 spaces per nesting level.
      // Without the 3rd argument you get one long unreadable line.
      const formatted = JSON.stringify(result, null, 2);

      // ── Render the result ────────────────────────────────────────────────
      outputPre.textContent = formatted;
      // .textContent sets the raw text inside the <pre> element.
      // We use textContent (not innerHTML) because:
      //   innerHTML parses the string as HTML — a security risk if the JSON
      //   contains "<script>" from a malicious tab title or URL.
      //   textContent treats the string as plain text, escaping < > & safely.
      //   Rule of thumb: always use textContent when inserting API/user data.

      // ── Show the output section ──────────────────────────────────────────
      outputSection.classList.remove("hidden");
      // classList is a DOMTokenList that lets you add/remove/toggle CSS class names.
      // .remove("hidden") takes away the "hidden" class -> element becomes visible.
      // The element goes from display:none to its CSS-defined display value (flex).

    } catch (error) {
      // If anything in the try block threw (API error, permission denied, etc.),
      // "error" is the Error object — .message describes what went wrong.

      outputPre.textContent = "Error: " + error.message;
      // Show the error message in the output area so the user knows what failed.

      outputSection.classList.remove("hidden");
      // Show the output section even on error so the message is readable.

      console.error("scan failed:", error);
      // console.error() logs with a red icon and a stack trace in DevTools.

    } finally {
      // "finally" runs ALWAYS — whether try succeeded or catch ran.
      // This is the right place to reset UI state that must always be restored.

      btnScan.disabled = false;
      // Re-enable the button so the user can click "Show Current Setup" again.

      btnScan.textContent = "Show Current Setup";
      // Reset the button label back to its original text.
    }
  });
  // End of "click" handler.

  // ── Copy button handler ────────────────────────────────────────────────────
  btnCopy.addEventListener("click", async () => {
    // Reads the current text from the <pre> and writes it to the system clipboard.

    const text = outputPre.textContent;
    // .textContent reads whatever text is currently in the <pre> element.

    if (!text) return;
    // Guard: if the <pre> is empty for any reason, bail out immediately.
    // "return" with no value exits the async function at once.

    try {
      await navigator.clipboard.writeText(text);
      // navigator.clipboard is the modern Clipboard API available in extension popups.
      // .writeText() returns a Promise that resolves when writing succeeds.
      // We "await" it so we know the copy worked before showing feedback.
      // Note: this API requires the document to be focused — popups always are.

      btnCopy.textContent = "Copied!";
      btnCopy.classList.add("copied");
      // Add the "copied" CSS class to turn the button text green — success signal.

      setTimeout(() => {
        // setTimeout() schedules a function to run after a delay (in milliseconds).
        // 1500ms = 1.5 seconds — long enough for the user to see "Copied!" feedback.
        btnCopy.textContent = "Copy";
        btnCopy.classList.remove("copied");
        // Reset back to default state after the delay.
      }, 1500);

    } catch (err) {
      // Clipboard write can fail if the popup loses focus mid-operation (rare).
      btnCopy.textContent = "Failed";
      console.error("clipboard write failed:", err);
    }
  });
  // End of copy button handler.

});
// End of DOMContentLoaded listener.