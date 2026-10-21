# Video Presentation Generator: Render Engine Setup

Set up and verified end to end on 2026-10-21 on the Muse VM (Linux).
One real test render succeeded; details below.

## Layout

```
render-engine/
  package.json / package-lock.json   local deps: hyperframes + gsap
  node_modules/                      local install only, nothing global
  SETUP.md                           this file
  .tmp/                              relocated temp dir (see VM quirk below)
  .frames-cache/                     relocated frame extract cache (currently empty)
  test-title-card/                   scaffolded test project (hyperframes init)
    index.html                       the test composition (5s, 1280x720)
    assets/gsap.min.js               GSAP 3.15.0, copied in for offline renders
    hyperframes.json, meta.json
    renders/test-title-card.mp4      the verified test output
```

The scaffold was created with:

```bash
cd ~/workspace/video-presentation-generator/render-engine
npm init -y
npm install hyperframes gsap
HYPERFRAMES_SKIP_SKILLS=1 npx hyperframes init test-title-card --non-interactive --example blank
```

## Verified versions

| Tool | Version | Notes |
|---|---|---|
| FFmpeg / FFprobe | 8.1.2 | at /usr/bin/ffmpeg, /usr/bin/ffprobe |
| Node.js | v24.20.0 | satisfies HyperFrames Node 22+ requirement |
| npm | 10.9.4 | |
| Python | 3.12.3 | present, not needed for the core render path |
| hyperframes | 0.8.181 | local npm dep, also pinned in test-title-card scripts |
| gsap | 3.15.0 | local npm dep at render-engine root; a copy is bundled in test-title-card/assets/ |
| Chrome Headless Shell | 152.0.7977.30 | downloaded by HyperFrames itself (see first-run downloads) |

## Doctor output

First run (`npx hyperframes doctor` in render-engine/):

- Pass: version 0.8.181 (latest), Node v24.20.0, CPU, disk 96.9 GB free, unzip, FFmpeg 8.1.2, FFprobe 8.1.2
- Fail: Memory (7.7 GB total, about 0.8 GB available; renders use the auto low-memory profile)
- Fail: Frames cache at /tmp (only 0.5 GB free there)
- Fail: Chrome not installed yet
- Fail, optional only: whisper-cpp (transcription), Kokoro TTS, MusicGen BGM
- Fail: Docker not found (only needed for `render --docker`, not used)

After `npx hyperframes browser ensure` and the TMPDIR relocation below, a second doctor run passes Chrome and the frames cache. Remaining fails are only the memory warning, the three optional AI extras, and Docker.

## First-run downloads (done by HyperFrames itself)

- Chrome Headless Shell v152.0.7977.30, 113.9 MB, via `npx hyperframes browser ensure`, stored at `~/.cache/hyperframes/chrome/chrome-headless-shell/linux-152.0.7977.30/`
- Fonts cached during `hyperframes check` to `~/.cache/hyperframes/fonts/` (EB Garamond, Inter)

No global npm installs were made. The only writes outside this folder are HyperFrames' own managed caches under `~/.cache/hyperframes/`.

## VM quirk: /tmp is tiny, relocate temp before rendering

On this VM, /tmp has only about 0.5 GB free, and a default render aborts with "Low disk space" before capturing a single frame. Always render with temp and the frame cache pointed at the workspace disk (about 97 GB free):

```bash
cd ~/workspace/video-presentation-generator/render-engine/test-title-card
TMPDIR=$HOME/workspace/video-presentation-generator/render-engine/.tmp \
HYPERFRAMES_EXTRACT_CACHE_DIR=$HOME/workspace/video-presentation-generator/render-engine/.frames-cache \
../node_modules/.bin/hyperframes render . -o renders/test-title-card.mp4 --frames-cache-dir ../.frames-cache
```

## Commands (all verified on this machine)

Preview in the Studio (opens http://localhost:3002):

```bash
cd ~/workspace/video-presentation-generator/render-engine/test-title-card
../node_modules/.bin/hyperframes preview --background   # start
../node_modules/.bin/hyperframes preview --status       # check it is listening
../node_modules/.bin/hyperframes preview . --stop       # stop it
```

(The scaffolded `npm run dev` inside test-title-card does the same in the foreground.)

Validate a composition:

```bash
../node_modules/.bin/hyperframes check
```

Result for the test composition: passed. 0 errors everywhere, contrast 15/15 WCAG AA. One lint warning (nested structure in #content, cosmetic for this simple card) and one layout info note (a decorative circle intentionally bleeds off-canvas).

Render: use the TMPDIR command in the VM quirk section above.

## Test render result

Composition: `test-title-card/index.html`, a 5 second, 1280x720 birthday title card (sample content: "Happy Birthday, Nur-Aina!", YSE Family sign-off). GSAP timeline, paused and registered on `window.__timelines`: eyebrow fade, title slide-up, gold rule scale, subtitle fade, footer fade.

Render: succeeded in 19.7s, 150 frames at 30 fps, 1 worker, screenshot capture, software GPU (auto low-memory profile because the VM has 8 GB RAM or less).

Output: `test-title-card/renders/test-title-card.mp4`

ffprobe verification:

```
codec_name=h264  codec_type=video
width=1280  height=720
r_frame_rate=30/1  nb_frames=150
format duration=5.000000  size=362844 bytes (about 355 KB)
```

A frame extracted at 2.5s shows the title, rule, and subtitle fully animated in, with the footer mid-fade, as scripted.

## Agent skills attempt (skipped, not forced)

`npx skills add heygen-com/hyperframes` was tried once with stdin closed. It fetched and cloned the repo, then ended with "Canceled" and "No valid skills found. Skills require a SKILL.md with name and description." Nothing was installed and no partial files were left behind. Per the setup brief it was not retried or forced. If skills are wanted later, the scaffold suggests the built-in route instead: `npx hyperframes skills update`.

## Same setup on Windows (your machine, PowerShell)

1. Install Node 22 or newer LTS from nodejs.org, or with nvm-windows. Verify: `node --version`, `npm --version`
2. Install FFmpeg: `winget install Gyan.FFmpeg`, then reopen PowerShell and verify: `ffmpeg -version`
3. Copy or clone this `render-engine` folder, then in it:
   ```powershell
   npm install
   npx hyperframes doctor
   npx hyperframes browser ensure
   ```
4. Preview and render use the same commands as above, run from `test-title-card` (its package.json scripts call the pinned CLI: `npm run dev`, `npm run check`, `npm run render`).
5. Temp space note: Windows temp lives on C: by default. If C: runs low during long renders, pass `--frames-cache-dir D:\hf-cache` (or another large drive) to the render command, the same flag used in the VM quirk section.

## Not installed, and when they matter

- Docker: only for `render --docker` deterministic renders. Not needed for normal local renders.
- whisper-cpp: only for `hyperframes transcribe`.
- Kokoro TTS and MusicGen BGM: only for the local voice and music fallbacks.
- System Chromium: not needed at all. HyperFrames manages its own Chrome Headless Shell.
