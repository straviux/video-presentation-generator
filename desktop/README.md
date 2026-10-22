# Video Presentation Generator, desktop app

A Tauri 2 desktop launcher for the Video Presentation Generator. It is a
shell over the existing engine, not a copy of it: the engine stays your
regular clone of this repository (the `app/` and `render-engine/` folders),
and the desktop app simply starts it, waits for it, and shows it in a
native window. No PowerShell, no `npm start`, no browser tab.

Because the engine is never bundled or copied, updates work exactly as
before: `git pull` in the engine clone updates the app. The desktop shell
itself rarely needs rebuilding.

## Prerequisites (Windows)

- The Rust and Tauri 2 prerequisites already installed for the CLI
  Emulator Manager (Rust toolchain, Microsoft C++ Build Tools, WebView2).
- Node.js 24 or newer on PATH (the engine server runs on it).
- FFmpeg on PATH (the engine renders and mixes music with it).
- An engine clone: this repository, cloned anywhere on disk, with its
  dependencies installed once (`npm run setup` at the clone root).
- The Chrome shell HyperFrames renders with, fetched once from the clone
  root with `npm run setup:browser`.

## Build and run

From this `desktop/` folder:

```powershell
npm install
npx tauri icon icon.svg
```

The icon step generates the `src-tauri/icons/` set from `icon.svg`. It
only needs to be redone if the icon changes, and it must be done once
before the first build because the generated icons are not committed.

Then:

```powershell
npm run tauri dev     # live run while developing
npm run tauri build   # NSIS installer in src-tauri/target/release/bundle/nsis/
```

The installer uses a per-user install (no admin prompt).

## First launch

1. On first launch the app asks you to choose the engine folder: pick
   the root of your clone (the folder that contains `app` and
   `render-engine`). The pick is validated (it must contain
   `app/server.js` and a `render-engine` folder) and remembered in a
   small `settings.json` in the app config folder.
2. The app checks whether the engine server is already listening on
   port 3210. If yes, it just opens it. If not, it starts
   `node server.js` from the engine's `app` folder and waits until the
   server answers, up to about 30 seconds.
3. The window loads the builder at http://127.0.0.1:3210/.

If Node is missing from PATH, the splash says so plainly instead of
hanging: install Node 24 or newer and relaunch.

To point the app at a different clone without the picker, set the
environment variable `VPG_ENGINE_DIR` to the clone root before
launching; it takes precedence over the saved folder.

## Troubleshooting

- **Port 3210 is already busy:** an engine server is already running
  (for example from an earlier `npm start`). The desktop app detects it
  and attaches to it instead of starting a second one.
- **Closing the app:** only a server the app started itself is stopped.
  A server that was already running when you launched is left alone.
- **Wrong folder saved:** if the saved folder stops being a valid
  engine (moved clone, deleted files), the splash shows an error with a
  "Change engine folder" button to pick again.
- **Server did not come up:** check the engine works on its own first
  (`npm start` in the clone root), then use Retry on the splash.
