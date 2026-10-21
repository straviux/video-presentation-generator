// generate.mjs (app copy, adapted from render-engine/birthday-template/generate.mjs)
//
// Reads config.json from its own folder and writes a complete HyperFrames
// composition (index.html, 1920x1080, 30fps) next to it. The app server copies
// this file into each job folder together with that job's config.json, photos,
// and gsap.min.js, then runs `node generate.mjs` there.
//
// Differences from the birthday-template original:
//   - config.collage.enabled === false drops the collage scene entirely
//     (the original always renders it) and removes its 6 seconds.
//
// Scene pacing matches the approved prototype:
//   Title 5s | Photos 5s each | Collage 6s (if on) |
//   Message cards 6s each | Closing 8s

import { readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(`${here}/config.json`, "utf8"));

// ---------------------------------------------------------------- pacing ---
const TITLE_DUR = 5;
const PHOTO_DUR = 5;

// ------------------------------------------------------- collage content ---
// The collage scene has two modes. "photos" (the default) builds polaroids
// from collage.photoIndexes. "text" builds greeting cards from
// collage.cards instead: up to 4 { text, from } entries, and cards with
// blank text are skipped.
const COLLAGE_MODE = config.collage && config.collage.mode === "text" ? "text" : "photos";
const COLLAGE_CARDS = (Array.isArray(config.collage && config.collage.cards) ? config.collage.cards : [])
  .slice(0, 4)
  .map((card) => ({
    text: String((card && card.text) ?? "").trim(),
    from: String((card && card.from) ?? "").trim(),
  }))
  .filter((card) => card.text !== "");

const COLLAGE_ENABLED = Boolean(
  config.collage && config.collage.enabled !== false &&
  (COLLAGE_MODE === "text"
    ? COLLAGE_CARDS.length > 0
    : Array.isArray(config.collage.photoIndexes) && config.collage.photoIndexes.length > 0),
);
const COLLAGE_DUR = COLLAGE_ENABLED ? 6 : 0;
const MESSAGE_DUR = 6;
const CLOSING_DUR = 8;

const MONTAGE_START = TITLE_DUR;
const COLLAGE_START = MONTAGE_START + config.photos.length * PHOTO_DUR;
const MESSAGES_START = COLLAGE_START + COLLAGE_DUR;
const CLOSING_START = MESSAGES_START + config.messages.length * MESSAGE_DUR;
const TOTAL = CLOSING_START + CLOSING_DUR;

// ------------------------------------------------------------- utilities ---
function esc(text) {
  return String(text ?? "")
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


const scenes = []; // HTML strings, in timeline order
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
{
  const s = 0;
  const titleLine1 = wordSpans(`Happy ${config.occasion},`);
  const nameParts = splitName(config.celebrantShortName || config.celebrantName);
  const titleLine2 = `<span class="name-chunk" id="title-name-left">${esc(nameParts.left)}</span>${nameParts.sep}<span class="name-chunk" id="title-name-right">${esc(nameParts.right)}!</span>`;
  const nameLineClass = FONT_SLOTS.name.script ? "name-line name-script" : "name-line";
  scenes.push(`
    <section class="clip scene scene-card" id="scene-title" style="opacity: 0" data-start="${s}" data-duration="${TITLE_DUR + 0.5}" data-track-index="${nextTrack()}">
      ${ORB_A}
      ${ORB_B}
      <div class="card-inner">
        <div class="eyebrow" id="title-eyebrow">Happy ${esc(config.occasion)}</div>
        <h1 class="big-title" id="title-name"><span id="title-greeting">${titleLine1}</span><br /><span class="${nameLineClass}">${titleLine2}</span></h1>
        <div class="rule" id="title-rule"></div>
        <p class="subtitle" id="title-role">${esc(config.celebrantName)} &middot; ${esc(config.role)}</p>
        <p class="from-line" id="title-from">${esc(config.fromLine)}</p>
      </div>
    </section>`);

  timeline.push(
    `tl.fromTo("#scene-title", { opacity: 0 }, { opacity: 1, duration: 0.4, ease: "power1.out" }, ${s});`,
    ...(ORBS_ANIMATED ? [
      `tl.fromTo("#scene-title .orb-a", { x: 0, y: 0 }, { x: -51, y: 33, duration: ${TITLE_DUR + 0.5}, ease: "sine.inOut" }, ${s});`,
      `tl.fromTo("#scene-title .orb-b", { x: 0, y: 0 }, { x: 39, y: -27, duration: ${TITLE_DUR + 0.5}, ease: "sine.inOut" }, ${s});`,
    ] : []),
    `tl.fromTo("#title-eyebrow", { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.6, ease: "power2.out" }, ${s + 0.15});`,
    `tl.fromTo("#title-greeting .w", { opacity: 0, y: 69, rotation: 4 }, { opacity: 1, y: 0, rotation: 0, duration: 0.7, ease: "power3.out", stagger: 0.12, transformOrigin: "50% 100%" }, ${s + 0.35});`,
    `tl.fromTo("#title-name-left", { opacity: 0, x: -1250 }, { opacity: 1, x: 0, duration: 0.75, ease: "power3.out" }, ${s + 0.8});`,
    `tl.fromTo("#title-name-right", { opacity: 0, x: 1250 }, { opacity: 1, x: 0, duration: 0.75, ease: "power3.out" }, ${s + 0.87});`,
    `tl.fromTo("#title-rule", { scaleX: 0, opacity: 0 }, { scaleX: 1, opacity: 1, duration: 0.7, ease: "power2.inOut" }, ${s + 1.8});`,
    `tl.fromTo("#title-role", { opacity: 0, y: 33 }, { opacity: 1, y: 0, duration: 0.8, ease: "power2.out" }, ${s + 2.05});`,
    `tl.fromTo("#title-from", { opacity: 0, y: 15 }, { opacity: 1, y: 0, duration: 0.7, ease: "power1.out" }, ${s + 2.6});`,
    `tl.to("#scene-title", { opacity: 0, duration: 0.5, ease: "power1.in" }, ${s + TITLE_DUR});`,
  );
}

// ---------------------------------------------------------- photo montage --
config.photos.forEach((photo, i) => {
  const s = MONTAGE_START + i * PHOTO_DUR;
  const drift = i % 2 === 0 ? 27 : -27; // alternate Ken Burns drift direction
  const isFirst = i === 0;
  const isLast = i === config.photos.length - 1;
  scenes.push(`
    <section class="clip scene scene-photo" id="scene-photo-${i}" style="opacity: 0" data-start="${s}" data-duration="${PHOTO_DUR + 0.5}" data-track-index="${nextTrack()}">
      <img class="photo-img" id="photo-img-${i}" src="${esc(photo.file)}" alt="" />
      <div class="vignette" id="vignette-${i}"></div>
      <div class="caption-bar" id="caption-${i}"><span id="caption-text-${i}">${esc(photo.caption)}</span></div>
      <div class="white-fade" id="white-${i}" style="opacity: ${isFirst ? 0 : 1}"></div>
    </section>`);

  timeline.push(
    // First photo crossfades in from the title card as before; later photos
    // start instantly under their white layer, which is what fades instead.
    isFirst
      ? `tl.fromTo("#scene-photo-${i}", { opacity: 0 }, { opacity: 1, duration: 0.5, ease: "power1.out" }, ${s});`
      : `tl.fromTo("#scene-photo-${i}", { opacity: 0 }, { opacity: 1, duration: 0.01, ease: "none" }, ${s});`,
    `tl.fromTo("#photo-img-${i}", { scale: 1.07, x: 0 }, { scale: 1.16, x: ${drift}, duration: ${PHOTO_DUR}, ease: "sine.inOut" }, ${s});`,
    `tl.fromTo("#photo-img-${i}", { filter: "brightness(1.16) saturate(1.06)" }, { filter: "brightness(1) saturate(1)", duration: 1.2, ease: "power2.out" }, ${s});`,
    `tl.fromTo("#vignette-${i}", { opacity: 0 }, { opacity: 1, duration: 1.4, ease: "power1.out" }, ${s + 0.3});`,
    `tl.fromTo("#caption-${i}", { y: 165 }, { y: 0, duration: 0.7, ease: "power3.out" }, ${s + 0.6});`,
    `tl.fromTo("#caption-text-${i}", { opacity: 0, y: 21 }, { opacity: 1, y: 0, duration: 0.55, ease: "power2.out" }, ${s + 0.85});`,
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
      `tl.to("#white-${i}", { opacity: 1, duration: 0.35, ease: "power1.in" }, ${s + PHOTO_DUR - 0.35});`,
      `tl.to("#scene-photo-${i}", { opacity: 0, duration: 0.01, ease: "none" }, ${s + PHOTO_DUR});`,
    );
  } else {
    // Last photo keeps the plain crossfade into the collage scene.
    timeline.push(
      `tl.to("#scene-photo-${i}", { opacity: 0, duration: 0.5, ease: "power1.in" }, ${s + PHOTO_DUR});`,
    );
  }
});

// --------------------------------------------------------------- collage ---
if (COLLAGE_ENABLED) {
  const s = COLLAGE_START;
  const accentSpots = [
    { left: "6%", top: "16%", size: 56, shape: ACCENT_HEART },
    { left: "88%", top: "13%", size: 44, shape: ACCENT_STAR },
    { left: "11%", top: "77%", size: 34, shape: ACCENT_DOT },
    { left: "85%", top: "73%", size: 58, shape: ACCENT_HEART },
    { left: "46%", top: "85%", size: 40, shape: ACCENT_STAR },
    { left: "64%", top: "9%", size: 30, shape: ACCENT_DOT },
  ];
  const accents = accentSpots
    .map((spot, k) => `<span class="accent" id="accent-${k}" style="left: ${spot.left}; top: ${spot.top}; width: ${spot.size}px; height: ${spot.size}px;">${spot.shape}</span>`)
    .join("");

  // The scene body depends on the mode: a row of polaroid photos, or a
  // grid of greeting cards in text mode.
  let collageInner;
  if (COLLAGE_MODE === "text") {
    const cards = COLLAGE_CARDS
      .map((card, k) => `
        <div class="greet-card" id="greet-card-${k}">
          <p class="greet-text">${esc(card.text)}</p>${card.from ? `
          <p class="greet-from" id="greet-from-${k}">${esc(card.from)}</p>` : ""}
        </div>`)
      .join("");
    collageInner = `
      <div class="collage-cards cards-${COLLAGE_CARDS.length}">${cards}
      </div>`;
  } else {
    const polaroids = config.collage.photoIndexes
      .map((photoIndex, k) => {
        const photo = config.photos[photoIndex];
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
    <section class="clip scene scene-card" id="scene-collage" style="opacity: 0" data-start="${s}" data-duration="${COLLAGE_DUR + 0.5}" data-track-index="${nextTrack()}">
      ${ORB_A}
      ${ORB_B}
      <h2 class="collage-heading" id="collage-heading">${wordSpans(config.collage.heading)}</h2>${collageInner}${accents}
    </section>`);

  timeline.push(
    `tl.fromTo("#scene-collage", { opacity: 0 }, { opacity: 1, duration: 0.4, ease: "power1.out" }, ${s});`,
    ...(ORBS_ANIMATED ? [
      `tl.fromTo("#scene-collage .orb-a", { x: 0, y: 0 }, { x: -42, y: 27, duration: ${COLLAGE_DUR + 0.5}, ease: "sine.inOut" }, ${s});`,
      `tl.fromTo("#scene-collage .orb-b", { x: 0, y: 0 }, { x: 33, y: -21, duration: ${COLLAGE_DUR + 0.5}, ease: "sine.inOut" }, ${s});`,
    ] : []),
    `tl.fromTo("#collage-heading .w", { opacity: 0, y: 39, rotation: 3 }, { opacity: 1, y: 0, rotation: 0, duration: 0.55, ease: "power3.out", stagger: 0.09, transformOrigin: "50% 100%" }, ${s + 0.2});`,
  );
  if (COLLAGE_MODE === "text") {
    // The greeting cards build one by one like the polaroids do. The 1.1s
    // spacing holds for any card count, and the build is centered in the
    // scene window, so fewer cards start later instead of leaving a long
    // still tail after an early finish.
    const cardRotations = [-2.5, 2, -1.5, 2.5];
    const buildStart = 0.8 + Math.max(0, (3.3 - 1.1 * (COLLAGE_CARDS.length - 1)) / 2);
    COLLAGE_CARDS.forEach((card, k) => {
      const rot = cardRotations[k % cardRotations.length];
      const popAt = Number((s + buildStart + k * 1.1).toFixed(3));
      timeline.push(
        `tl.fromTo("#greet-card-${k}", { opacity: 0, scale: 0.5, y: 39, rotation: ${rot - 12} }, { opacity: 1, scale: 1, y: 0, rotation: ${rot}, duration: 0.6, ease: "back.out(1.7)" }, ${popAt});`,
      );
      if (card.from) {
        timeline.push(
          `tl.fromTo("#greet-from-${k}", { opacity: 0, y: 9 }, { opacity: 1, y: 0, duration: 0.45, ease: "power1.out" }, ${Number((popAt + 0.35).toFixed(3))});`,
        );
      }
    });
  } else {
    // The collage builds one polaroid at a time, about a second apart, so the
    // scene feels assembled rather than shown. Captions fade in late.
    const rotations = [-5, 3, -3];
    const popTimes = [0.8, 1.9, 3.0];
    config.collage.photoIndexes.forEach((_, k) => {
      const rot = rotations[k % rotations.length];
      const popAt = s + (popTimes[k] ?? 3.0 + (k - 2) * 1.1);
      timeline.push(
        `tl.fromTo("#polaroid-${k}", { opacity: 0, scale: 0.45, y: 39, rotation: ${rot - 14} }, { opacity: 1, scale: 1, y: 0, rotation: ${rot}, duration: 0.6, ease: "back.out(1.7)" }, ${popAt});`,
        `tl.fromTo("#polaroid-cap-${k}", { opacity: 0, y: 9 }, { opacity: 1, y: 0, duration: 0.5, ease: "power1.out" }, ${s + 4.6 + k * 0.12});`,
      );
    });
  }
  const accentTimes = [0.5, 1.45, 2.5, 3.55, 3.9, 4.25];
  accentTimes.forEach((t, k) => {
    timeline.push(
      `tl.fromTo("#accent-${k}", { opacity: 0, scale: 0, rotation: -40 }, { opacity: 1, scale: 1, rotation: 0, duration: 0.45, ease: "back.out(2)" }, ${s + t});`,
    );
  });
  if (COLLAGE_MODE === "text") {
    timeline.push(
      // Gentle idle float after the last card lands, kept finite so the
      // timeline stays deterministic and ends inside the scene window.
      `tl.to(".greet-card", { y: -9, duration: 0.65, ease: "sine.inOut", stagger: 0.08 }, ${s + 4.75});`,
      `tl.to(".greet-card", { y: 0, duration: 0.5, ease: "sine.inOut", stagger: 0.08 }, ${s + 5.45});`,
      `tl.to("#scene-collage", { opacity: 0, duration: 0.5, ease: "power1.in" }, ${s + COLLAGE_DUR});`,
    );
  } else {
    timeline.push(
      // Gentle idle float after the last polaroid lands, kept finite so the
      // timeline stays deterministic and ends inside the scene window.
      `tl.to(".polaroid", { y: -10.5, duration: 0.9, ease: "sine.inOut", stagger: 0.1 }, ${s + 3.9});`,
      `tl.to(".polaroid", { y: 0, duration: 0.8, ease: "sine.inOut", stagger: 0.1 }, ${s + 5.0});`,
      `tl.to("#scene-collage", { opacity: 0, duration: 0.5, ease: "power1.in" }, ${s + COLLAGE_DUR});`,
    );
  }
}

// ----------------------------------------------------------- message cards -
config.messages.forEach((message, i) => {
  const s = MESSAGES_START + i * MESSAGE_DUR;
  // Typewriter fit: characters appear one by one starting at 1s in, and the
  // full text completes about 4.2s later, whatever the message length.
  const typeCharTotal = typeCharCount(message.text);
  const typeStagger = typeCharTotal > 1 ? Number((4.15 / (typeCharTotal - 1)).toFixed(4)) : 0;
  const typeStart = 1.0;
  const typeEnd = typeStart + 4.2;
  scenes.push(`
    <section class="clip scene scene-card" id="scene-msg-${i}" style="opacity: 0" data-start="${s}" data-duration="${MESSAGE_DUR + 0.5}" data-track-index="${nextTrack()}">
      ${ORB_A}
      <div class="msg-card" id="msg-card-${i}">
        <div class="msg-tape"></div>
        <div class="quote-mark" id="msg-quote-${i}">&ldquo;</div>
        <p class="msg-text" id="msg-text-${i}">${typewriterSpans(message.text)}</p>
        <p class="msg-sign" id="msg-sign-${i}">${esc(message.signedBy)}</p>
      </div>
    </section>`);

  timeline.push(
    `tl.fromTo("#scene-msg-${i}", { opacity: 0 }, { opacity: 1, duration: 0.4, ease: "power1.out" }, ${s});`,
    ...(ORBS_ANIMATED ? [
      `tl.fromTo("#scene-msg-${i} .orb-a", { x: 0, y: 0 }, { x: -33, y: 21, duration: ${MESSAGE_DUR + 0.5}, ease: "sine.inOut" }, ${s});`,
    ] : []),
    `tl.fromTo("#msg-card-${i}", { opacity: 0, y: 66, scale: 0.97, rotationX: 6, transformPerspective: 1350 }, { opacity: 1, y: 0, scale: 1, rotationX: 0, duration: 0.85, ease: "power3.out" }, ${s + 0.25});`,
    `tl.fromTo("#msg-quote-${i}", { scale: 0, rotation: -12 }, { scale: 1, rotation: 0, duration: 0.5, ease: "back.out(2)", transformOrigin: "50% 50%" }, ${s + 0.55});`,
    `tl.fromTo("#msg-text-${i} .tw-c", { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.05, ease: "none", stagger: ${typeStagger} }, ${s + typeStart});`,
    `tl.fromTo("#msg-sign-${i}", { opacity: 0, x: -27 }, { opacity: 1, x: 0, duration: 0.5, ease: "power2.out" }, ${s + typeEnd + 0.15});`,
    `tl.to("#scene-msg-${i}", { opacity: 0, duration: 0.5, ease: "power1.in" }, ${s + MESSAGE_DUR});`,
  );
});

// ------------------------------------------------------------ closing card -
{
  const s = CLOSING_START;
  scenes.push(`
    <section class="clip scene scene-card" id="scene-closing" style="opacity: 0" data-start="${s}" data-duration="${CLOSING_DUR}" data-track-index="${nextTrack()}">
      ${ORB_A}
      ${ORB_B}
      <div class="scrap-wrap" id="closing-card">
        <div class="scrap-card">
          <div class="eyebrow scrap-eyebrow" id="closing-eyebrow">Happy ${esc(config.occasion)}, ${esc(config.celebrantShortName)}</div>
          <p class="closing-line" id="closing-line">${wordSpans(config.closingLine)}</p>
          <div class="rule scrap-rule" id="closing-rule"></div>
          <p class="closing-sign" id="closing-sign">${esc(config.closingSignOff)}</p>
        </div>
        <div class="tape tape-left" id="tape-left"></div>
        <div class="tape tape-right" id="tape-right"></div>
      </div>
    </section>`);

  timeline.push(
    `tl.fromTo("#scene-closing", { opacity: 0 }, { opacity: 1, duration: 0.5, ease: "power1.out" }, ${s});`,
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
        --accent: ${BACKGROUND.accent};${HAS_ORBS ? `
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
      .subtitle {
        font-family: Arial, Helvetica, sans-serif;
        font-size: 40.5px; line-height: 1.45; color: var(--ink); max-width: 1290px;
      }
      .from-line {
        font-family: Arial, Helvetica, sans-serif;
        font-size: 31.5px; letter-spacing: 0.06em; color: var(--ink-soft); margin-top: 51px;
      }
      /* Photo montage */
      .scene-photo { background: #0a0f0d; }
      .photo-img {
        position: absolute; inset: 0;
        width: 1920px; height: 1080px; object-fit: cover;
      }
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
      /* Collage, text mode: greeting cards in place of the polaroids. The
         container wraps, so 4 cards land in a 2x2 grid, 3 in one row, and
         2 or 1 in a single centered row. Card widths are set by count.
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
      /* Message cards */
      /* Message cards wear the same paper as the closing scrapbook card:
         warm gradient plus a faint SVG-noise grain, so the text sits on
         paper instead of plain white. Text colors stay dark for contrast. */
      .msg-card {
        position: absolute; top: 50%; left: 50%;
        transform: translate(-50%, -50%);
        width: 1320px;
        background:
          url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='matrix' values='0 0 0 0 0.45 0 0 0 0 0.36 0 0 0 0 0.18 0 0 0 0.05 0'/></filter><rect width='240' height='240' filter='url(%23n)'/></svg>"),
          linear-gradient(165deg, #f8f0dc 0%, #f1e5c9 58%, #ecdcba 100%);
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
        background: linear-gradient(165deg, #f8f0dc 0%, #f1e5c9 58%, #ecdcba 100%);
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
    <!-- Generated by the app (lib/generate.mjs) from this job's config.json. -->
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
console.log(`Wrote index.html for ${config.celebrantName}`);
console.log(`Collage: ${COLLAGE_ENABLED ? `on, ${COLLAGE_START}-${MESSAGES_START}s` : "off"}`);
console.log(`Total duration: ${TOTAL}s`);
