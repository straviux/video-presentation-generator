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

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 20 },
  fileFilter: (req, file, cb) => {
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

app.post("/api/generate", upload.array("photos", 20), (req, res) => {
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
    const files = req.files || [];
    const text = (v) => (typeof v === "string" ? v.trim() : "");
    const celebrantName = text(body.celebrantName);
    if (!celebrantName) {
      return res.status(400).json({ error: "Please enter the celebrant name." });
    }
    if (files.length === 0) {
      return res.status(400).json({ error: "Please add at least one photo." });
    }

    const asArray = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
    const captions = asArray(body.captions).map((c) => String(c ?? ""));
    const collageEnabled = text(body.collageEnabled) === "true";
    const collageIndexes = asArray(body.collageIndexes)
      .map((v) => Number.parseInt(v, 10))
      .filter((n) => Number.isInteger(n) && n >= 0 && n < files.length);
    if (collageEnabled && collageIndexes.length !== 3) {
      return res.status(400).json({
        error:
          "The collage needs exactly 3 photos. Tick 3 photos for the collage, or turn the collage off.",
      });
    }

    const messages = [];
    for (const n of [1, 2]) {
      const msgText = text(body[`message${n}Text`]);
      const signedBy = text(body[`message${n}SignedBy`]);
      if (msgText) messages.push({ text: msgText, signedBy });
    }

    const fromLine = text(body.fromLine) || "Your YSE Family";

    // Font picks for the four text slots (name, headings, captions,
    // messages). The key list mirrors the font registry in lib/generate.mjs;
    // unknown or missing keys fall back to the slot defaults, which are the
    // template's original look.
    const FONT_KEYS = [
      "classic", "clean", "playfair", "fraunces", "dmserif", "greatvibes",
      "caveat", "bebas", "geist", "jakarta", "outfit", "dmsans",
    ];
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
    const shortName =
      text(body.celebrantShortName) ||
      celebrantName.split(/\s+/)[0].replace(/[^A-Za-zÀ-ÿ'-]/g, "");
    const closingSignOff =
      text(body.closingSignOff) || `With love, ${fromLine.replace(/^From\s+/i, "")}`;

    // --- create the job folder -------------------------------------------
    const jobId = `${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;
    const jobDir = path.join(JOBS_DIR, jobId);
    const photosDir = path.join(jobDir, "assets", "photos");
    mkdirSync(photosDir, { recursive: true });
    mkdirSync(path.join(jobDir, "renders"), { recursive: true });

    const extByMime = {
      "image/jpeg": ".jpg",
      "image/png": ".png",
      "image/webp": ".webp",
    };
    const photos = files.map((file, i) => {
      const extFromName = path.extname(file.originalname || "").toLowerCase();
      const ext = [".jpg", ".jpeg", ".png", ".webp"].includes(extFromName)
        ? extFromName
        : extByMime[file.mimetype] || ".jpg";
      const name = `photo-${i + 1}${ext}`;
      writeFileSync(path.join(photosDir, name), file.buffer);
      return {
        file: `assets/photos/${name}`,
        caption: captions[i] || "",
      };
    });

    const config = {
      celebrantName,
      celebrantShortName: shortName,
      closingLine:
        text(body.closingLine) || "Wishing you a year as warm and generous as you are.",
      closingSignOff,
      collage: {
        enabled: collageEnabled,
        heading: text(body.collageHeading) || "Moments together",
        photoIndexes: collageEnabled ? collageIndexes : [],
      },
      fromLine,
      fonts,
      messages,
      occasion: "Birthday",
      photos,
      role: text(body.role),
    };
    writeFileSync(path.join(jobDir, "config.json"), JSON.stringify(config, null, 2));

    // Composition support files inside the job folder: the generator, the
    // local GSAP copy (no CDN at render time), and the hyperframes config.
    copyFileSync(path.join(APP_DIR, "lib", "generate.mjs"), path.join(jobDir, "generate.mjs"));
    const gsapSource = [
      path.join(TEMPLATE_DIR, "assets", "gsap.min.js"),
      path.join(RENDER_ENGINE_DIR, "node_modules", "gsap", "dist", "gsap.min.js"),
    ].find((p) => existsSync(p));
    if (!gsapSource) {
      return res
        .status(500)
        .json({ error: "GSAP was not found in the render-engine. See the app README setup steps." });
    }
    copyFileSync(gsapSource, path.join(jobDir, "assets", "gsap.min.js"));
    const hfConfig = path.join(TEMPLATE_DIR, "hyperframes.json");
    if (existsSync(hfConfig)) copyFileSync(hfConfig, path.join(jobDir, "hyperframes.json"));
    writeFileSync(
      path.join(jobDir, "meta.json"),
      JSON.stringify({ id: jobId, name: jobId, createdAt: new Date().toISOString() }, null, 2),
    );

    const totalSeconds =
      5 + photos.length * 5 + (collageEnabled ? 6 : 0) + messages.length * 6 + 8;

    const job = {
      id: jobId,
      dir: jobDir,
      status: "generating",
      message: "Job created.",
      error: null,
      logTail: null,
      totalSeconds,
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
    if (cfg.celebrantShortName) {
      base = `birthday-${String(cfg.celebrantShortName).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
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
