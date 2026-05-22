# ⚡ Session Launcher

A Chrome extension for saving and restoring browser sessions. Capture every open window and tab with one click, name it, and launch it back at any time — with full multi-monitor position support.

**Version:** v0.5 · Manifest V3

---

## Features

- **Save sessions** — snapshots all open windows and their tabs, including positions, sizes, pinned state, and active tab
- **Restore sessions** — reopens every window on the correct monitor (multi-monitor aware)
- **Delete sessions** — remove sessions you no longer need
- **Session metadata** — shows window count, tab count, and save date at a glance
- **Keyboard shortcut** — hit Enter in the name field to save without reaching for the mouse
- Neon dark UI

---

## Installation (Developer Mode)

Chrome extensions not published to the Web Store must be loaded manually.

1. **Download or clone this repo**

   ```
   git clone https://github.com/GRV1DEV/session-launcher.git
   ```

   Or download and unzip the repository as a folder.

2. **Open Chrome Extensions**

   Navigate to `chrome://extensions` in your address bar.

3. **Enable Developer Mode**

   Toggle the **Developer mode** switch in the top-right corner of the page.

4. **Load the extension**

   Click **Load unpacked**, then select the `session-launcher` folder (the one containing `manifest.json`).

5. **Pin it (optional)**

   Click the puzzle-piece icon in the Chrome toolbar → find **Session Launcher** → click the pin icon so it's always visible.

---

## Usage

1. Click the **⚡ SESSION LAUNCHER** icon in the toolbar.
2. Type a name for the current session (e.g. `Morning setup`).
3. Click **SAVE** (or press **Enter**).
4. Your saved sessions appear below. Click **LAUNCH** to restore a session or **DEL** to remove it.

---

## Permissions

| Permission | Why it's needed |
|---|---|
| `tabs` | Read the URL, title, pinned state, and position of every open tab |
| `storage` | Persist saved sessions across browser restarts |
| `sessions` | Access session data via the Chrome Sessions API |
| `system.display` | Read monitor layout for accurate multi-monitor window placement |

---

## Project Structure

```
session-launcher/
├── manifest.json     # Extension manifest (MV3)
├── background.js     # Service worker — all Chrome API calls live here
├── popup.html        # Extension popup markup
├── popup.css         # Neon dark theme styles
├── popup.js          # Popup UI logic (storage reads, DOM, messages to background)
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## How It Works

- **Saving:** `popup.js` sends a `CAPTURE_SESSION` message to the service worker. `background.js` runs `chrome.windows.getAll` and `chrome.system.display.getInfo` in parallel, then returns the combined snapshot. The popup stores it under a user-given name in `chrome.storage.local`.

- **Restoring:** The popup sends a `RESTORE_SESSION` message with the saved session object. The service worker iterates over the saved windows, calls `chrome.windows.create` with the original position and size, then sequentially adds each tab in order. Finally it applies the saved window state (`maximized`, `minimized`, `fullscreen`) so each window lands in the right place on the right monitor.

---

## License

MIT
