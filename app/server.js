// Video Presentation Generator: local web app server.
//
// Serves the builder UI, accepts photo uploads, writes a job folder with a
// config.json in the birthday-template schema, generates the HyperFrames
// composition, renders a real MP4 with the sibling render-engine's local
// hyperframes CLI, and serves the result for download.
//
// Cross-platform: only Node path APIs are used, and the hyperframes render is
// spawned as `node <render-engine>/node_modules/hyperframes/bin/hyperframes.mjs`
// so the same code runs on Linux and on Windows/PowerShell.
//
// The server sets TMPDIR and the frames cache for render child processes to
// folders under the sibling render-engine folder, so nobody has to set
// environment variables by hand (on the Muse VM, /tmp is nearly full and a
// default render aborts; on Windows this also keeps caches next to the project).

import express from "express";
import multer from "multer";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.dirname(APP_DIR);
const RENDER_ENGINE_DIR = path.join(PROJECT_DIR, "render-engine");
const TEMPLATE_DIR = path.join(RENDER_ENGINE_DIR, "birthday-template");
const JOBS_DIR = path.join(APP_DIR, "jobs");
const PORT = 3210;

// Render scratch space, kept under the render-engine folder (created if the
// project was just unzipped and they do not exist yet).
const RENDER_TMP_DIR = path.join(RENDER_ENGINE_DIR, ".tmp");
const FRAMES_CACHE_DIR = path.join(RENDER_ENGINE_DIR, ".frames-cache");
mkdirSync(RENDER_TMP_DIR, { recursive: true });
mkdirSync(FRAMES_CACHE_DIR, { recursive: true });
mkdirSync(JOBS_DIR, { recursive: true });

// The exact preview stages into one reused folder, wiped per build and
// served at /previews/current/index.html.
const PREVIEW_DIR = path.join(APP_DIR, "previews", "current");

const HF_BIN = path.join(
  RENDER_ENGINE_DIR,
  "node_modules",
  "hyperframes",
  "bin",
  "hyperframes.mjs",
);
const RENDER_TIMEOUT_MS = 15 * 60 * 1000;

const app = express();
app.use(express.static(path.join(APP_DIR, "public")));
app.use("/previews", express.static(path.join(APP_DIR, "previews")));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 21 },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === "music") {
      const okAudio =
        ["audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/wav", "audio/x-wav", "audio/wave", "audio/ogg", "audio/vorbis"].includes(file.mimetype) ||
        [".mp3", ".m4a", ".wav", ".ogg"].includes(path.extname(file.originalname || "").toLowerCase());
      cb(okAudio ? null : new Error("Only MP3, M4A, WAV, or OGG music files are accepted."), okAudio);
      return;
    }
    const ok = ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype);
    cb(ok ? null : new Error("Only JPG, PNG, or WebP photos are accepted."), ok);
  },
});

// ------------------------------------------------------------------- jobs --
const jobs = new Map(); // jobId -> job record
let activeJobId = null; // one render at a time in v1

function jobView(job) {
  return {
    id: job.id,
    status: job.status, // generating | rendering | done | error
    message: job.message,
    error: job.error || null,
    musicWarning: job.musicWarning || null,
    logTail: job.logTail || null,
    totalSeconds: job.totalSeconds || null,
    downloadUrl: job.status === "done" ? `/api/jobs/${job.id}/download` : null,
    videoUrl: job.status === "done" ? `/api/jobs/${job.id}/video` : null,
  };
}

function logTail(text, lines = 30) {
  const all = String(text || "").split(/\r?\n/);
  return all.slice(-lines).join("\n").trim();
}

function runProcess(command, args, options) {
  return new Promise((resolve) => {
    const child = spawn(command, args, options);
    let out = "";
    child.stdout.on("data", (d) => {
      out += d;
    });
    child.stderr.on("data", (d) => {
      out += d;
    });
    child.on("error", (err) => resolve({ code: -1, out: out + String(err) }));
    child.on("close", (code) => resolve({ code, out }));
  });
}

// Probe a media file's duration in seconds with ffprobe; null on failure.
async function probeDurationSeconds(file) {
  const probe = await runProcess("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "csv=p=0",
    file,
  ]);
  const seconds = Number.parseFloat(String(probe.out).trim());
  return probe.code === 0 && Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

// Mux the job's music track onto the rendered (silent) video with FFmpeg:
// the track loops if it is shorter than the video, sits at the chosen
// volume, fades in over the first second and out over the last 3.5
// seconds, and is encoded as AAC while the video stream is copied. On any
// failure the job keeps the silent video and gains a musicWarning.
async function muxMusic(job, outputFile) {
  const fail = (detail) => {
    job.musicWarning =
      "The music track could not be added, so this video is silent. " +
      (detail ? `(${detail})` : "Try a different music file.");
  };
  const duration = await probeDurationSeconds(outputFile);
  if (duration === null) {
    fail("The rendered video could not be checked.");
    return;
  }
  const volume = Math.min(1, Math.max(0, (job.musicVolume ?? 40) / 100));
  const fadeOutStart = Math.max(0, duration - 3.5);
  const tmpFile = path.join(job.dir, "renders", "output-music.mp4");
  const mux = await runProcess("ffmpeg", [
    "-y",
    "-i", outputFile,
    "-stream_loop", "-1",
    "-i", path.join(job.dir, job.musicFile),
    "-filter_complex",
    `[1:a]volume=${volume.toFixed(2)},afade=t=in:st=0:d=1,afade=t=out:st=${fadeOutStart.toFixed(2)}:d=3.5[aout]`,
    "-map", "0:v",
    "-map", "[aout]",
    "-c:v", "copy",
    "-c:a", "aac",
    "-b:a", "192k",
    "-t", duration.toFixed(3),
    tmpFile,
  ]);
  writeFileSync(path.join(job.dir, "music.log"), mux.out);
  if (mux.code !== 0 || !existsSync(tmpFile)) {
    fail(logTail(mux.out, 3) || "FFmpeg did not produce a video with music.");
    return;
  }
  copyFileSync(tmpFile, outputFile);
}

async function runJob(job) {
  const jobDir = job.dir;
  try {
    // 1. Generate the composition from this job's config.json.
    job.status = "generating";
    job.message = "Building the video scenes from your details.";
    const gen = await runProcess(process.execPath, ["generate.mjs"], {
      cwd: jobDir,
    });
    writeFileSync(path.join(jobDir, "generate.log"), gen.out);
    if (gen.code !== 0) {
      throw new Error(`Scene generation failed.\n${logTail(gen.out)}`);
    }

    // 2. Render the MP4 with the sibling render-engine's hyperframes CLI.
    job.status = "rendering";
    job.message =
      "Rendering your video. This usually takes a few minutes on this machine.";
    const renderEnv = {
      ...process.env,
      TMPDIR: RENDER_TMP_DIR,
      HYPERFRAMES_EXTRACT_CACHE_DIR: FRAMES_CACHE_DIR,
    };
    const render = await new Promise((resolve) => {
      const child = spawn(
        process.execPath,
        [
          HF_BIN,
          "render",
          ".",
          "-o",
          path.join("renders", "output.mp4"),
          "--quality",
          "delivery",
          "--frames-cache-dir",
          FRAMES_CACHE_DIR,
        ],
        { cwd: jobDir, env: renderEnv },
      );
      let out = "";
      const onData = (d) => {
        out += d;
        job.logTail = logTail(out);
      };
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);
      const timer = setTimeout(() => {
        out += "\nRender timed out and was stopped.";
        child.kill();
      }, RENDER_TIMEOUT_MS);
      child.on("error", (err) => {
        clearTimeout(timer);
        resolve({ code: -1, out: out + String(err) });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ code, out });
      });
    });
    writeFileSync(path.join(jobDir, "render.log"), render.out);
    job.logTail = logTail(render.out);
    const outputFile = path.join(jobDir, "renders", "output.mp4");
    if (render.code !== 0 || !existsSync(outputFile)) {
      throw new Error(
        `Rendering failed.\n${logTail(render.out) || "No render output was produced."}`,
      );
    }

    // 3. Add the music track, if one was uploaded. A failed mux never
    // fails the job: the silent video ships with a musicWarning instead.
    if (job.musicFile) {
      job.message = "Adding the music track to your video.";
      await muxMusic(job, outputFile);
    }

    job.status = "done";
    job.message = "Your video is ready.";
    job.error = null;
  } catch (err) {
    job.status = "error";
    job.message = "Something went wrong while making this video.";
    job.error = String(err && err.message ? err.message : err);
  } finally {
    if (activeJobId === job.id) activeJobId = null;
    writeFileSync(
      path.join(jobDir, "status.json"),
      JSON.stringify(jobView(job), null, 2),
    );
  }
}

// ------------------------------------------------------------------- api ---
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    hyperframesInstalled: existsSync(HF_BIN),
    rendering: activeJobId !== null,
  });
});

// ------------------------------------------------------- form parsing ----
// /api/generate and /api/preview read the same multipart form. parseForm
// validates the content rules and normalizes every value; buildConfig
// turns the values into a generator config; stageComposition writes a
// folder the generator can run in. The two routes share all of it and
// differ only in what they require (a render job needs at least one
// photo, a preview may have none) and in what they do with the result.
const FONT_KEYS = [
  "classic", "clean", "playfair", "fraunces", "dmserif", "greatvibes",
  "caveat", "bebas", "geist", "jakarta", "outfit", "dmsans",
];
const BACKGROUND_KEYS = [
  "deep-green", "emerald", "midnight", "royal",
  "sunset", "charcoal", "cream", "sky",
];
const PHOTO_FRAME_KEYS = ["full", "thin", "polaroid", "rounded", "gold"];
const PAPER_KEYS = ["classic", "white", "kraft", "blush", "mint", "sky"];
const EFFECT_KEYS = ["none", "confetti", "sparkles", "hearts", "petals"];

function clampNumber(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// Returns { error } or { values }.
function parseForm(body, photoCount, { requirePhotos }) {
  const text = (v) => (typeof v === "string" ? v.trim() : "");
  const asArray = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
  const celebrantName = text(body.celebrantName);
  if (!celebrantName) return { error: "Please enter the celebrant name." };
  if (requirePhotos && photoCount === 0) {
    return { error: "Please add at least one photo." };
  }

  const captions = asArray(body.captions).map((c) => String(c ?? ""));
  // A preview with no photos yet skips the photo collage instead of
  // failing the exactly-3 rule; a render job always has photos at this
  // point, so its rule is unchanged.
  const collageWanted = text(body.collageEnabled) === "true";
  const collageEnabled = collageWanted && photoCount > 0;
  const collageIndexes = asArray(body.collageIndexes)
    .map((v) => Number.parseInt(v, 10))
    .filter((n) => Number.isInteger(n) && n >= 0 && n < photoCount);
  if (collageEnabled && collageIndexes.length !== 3) {
    return {
      error:
        "The photo collage needs exactly 3 photos. Tick 3 photos for the collage, or turn the photo collage off.",
    };
  }
  const textCollageEnabled = text(body.textCollageEnabled) === "true";

  // Text collage cards: pair the card texts with their signers, cap at 4,
  // and drop pairs where both are empty.
  const cardTexts = asArray(body.cardTexts);
  const cardFroms = asArray(body.cardFroms);
  const collageCards = [];
  for (let i = 0; i < Math.min(4, Math.max(cardTexts.length, cardFroms.length)); i++) {
    const cardText = String(cardTexts[i] ?? "").trim();
    const cardFrom = String(cardFroms[i] ?? "").trim();
    if (cardText || cardFrom) collageCards.push({ text: cardText, from: cardFrom });
  }
  if (textCollageEnabled && collageCards.filter((c) => c.text).length < 2) {
    return {
      error:
        "The text collage needs at least 2 greeting cards with text. Add more cards, or turn the text collage off.",
    };
  }

  // Music volume from the slider: an integer percent, clamped to 0-100.
  const volumeParsed = Number.parseInt(body.musicVolume, 10);
  const musicVolume = Number.isInteger(volumeParsed)
    ? Math.min(100, Math.max(0, volumeParsed))
    : 40;

  // Background preset for the scenes; unknown or missing keys fall back
  // to "deep-green", the original look.
  const background = BACKGROUND_KEYS.includes(text(body.background))
    ? text(body.background)
    : "deep-green";

  // Per-message duration, paper, and effect, aligned with message 1 and
  // 2 by the same index the fields were appended in.
  const messageDurations = asArray(body.messageDurations);
  const messagePapers = asArray(body.messagePapers);
  const messageEffects = asArray(body.messageEffects);
  const messages = [];
  for (const n of [1, 2]) {
    const msgText = text(body[`message${n}Text`]);
    const signedBy = text(body[`message${n}SignedBy`]);
    if (msgText) {
      messages.push({
        text: msgText,
        signedBy,
        duration: Math.round(clampNumber(messageDurations[n - 1], 6, 4, 15)),
        paper: PAPER_KEYS.includes(text(messagePapers[n - 1]))
          ? text(messagePapers[n - 1])
          : "classic",
        effect: EFFECT_KEYS.includes(text(messageEffects[n - 1]))
          ? text(messageEffects[n - 1])
          : "none",
      });
    }
  }
  const effectPick = (value) =>
    EFFECT_KEYS.includes(text(value)) ? text(value) : "none";

  // Per-photo settings, aligned by photo index. Missing or invalid
  // values fall back to the defaults that reproduce the original
  // montage, and every value is clamped to its control's range.
  const numArr = (v, fallback, min, max) => {
    const arr = asArray(v);
    return Array.from({ length: photoCount }, (_, i) => clampNumber(arr[i], fallback, min, max));
  };
  const durations = numArr(body.photoDurations, 5, 2, 12);
  const zooms = numArr(body.photoZooms, 115, 100, 150);
  const focusXs = numArr(body.photoFocusX, 50, 0, 100);
  const focusYs = numArr(body.photoFocusY, 50, 0, 100);
  const brightnesses = numArr(body.photoBrightness, 100, 80, 120);
  const saturations = numArr(body.photoSaturation, 100, 0, 150);
  const frames = asArray(body.photoFrames);
  const photoSettings = Array.from({ length: photoCount }, (_, i) => ({
    duration: Math.round(durations[i]),
    zoom: zooms[i],
    focusX: focusXs[i],
    focusY: focusYs[i],
    brightness: brightnesses[i],
    saturation: saturations[i],
    frame: PHOTO_FRAME_KEYS.includes(text(frames[i])) ? text(frames[i]) : "full",
  }));

  // Font picks for the four text slots (name, headings, captions,
  // messages); unknown or missing keys fall back to the slot defaults,
  // which are the template's original look.
  const fontPick = (value, fallback) => {
    const key = text(value);
    return FONT_KEYS.includes(key) ? key : fallback;
  };
  const fonts = {
    name: fontPick(body.fontName, "classic"),
    headings: fontPick(body.fontHeadings, "classic"),
    captions: fontPick(body.fontCaptions, "clean"),
    messages: fontPick(body.fontMessages, "classic"),
  };

  // Scene order for the four middle blocks, sanitized exactly like the
  // generator does it: unknown keys dropped, duplicates removed, and
  // blocks missing from the list appended in the default order.
  const SCENE_ORDER_KEYS = ["photos", "photoCollage", "textCollage", "messages"];
  const sceneOrder = [];
  for (const key of text(body.sceneOrder).split(",")) {
    const k = key.trim();
    if (SCENE_ORDER_KEYS.includes(k) && !sceneOrder.includes(k)) sceneOrder.push(k);
  }
  for (const k of SCENE_ORDER_KEYS) {
    if (!sceneOrder.includes(k)) sceneOrder.push(k);
  }

  return {
    values: {
      celebrantName,
      captions,
      collageEnabled,
      collageIndexes,
      collageHeading: text(body.collageHeading),
      textCollageEnabled,
      textCollageHeading: text(body.textCollageHeading),
      collageCards,
      musicVolume,
      background,
      fonts,
      messages,
      photoSettings,
      sceneOrder,
      titleDuration: Math.round(clampNumber(body.titleDuration, 5, 3, 10)),
      closingDuration: Math.round(clampNumber(body.closingDuration, 8, 4, 15)),
      photoCollageDuration: Math.round(clampNumber(body.photoCollageDuration, 6, 4, 12)),
      textCollageDuration: Math.round(clampNumber(body.textCollageDuration, 6, 4, 12)),
      closingLine: text(body.closingLine),
      closingSignOff: text(body.closingSignOff) || "With love, your YSE Family",
      closingPaper: PAPER_KEYS.includes(text(body.closingPaper))
        ? text(body.closingPaper)
        : "classic",
      titleEffect: effectPick(body.titleEffect),
      closingEffect: effectPick(body.closingEffect),
      photoCollageEffect: effectPick(body.photoCollageEffect),
      textCollageEffect: effectPick(body.textCollageEffect),
    },
  };
}

function buildConfig(values) {
  return {
    background: values.background,
    celebrantName: values.celebrantName,
    titleDuration: values.titleDuration,
    titleEffect: values.titleEffect,
    closingDuration: values.closingDuration,
    closingEffect: values.closingEffect,
    closingLine:
      values.closingLine || "Wishing you a year as warm and generous as you are.",
    closingPaper: values.closingPaper,
    closingSignOff: values.closingSignOff,
    collage: {
      photo: {
        enabled: values.collageEnabled,
        heading: values.collageHeading || "Moments together",
        photoIndexes: values.collageEnabled ? values.collageIndexes : [],
        duration: values.photoCollageDuration,
        effect: values.photoCollageEffect,
      },
      text: {
        enabled: values.textCollageEnabled,
        heading: values.textCollageHeading || "Kind words",
        cards: values.collageCards,
        duration: values.textCollageDuration,
        effect: values.textCollageEffect,
      },
    },
    sceneOrder: values.sceneOrder,
    fonts: values.fonts,
    messages: values.messages,
    occasion: "Birthday",
    photos: [],
  };
}

// The same duration math the generator runs, so job totals and preview
// totals agree with the composition.
function totalSecondsFor(config) {
  let total = config.titleDuration + config.closingDuration;
  total += config.photos.reduce((sum, p) => sum + p.duration, 0);
  if (config.collage.photo.enabled) total += config.collage.photo.duration;
  if (config.collage.text.enabled) total += config.collage.text.duration;
  total += config.messages.reduce((sum, m) => sum + m.duration, 0);
  return total;
}

// Writes the uploaded photos, the config, and the composition support
// files into dir (a job folder or the preview folder). The config's
// photo entries are filled in here because their file names follow the
// upload order. Returns an error message, or null on success.
function stageComposition(dir, config, files, values) {
  const photosDir = path.join(dir, "assets", "photos");
  mkdirSync(photosDir, { recursive: true });
  mkdirSync(path.join(dir, "renders"), { recursive: true });

  const extByMime = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
  };
  config.photos = files.map((file, i) => {
    const extFromName = path.extname(file.originalname || "").toLowerCase();
    const ext = [".jpg", ".jpeg", ".png", ".webp"].includes(extFromName)
      ? extFromName
      : extByMime[file.mimetype] || ".jpg";
    const name = `photo-${i + 1}${ext}`;
    writeFileSync(path.join(photosDir, name), file.buffer);
    return {
      file: `assets/photos/${name}`,
      caption: values.captions[i] || "",
      ...values.photoSettings[i],
    };
  });
  writeFileSync(path.join(dir, "config.json"), JSON.stringify(config, null, 2));

  // Composition support files: the generator, the local GSAP copy (no
  // CDN at render time), and the hyperframes config.
  copyFileSync(path.join(APP_DIR, "lib", "generate.mjs"), path.join(dir, "generate.mjs"));
  const gsapSource = [
    path.join(TEMPLATE_DIR, "assets", "gsap.min.js"),
    path.join(RENDER_ENGINE_DIR, "node_modules", "gsap", "dist", "gsap.min.js"),
  ].find((p) => existsSync(p));
  if (!gsapSource) {
    return "GSAP was not found in the render-engine. See the app README setup steps.";
  }
  copyFileSync(gsapSource, path.join(dir, "assets", "gsap.min.js"));
  const hfConfig = path.join(TEMPLATE_DIR, "hyperframes.json");
  if (existsSync(hfConfig)) copyFileSync(hfConfig, path.join(dir, "hyperframes.json"));
  return null;
}

app.post(
  "/api/generate",
  upload.fields([
    { name: "photos", maxCount: 20 },
    { name: "music", maxCount: 1 },
  ]),
  (req, res) => {
  try {
    if (activeJobId) {
      const active = jobs.get(activeJobId);
      return res.status(409).json({
        error:
          "Another video is still rendering on this machine. Wait for it to finish, then try again.",
        activeJob: active ? jobView(active) : null,
      });
    }

    const body = req.body || {};
    const files = (req.files && req.files.photos) || [];
    const musicUpload = ((req.files && req.files.music) || [])[0] || null;
    const parsed = parseForm(body, files.length, { requirePhotos: true });
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const values = parsed.values;

    // --- create the job folder -------------------------------------------
    const jobId = `${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;
    const jobDir = path.join(JOBS_DIR, jobId);
    const config = buildConfig(values);
    const stageError = stageComposition(jobDir, config, files, values);
    if (stageError) return res.status(500).json({ error: stageError });

    // The uploaded music track, if any, waits in the job folder for the
    // post-render mux step.
    let musicFile = null;
    if (musicUpload) {
      const musicExtFromName = path.extname(musicUpload.originalname || "").toLowerCase();
      const musicExtByMime = {
        "audio/mpeg": ".mp3",
        "audio/mp4": ".m4a",
        "audio/x-m4a": ".m4a",
        "audio/wav": ".wav",
        "audio/x-wav": ".wav",
        "audio/wave": ".wav",
        "audio/ogg": ".ogg",
        "audio/vorbis": ".ogg",
      };
      const musicExt = [".mp3", ".m4a", ".wav", ".ogg"].includes(musicExtFromName)
        ? musicExtFromName
        : musicExtByMime[musicUpload.mimetype] || ".mp3";
      musicFile = `music${musicExt}`;
      writeFileSync(path.join(jobDir, musicFile), musicUpload.buffer);
    }

    writeFileSync(
      path.join(jobDir, "meta.json"),
      JSON.stringify({ id: jobId, name: jobId, createdAt: new Date().toISOString() }, null, 2),
    );

    const job = {
      id: jobId,
      dir: jobDir,
      status: "generating",
      message: "Job created.",
      error: null,
      musicFile,
      musicVolume: values.musicVolume,
      musicWarning: null,
      logTail: null,
      totalSeconds: totalSecondsFor(config),
    };
    jobs.set(jobId, job);
    activeJobId = jobId;
    writeFileSync(path.join(jobDir, "status.json"), JSON.stringify(jobView(job), null, 2));

    res.status(202).json(jobView(job));
    runJob(job); // continues in the background; the UI polls for status
  } catch (err) {
    res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
});

// --------------------------------------------------------------- preview ---
// The exact preview: the same form payload as /api/generate (any music
// file is ignored), staged into the reused preview folder and generated
// with the same code path, so the composition the stage shows is the
// render design itself. Builds are serialized with a simple in-flight
// flag: a second request while one is building gets a 409 and the UI
// keeps the previous preview.
let previewBuilding = false;

app.post(
  "/api/preview",
  upload.fields([
    { name: "photos", maxCount: 20 },
    { name: "music", maxCount: 1 },
  ]),
  async (req, res) => {
    if (previewBuilding) {
      return res
        .status(409)
        .json({ error: "A preview is already being built. Try again in a moment." });
    }
    previewBuilding = true;
    try {
      const body = req.body || {};
      const files = (req.files && req.files.photos) || [];
      const parsed = parseForm(body, files.length, { requirePhotos: false });
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      const config = buildConfig(parsed.values);
      rmSync(PREVIEW_DIR, { recursive: true, force: true });
      const stageError = stageComposition(PREVIEW_DIR, config, files, parsed.values);
      if (stageError) return res.status(500).json({ error: stageError });
      const gen = await runProcess("node", ["generate.mjs"], { cwd: PREVIEW_DIR });
      if (gen.code !== 0) {
        return res.status(500).json({
          error: `The preview composition could not be generated. ${logTail(gen.out, 5)}`,
        });
      }
      const scenesData = JSON.parse(
        readFileSync(path.join(PREVIEW_DIR, "scenes.json"), "utf8"),
      );
      res.json({
        ok: true,
        previewUrl: "/previews/current/index.html",
        scenes: scenesData.scenes,
        total: scenesData.total,
      });
    } catch (err) {
      res.status(500).json({ error: String(err && err.message ? err.message : err) });
    } finally {
      previewBuilding = false;
    }
  },
);

function loadJob(req, res) {
  const id = req.params.id;
  if (!/^[a-zA-Z0-9-]+$/.test(id)) {
    res.status(400).json({ error: "Invalid job id." });
    return null;
  }
  let job = jobs.get(id);
  if (!job) {
    const statusFile = path.join(JOBS_DIR, id, "status.json");
    if (existsSync(statusFile)) {
      const saved = JSON.parse(readFileSync(statusFile, "utf8"));
      job = { ...saved, dir: path.join(JOBS_DIR, id) };
      jobs.set(id, job);
    }
  }
  if (!job) {
    res.status(404).json({ error: "Job not found." });
    return null;
  }
  return job;
}

app.get("/api/jobs/:id", (req, res) => {
  const job = loadJob(req, res);
  if (job) res.json(jobView(job));
});

app.get("/api/jobs/:id/video", (req, res) => {
  const job = loadJob(req, res);
  if (!job) return;
  const file = path.join(job.dir, "renders", "output.mp4");
  if (!existsSync(file)) return res.status(404).json({ error: "Video not ready yet." });
  res.sendFile(file);
});

app.get("/api/jobs/:id/download", (req, res) => {
  const job = loadJob(req, res);
  if (!job) return;
  const file = path.join(job.dir, "renders", "output.mp4");
  if (!existsSync(file)) return res.status(404).json({ error: "Video not ready yet." });
  let base = "birthday-video";
  try {
    const cfg = JSON.parse(readFileSync(path.join(job.dir, "config.json"), "utf8"));
    if (cfg.celebrantName) {
      const firstName = String(cfg.celebrantName)
        .trim()
        .split(/\s+/)[0]
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      if (firstName) base = `birthday-${firstName}`;
    }
  } catch {
    // keep the default file name
  }
  res.download(file, `${base}.mp4`);
});

// Multer and body errors land here so uploads fail with JSON, not a hang.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  res.status(400).json({ error: String(err && err.message ? err.message : err) });
});

app.listen(PORT, () => {
  console.log(`Video Presentation Generator running at http://localhost:${PORT}`);
  console.log(`Jobs folder: ${JOBS_DIR}`);
  if (!existsSync(HF_BIN)) {
    console.log(
      "Warning: hyperframes was not found in the sibling render-engine. Run npm install there first (see README).",
    );
  }
});
