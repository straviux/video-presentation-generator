# Video Presentation Generator

A local web app that generates short event presentation videos, about 1 minute, from photos and messages. Built for YSE/office use: birthdays, appreciations, awards, and similar celebrations.

You fill in a builder form (celebrant, photos with captions, greeting messages, an optional photo collage), click **Generate Video**, and the app renders a real MP4 for download.

Current status: the **Birthday** template is fully working end to end. Appreciation, Awards, and Retirement templates are planned and show as "Coming soon" in the app.

## How it works

- `app/` is the local web app (Node + Express). It serves the builder UI, accepts photo uploads, and manages render jobs.
- `render-engine/` holds the rendering stack: [HyperFrames](https://github.com/heygen-com/hyperframes) compositions (plain HTML with data-attribute timing), GSAP for animation, headless Chrome for frame capture, and FFmpeg for encoding.
- `render-engine/birthday-template/` is the config-driven Birthday template: edit `config.json`, run `node generate.mjs`, then render. The app automates exactly this flow per job.

Scene pacing for the Birthday template (66 seconds total):

| Scene | Duration |
| --- | --- |
| Title card | 5s |
| Photo montage (7 photos) | 35s |
| Photo collage (optional) | 6s |
| Message cards (2) | 12s |
| Closing card | 8s |

Output: 1920x1080, 30fps, H.264 MP4, rendered with the delivery quality preset. No music track yet (known v1 gap).

## Quick start

Prerequisites: Node.js 22 or newer, and FFmpeg on your PATH.

Windows:

```powershell
winget install Gyan.FFmpeg
```

Then, in this project folder (the root has shortcuts, the two installs live in the subfolders):

```powershell
npm run setup
npm run setup:browser
npm start
```

`npm run setup` installs dependencies for both `render-engine` and `app`, `npm run setup:browser` downloads the headless Chrome HyperFrames renders with, and `npm start` starts the app.

Open http://localhost:3210 in your browser.

Full details: `render-engine/SETUP.md` for the stack, `app/README.md` for using the app, `render-engine/birthday-template/README.md` for the template.

## Desktop app

A Tauri 2 desktop launcher lives in `desktop/`: it starts this engine and shows it in a native window, so daily use needs no terminal or browser tab. The engine is not bundled, so `git pull` updates keep working as usual. See `desktop/README.md` for setup and first-launch details.

## Notes on this repository

- `node_modules/`, render jobs, rendered MP4s, and cache folders are not committed (see `.gitignore`); run `npm install` after cloning.
- The sample photos used during development are not committed. To try the template sample, place any 7 landscape photos at `render-engine/birthday-template/assets/photos/photo-1.jpg` to `photo-7.jpg`, for example from https://picsum.photos/seed/yse1/1280/720 (change the seed number for each photo).
- One render at a time; a full 1 minute video takes a few minutes to render depending on the machine.
