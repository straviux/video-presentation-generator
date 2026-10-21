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
2. **Details.** Celebrant name, short name for the title, role, from line,
   closing line, closing sign-off, and the two collage headings. All of
   these appear in the video, so read them once before generating.
3. **Photos.** Add JPG, PNG, or WebP photos.
   - Each photo gets 5 seconds in the montage, in the order shown. Use the
     Up and Down buttons to reorder, Remove to drop one.
   - Type a caption for each photo if you want one on screen.
   - For the photo collage, tick exactly 3 photos, or untick the photo
     collage switch in the Collage tab to skip that scene entirely.
4. **Messages.** Up to two message cards, 6 seconds each. Leave a message
   blank to skip it. The Scenes tab decides where in the video they play.
5. **Fonts.** Use the Fonts tab to pick a font for each kind of text: the
   celebrant name, the headings, the captions, and the message text. The
   stage preview follows your picks. Picks beyond the two built-in stacks
   load from Google Fonts, so keep the machine online while rendering;
   offline, the video falls back to similar system fonts.
6. **Background.** In the Background tab, pick one of eight backdrops
   for the title, collage, message, and closing scenes: five animated
   (Deep Green, Emerald, Midnight, Royal, Sunset), two flat colors
   (Charcoal, Cream), and one light gradient (Sky). Cream and Sky are
   light backdrops, so the words on them turn dark automatically. Photos
   stay full screen in every backdrop, and the paper cards keep their
   paper.
7. **Collage.** The Collage tab holds two separate scenes, and both can
   be in the same video. The photo collage shows the 3 ticked photos as
   polaroids under its own heading. The text collage shows up to 4 short
   greeting cards under its own heading instead; write at least 2 cards
   with text. Each scene runs 6 seconds, and each has its own switch.
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
   time and shows the total runtime. Title 5s, photos 5s each, each
   collage 6s, messages 6s each, closing 8s. Seven photos with both
   collages and two messages comes to 1:12.
11. **Quick preview (optional).** A simple slideshow of your photos and words
   at the real scene lengths, in the order set on the Scenes tab. The
   finished video adds the animations.
12. **Generate Video.** The page shows progress while the scenes are built and
   the video renders. Rendering usually takes a few minutes for a one minute
   video, so keep the page open. When it finishes, the video plays right on
   the page and the Download MP4 button saves the file.

## Where things land

- Every run is a **job** in `app/jobs/<job-id>/`, holding the uploaded
  photos, the job's `config.json`, the generated composition, the render log
  (`render.log`), and the finished video at `renders/output.mp4`.
- Job folders are kept, so you can re-download an earlier video from its job
  folder. Delete old job folders whenever you like.
- Only **one video renders at a time**. If you press Generate while another
  video is rendering, the app says so and asks you to wait.

## Known limits in v1

- **Birthday template only.** The other event types are placeholders.
- **Music is added after rendering.** If the music step fails (for
  example a damaged audio file), the video still finishes, silent, and
  the page shows a note that the music could not be added.
- **One render at a time**, and the app runs on your local machine only. It
  is not a hosted website; anyone who wants to use it runs their own copy.
- Photos are center-cropped to fill the 16:9 frame. There is no crop or
  position control yet.
- Output is fixed at 1920x1080, 30fps, rendered with the delivery quality
  preset. The length depends on how many photos and messages you add and
  which scenes are switched on: about a minute for a typical video, longer
  with everything on.

## Passing it to another machine

Use the packaged `video-presentation-generator.zip` from the project root. It
contains this `app` folder and the `render-engine` folder without their
installed dependencies or outputs, so on the new machine: install Node and
FFmpeg, run `npm install` in both folders, run `npx hyperframes browser
ensure` in `render-engine`, then `npm start` in `app`.
