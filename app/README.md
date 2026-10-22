# Video Presentation Generator: the app

A local web app that turns the birthday template into a finished video. Fill in
a form, upload photos, press Generate Video, and download a real MP4. Rendering
happens on the same machine with the HyperFrames engine that lives in the
sibling `render-engine` folder.

Birthday only in this version. The other event types (Appreciation, Awards,
Retirement) show as Coming soon in the form and are not generated yet.

## What you need first

1. **Node.js 22 or newer.** Check with `node --version`.
2. **FFmpeg on your PATH.** Check with `ffmpeg -version`.
   - Windows: `winget install Gyan.FFmpeg`, then close and reopen PowerShell.
   - Mac: `brew install ffmpeg`.
   - Linux: `sudo apt install ffmpeg`.
3. **The render engine installed.** In the sibling `render-engine` folder:
   ```bash
   cd ../render-engine
   npm install
   npx hyperframes browser ensure
   ```
   The first command installs HyperFrames and GSAP locally. The second
   downloads the headless Chrome that HyperFrames renders with (about 114 MB,
   one time). See `render-engine/SETUP.md` for the full setup notes, including
   how the engine was verified.

## Start the app

```bash
cd app
npm install
npm start
```

Then open http://localhost:3210 in your browser. The server prints the same
address in the terminal. Stop it with Ctrl+C.

The app itself sets the temp and frame-cache folders the renderer needs
(under `render-engine/.tmp` and `render-engine/.frames-cache`), so there are
no environment variables to set, on any platform.

## How to use it

1. **Event type.** Birthday is the only working type in this version.
2. **Details.** Celebrant name (it starts blank; type the full name
   exactly as it should appear on the title card), an optional date
   line for the title card (free text; leave it blank for no date),
   how long the title
   and closing cards stay, the closing line and sign-off, and the
   closing card's paper: Classic cream, Clean white, Kraft tan, Blush
   pink, Mint green, Sky blue, Crumpled, Folder, Asymmetrical, Felt,
   or Specialty. The title and closing cards can each
   also carry an optional animated Effect: Confetti, Sparkles, Hearts,
   or Petals. The Closing card photos picker at the bottom of the tab
   adds small framed copies of your photos in a strip above the
   closing card, below it, or both (up to 5 per strip), chosen per
   photo with the Top and Bottom chips.
3. **Photos.** Add JPG, PNG, or WebP photos.
   - Photos play in the order shown. Use the Up and Down buttons to
     reorder, Remove to drop one.
   - Type a caption for each photo if you want one on screen.
   - Every photo has its own controls under it: how long it stays
     (5 seconds by default), its Frame (Full bleed, Thin border,
     Polaroid, Rounded, or Gold frame), the Ken Burns Zoom, Brightness,
     Saturation, and Position.
   - Position picks which part of the photo stays in frame: Vertical at
     the bottom end keeps the bottom of the photo visible, which is the
     fix when a subject stands low in the shot and gets cropped out.
     The Top / Center / Bottom and Left / Center / Right buttons jump
     the sliders to those spots, and the zoom pushes toward the same
     point.
   - For the photo collage, tick exactly 3 photos, or untick the photo
     collage switch in the Collage tab to skip that scene entirely.
4. **Messages.** Up to two message cards. Each one has its own length
   (6 seconds by default), its own paper, picked from the same eleven
   papers as the closing card, and its own optional Effect. Leave a message blank to skip it. The
   Scenes tab decides where in the video they play. The Smart generate
   row at the top of the tab writes ready-made messages for you: pick a
   tone (Warm, Grateful, Playful, or Formal) and it fills both messages
   with lines composed from the message library (see Message library
   below), greeting the
   celebrant by first name when one is entered. The same tone drives
   the small Generate buttons under each greeting card in the Collage
   tab and beside the closing line in the Details tab. Signers are
   never overwritten.
5. **Fonts.** Use the Fonts tab to pick a font for each kind of text: the
   celebrant name, the headings, the captions, and the message text.
   Press Update preview above the stage to see your picks in the real
   design. Picks beyond the two built-in stacks
   load from Google Fonts, so keep the machine online while rendering;
   offline, the video falls back to similar system fonts. The same tab
   holds Text effects: an optional shadow, glow, and outline for the
   video's text, each with its own switch and strength, applied either
   to the display text (the name and headings) or to all text.
6. **Background.** In the Background tab, pick one of eight backdrops
   for the title, collage, message, and closing scenes: five animated
   (Deep Green, Emerald, Midnight, Royal, Sunset), two flat colors
   (Charcoal, Cream), and one light gradient (Sky). Cream and Sky are
   light backdrops, so the words on them turn dark automatically.
   Full-bleed photos fill the screen in every backdrop; framed photos
   (Polaroid, Rounded, Gold frame) sit on the backdrop, and the paper
   cards keep their paper.
7. **Collage.** The Collage tab holds two separate scenes, and both can
   be in the same video. The photo collage shows the 3 ticked photos as
   polaroids under its own heading. The text collage shows up to 4 short
   greeting cards under its own heading instead; write at least 2 cards
   with text, and pick each card's paper under the card, from the same
   eleven papers as the message cards. Each scene runs 6 seconds by default and has its own
   length setting, its own switch, and its own optional Effect.
8. **Scenes.** In the Scenes tab, drag the middle scenes into the order
   you want with the Up and Down buttons: Photos, Photo collage, Text
   collage, and Messages. The title card always opens the video and the
   closing card always ends it. Scenes that are off or empty are marked
   Off and are skipped, and the total runtime grows or shrinks to match,
   so a video with everything switched on runs longer than a minute.
9. **Music (optional).** In the Music tab, add one MP3, M4A, WAV, or OGG
   track and set its volume. The track is added after the video renders:
   it loops if it is shorter than the video, fades in at the start, and
   fades out at the end. Leave it empty for a silent video, and only use
   music you have the right to use.
10. **Check the summary.** The side panel lists every scene with its start
   time and shows the total runtime. The defaults are title 5s, photos
   5s each, each collage 6s, messages 6s each, closing 8s, and every one
   of those lengths can be changed in its tab. Seven photos with both
   collages and two messages comes to 1:12.
11. **Exact preview (optional).** The stage shows the actual generated
   composition, the same HTML, styling, fonts, and animation the render
   uses, so what you see is the video design itself. Play and Pause run
   the real timeline, the time readout follows it, and clicking a scene
   in the filmstrip jumps there. Press Update preview to rebuild it
   after changing anything; pressing Play after a change rebuilds it
   first on its own. Music is not part of the preview: it is mixed in
   when you generate.
12. **Generate Video.** Use the Generate Video button in the panel
   beside the preview. The page shows progress while the scenes are built and
   the video renders. Rendering usually takes a few minutes for a one minute
   video, so keep the page open. When it finishes, the video plays right on
   the page and the Download MP4 button saves the file.

## Saved projects

The Projects tab saves the whole editor under a name: every field,
every photo with its caption and per-photo settings, the music track,
and the volume. Loading a project brings it all back exactly as it was
left. Saving with a name that already exists replaces the older copy;
the page asks first. Each project is a folder in `app/projects/<slug>/`
holding a `state.json` plus copies of the photos and the music file, so
projects survive restarts, and you can back one up by copying its
folder. Projects are your own data on this machine: the projects folder
is gitignored and nothing in it is uploaded anywhere.

## Message library

The lines Smart generate composes from live in a small SQLite database
at `app/data/messages.db`, served by the app itself. On first run the
database is seeded from the curated lines in `app/lib/message-banks.json`
(four tones, with openers, middles, closers, short lines, and closing
lines). Later seed updates only add lines that are not already there;
they never remove anything, so your own additions are safe. Manage the
library in the Library tab: filter by tone and kind, add your own
lines, and delete ones you no longer want. The composer uses a new line
right away.

## Where things land

- Every run is a **job** in `app/jobs/<job-id>/`, holding the uploaded
  photos, the job's `config.json`, the generated composition, the render log
  (`render.log`), and the finished video at `renders/output.mp4`.
- Job folders are kept, so you can re-download an earlier video from its job
  folder. Delete old job folders whenever you like.
- The exact preview stages into `app/previews/current/`, wiped and rebuilt
  on every preview. It is working state, not a deliverable; delete the
  `previews` folder whenever you like.
- Saved projects live in `app/projects/<slug>/` (see Saved projects
  above).
- Only **one video renders at a time**. If you press Generate while another
  video is rendering, the app says so and asks you to wait.

## Known limits in v1

- **Birthday template only.** The other event types are placeholders.
- **Music is added after rendering.** If the music step fails (for
  example a damaged audio file), the video still finishes, silent, and
  the page shows a note that the music could not be added.
- **One render at a time**, and the app runs on your local machine only. It
  is not a hosted website; anyone who wants to use it runs their own copy.
- Photos are cropped to fill their frame. Each photo's Position controls
  choose which part stays in frame, but there is no freehand crop or
  rotate.
- Output is fixed at 1920x1080, 30fps, rendered with the delivery quality
  preset. The length depends on how many photos and messages you add and
  which scenes are switched on: about a minute for a typical video, longer
  with everything on.

## Passing it to another machine

Clone or pull the project repository (github.com/straviux/video-presentation-generator),
then on the new machine: install Node and FFmpeg, run `npm install` in both
the `app` and `render-engine` folders, run `npx hyperframes browser ensure`
in `render-engine`, then `npm start` in `app`. Sample photos are not in the
repository; bring your own or re-download the placeholders as described in
the template README.
