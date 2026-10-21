// generate.mjs
// Config-driven composition generator for the Video Presentation Generator.
//
// Reads config.json (celebrant, photos, collage picks, messages, closing) and
// writes index.html, a complete HyperFrames composition (1920x1080, 30fps).
// To make a video for someone else: edit config.json, replace the photos in
// assets/photos/, then run `node generate.mjs` and render. Nothing else changes.
//
// Scene pacing: every card has its own duration from the config
//   (titleDuration, photos[].duration, collage.photo.duration /
//   collage.text.duration, messages[].duration, closingDuration), each
//   defaulting to the original pacing: title 5s, photos 5s each, collages
//   6s, messages 6s each, closing 8s. The four middle blocks (photos,
//   photoCollage, textCollage, messages) play in config.sceneOrder, so the
//   total duration is computed from the config, not fixed. With the sample
//   config (7 photos, photo collage on, text collage off, 2 messages, in
//   the default order) the total is 66s. The generator also writes
//   scenes.json (per-scene start and duration) next to index.html, which
//   the app's exact preview uses for its transport and filmstrip.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(`${here}/config.json`, "utf8"));

// ---------------------------------------------------------------- pacing ---
// Durations are per-card now: every value comes from the config, with a
// default that reproduces the original pacing, clamped to a sane range.
// Title and closing choreography stay anchored to the card start (the
// sequences complete in about 2.6s and 3.2s), so extra seconds are hold.
function clampNum(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
const TITLE_DUR = clampNum(config.titleDuration, 5, 3, 10);
const CLOSING_DUR = clampNum(config.closingDuration, 8, 4, 15);

// ----------------------------------------------------------- paper styles --
// Light paper treatments for the message and closing cards. A card picks
// one with paper: "<key>" in the config; anything unknown falls back to
// classic (the original warm gradient plus grain). All six stay light, so
// the existing dark ink remains valid on every one.
const PAPER_KEYS = ["classic", "white", "kraft", "blush", "mint", "sky"];
function pickPaper(value) {
  return PAPER_KEYS.includes(value) ? value : "classic";
}
const CLOSING_PAPER = pickPaper(config.closingPaper ?? config.closing?.paper);
// The closing eyebrow greets the celebrant by first name only.
const FIRST_NAME = String(config.celebrantName ?? "").trim().split(/\s+/)[0] || "";

// ------------------------------------------------------------ card effects --
// Optional animated assets layered over a card scene: confetti, sparkles,
// hearts, or petals. Each card picks its own (titleEffect, messages[].effect,
// collage.photo.effect, collage.text.effect, closingEffect); the default is
// "none" everywhere and unknown keys fall back to it. buildEffect below
// does the layer construction.
const EFFECT_KEYS = ["none", "confetti", "sparkles", "hearts", "petals"];
function pickEffect(value) {
  return EFFECT_KEYS.includes(value) ? value : "none";
}
const TITLE_EFFECT = pickEffect(config.titleEffect);
const CLOSING_EFFECT = pickEffect(config.closingEffect);

// ------------------------------------------------------- collage content ---
// The two collages are separate scenes. collage.photo builds polaroids from
// collage.photo.photoIndexes; collage.text builds greeting cards from
// collage.text.cards instead: up to 4 { text, from } entries, and cards
// with blank text are skipped. Each scene has its own heading. (The older
// flat fields, collage.heading / collage.photoIndexes / collage.cards, are
// still read when the nested objects are absent.)
const rawCollage = config.collage || {};
const photoCfg = rawCollage.photo || {};
const textCfg = rawCollage.text || {};

const PHOTO_COLLAGE_HEADING = photoCfg.heading ?? rawCollage.heading ?? "Moments together";
const PHOTO_INDEXES = Array.isArray(photoCfg.photoIndexes)
  ? photoCfg.photoIndexes
  : (Array.isArray(rawCollage.photoIndexes) ? rawCollage.photoIndexes : []);
const TEXT_COLLAGE_HEADING = textCfg.heading ?? "Kind words";
const TEXT_CARDS = (Array.isArray(textCfg.cards)
  ? textCfg.cards
  : (Array.isArray(rawCollage.cards) ? rawCollage.cards : []))
  .slice(0, 4)
  .map((card) => ({
    text: String((card && card.text) ?? "").trim(),
    from: String((card && card.from) ?? "").trim(),
  }))
  .filter((card) => card.text !== "");

// The photo collage is on unless its flag says no (it has always been part
// of this template); the text collage is off unless its flag turns it on.
// Either scene also needs content: photos ticked, cards written.
const PHOTO_COLLAGE_ON =
  (photoCfg.enabled ?? rawCollage.enabled) !== false && PHOTO_INDEXES.length > 0;
const TEXT_COLLAGE_ON = textCfg.enabled === true && TEXT_CARDS.length > 0;
const PHOTO_COLLAGE_DUR = clampNum(photoCfg.duration, 6, 4, 12);
const TEXT_COLLAGE_DUR = clampNum(textCfg.duration, 6, 4, 12);
const PHOTO_COLLAGE_EFFECT = pickEffect(photoCfg.effect);
const TEXT_COLLAGE_EFFECT = pickEffect(textCfg.effect);

// ---------------------------------------------------------- scene order ---
// The four middle blocks can play in any order. config.sceneOrder lists
// block keys; unknown keys are dropped, duplicates collapse, and any block
// missing from the list is appended in the default order.
const MIDDLE_BLOCKS = ["photos", "photoCollage", "textCollage", "messages"];
function sanitizeSceneOrder(raw) {
  const order = [];
  if (Array.isArray(raw)) {
    for (const key of raw) {
      if (MIDDLE_BLOCKS.includes(key) && !order.includes(key)) order.push(key);
    }
  }
  for (const key of MIDDLE_BLOCKS) {
    if (!order.includes(key)) order.push(key);
  }
  return order;
}
const SCENE_ORDER = sanitizeSceneOrder(config.sceneOrder);

// ----------------------------------------------------- per-photo setup ---
// Each photo carries its own display settings; missing fields fall back
// to the values that reproduce the original montage exactly. Position
// (focusX / focusY) picks which part of the photo stays in frame: it is
// both the object-position of the crop and the transform-origin the
// Ken Burns zoom pushes toward, so Vertical 100 keeps the bottom of the
// photo visible and Vertical 0 keeps the top.
const PHOTO_FRAMES = ["full", "thin", "polaroid", "rounded", "gold"];
const PHOTOS = config.photos.map((photo) => ({
  file: photo.file,
  caption: photo.caption ?? "",
  duration: clampNum(photo.duration, 5, 2, 12),
  zoom: clampNum(photo.zoom, 115, 100, 150),
  focusX: clampNum(photo.focusX, 50, 0, 100),
  focusY: clampNum(photo.focusY, 50, 0, 100),
  brightness: clampNum(photo.brightness, 100, 80, 120),
  saturation: clampNum(photo.saturation, 100, 0, 150),
  frame: PHOTO_FRAMES.includes(photo.frame) ? photo.frame : "full",
}));
const PHOTO_OFFSETS = [];
{
  let acc = 0;
  for (const photo of PHOTOS) {
    PHOTO_OFFSETS.push(acc);
    acc += photo.duration;
  }
}

// -------------------------------------------------- per-message setup ----
const MESSAGES = config.messages.map((message) => ({
  text: message.text,
  signedBy: message.signedBy,
  duration: clampNum(message.duration, 6, 4, 15),
  paper: pickPaper(message.paper),
  effect: pickEffect(message.effect),
}));
const MSG_OFFSETS = [];
{
  let acc = 0;
  for (const message of MESSAGES) {
    MSG_OFFSETS.push(acc);
    acc += message.duration;
  }
}

// Block durations. A block that is off or empty contributes no seconds
// and no scenes. Photos and messages sum their per-card durations.
const BLOCK_DUR = {
  photos: PHOTOS.reduce((sum, photo) => sum + photo.duration, 0),
  photoCollage: PHOTO_COLLAGE_ON ? PHOTO_COLLAGE_DUR : 0,
  textCollage: TEXT_COLLAGE_ON ? TEXT_COLLAGE_DUR : 0,
  messages: MESSAGES.reduce((sum, message) => sum + message.duration, 0),
};

// Running start offsets: title first, then the middle blocks in scene
// order, then the closing card. The total is whatever the blocks add to.
const STARTS = { title: 0 };
{
  let cursor = TITLE_DUR;
  for (const key of SCENE_ORDER) {
    STARTS[key] = cursor;
    cursor += BLOCK_DUR[key];
  }
  STARTS.closing = cursor;
}
const TOTAL = STARTS.closing + CLOSING_DUR;

// ------------------------------------------------------------- utilities ---
function esc(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// Split a short line into word spans so GSAP can stagger the words in.
// The spans get class "w" (display: inline-block in the CSS) so transforms apply.
function wordSpans(text) {
  return String(text)
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => `<span class="w">${esc(w)}</span>`)
    .join(" ");
}

// Split a celebrant name into two chunks for the split reveal on the title
// card: first word vs the rest for multi-word names, otherwise split at a
// hyphen (kept on the left chunk) or at the midpoint of a single word.
function splitName(name) {
  const raw = String(name ?? "").trim();
  const words = raw.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return { left: words[0], right: words.slice(1).join(" "), sep: " " };
  }
  const word = words[0] || raw;
  const hy = word.indexOf("-");
  if (hy > 0 && hy < word.length - 1) {
    return { left: word.slice(0, hy + 1), right: word.slice(hy + 1), sep: "" };
  }
  const mid = Math.ceil(word.length / 2);
  return { left: word.slice(0, mid), right: word.slice(mid), sep: "" };
}

// Split a message into per-character spans for the typewriter reveal. Words
// become inline-block spans so wrapping still breaks between words, never
// inside one; the character spans inside animate opacity only.
function typewriterSpans(text) {
  return String(text)
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => `<span class="tw-w">${[...w].map((c) => `<span class="tw-c">${esc(c)}</span>`).join("")}</span>`)
    .join(" ");
}

// Visible character count of a message (spaces excluded, they are not spans).
function typeCharCount(text) {
  return String(text).replace(/\s+/g, "").length;
}

// Small gold accent shapes sprinkled around the collage polaroids.
const ACCENT_HEART = '<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 5.5c0 2.29 1.51 4.04 3 5.5l7 7Z"/></svg>';
const ACCENT_STAR = '<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4Z"/></svg>';
const ACCENT_DOT = '<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="6"/></svg>';

let hfCounter = 0;
function hfId() {
  hfCounter += 1;
  return `hf-b${String(hfCounter).padStart(2, "0")}`;
}

// ----------------------------------------------------- effect layers -----
// Deterministic pseudo-random stream (FNV-1a seed + mulberry32), so an
// effect layer is identical on every render of the same config and in both
// generators. Seeded from the layer id, which names the card.
function effectRng(seedText) {
  let h = 2166136261;
  for (let i = 0; i < seedText.length; i++) {
    h ^= seedText.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let state = h >>> 0 || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const fxRound = (n) => Math.round(n * 1000) / 1000;

// Plan one looping asset inside a scene window: a cycle length in
// [minCyc, maxCyc], a start offset inside the first cycle, and a whole
// number of cycles, so offset + cycles * cycle never passes the window.
function fxLoop(rng, span, minCyc, maxCyc) {
  let cyc = minCyc + rng() * (maxCyc - minCyc);
  if (cyc > span) cyc = span * (0.75 + rng() * 0.2);
  const off = rng() * cyc * 0.9;
  let cycles = Math.floor((span - off) / cyc);
  if (cycles < 1) {
    cycles = 1;
    cyc = Math.max(0.4, span - off);
  }
  return { cyc: fxRound(cyc), off: fxRound(off), cycles };
}

const FX_HEART_PATH = "M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 5.5c0 2.29 1.51 4.04 3 5.5l7 7Z";
const FX_STAR_PATH = "M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4Z";
function fxSvg(path, color) {
  return `<svg viewBox="0 0 24 24" fill="${color}" xmlns="http://www.w3.org/2000/svg"><path d="${path}"/></svg>`;
}

// Builds one effect layer for a scene starting at s with duration dur:
// the layer markup (assets placed full-canvas) plus the GSAP statements
// that animate them on the main timeline. Layers are inserted above the
// scene background and orbs and below the card content, so assets spill
// around the card edges. Returns empty parts for "none".
function buildEffect(kind, layerId, s, dur) {
  if (!EFFECT_KEYS.includes(kind) || kind === "none") return { html: "", tweens: [] };
  const rng = effectRng(layerId);
  const pieces = [];
  const tweens = [];
  const start = fxRound(s + 0.15);
  const span = Math.max(0.5, dur - 0.3);
  if (kind === "confetti") {
    const colors = ["#e8c56e", "#f7f3e8", "#a9c19a", "#e8b4b8"];
    for (let k = 0; k < 26; k++) {
      const id = `${layerId}-a${k}`;
      const w = Math.round(9 + rng() * 9);
      const dot = rng() < 0.3;
      const h = dot ? w : Math.round(14 + rng() * 12);
      const op = fxRound(0.55 + rng() * 0.35);
      pieces.push(`<span class="fx-piece" id="${id}" style="left: ${fxRound(2 + rng() * 94)}%; top: -70px; width: ${w}px; height: ${h}px; background: ${colors[k % colors.length]}; border-radius: ${dot ? "50%" : "2px"}; opacity: ${op}"></span>`);
      const plan = fxLoop(rng, span, 2.4, 3.8);
      const t0 = fxRound(start + plan.off);
      const sway = Math.round(18 + rng() * 30);
      const spin = Math.round(180 + rng() * 360) * (rng() < 0.5 ? -1 : 1);
      tweens.push(
        `tl.fromTo("#${id}", { y: 0 }, { y: 1240, duration: ${plan.cyc}, ease: "none", repeat: ${plan.cycles - 1} }, ${t0});`,
        `tl.fromTo("#${id}", { x: ${-sway}, rotation: 0 }, { x: ${sway}, rotation: ${spin}, duration: ${fxRound(plan.cyc / 2)}, ease: "sine.inOut", yoyo: true, repeat: ${plan.cycles * 2 - 1} }, ${t0});`,
      );
    }
  } else if (kind === "sparkles") {
    const colors = ["#f5e2a0", "#e8c56e", "#fff3d6"];
    for (let k = 0; k < 14; k++) {
      const id = `${layerId}-a${k}`;
      const size = Math.round(20 + rng() * 24);
      const op = fxRound(0.55 + rng() * 0.35);
      pieces.push(`<span class="fx-piece" id="${id}" style="left: ${fxRound(3 + rng() * 92)}%; top: ${fxRound(4 + rng() * 86)}%; width: ${size}px; height: ${size}px">${fxSvg(FX_STAR_PATH, colors[k % colors.length])}</span>`);
      const plan = fxLoop(rng, span, 1.6, 3.0);
      const t0 = fxRound(start + plan.off);
      tweens.push(
        `tl.fromTo("#${id}", { scale: 0.35, opacity: ${fxRound(op * 0.25)}, rotation: -14 }, { scale: 1, opacity: ${op}, rotation: 14, duration: ${fxRound(plan.cyc / 2)}, ease: "sine.inOut", yoyo: true, repeat: ${plan.cycles * 2 - 1}, transformOrigin: "50% 50%" }, ${t0});`,
      );
    }
  } else if (kind === "hearts") {
    const colors = ["#e88ca0", "#d96b84", "#f2b8c6"];
    for (let k = 0; k < 12; k++) {
      const id = `${layerId}-a${k}`;
      const size = Math.round(20 + rng() * 18);
      const op = fxRound(0.5 + rng() * 0.35);
      pieces.push(`<span class="fx-piece" id="${id}" style="left: ${fxRound(3 + rng() * 92)}%; top: 1092px; width: ${size}px; height: ${size}px; opacity: ${op}">${fxSvg(FX_HEART_PATH, colors[k % colors.length])}</span>`);
      const plan = fxLoop(rng, span, 2.8, 4.4);
      const t0 = fxRound(start + plan.off);
      const rise = Math.round(760 + rng() * 80);
      const sway = Math.round(14 + rng() * 22);
      tweens.push(
        `tl.fromTo("#${id}", { y: 0 }, { y: ${-rise}, duration: ${plan.cyc}, ease: "sine.out", repeat: ${plan.cycles - 1} }, ${t0});`,
        `tl.fromTo("#${id}", { x: ${-sway} }, { x: ${sway}, duration: ${fxRound(plan.cyc / 2)}, ease: "sine.inOut", yoyo: true, repeat: ${plan.cycles * 2 - 1} }, ${t0});`,
        // Fade out over the last stretch of each rise, near the top.
        `tl.fromTo("#${id}", { opacity: ${op} }, { opacity: 0, duration: ${fxRound(plan.cyc * 0.22)}, ease: "power1.in", repeat: ${plan.cycles - 1} }, ${fxRound(t0 + plan.cyc * 0.78)});`,
      );
    }
  } else if (kind === "petals") {
    const colors = ["#f6d9de", "#f9ecec", "#f3e3d3", "#eed7c8"];
    for (let k = 0; k < 14; k++) {
      const id = `${layerId}-a${k}`;
      const w = Math.round(22 + rng() * 18);
      const h = Math.round(w * 0.72);
      const op = fxRound(0.5 + rng() * 0.35);
      pieces.push(`<span class="fx-piece" id="${id}" style="left: ${fxRound(2 + rng() * 94)}%; top: -60px; width: ${w}px; height: ${h}px; background: ${colors[k % colors.length]}; border-radius: 62% 38% 62% 38% / 48% 58% 42% 52%; opacity: ${op}"></span>`);
      const plan = fxLoop(rng, span, 3.4, 5.2);
      const t0 = fxRound(start + plan.off);
      const sway = Math.round(30 + rng() * 40);
      const rot0 = Math.round(rng() * 360);
      const spin = Math.round(120 + rng() * 180) * (rng() < 0.5 ? -1 : 1);
      tweens.push(
        `tl.fromTo("#${id}", { y: 0 }, { y: 1220, duration: ${plan.cyc}, ease: "sine.inOut", repeat: ${plan.cycles - 1} }, ${t0});`,
        `tl.fromTo("#${id}", { x: ${-sway}, rotation: ${rot0} }, { x: ${sway}, rotation: ${rot0 + spin}, duration: ${fxRound(plan.cyc / 2)}, ease: "sine.inOut", yoyo: true, repeat: ${plan.cycles * 2 - 1} }, ${t0});`,
      );
    }
  }
  return {
    html: `
      <div class="fx-layer" id="${layerId}">${pieces.join("")}
      </div>`,
    tweens,
  };
}

const scenes = []; // HTML strings, in timeline order
const sceneMeta = []; // { key, label, start, duration } per scene, written to scenes.json
const timeline = []; // GSAP statements (strings), absolute positions in seconds
let track = 0;
function nextTrack() {
  track += 1;
  return track;
}


// ------------------------------------------------------------- font pool ---
// Curated font pool, the single source of truth for per-slot font picks.
// Keys are what config.fonts (and the app's font fields) store. Entries with
// a family name load from Google Fonts; classic and clean are local stacks
// and load nothing. The script flag marks script/handwritten faces, used for
// the name slot size bump on the title card.
const FONT_REGISTRY = {
  classic:    { label: "Classic Serif",    family: null,                weights: [],            stack: 'Georgia, "Times New Roman", serif',        script: false },
  clean:      { label: "Clean Sans",       family: null,                weights: [],            stack: "Arial, Helvetica, sans-serif",             script: false },
  playfair:   { label: "Playfair Display", family: "Playfair Display",  weights: [500, 700, 800], stack: '"Playfair Display", Georgia, serif',     script: false },
  fraunces:   { label: "Fraunces",         family: "Fraunces",          weights: [600, 700],      stack: '"Fraunces", Georgia, serif',               script: false },
  dmserif:    { label: "DM Serif Display", family: "DM Serif Display",  weights: [400],           stack: '"DM Serif Display", Georgia, serif',       script: false },
  greatvibes: { label: "Great Vibes",      family: "Great Vibes",       weights: [400],           stack: '"Great Vibes", cursive',                     script: true },
  caveat:     { label: "Caveat",           family: "Caveat",            weights: [600, 700],      stack: '"Caveat", cursive',                          script: true },
  bebas:      { label: "Bebas Neue",       family: "Bebas Neue",        weights: [400],           stack: '"Bebas Neue", "Arial Narrow", sans-serif',   script: false },
  geist:      { label: "Geist",            family: "Geist",             weights: [400, 600, 700], stack: '"Geist", system-ui, sans-serif',             script: false },
  jakarta:    { label: "Plus Jakarta Sans", family: "Plus Jakarta Sans", weights: [400, 600, 700], stack: '"Plus Jakarta Sans", system-ui, sans-serif', script: false },
  outfit:     { label: "Outfit",           family: "Outfit",            weights: [400, 600, 700],   stack: '"Outfit", system-ui, sans-serif',            script: false },
  dmsans:     { label: "DM Sans",          family: "DM Sans",           weights: [400, 500, 700], stack: '"DM Sans", system-ui, sans-serif',           script: false },
};
// Slot defaults reproduce the original look: serif name/headings/messages,
// sans captions.
const FONT_DEFAULTS = { name: "classic", headings: "classic", captions: "clean", messages: "classic" };
function pickFontKey(slot) {
  const wanted = config.fonts && typeof config.fonts[slot] === "string" ? config.fonts[slot] : "";
  return FONT_REGISTRY[wanted] ? wanted : FONT_DEFAULTS[slot];
}
const FONT_SLOTS = {
  name: FONT_REGISTRY[pickFontKey("name")],
  headings: FONT_REGISTRY[pickFontKey("headings")],
  captions: FONT_REGISTRY[pickFontKey("captions")],
  messages: FONT_REGISTRY[pickFontKey("messages")],
};

// One Google Fonts stylesheet covering the union of the selected webfonts,
// families deduped with their weights merged. Null when every slot is local.
function googleFontsUrl() {
  const byFamily = new Map();
  for (const entry of Object.values(FONT_SLOTS)) {
    if (!entry.family) continue;
    const set = byFamily.get(entry.family) || new Set();
    entry.weights.forEach((w) => set.add(w));
    byFamily.set(entry.family, set);
  }
  if (byFamily.size === 0) return null;
  const parts = [...byFamily.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([family, weights]) => `${family.replaceAll(" ", "+")}:wght@${[...weights].sort((a, b) => a - b).join(";")}`);
  return `https://fonts.googleapis.com/css2?family=${parts.join("&family=")}&display=swap`;
}
const FONT_CSS_URL = googleFontsUrl();

// ------------------------------------------------------ background pool --
// Per-render backdrop presets, picked by config.background. A preset sets
// the scene background, the drifting orb layer (or none), and the colors
// of the text that sits directly on the background. Photo scenes are
// full-bleed and the paper cards keep their paper in every preset, so
// neither is affected by the pick. "deep-green" is the original look.
const BACKGROUND_REGISTRY = {
  "deep-green": { label: "Deep Green", type: "animated",
    bg: "radial-gradient(circle at 18% 12%, #2c5c46 0%, #17352b 55%, #10261e 100%)",
    orbs: { a: "rgba(232, 197, 110, 0.16)", b: "rgba(255, 255, 255, 0.07)" },
    ink: "#f7f3e8", inkSoft: "#cfd8cc", line: "#e8c56e", accent: "#e8c56e" },
  emerald: { label: "Emerald", type: "animated",
    bg: "radial-gradient(circle at 20% 10%, #1f7a55 0%, #0d4d33 52%, #063a26 100%)",
    orbs: { a: "rgba(140, 240, 190, 0.14)", b: "rgba(255, 255, 255, 0.06)" },
    ink: "#f4fbf6", inkSoft: "#cfe8d8", line: "#ffd98a", accent: "#ffd98a" },
  midnight: { label: "Midnight", type: "animated",
    bg: "radial-gradient(circle at 18% 12%, #2b3a6e 0%, #1a2450 55%, #0d1330 100%)",
    orbs: { a: "rgba(130, 160, 255, 0.16)", b: "rgba(255, 255, 255, 0.06)" },
    ink: "#f2f4ff", inkSoft: "#c3cbe8", line: "#a9c2ff", accent: "#a9c2ff" },
  royal: { label: "Royal", type: "animated",
    bg: "radial-gradient(circle at 18% 12%, #5b2a86 0%, #3a1663 55%, #22093f 100%)",
    orbs: { a: "rgba(216, 180, 255, 0.15)", b: "rgba(255, 255, 255, 0.06)" },
    ink: "#faf5ff", inkSoft: "#ddccf2", line: "#e3b8ff", accent: "#e3b8ff" },
  sunset: { label: "Sunset", type: "animated",
    bg: "radial-gradient(circle at 18% 12%, #93395f 0%, #5e2149 52%, #33102e 100%)",
    orbs: { a: "rgba(255, 180, 84, 0.20)", b: "rgba(255, 120, 80, 0.10)" },
    ink: "#fff6ec", inkSoft: "#f2d7c4", line: "#ffb45e", accent: "#ffb45e" },
  charcoal: { label: "Charcoal", type: "solid",
    bg: "#201f1e",
    orbs: { a: "rgba(255, 255, 255, 0.04)", b: "rgba(255, 255, 255, 0.025)" },
    ink: "#f5efe4", inkSoft: "#cbc2b2", line: "#d9b96a", accent: "#d9b96a" },
  cream: { label: "Cream", type: "solid",
    bg: "#f6eeda",
    orbs: null,
    ink: "#22371f", inkSoft: "#5c6650", line: "#a07d1e", accent: "#b08a1e" },
  sky: { label: "Sky", type: "gradient",
    bg: "linear-gradient(165deg, #eaf4fc 0%, #cfe6f7 55%, #aed2ef 100%)",
    orbs: { a: "rgba(255, 255, 255, 0.5)", b: "rgba(255, 255, 255, 0.35)" },
    ink: "#173a52", inkSoft: "#47637a", line: "#256d9e", accent: "#c98f1f" },
};
const BACKGROUND = BACKGROUND_REGISTRY[
  typeof config.background === "string" && BACKGROUND_REGISTRY[config.background] ? config.background : "deep-green"
];
const HAS_ORBS = BACKGROUND.orbs !== null;
const ORBS_ANIMATED = HAS_ORBS && BACKGROUND.type === "animated";
const ORB_A = HAS_ORBS ? `<div class="orb orb-a"></div>` : "";
const ORB_B = HAS_ORBS ? `<div class="orb orb-b"></div>` : "";


// ------------------------------------------------------------ title card ---
function buildTitle(s) {
  const titleLine1 = wordSpans(`Happy ${config.occasion},`);
  const nameParts = splitName(config.celebrantName);
  const titleLine2 = `<span class="name-chunk" id="title-name-left">${esc(nameParts.left)}</span>${nameParts.sep}<span class="name-chunk" id="title-name-right">${esc(nameParts.right)}!</span>`;
  const nameLineClass = FONT_SLOTS.name.script ? "name-line name-script" : "name-line";
  const fx = buildEffect(TITLE_EFFECT, "fx-title", s, TITLE_DUR);
  scenes.push(`
    <section class="clip scene scene-card" id="scene-title" style="opacity: 0" data-start="${s}" data-duration="${TITLE_DUR + 0.5}" data-track-index="${nextTrack()}">
      ${ORB_A}
      ${ORB_B}${fx.html}
      <div class="card-inner">
        <div class="eyebrow" id="title-eyebrow">Happy ${esc(config.occasion)}</div>
        <h1 class="big-title" id="title-name"><span id="title-greeting">${titleLine1}</span><br /><span class="${nameLineClass}">${titleLine2}</span></h1>
        <div class="rule" id="title-rule"></div>
      </div>
    </section>`);
  sceneMeta.push({ key: "title", label: "Title card", start: s, duration: TITLE_DUR });

  timeline.push(
    `tl.fromTo("#scene-title", { opacity: 0 }, { opacity: 1, duration: 0.4, ease: "power1.out" }, ${s});`,
    ...fx.tweens,
    ...(ORBS_ANIMATED ? [
      `tl.fromTo("#scene-title .orb-a", { x: 0, y: 0 }, { x: -51, y: 33, duration: ${TITLE_DUR + 0.5}, ease: "sine.inOut" }, ${s});`,
      `tl.fromTo("#scene-title .orb-b", { x: 0, y: 0 }, { x: 39, y: -27, duration: ${TITLE_DUR + 0.5}, ease: "sine.inOut" }, ${s});`,
    ] : []),
    `tl.fromTo("#title-eyebrow", { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.6, ease: "power2.out" }, ${s + 0.15});`,
    `tl.fromTo("#title-greeting .w", { opacity: 0, y: 69, rotation: 4 }, { opacity: 1, y: 0, rotation: 0, duration: 0.7, ease: "power3.out", stagger: 0.12, transformOrigin: "50% 100%" }, ${s + 0.35});`,
    `tl.fromTo("#title-name-left", { opacity: 0, x: -1250 }, { opacity: 1, x: 0, duration: 0.75, ease: "power3.out" }, ${s + 0.8});`,
    `tl.fromTo("#title-name-right", { opacity: 0, x: 1250 }, { opacity: 1, x: 0, duration: 0.75, ease: "power3.out" }, ${s + 0.87});`,
    `tl.fromTo("#title-rule", { scaleX: 0, opacity: 0 }, { scaleX: 1, opacity: 1, duration: 0.7, ease: "power2.inOut" }, ${s + 1.8});`,
    `tl.to("#scene-title", { opacity: 0, duration: 0.5, ease: "power1.in" }, ${s + TITLE_DUR});`,
  );
}

function buildPhotos(blockStart) {
  PHOTOS.forEach((photo, i) => {
  const s = blockStart + PHOTO_OFFSETS[i];
  const dur = photo.duration;
  const framed = photo.frame === "polaroid" || photo.frame === "rounded" || photo.frame === "gold";
  const drift = (i % 2 === 0 ? 1 : -1) * (framed ? 12 : 27); // alternate Ken Burns drift direction
  const isFirst = i === 0;
  const isLast = i === PHOTOS.length - 1;
  const brightStart = Number(((photo.brightness / 100) * 1.16).toFixed(3));
  const brightEnd = photo.brightness / 100;
  const imgTag = `<img class="photo-img" id="photo-img-${i}" src="${esc(photo.file)}" alt="" style="object-position: ${photo.focusX}% ${photo.focusY}%; filter: saturate(${photo.saturation / 100})" />`;
  const clipInner = `<div class="photo-bright" id="bright-${i}">${imgTag}</div>
      <div class="vignette" id="vignette-${i}"></div>`;
  const captionBar = `<div class="caption-bar" id="caption-${i}"><span id="caption-text-${i}">${esc(photo.caption)}</span></div>`;
  let inner;
  if (photo.frame === "polaroid") {
    inner = `
      <figure class="photo-polaroid" id="photo-frame-${i}" style="rotate: ${i % 2 === 0 ? -2.5 : 2.5}deg">
        <div class="photo-clip">${clipInner}
        </div>
        <figcaption class="photo-pol-cap" id="caption-text-${i}">${esc(photo.caption)}</figcaption>
      </figure>`;
  } else if (photo.frame === "rounded") {
    inner = `
      <div class="photo-rounded" id="photo-frame-${i}">
        <div class="photo-clip">${clipInner}
          ${captionBar}
        </div>
      </div>`;
  } else if (photo.frame === "gold") {
    inner = `
      <div class="photo-gold" id="photo-frame-${i}">
        <div class="photo-gold-mat">
          <div class="photo-clip">${clipInner}
            ${captionBar}
          </div>
        </div>
      </div>`;
  } else {
    inner = `
      ${clipInner}${photo.frame === "thin" ? `
      <div class="frame-thin"></div>` : ""}
      ${captionBar}`;
  }
  scenes.push(`
    <section class="clip scene scene-photo${framed ? " scene-photo-framed" : ""}" id="scene-photo-${i}" style="opacity: 0" data-start="${s}" data-duration="${dur + 0.5}" data-track-index="${nextTrack()}">${framed ? `
      ${ORB_A}
      ${ORB_B}` : ""}${inner}
      <div class="white-fade" id="white-${i}" style="opacity: ${isFirst ? 0 : 1}"></div>
    </section>`);
  sceneMeta.push({ key: `photo-${i}`, label: `Photo ${i + 1}`, start: s, duration: dur });

  timeline.push(
    // First photo crossfades in from the title card as before; later photos
    // start instantly under their white layer, which is what fades instead.
    isFirst
      ? `tl.fromTo("#scene-photo-${i}", { opacity: 0 }, { opacity: 1, duration: 0.5, ease: "power1.out" }, ${s});`
      : `tl.fromTo("#scene-photo-${i}", { opacity: 0 }, { opacity: 1, duration: 0.01, ease: "none" }, ${s});`,
    // Ken Burns pushes in toward the chosen Position: the transform-origin
    // is the same point the object-position crop keeps in frame.
    `tl.fromTo("#photo-img-${i}", { scale: 1.05, x: 0 }, { scale: ${photo.zoom / 100}, x: ${drift}, duration: ${dur}, ease: "sine.inOut", transformOrigin: "${photo.focusX}% ${photo.focusY}%" }, ${s});`,
    // The settle brightness rides on a wrapper so it composes with the
    // per-photo brightness: from 16% over the chosen value down to it. The
    // img itself carries only the static saturation.
    `tl.fromTo("#bright-${i}", { filter: "brightness(${brightStart})" }, { filter: "brightness(${brightEnd})", duration: 1.2, ease: "power2.out" }, ${s});`,
    `tl.fromTo("#vignette-${i}", { opacity: 0 }, { opacity: 1, duration: 1.4, ease: "power1.out" }, ${s + 0.3});`,
    ...(photo.frame === "polaroid"
      ? [
          `tl.fromTo("#photo-frame-${i}", { scale: 0.96 }, { scale: 1, duration: 0.9, ease: "power2.out" }, ${s});`,
          `tl.fromTo("#caption-text-${i}", { opacity: 0, y: 21 }, { opacity: 1, y: 0, duration: 0.55, ease: "power2.out" }, ${s + 0.85});`,
        ]
      : [
          `tl.fromTo("#caption-${i}", { y: 165 }, { y: 0, duration: 0.7, ease: "power3.out" }, ${s + 0.6});`,
          `tl.fromTo("#caption-text-${i}", { opacity: 0, y: 21 }, { opacity: 1, y: 0, duration: 0.55, ease: "power2.out" }, ${s + 0.85});`,
        ]),
  );
  if (!isFirst) {
    // Incoming half of the fade through white: the white layer lifts.
    timeline.push(
      `tl.to("#white-${i}", { opacity: 0, duration: 0.35, ease: "power1.out" }, ${s});`,
    );
  }
  if (!isLast) {
    // Outgoing half: the white layer ramps up over the last 0.35s, then the
    // scene itself cuts out underneath the fully white frame.
    timeline.push(
      `tl.to("#white-${i}", { opacity: 1, duration: 0.35, ease: "power1.in" }, ${s + dur - 0.35});`,
      `tl.to("#scene-photo-${i}", { opacity: 0, duration: 0.01, ease: "none" }, ${s + dur});`,
    );
  } else {
    // Last photo keeps the plain crossfade into whatever scene follows.
    timeline.push(
      `tl.to("#scene-photo-${i}", { opacity: 0, duration: 0.5, ease: "power1.in" }, ${s + dur});`,
    );
  }
  });
}

function buildCollage(kind, s) {
  const isText = kind === "text";
  const dur = isText ? TEXT_COLLAGE_DUR : PHOTO_COLLAGE_DUR;
  // The choreography was authored against a 6s scene. ct/cd stretch or
  // compress every internal time by the same factor, so the build pattern
  // lands the same way at any duration and the 6s case is unchanged.
  const f = dur / 6;
  const ct = (t) => Number((s + t * f).toFixed(3));
  const cd = (d) => Number((d * f).toFixed(3));
  const prefix = isText ? "tc" : "pc";
  const sceneId = isText ? "scene-text-collage" : "scene-photo-collage";
  const headingId = `${prefix}-collage-heading`;
  const fx = buildEffect(isText ? TEXT_COLLAGE_EFFECT : PHOTO_COLLAGE_EFFECT, isText ? "fx-tc" : "fx-pc", s, dur);
  const accentSpots = [
    { left: "6%", top: "16%", size: 56, shape: ACCENT_HEART },
    { left: "88%", top: "13%", size: 44, shape: ACCENT_STAR },
    { left: "11%", top: "77%", size: 34, shape: ACCENT_DOT },
    { left: "85%", top: "73%", size: 58, shape: ACCENT_HEART },
    { left: "46%", top: "85%", size: 40, shape: ACCENT_STAR },
    { left: "64%", top: "9%", size: 30, shape: ACCENT_DOT },
  ];
  const accents = accentSpots
    .map((spot, k) => `<span class="accent" id="accent-${prefix}-${k}" style="left: ${spot.left}; top: ${spot.top}; width: ${spot.size}px; height: ${spot.size}px;">${spot.shape}</span>`)
    .join("");

  // The photo scene builds a row of polaroids; the text scene builds a
  // grid of greeting cards.
  let collageInner;
  if (isText) {
    const cards = TEXT_CARDS
      .map((card, k) => `
        <div class="greet-card" id="greet-card-${k}">
          <p class="greet-text">${esc(card.text)}</p>${card.from ? `
          <p class="greet-from" id="greet-from-${k}">${esc(card.from)}</p>` : ""}
        </div>`)
      .join("");
    collageInner = `
      <div class="collage-cards cards-${TEXT_CARDS.length}">${cards}
      </div>`;
  } else {
    const polaroids = PHOTO_INDEXES
      .map((photoIndex, k) => {
        const photo = PHOTOS[photoIndex];
        return `
        <figure class="polaroid" id="polaroid-${k}">
          <img src="${esc(photo.file)}" alt="" />
          <figcaption id="polaroid-cap-${k}">${esc(photo.caption)}</figcaption>
        </figure>`;
      })
      .join("");
    collageInner = `
      <div class="collage-row">${polaroids}
      </div>`;
  }

  scenes.push(`
    <section class="clip scene scene-card" id="${sceneId}" style="opacity: 0" data-start="${s}" data-duration="${dur + 0.5}" data-track-index="${nextTrack()}">
      ${ORB_A}
      ${ORB_B}${fx.html}
      <h2 class="collage-heading" id="${headingId}">${wordSpans(isText ? TEXT_COLLAGE_HEADING : PHOTO_COLLAGE_HEADING)}</h2>${collageInner}${accents}
    </section>`);
  sceneMeta.push({ key: isText ? "textCollage" : "photoCollage", label: isText ? "Text collage" : "Photo collage", start: s, duration: dur });

  timeline.push(
    `tl.fromTo("#${sceneId}", { opacity: 0 }, { opacity: 1, duration: 0.4, ease: "power1.out" }, ${s});`,
    ...fx.tweens,
    ...(ORBS_ANIMATED ? [
      `tl.fromTo("#${sceneId} .orb-a", { x: 0, y: 0 }, { x: -42, y: 27, duration: ${dur + 0.5}, ease: "sine.inOut" }, ${s});`,
      `tl.fromTo("#${sceneId} .orb-b", { x: 0, y: 0 }, { x: 33, y: -21, duration: ${dur + 0.5}, ease: "sine.inOut" }, ${s});`,
    ] : []),
    `tl.fromTo("#${headingId} .w", { opacity: 0, y: 39, rotation: 3 }, { opacity: 1, y: 0, rotation: 0, duration: ${cd(0.55)}, ease: "power3.out", stagger: ${cd(0.09)}, transformOrigin: "50% 100%" }, ${ct(0.2)});`,
  );
  if (isText) {
    // The greeting cards build one by one like the polaroids do. The 1.1s
    // spacing holds for any card count, and the build is centered in the
    // scene window, so fewer cards start later instead of leaving a long
    // still tail after an early finish.
    const cardRotations = [-2.5, 2, -1.5, 2.5];
    const buildStart = 0.8 + Math.max(0, (3.3 - 1.1 * (TEXT_CARDS.length - 1)) / 2);
    TEXT_CARDS.forEach((card, k) => {
      const rot = cardRotations[k % cardRotations.length];
      const popAt = ct(buildStart + k * 1.1);
      timeline.push(
        `tl.fromTo("#greet-card-${k}", { opacity: 0, scale: 0.5, y: 39, rotation: ${rot - 12} }, { opacity: 1, scale: 1, y: 0, rotation: ${rot}, duration: ${cd(0.6)}, ease: "back.out(1.7)" }, ${popAt});`,
      );
      if (card.from) {
        timeline.push(
          `tl.fromTo("#greet-from-${k}", { opacity: 0, y: 9 }, { opacity: 1, y: 0, duration: ${cd(0.45)}, ease: "power1.out" }, ${Number((popAt + 0.35 * f).toFixed(3))});`,
        );
      }
    });
  } else {
    // The collage builds one polaroid at a time, about a second apart, so the
    // scene feels assembled rather than shown. Captions fade in late.
    const rotations = [-5, 3, -3];
    const popTimes = [0.8, 1.9, 3.0];
    PHOTO_INDEXES.forEach((_, k) => {
      const rot = rotations[k % rotations.length];
      const popAt = ct(popTimes[k] ?? 3.0 + (k - 2) * 1.1);
      timeline.push(
        `tl.fromTo("#polaroid-${k}", { opacity: 0, scale: 0.45, y: 39, rotation: ${rot - 14} }, { opacity: 1, scale: 1, y: 0, rotation: ${rot}, duration: ${cd(0.6)}, ease: "back.out(1.7)" }, ${popAt});`,
        `tl.fromTo("#polaroid-cap-${k}", { opacity: 0, y: 9 }, { opacity: 1, y: 0, duration: ${cd(0.5)}, ease: "power1.out" }, ${ct(4.6 + k * 0.12)});`,
      );
    });
  }
  const accentTimes = [0.5, 1.45, 2.5, 3.55, 3.9, 4.25];
  accentTimes.forEach((t, k) => {
    timeline.push(
      `tl.fromTo("#accent-${prefix}-${k}", { opacity: 0, scale: 0, rotation: -40 }, { opacity: 1, scale: 1, rotation: 0, duration: ${cd(0.45)}, ease: "back.out(2)" }, ${ct(t)});`,
    );
  });
  if (isText) {
    timeline.push(
      // Gentle idle float after the last card lands, kept finite so the
      // timeline stays deterministic and ends inside the scene window.
      `tl.to(".greet-card", { y: -9, duration: ${cd(0.65)}, ease: "sine.inOut", stagger: ${cd(0.08)} }, ${ct(4.75)});`,
      `tl.to(".greet-card", { y: 0, duration: ${cd(0.5)}, ease: "sine.inOut", stagger: ${cd(0.08)} }, ${ct(5.45)});`,
      `tl.to("#${sceneId}", { opacity: 0, duration: 0.5, ease: "power1.in" }, ${s + dur});`,
    );
  } else {
    timeline.push(
      // Gentle idle float after the last polaroid lands, kept finite so the
      // timeline stays deterministic and ends inside the scene window.
      `tl.to(".polaroid", { y: -10.5, duration: ${cd(0.9)}, ease: "sine.inOut", stagger: ${cd(0.1)} }, ${ct(3.9)});`,
      `tl.to(".polaroid", { y: 0, duration: ${cd(0.8)}, ease: "sine.inOut", stagger: ${cd(0.1)} }, ${ct(5.0)});`,
      `tl.to("#${sceneId}", { opacity: 0, duration: 0.5, ease: "power1.in" }, ${s + dur});`,
    );
  }
}

function buildMessages(blockStart) {
  MESSAGES.forEach((message, i) => {
  const s = blockStart + MSG_OFFSETS[i];
  const dur = message.duration;
  // Typewriter fit: characters appear one by one starting at 1s in. The
  // typing window is the card duration minus 1.6s, so the full text lands
  // by dur - 0.6s whatever the message length or the chosen duration.
  const typeCharTotal = typeCharCount(message.text);
  const typeSpan = Math.max(0.5, dur - 1.85);
  const typeStagger = typeCharTotal > 1 ? Number((typeSpan / (typeCharTotal - 1)).toFixed(4)) : 0;
  const typeStart = 1.0;
  const typeEnd = typeStart + typeSpan + 0.05;
  const fx = buildEffect(message.effect, `fx-msg-${i}`, s, dur);
  scenes.push(`
    <section class="clip scene scene-card" id="scene-msg-${i}" style="opacity: 0" data-start="${s}" data-duration="${dur + 0.5}" data-track-index="${nextTrack()}">
      ${ORB_A}${fx.html}
      <div class="msg-card paper-${message.paper}" id="msg-card-${i}">
        <div class="msg-tape"></div>
        <div class="quote-mark" id="msg-quote-${i}">&ldquo;</div>
        <p class="msg-text" id="msg-text-${i}">${typewriterSpans(message.text)}</p>
        <p class="msg-sign" id="msg-sign-${i}">${esc(message.signedBy)}</p>
      </div>
    </section>`);
  sceneMeta.push({ key: `message-${i}`, label: `Message card ${i + 1}`, start: s, duration: dur });

  timeline.push(
    `tl.fromTo("#scene-msg-${i}", { opacity: 0 }, { opacity: 1, duration: 0.4, ease: "power1.out" }, ${s});`,
    ...fx.tweens,
    ...(ORBS_ANIMATED ? [
      `tl.fromTo("#scene-msg-${i} .orb-a", { x: 0, y: 0 }, { x: -33, y: 21, duration: ${dur + 0.5}, ease: "sine.inOut" }, ${s});`,
    ] : []),
    `tl.fromTo("#msg-card-${i}", { opacity: 0, y: 66, scale: 0.97, rotationX: 6, transformPerspective: 1350 }, { opacity: 1, y: 0, scale: 1, rotationX: 0, duration: 0.85, ease: "power3.out" }, ${s + 0.25});`,
    `tl.fromTo("#msg-quote-${i}", { scale: 0, rotation: -12 }, { scale: 1, rotation: 0, duration: 0.5, ease: "back.out(2)", transformOrigin: "50% 50%" }, ${s + 0.55});`,
    `tl.fromTo("#msg-text-${i} .tw-c", { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.05, ease: "none", stagger: ${typeStagger} }, ${s + typeStart});`,
    `tl.fromTo("#msg-sign-${i}", { opacity: 0, x: -27 }, { opacity: 1, x: 0, duration: 0.5, ease: "power2.out" }, ${s + typeEnd + 0.15});`,
    `tl.to("#scene-msg-${i}", { opacity: 0, duration: 0.5, ease: "power1.in" }, ${s + dur});`,
  );
  });
}

function buildClosing(s) {
  const fx = buildEffect(CLOSING_EFFECT, "fx-closing", s, CLOSING_DUR);
  scenes.push(`
    <section class="clip scene scene-card" id="scene-closing" style="opacity: 0" data-start="${s}" data-duration="${CLOSING_DUR}" data-track-index="${nextTrack()}">
      ${ORB_A}
      ${ORB_B}${fx.html}
      <div class="scrap-wrap" id="closing-card">
        <div class="scrap-card paper-${CLOSING_PAPER}">
          <div class="eyebrow scrap-eyebrow" id="closing-eyebrow">Happy ${esc(config.occasion)}, ${esc(FIRST_NAME)}</div>
          <p class="closing-line" id="closing-line">${wordSpans(config.closingLine)}</p>
          <div class="rule scrap-rule" id="closing-rule"></div>
          <p class="closing-sign" id="closing-sign">${esc(config.closingSignOff)}</p>
        </div>
        <div class="tape tape-left" id="tape-left"></div>
        <div class="tape tape-right" id="tape-right"></div>
      </div>
    </section>`);
  sceneMeta.push({ key: "closing", label: "Closing card", start: s, duration: CLOSING_DUR });

  timeline.push(
    `tl.fromTo("#scene-closing", { opacity: 0 }, { opacity: 1, duration: 0.5, ease: "power1.out" }, ${s});`,
    ...fx.tweens,
    ...(ORBS_ANIMATED ? [
      `tl.fromTo("#scene-closing .orb-a", { x: 0, y: 0 }, { x: -45, y: 30, duration: ${CLOSING_DUR}, ease: "sine.inOut" }, ${s});`,
      `tl.fromTo("#scene-closing .orb-b", { x: 0, y: 0 }, { x: 36, y: -24, duration: ${CLOSING_DUR}, ease: "sine.inOut" }, ${s});`,
    ] : []),
    `tl.fromTo("#closing-card", { opacity: 0, y: 72, rotation: -2.4 }, { opacity: 1, y: 0, rotation: -0.7, duration: 0.8, ease: "power3.out" }, ${s + 0.2});`,
    `tl.fromTo("#tape-left", { opacity: 0, y: -42, rotation: -52 }, { opacity: 1, y: 0, rotation: -38, duration: 0.5, ease: "power2.out" }, ${s + 0.6});`,
    `tl.fromTo("#tape-right", { opacity: 0, y: -42, rotation: 52 }, { opacity: 1, y: 0, rotation: 38, duration: 0.5, ease: "power2.out" }, ${s + 0.7});`,
    `tl.fromTo("#closing-eyebrow", { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.6, ease: "power2.out" }, ${s + 0.75});`,
    `tl.fromTo("#closing-line .w", { opacity: 0, y: 51, rotation: 3 }, { opacity: 1, y: 0, rotation: 0, duration: 0.65, ease: "power3.out", stagger: 0.07, transformOrigin: "50% 100%" }, ${s + 1.05});`,
    `tl.fromTo("#closing-rule", { scaleX: 0, opacity: 0 }, { scaleX: 1, opacity: 1, duration: 0.7, ease: "power2.inOut" }, ${s + 2.1});`,
    `tl.fromTo("#closing-sign", { opacity: 0, y: 15 }, { opacity: 1, y: 0, duration: 0.8, ease: "power1.out" }, ${s + 2.55});`,
    // Hold the closing card to the exact end of the composition.
    `tl.to("#scene-closing", { opacity: 1, duration: ${TOTAL - (s + 3.0)}, ease: "none" }, ${s + 3.0});`,
  );
}

// ------------------------------------------------------------ build all ---
// Title first, then the middle blocks in scene order (skipping blocks
// that are off or empty), then the closing card.
buildTitle(STARTS.title);
for (const key of SCENE_ORDER) {
  if (BLOCK_DUR[key] === 0) continue;
  if (key === "photos") buildPhotos(STARTS.photos);
  else if (key === "photoCollage") buildCollage("photo", STARTS.photoCollage);
  else if (key === "textCollage") buildCollage("text", STARTS.textCollage);
  else if (key === "messages") buildMessages(STARTS.messages);
}
buildClosing(STARTS.closing);

// --------------------------------------------------------------- document ---
const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />${FONT_CSS_URL ? `
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="${FONT_CSS_URL}" rel="stylesheet" />` : ""}
    <script src="assets/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      :root {
        --font-name: ${FONT_SLOTS.name.stack};
        --font-headings: ${FONT_SLOTS.headings.stack};
        --font-captions: ${FONT_SLOTS.captions.stack};
        --font-messages: ${FONT_SLOTS.messages.stack};
        --bg: ${BACKGROUND.bg};
        --ink: ${BACKGROUND.ink};
        --ink-soft: ${BACKGROUND.inkSoft};
        --line: ${BACKGROUND.line};
        --accent: ${BACKGROUND.accent};
        --paper-grain: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='matrix' values='0 0 0 0 0.45 0 0 0 0 0.36 0 0 0 0 0.18 0 0 0 0.05 0'/></filter><rect width='240' height='240' filter='url(%23n)'/></svg>");${HAS_ORBS ? `
        --orb-a: ${BACKGROUND.orbs.a};
        --orb-b: ${BACKGROUND.orbs.b};` : ""}
      }
      html, body {
        margin: 0;
        width: 1920px;
        height: 1080px;
        overflow: hidden;
        background: #10261e;
      }
      #root {
        position: relative;
        width: 1920px;
        height: 1080px;
        overflow: hidden;
        font-family: Georgia, "Times New Roman", serif;
        background: var(--bg);
        color: var(--ink);
      }
      .scene {
        position: absolute;
        inset: 0;
        width: 1920px;
        height: 1080px;
        overflow: hidden;
      }
      .scene-card {
        background: var(--bg);
      }
      .orb { position: absolute; border-radius: 999px; pointer-events: none; }
      .orb-a { width: 510px; height: 510px; right: -135px; top: -165px; background: var(--orb-a); }
      .orb-b { width: 315px; height: 315px; left: -90px; bottom: -120px; background: var(--orb-b); }
      /* Word spans GSAP staggers in: inline-block so transforms apply. */
      .w { display: inline-block; }
      /* Split name reveal: the two chunks form one continuous name line. */
      .name-line { display: inline-block; white-space: nowrap; font-family: var(--font-name); }
      .name-script { font-size: 121px; line-height: 1.3; }
      #title-greeting { font-family: var(--font-headings); }
      .name-chunk { display: inline-block; }
      /* Typewriter spans: words are inline-block so wrapping stays between
         words; the characters inside stay inline and only fade in. */
      .tw-w { display: inline-block; }
      .tw-c { display: inline; }
      /* Gold accent shapes that pop in around the collage polaroids. */
      .accent { position: absolute; pointer-events: none; color: var(--accent); }
      .accent svg { display: block; width: 100%; height: 100%; }
      /* Optional per-card effect layers (confetti, sparkles, hearts,
         petals): full-canvas, clipped, decorative only. */
      .fx-layer { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
      .fx-piece { position: absolute; display: block; pointer-events: none; }
      .fx-piece svg { display: block; width: 100%; height: 100%; }
      /* Soft edge darkening over photos, faded in by GSAP per scene. */
      .vignette {
        position: absolute; inset: 0; pointer-events: none; opacity: 0;
        background: radial-gradient(ellipse at center, rgba(0, 0, 0, 0) 52%, rgba(4, 12, 9, 0.42) 100%);
      }
      /* Full-canvas white layer for the fade-through-white photo transitions. */
      .white-fade { position: absolute; inset: 0; background: #ffffff; pointer-events: none; }
      .card-inner {
        position: absolute; inset: 0;
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        text-align: center; padding: 96px;
      }
      .eyebrow {
        font-family: var(--font-headings);
        font-size: 28.5px; letter-spacing: 0.34em; text-transform: uppercase;
        color: var(--line); margin-bottom: 39px;
      }
      .big-title { font-size: 108px; line-height: 1.1; font-weight: 700; max-width: 1530px; }
      .rule {
        width: 270px; height: 6px; border-radius: 3px;
        background: var(--line); margin: 45px 0 39px; transform-origin: center;
      }
      /* Photo montage. Every photo sits in a brightness wrapper (the
         settle tween animates the wrapper) around the img itself, which
         carries the static saturation and the Position crop
         (object-position, set inline per photo). Framed variants center
         the photo on the scene background instead of bleeding edge to
         edge; the white fade layer still covers the whole canvas. */
      .scene-photo { background: #0a0f0d; }
      .scene-photo-framed { background: var(--bg); }
      .photo-bright { position: absolute; inset: 0; }
      .photo-img {
        position: absolute; inset: 0; display: block;
        width: 100%; height: 100%; object-fit: cover;
      }
      .photo-clip { position: relative; width: 100%; height: 100%; overflow: hidden; }
      .frame-thin {
        position: absolute; inset: 26px; pointer-events: none;
        border: 3px solid rgba(255, 255, 255, 0.85);
      }
      .photo-polaroid {
        position: absolute; top: 50%; left: 50%; translate: -50% -50%;
        width: 920px; padding: 26px 26px 18px;
        background: #fdfcf8;
        box-shadow: 0 36px 75px rgba(0, 0, 0, 0.45);
      }
      .photo-polaroid .photo-clip { height: 660px; }
      .photo-pol-cap {
        font-family: var(--font-captions);
        font-size: 33px; color: #44503f; text-align: center;
        padding-top: 18px; min-height: 44px;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .photo-rounded {
        position: absolute; top: 50%; left: 50%; translate: -50% -50%;
        width: 1560px; height: 880px;
        border-radius: 40px; overflow: hidden;
        box-shadow: 0 45px 90px rgba(0, 0, 0, 0.45);
      }
      .photo-gold {
        position: absolute; top: 50%; left: 50%; translate: -50% -50%;
        padding: 16px;
        background: linear-gradient(135deg, #8a6a14 0%, #e8c56e 30%, #b08a1e 55%, #f0d488 80%, #96761a 100%);
        box-shadow: 0 45px 90px rgba(0, 0, 0, 0.5);
      }
      .photo-gold-mat { background: #f8f2df; padding: 34px; }
      .photo-gold .photo-clip { width: 1400px; height: 740px; }
      .caption-bar {
        position: absolute; left: 0; right: 0; bottom: 0;
        padding: 96px 84px 51px;
        background: linear-gradient(to top, rgba(6, 18, 13, 0.82), rgba(6, 18, 13, 0));
        font-family: var(--font-captions);
        font-size: 39px; color: #f7f3e8;
      }
      /* Collage */
      .collage-heading {
        position: absolute; top: 96px; left: 0; right: 0;
        text-align: center; font-family: var(--font-headings); font-size: 66px; font-weight: 700; color: var(--ink);
      }
      .collage-row {
        position: absolute; inset: 0;
        display: flex; align-items: center; justify-content: center; gap: 66px;
        padding-top: 105px;
      }
      .polaroid {
        background: #fdfcf8;
        padding: 21px 21px 18px;
        width: 525px;
        box-shadow: 0 36px 75px rgba(0, 0, 0, 0.45);
      }
      .polaroid img { display: block; width: 483px; height: 360px; object-fit: cover; }
      .polaroid figcaption {
        font-family: var(--font-captions);
        font-size: 24px; color: #44503f; text-align: center;
        padding-top: 15px; min-height: 39px;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      /* Text collage scene: greeting cards on the same backdrop as the
         photo collage. The container wraps, so 4 cards land in a 2x2
         grid, 3 in one row, and 2 or 1 in a single centered row. Card
         widths are set by count.
         The cards wear the same paper treatment as the message cards. */
      .collage-cards {
        position: absolute; inset: 0;
        display: flex; flex-wrap: wrap;
        align-items: center; align-content: center; justify-content: center;
        gap: 44px; padding: 190px 120px 56px;
      }
      .greet-card {
        background:
          url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='matrix' values='0 0 0 0 0.45 0 0 0 0 0.36 0 0 0 0 0.18 0 0 0 0.05 0'/></filter><rect width='240' height='240' filter='url(%23n)'/></svg>"),
          linear-gradient(165deg, #f8f0dc 0%, #f1e5c9 58%, #ecdcba 100%);
        border-radius: 18px;
        box-shadow: 0 30px 60px rgba(0, 0, 0, 0.4);
        border: 1px solid rgba(90, 70, 30, 0.18);
        padding: 46px 50px 40px;
        text-align: center;
      }
      .cards-1 .greet-card { width: 760px; }
      .cards-2 .greet-card { width: 640px; }
      .cards-3 .greet-card { width: 528px; }
      .cards-4 .greet-card { width: 620px; }
      .greet-text { font-family: var(--font-messages); font-size: 42px; line-height: 1.4; color: #22301f; }
      .cards-3 .greet-text { font-size: 38px; }
      .greet-from {
        font-family: var(--font-headings);
        font-size: 25.5px; letter-spacing: 0.07em; text-transform: uppercase;
        color: #9a7b1c; margin-top: 24px;
      }
      /* Paper styles for the message and closing cards: the shared grain
         layer plus a light gradient, one class per registry key. */
      .paper-classic { background: var(--paper-grain), linear-gradient(165deg, #f8f0dc 0%, #f1e5c9 58%, #ecdcba 100%); }
      .paper-white { background: var(--paper-grain), linear-gradient(165deg, #fffef9 0%, #faf7ef 58%, #f1ecdd 100%); }
      .paper-kraft { background: var(--paper-grain), linear-gradient(165deg, #eddcae 0%, #dfc48c 58%, #d0af6e 100%); }
      .paper-blush { background: var(--paper-grain), linear-gradient(165deg, #fceff1 0%, #f7dee1 58%, #f0cdd2 100%); }
      .paper-mint { background: var(--paper-grain), linear-gradient(165deg, #f0f8ed 0%, #dff0da 58%, #cbe5c6 100%); }
      .paper-sky { background: var(--paper-grain), linear-gradient(165deg, #eef5fc 0%, #dcedf8 58%, #c6dff2 100%); }
      /* Message cards */
      /* Message cards wear the same paper as the closing scrapbook card:
         warm gradient plus a faint SVG-noise grain, so the text sits on
         paper instead of plain white. Text colors stay dark for contrast. */
      .msg-card {
        position: absolute; top: 50%; left: 50%;
        transform: translate(-50%, -50%);
        width: 1320px;
        border-radius: 27px;
        padding: 87px 96px 72px;
        text-align: center;
        box-shadow: 0 45px 90px rgba(0, 0, 0, 0.4);
        border: 1px solid rgba(90, 70, 30, 0.18);
      }
      /* Tape strip across the top of the message card, same stock as the
         closing card's tape. Static: it rides along with the card rise. */
      .msg-tape {
        position: absolute; top: -24px; left: 50%;
        width: 246px; height: 56px;
        transform: translateX(-50%) rotate(-2deg);
        background: linear-gradient(100deg, rgba(238, 205, 116, 0.62), rgba(228, 190, 96, 0.5));
        box-shadow: 0 5px 12px rgba(0, 0, 0, 0.18);
      }
      .quote-mark { font-family: var(--font-messages); font-size: 96px; line-height: 0.6; color: #ac8a21; margin-bottom: 39px; }
      .msg-text { font-family: var(--font-messages); font-size: 46.5px; line-height: 1.5; color: #22301f; }
      .msg-sign {
        font-family: var(--font-messages);
        font-size: 28.5px; letter-spacing: 0.08em; text-transform: uppercase;
        color: #7a6a35; margin-top: 45px;
      }
      /* Closing: scrapbook card with torn edges and tape strips */
      .scrap-wrap {
        position: absolute; top: 50%; left: 50%;
        translate: -50% -50%;
        width: 1380px;
        filter: drop-shadow(0 42px 54px rgba(0, 0, 0, 0.45));
      }
      .scrap-card {
        clip-path: polygon(1% 3%, 6% 1%, 12% 2.4%, 20% 0.8%, 29% 2%, 38% 1%, 47% 2.2%, 56% 0.9%, 65% 2%, 74% 1.1%, 83% 2.3%, 91% 1%, 98.6% 2.6%, 99.4% 12%, 98.7% 24%, 99.5% 38%, 98.8% 52%, 99.4% 66%, 98.7% 80%, 99.3% 92%, 97% 98.6%, 88% 99.3%, 78% 98.5%, 68% 99.4%, 58% 98.6%, 48% 99.5%, 38% 98.7%, 28% 99.3%, 18% 98.5%, 9% 99.4%, 1.6% 98.2%, 0.6% 88%, 1.3% 74%, 0.5% 60%, 1.2% 45%, 0.6% 30%, 1.3% 16%);
        padding: 88px 100px 80px;
        text-align: center;
      }
      .scrap-eyebrow { color: #a07d1e; }
      .closing-line { font-family: var(--font-headings); font-size: 69px; line-height: 1.3; font-weight: 700; max-width: 1180px; margin: 0 auto; color: #26331f; }
      .scrap-rule { background: #b08a1e; margin-left: auto; margin-right: auto; }
      .closing-sign {
        font-family: Georgia, "Times New Roman", serif;
        font-style: italic; font-size: 37.5px; letter-spacing: 0.02em;
        color: #6d5a22;
      }
      .tape {
        position: absolute; top: -26px; width: 246px; height: 56px;
        background: linear-gradient(100deg, rgba(238, 205, 116, 0.62), rgba(228, 190, 96, 0.5));
        box-shadow: 0 5px 12px rgba(0, 0, 0, 0.18);
      }
      .tape-left { left: 46px; }
      .tape-right { right: 46px; }
    </style>
  </head>
  <body>
    <!-- Generated by generate.mjs from config.json. Edit the config, not this file. -->
    <div id="root"
      data-composition-id="main"
      data-start="0"
      data-duration="${TOTAL}"
      data-width="1920"
      data-height="1080"
    >${scenes.join("")}
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
${timeline.map((line) => `      ${line}`).join("\n")}
      window.__timelines["main"] = tl;
      tl.seek(0);
    </script>
  </body>
</html>
`;

writeFileSync(`${here}/index.html`, html);
writeFileSync(
  `${here}/scenes.json`,
  JSON.stringify({ total: TOTAL, scenes: sceneMeta }, null, 2),
);
console.log(`Wrote index.html for ${config.celebrantName}`);
const blockSummary = SCENE_ORDER
  .filter((key) => BLOCK_DUR[key] > 0)
  .map((key) => `${key} ${STARTS[key]}-${STARTS[key] + BLOCK_DUR[key]}s`)
  .join(", ");
console.log(`Scenes: title 0-${TITLE_DUR}s, ${blockSummary}, closing ${STARTS.closing}-${TOTAL}s`);
console.log(`Total duration: ${TOTAL}s`);
