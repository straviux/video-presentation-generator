// generate.mjs (app copy, adapted from render-engine/birthday-template/generate.mjs)
//
// Reads config.json from its own folder and writes a complete HyperFrames
// composition (index.html, 1280x720, 30fps) next to it. The app server copies
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
const COLLAGE_ENABLED = Boolean(
  config.collage && config.collage.enabled !== false && Array.isArray(config.collage.photoIndexes) && config.collage.photoIndexes.length > 0,
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

const scenes = []; // HTML strings, in timeline order
const timeline = []; // GSAP statements (strings), absolute positions in seconds
let track = 0;
function nextTrack() {
  track += 1;
  return track;
}

// ------------------------------------------------------------ title card ---
{
  const s = 0;
  scenes.push(`
    <section class="clip scene scene-card" id="scene-title" style="opacity: 0" data-start="${s}" data-duration="${TITLE_DUR + 0.5}" data-track-index="${nextTrack()}">
      <div class="orb orb-a"></div>
      <div class="orb orb-b"></div>
      <div class="card-inner">
        <div class="eyebrow" id="title-eyebrow">Happy ${esc(config.occasion)}</div>
        <h1 class="big-title" id="title-name">Happy ${esc(config.occasion)},<br />${esc(config.celebrantShortName)}!</h1>
        <div class="rule" id="title-rule"></div>
        <p class="subtitle" id="title-role">${esc(config.celebrantName)} &middot; ${esc(config.role)}</p>
        <p class="from-line" id="title-from">${esc(config.fromLine)}</p>
      </div>
    </section>`);

  timeline.push(
    `tl.fromTo("#scene-title", { opacity: 0 }, { opacity: 1, duration: 0.4, ease: "power1.out" }, ${s});`,
    `tl.fromTo("#title-eyebrow", { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.6, ease: "power2.out" }, ${s + 0.2});`,
    `tl.fromTo("#title-name", { opacity: 0, y: 44 }, { opacity: 1, y: 0, duration: 0.9, ease: "power3.out" }, ${s + 0.45});`,
    `tl.fromTo("#title-rule", { scaleX: 0, opacity: 0 }, { scaleX: 1, opacity: 1, duration: 0.6, ease: "power2.out" }, ${s + 1.25});`,
    `tl.fromTo("#title-role", { opacity: 0, y: 22 }, { opacity: 1, y: 0, duration: 0.8, ease: "power2.out" }, ${s + 1.5});`,
    `tl.fromTo("#title-from", { opacity: 0 }, { opacity: 1, duration: 0.7, ease: "power1.out" }, ${s + 2.3});`,
    `tl.to("#scene-title", { opacity: 0, duration: 0.5, ease: "power1.in" }, ${s + TITLE_DUR});`,
  );
}

// ---------------------------------------------------------- photo montage --
config.photos.forEach((photo, i) => {
  const s = MONTAGE_START + i * PHOTO_DUR;
  const drift = i % 2 === 0 ? 18 : -18; // alternate Ken Burns drift direction
  scenes.push(`
    <section class="clip scene scene-photo" id="scene-photo-${i}" style="opacity: 0" data-start="${s}" data-duration="${PHOTO_DUR + 0.5}" data-track-index="${nextTrack()}">
      <img class="photo-img" id="photo-img-${i}" src="${esc(photo.file)}" alt="" />
      <div class="caption-bar" id="caption-${i}"><span>${esc(photo.caption)}</span></div>
    </section>`);

  timeline.push(
    `tl.fromTo("#scene-photo-${i}", { opacity: 0 }, { opacity: 1, duration: 0.5, ease: "power1.out" }, ${s});`,
    `tl.fromTo("#photo-img-${i}", { scale: 1, x: 0 }, { scale: 1.1, x: ${drift}, duration: ${PHOTO_DUR}, ease: "sine.inOut" }, ${s});`,
    `tl.fromTo("#caption-${i}", { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.6, ease: "power2.out" }, ${s + 0.7});`,
    `tl.to("#scene-photo-${i}", { opacity: 0, duration: 0.5, ease: "power1.in" }, ${s + PHOTO_DUR});`,
  );
});

// --------------------------------------------------------------- collage ---
if (COLLAGE_ENABLED) {
  const s = COLLAGE_START;
  const rotations = [-5, 3, -3];
  const polaroids = config.collage.photoIndexes
    .map((photoIndex, k) => {
      const photo = config.photos[photoIndex];
      return `
        <figure class="polaroid" id="polaroid-${k}">
          <img src="${esc(photo.file)}" alt="" />
          <figcaption>${esc(photo.caption)}</figcaption>
        </figure>`;
    })
    .join("");

  scenes.push(`
    <section class="clip scene scene-card" id="scene-collage" style="opacity: 0" data-start="${s}" data-duration="${COLLAGE_DUR + 0.5}" data-track-index="${nextTrack()}">
      <div class="orb orb-a"></div>
      <div class="orb orb-b"></div>
      <h2 class="collage-heading" id="collage-heading">${esc(config.collage.heading)}</h2>
      <div class="collage-row">${polaroids}
      </div>
    </section>`);

  timeline.push(
    `tl.fromTo("#scene-collage", { opacity: 0 }, { opacity: 1, duration: 0.4, ease: "power1.out" }, ${s});`,
    `tl.fromTo("#collage-heading", { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.6, ease: "power2.out" }, ${s + 0.2});`,
  );
  config.collage.photoIndexes.forEach((_, k) => {
    timeline.push(
      `tl.fromTo("#polaroid-${k}", { opacity: 0, scale: 0.5, rotation: ${rotations[k % rotations.length] - 12} }, { opacity: 1, scale: 1, rotation: ${rotations[k % rotations.length]}, duration: 0.55, ease: "back.out(1.8)" }, ${s + 0.5 + k * 0.7});`,
    );
  });
  timeline.push(
    `tl.to("#scene-collage", { opacity: 0, duration: 0.5, ease: "power1.in" }, ${s + COLLAGE_DUR});`,
  );
}

// ----------------------------------------------------------- message cards -
config.messages.forEach((message, i) => {
  const s = MESSAGES_START + i * MESSAGE_DUR;
  scenes.push(`
    <section class="clip scene scene-card" id="scene-msg-${i}" style="opacity: 0" data-start="${s}" data-duration="${MESSAGE_DUR + 0.5}" data-track-index="${nextTrack()}">
      <div class="orb orb-a"></div>
      <div class="msg-card" id="msg-card-${i}">
        <div class="quote-mark">&ldquo;</div>
        <p class="msg-text">${esc(message.text)}</p>
        <p class="msg-sign" id="msg-sign-${i}">${esc(message.signedBy)}</p>
      </div>
    </section>`);

  timeline.push(
    `tl.fromTo("#scene-msg-${i}", { opacity: 0 }, { opacity: 1, duration: 0.4, ease: "power1.out" }, ${s});`,
    `tl.fromTo("#msg-card-${i}", { opacity: 0, y: 34 }, { opacity: 1, y: 0, duration: 0.7, ease: "power2.out" }, ${s + 0.3});`,
    `tl.fromTo("#msg-sign-${i}", { opacity: 0 }, { opacity: 1, duration: 0.6, ease: "power1.out" }, ${s + 1.2});`,
    `tl.to("#scene-msg-${i}", { opacity: 0, duration: 0.5, ease: "power1.in" }, ${s + MESSAGE_DUR});`,
  );
});

// ------------------------------------------------------------ closing card -
{
  const s = CLOSING_START;
  scenes.push(`
    <section class="clip scene scene-card" id="scene-closing" style="opacity: 0" data-start="${s}" data-duration="${CLOSING_DUR}" data-track-index="${nextTrack()}">
      <div class="orb orb-a"></div>
      <div class="orb orb-b"></div>
      <div class="card-inner">
        <div class="eyebrow" id="closing-eyebrow">Happy ${esc(config.occasion)}, ${esc(config.celebrantShortName)}</div>
        <p class="closing-line" id="closing-line">${esc(config.closingLine)}</p>
        <div class="rule" id="closing-rule"></div>
        <p class="from-line closing-sign" id="closing-sign">${esc(config.closingSignOff)}</p>
      </div>
    </section>`);

  timeline.push(
    `tl.fromTo("#scene-closing", { opacity: 0 }, { opacity: 1, duration: 0.5, ease: "power1.out" }, ${s});`,
    `tl.fromTo("#closing-eyebrow", { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.6, ease: "power2.out" }, ${s + 0.3});`,
    `tl.fromTo("#closing-line", { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.9, ease: "power3.out" }, ${s + 0.6});`,
    `tl.fromTo("#closing-rule", { scaleX: 0, opacity: 0 }, { scaleX: 1, opacity: 1, duration: 0.6, ease: "power2.out" }, ${s + 1.5});`,
    `tl.fromTo("#closing-sign", { opacity: 0 }, { opacity: 1, duration: 0.8, ease: "power1.out" }, ${s + 1.9});`,
    // Hold the closing card to the exact end of the composition.
    `tl.to("#scene-closing", { opacity: 1, duration: ${TOTAL - (s + 2.7)}, ease: "none" }, ${s + 2.7});`,
  );
}

// --------------------------------------------------------------- document ---
const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1280, height=720" />
    <script src="assets/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body {
        margin: 0;
        width: 1280px;
        height: 720px;
        overflow: hidden;
        background: #10261e;
      }
      #root {
        position: relative;
        width: 1280px;
        height: 720px;
        overflow: hidden;
        font-family: Georgia, "Times New Roman", serif;
        background: radial-gradient(circle at 18% 12%, #2c5c46 0%, #17352b 55%, #10261e 100%);
        color: #f7f3e8;
      }
      .scene {
        position: absolute;
        inset: 0;
        width: 1280px;
        height: 720px;
        overflow: hidden;
      }
      .scene-card {
        background: radial-gradient(circle at 18% 12%, #2c5c46 0%, #17352b 55%, #10261e 100%);
      }
      .orb { position: absolute; border-radius: 999px; pointer-events: none; }
      .orb-a { width: 340px; height: 340px; right: -90px; top: -110px; background: rgba(232, 197, 110, 0.16); }
      .orb-b { width: 210px; height: 210px; left: -60px; bottom: -80px; background: rgba(255, 255, 255, 0.07); }
      .card-inner {
        position: absolute; inset: 0;
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        text-align: center; padding: 64px;
      }
      .eyebrow {
        font-family: Arial, Helvetica, sans-serif;
        font-size: 19px; letter-spacing: 0.34em; text-transform: uppercase;
        color: #e8c56e; margin-bottom: 26px;
      }
      .big-title { font-size: 72px; line-height: 1.1; font-weight: 700; max-width: 1020px; }
      .rule {
        width: 180px; height: 4px; border-radius: 2px;
        background: #e8c56e; margin: 30px 0 26px; transform-origin: center;
      }
      .subtitle {
        font-family: Arial, Helvetica, sans-serif;
        font-size: 27px; line-height: 1.45; color: #e9e4d4; max-width: 860px;
      }
      .from-line {
        font-family: Arial, Helvetica, sans-serif;
        font-size: 21px; letter-spacing: 0.06em; color: #cfd8cc; margin-top: 34px;
      }
      /* Photo montage */
      .scene-photo { background: #0a0f0d; }
      .photo-img {
        position: absolute; inset: 0;
        width: 1280px; height: 720px; object-fit: cover;
      }
      .caption-bar {
        position: absolute; left: 0; right: 0; bottom: 0;
        padding: 64px 56px 34px;
        background: linear-gradient(to top, rgba(6, 18, 13, 0.82), rgba(6, 18, 13, 0));
        font-family: Arial, Helvetica, sans-serif;
        font-size: 26px; color: #f7f3e8;
      }
      /* Collage */
      .collage-heading {
        position: absolute; top: 64px; left: 0; right: 0;
        text-align: center; font-size: 44px; font-weight: 700; color: #f7f3e8;
      }
      .collage-row {
        position: absolute; inset: 0;
        display: flex; align-items: center; justify-content: center; gap: 44px;
        padding-top: 70px;
      }
      .polaroid {
        background: #fdfcf8;
        padding: 14px 14px 12px;
        width: 350px;
        box-shadow: 0 24px 50px rgba(0, 0, 0, 0.45);
      }
      .polaroid img { display: block; width: 322px; height: 240px; object-fit: cover; }
      .polaroid figcaption {
        font-family: Arial, Helvetica, sans-serif;
        font-size: 16px; color: #44503f; text-align: center;
        padding-top: 10px; min-height: 26px;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      /* Message cards */
      .msg-card {
        position: absolute; top: 50%; left: 50%;
        transform: translate(-50%, -50%);
        width: 880px;
        background: rgba(253, 252, 248, 0.97);
        border-radius: 18px;
        padding: 58px 64px 48px;
        text-align: center;
        box-shadow: 0 30px 60px rgba(0, 0, 0, 0.4);
      }
      .quote-mark { font-size: 64px; line-height: 0.6; color: #ac8a21; margin-bottom: 26px; }
      .msg-text { font-size: 31px; line-height: 1.5; color: #22301f; }
      .msg-sign {
        font-family: Arial, Helvetica, sans-serif;
        font-size: 19px; letter-spacing: 0.08em; text-transform: uppercase;
        color: #7a6a35; margin-top: 30px;
      }
      /* Closing */
      .closing-line { font-size: 46px; line-height: 1.3; font-weight: 700; max-width: 900px; }
      .closing-sign { margin-top: 6px; }
    </style>
  </head>
  <body>
    <!-- Generated by the app (lib/generate.mjs) from this job's config.json. -->
    <div id="root"
      data-composition-id="main"
      data-start="0"
      data-duration="${TOTAL}"
      data-width="1280"
      data-height="720"
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
