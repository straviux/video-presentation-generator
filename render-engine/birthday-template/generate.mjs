// generate.mjs
// Config-driven composition generator for the Video Presentation Generator.
//
// Reads config.json (celebrant, photos, collage picks, messages, closing) and
// writes index.html, a complete HyperFrames composition (1920x1080, 30fps).
// To make a video for someone else: edit config.json, replace the photos in
// assets/photos/, then run `node generate.mjs` and render. Nothing else changes.
//
// Scene pacing matches the approved prototype:
//   Title 5s | Photo montage 7 x 5s = 35s | Collage 6s |
//   Message cards 2 x 6s = 12s | Closing 8s | Total 66s

import { readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(`${here}/config.json`, "utf8"));

// ---------------------------------------------------------------- pacing ---
const TITLE_DUR = 5;
const PHOTO_DUR = 5;
const COLLAGE_DUR = 6;
const MESSAGE_DUR = 6;
const CLOSING_DUR = 8;

const MONTAGE_START = TITLE_DUR; // 5
const COLLAGE_START = MONTAGE_START + config.photos.length * PHOTO_DUR; // 40
const MESSAGES_START = COLLAGE_START + COLLAGE_DUR; // 46
const CLOSING_START = MESSAGES_START + config.messages.length * MESSAGE_DUR; // 58
const TOTAL = CLOSING_START + CLOSING_DUR; // 66

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

// Split a message into sentence spans for a staggered fade-in. The spans stay
// inline so the paragraph still wraps naturally; they animate opacity only.
function sentenceSpans(text) {
  const parts = String(text).match(/[^.!?]+[.!?]+["']?|[^.!?]+$/g) || [String(text)];
  return parts.map((p) => `<span class="sent">${esc(p.trim())}</span>`).join(" ");
}

let hfCounter = 0;
function hfId() {
  hfCounter += 1;
  return `hf-b${String(hfCounter).padStart(2, "0")}`;
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
  const titleLine1 = wordSpans(`Happy ${config.occasion},`);
  const titleLine2 = wordSpans(`${config.celebrantShortName}!`);
  scenes.push(`
    <section class="clip scene scene-card" id="scene-title" style="opacity: 0" data-start="${s}" data-duration="${TITLE_DUR + 0.5}" data-track-index="${nextTrack()}">
      <div class="orb orb-a"></div>
      <div class="orb orb-b"></div>
      <div class="card-inner">
        <div class="eyebrow" id="title-eyebrow">Happy ${esc(config.occasion)}</div>
        <h1 class="big-title" id="title-name">${titleLine1}<br />${titleLine2}</h1>
        <div class="rule" id="title-rule"></div>
        <p class="subtitle" id="title-role">${esc(config.celebrantName)} &middot; ${esc(config.role)}</p>
        <p class="from-line" id="title-from">${esc(config.fromLine)}</p>
      </div>
    </section>`);

  timeline.push(
    `tl.fromTo("#scene-title", { opacity: 0 }, { opacity: 1, duration: 0.4, ease: "power1.out" }, ${s});`,
    `tl.fromTo("#scene-title .orb-a", { x: 0, y: 0 }, { x: -51, y: 33, duration: ${TITLE_DUR + 0.5}, ease: "sine.inOut" }, ${s});`,
    `tl.fromTo("#scene-title .orb-b", { x: 0, y: 0 }, { x: 39, y: -27, duration: ${TITLE_DUR + 0.5}, ease: "sine.inOut" }, ${s});`,
    `tl.fromTo("#title-eyebrow", { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.6, ease: "power2.out" }, ${s + 0.15});`,
    `tl.fromTo("#title-name .w", { opacity: 0, y: 69, rotation: 4 }, { opacity: 1, y: 0, rotation: 0, duration: 0.7, ease: "power3.out", stagger: 0.12, transformOrigin: "50% 100%" }, ${s + 0.35});`,
    `tl.fromTo("#title-rule", { scaleX: 0, opacity: 0 }, { scaleX: 1, opacity: 1, duration: 0.7, ease: "power2.inOut" }, ${s + 1.35});`,
    `tl.fromTo("#title-role", { opacity: 0, y: 33 }, { opacity: 1, y: 0, duration: 0.8, ease: "power2.out" }, ${s + 1.6});`,
    `tl.fromTo("#title-from", { opacity: 0, y: 15 }, { opacity: 1, y: 0, duration: 0.7, ease: "power1.out" }, ${s + 2.3});`,
    `tl.to("#scene-title", { opacity: 0, duration: 0.5, ease: "power1.in" }, ${s + TITLE_DUR});`,
  );
}

// ---------------------------------------------------------- photo montage --
config.photos.forEach((photo, i) => {
  const s = MONTAGE_START + i * PHOTO_DUR;
  const drift = i % 2 === 0 ? 27 : -27; // alternate Ken Burns drift direction
  scenes.push(`
    <section class="clip scene scene-photo" id="scene-photo-${i}" style="opacity: 0" data-start="${s}" data-duration="${PHOTO_DUR + 0.5}" data-track-index="${nextTrack()}">
      <img class="photo-img" id="photo-img-${i}" src="${esc(photo.file)}" alt="" />
      <div class="vignette" id="vignette-${i}"></div>
      <div class="caption-bar" id="caption-${i}"><span id="caption-text-${i}">${esc(photo.caption)}</span></div>
    </section>`);

  timeline.push(
    `tl.fromTo("#scene-photo-${i}", { opacity: 0 }, { opacity: 1, duration: 0.5, ease: "power1.out" }, ${s});`,
    `tl.fromTo("#photo-img-${i}", { scale: 1.07, x: 0 }, { scale: 1.16, x: ${drift}, duration: ${PHOTO_DUR}, ease: "sine.inOut" }, ${s});`,
    `tl.fromTo("#photo-img-${i}", { filter: "brightness(1.16) saturate(1.06)" }, { filter: "brightness(1) saturate(1)", duration: 1.2, ease: "power2.out" }, ${s});`,
    `tl.fromTo("#vignette-${i}", { opacity: 0 }, { opacity: 1, duration: 1.4, ease: "power1.out" }, ${s + 0.3});`,
    `tl.fromTo("#caption-${i}", { y: 165 }, { y: 0, duration: 0.7, ease: "power3.out" }, ${s + 0.6});`,
    `tl.fromTo("#caption-text-${i}", { opacity: 0, y: 21 }, { opacity: 1, y: 0, duration: 0.55, ease: "power2.out" }, ${s + 0.85});`,
    `tl.to("#scene-photo-${i}", { opacity: 0, duration: 0.5, ease: "power1.in" }, ${s + PHOTO_DUR});`,
  );
});

// --------------------------------------------------------------- collage ---
{
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
      <h2 class="collage-heading" id="collage-heading">${wordSpans(config.collage.heading)}</h2>
      <div class="collage-row">${polaroids}
      </div>
    </section>`);

  timeline.push(
    `tl.fromTo("#scene-collage", { opacity: 0 }, { opacity: 1, duration: 0.4, ease: "power1.out" }, ${s});`,
    `tl.fromTo("#scene-collage .orb-a", { x: 0, y: 0 }, { x: -42, y: 27, duration: ${COLLAGE_DUR + 0.5}, ease: "sine.inOut" }, ${s});`,
    `tl.fromTo("#scene-collage .orb-b", { x: 0, y: 0 }, { x: 33, y: -21, duration: ${COLLAGE_DUR + 0.5}, ease: "sine.inOut" }, ${s});`,
    `tl.fromTo("#collage-heading .w", { opacity: 0, y: 39, rotation: 3 }, { opacity: 1, y: 0, rotation: 0, duration: 0.55, ease: "power3.out", stagger: 0.09, transformOrigin: "50% 100%" }, ${s + 0.2});`,
  );
  config.collage.photoIndexes.forEach((_, k) => {
    const rot = rotations[k % rotations.length];
    const popAt = s + 0.55 + k * 0.45;
    timeline.push(
      `tl.fromTo("#polaroid-${k}", { opacity: 0, scale: 0.45, y: 39, rotation: ${rot - 14} }, { opacity: 1, scale: 1, y: 0, rotation: ${rot}, duration: 0.6, ease: "back.out(1.7)" }, ${popAt});`,
    );
  });
  timeline.push(
    // Gentle idle float after the last polaroid lands, kept finite so the
    // timeline stays deterministic and ends inside the scene window.
    `tl.to(".polaroid", { y: -10.5, duration: 1.5, ease: "sine.inOut", stagger: 0.12 }, ${s + 2.2});`,
    `tl.to(".polaroid", { y: 0, duration: 1.5, ease: "sine.inOut", stagger: 0.12 }, ${s + 3.7});`,
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
        <div class="quote-mark" id="msg-quote-${i}">&ldquo;</div>
        <p class="msg-text" id="msg-text-${i}">${sentenceSpans(message.text)}</p>
        <p class="msg-sign" id="msg-sign-${i}">${esc(message.signedBy)}</p>
      </div>
    </section>`);

  timeline.push(
    `tl.fromTo("#scene-msg-${i}", { opacity: 0 }, { opacity: 1, duration: 0.4, ease: "power1.out" }, ${s});`,
    `tl.fromTo("#scene-msg-${i} .orb-a", { x: 0, y: 0 }, { x: -33, y: 21, duration: ${MESSAGE_DUR + 0.5}, ease: "sine.inOut" }, ${s});`,
    `tl.fromTo("#msg-card-${i}", { opacity: 0, y: 66, scale: 0.97, rotationX: 6, transformPerspective: 1350 }, { opacity: 1, y: 0, scale: 1, rotationX: 0, duration: 0.85, ease: "power3.out" }, ${s + 0.25});`,
    `tl.fromTo("#msg-quote-${i}", { scale: 0, rotation: -12 }, { scale: 1, rotation: 0, duration: 0.5, ease: "back.out(2)", transformOrigin: "50% 50%" }, ${s + 0.55});`,
    `tl.fromTo("#msg-text-${i}", { y: 15 }, { y: 0, duration: 0.7, ease: "power2.out" }, ${s + 0.8});`,
    `tl.fromTo("#msg-text-${i} .sent", { opacity: 0 }, { opacity: 1, duration: 0.55, ease: "power1.out", stagger: 0.38 }, ${s + 0.8});`,
    `tl.fromTo("#msg-sign-${i}", { opacity: 0, x: -27 }, { opacity: 1, x: 0, duration: 0.6, ease: "power2.out" }, ${s + 2.1});`,
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
        <p class="closing-line" id="closing-line">${wordSpans(config.closingLine)}</p>
        <div class="rule" id="closing-rule"></div>
        <p class="from-line closing-sign" id="closing-sign">${esc(config.closingSignOff)}</p>
      </div>
    </section>`);

  timeline.push(
    `tl.fromTo("#scene-closing", { opacity: 0 }, { opacity: 1, duration: 0.5, ease: "power1.out" }, ${s});`,
    `tl.fromTo("#scene-closing .orb-a", { x: 0, y: 0 }, { x: -45, y: 30, duration: ${CLOSING_DUR}, ease: "sine.inOut" }, ${s});`,
    `tl.fromTo("#scene-closing .orb-b", { x: 0, y: 0 }, { x: 36, y: -24, duration: ${CLOSING_DUR}, ease: "sine.inOut" }, ${s});`,
    `tl.fromTo("#closing-eyebrow", { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.6, ease: "power2.out" }, ${s + 0.25});`,
    `tl.fromTo("#closing-line .w", { opacity: 0, y: 51, rotation: 3 }, { opacity: 1, y: 0, rotation: 0, duration: 0.65, ease: "power3.out", stagger: 0.07, transformOrigin: "50% 100%" }, ${s + 0.55});`,
    `tl.fromTo("#closing-rule", { scaleX: 0, opacity: 0 }, { scaleX: 1, opacity: 1, duration: 0.7, ease: "power2.inOut" }, ${s + 1.8});`,
    `tl.fromTo("#closing-sign", { opacity: 0, y: 15 }, { opacity: 1, y: 0, duration: 0.8, ease: "power1.out" }, ${s + 2.2});`,
    // Hold the closing card to the exact end of the composition.
    `tl.to("#scene-closing", { opacity: 1, duration: ${TOTAL - (s + 3.0)}, ease: "none" }, ${s + 3.0});`,
  );
}

// --------------------------------------------------------------- document ---
const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <script src="assets/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
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
        background: radial-gradient(circle at 18% 12%, #2c5c46 0%, #17352b 55%, #10261e 100%);
        color: #f7f3e8;
      }
      .scene {
        position: absolute;
        inset: 0;
        width: 1920px;
        height: 1080px;
        overflow: hidden;
      }
      .scene-card {
        background: radial-gradient(circle at 18% 12%, #2c5c46 0%, #17352b 55%, #10261e 100%);
      }
      .orb { position: absolute; border-radius: 999px; pointer-events: none; }
      .orb-a { width: 510px; height: 510px; right: -135px; top: -165px; background: rgba(232, 197, 110, 0.16); }
      .orb-b { width: 315px; height: 315px; left: -90px; bottom: -120px; background: rgba(255, 255, 255, 0.07); }
      /* Word spans GSAP staggers in: inline-block so transforms apply. */
      .w { display: inline-block; }
      /* Soft edge darkening over photos, faded in by GSAP per scene. */
      .vignette {
        position: absolute; inset: 0; pointer-events: none; opacity: 0;
        background: radial-gradient(ellipse at center, rgba(0, 0, 0, 0) 52%, rgba(4, 12, 9, 0.42) 100%);
      }
      .card-inner {
        position: absolute; inset: 0;
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        text-align: center; padding: 96px;
      }
      .eyebrow {
        font-family: Arial, Helvetica, sans-serif;
        font-size: 28.5px; letter-spacing: 0.34em; text-transform: uppercase;
        color: #e8c56e; margin-bottom: 39px;
      }
      .big-title { font-size: 108px; line-height: 1.1; font-weight: 700; max-width: 1530px; }
      .rule {
        width: 270px; height: 6px; border-radius: 3px;
        background: #e8c56e; margin: 45px 0 39px; transform-origin: center;
      }
      .subtitle {
        font-family: Arial, Helvetica, sans-serif;
        font-size: 40.5px; line-height: 1.45; color: #e9e4d4; max-width: 1290px;
      }
      .from-line {
        font-family: Arial, Helvetica, sans-serif;
        font-size: 31.5px; letter-spacing: 0.06em; color: #cfd8cc; margin-top: 51px;
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
        font-family: Arial, Helvetica, sans-serif;
        font-size: 39px; color: #f7f3e8;
      }
      /* Collage */
      .collage-heading {
        position: absolute; top: 96px; left: 0; right: 0;
        text-align: center; font-size: 66px; font-weight: 700; color: #f7f3e8;
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
        font-family: Arial, Helvetica, sans-serif;
        font-size: 24px; color: #44503f; text-align: center;
        padding-top: 15px; min-height: 39px;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      /* Message cards */
      .msg-card {
        position: absolute; top: 50%; left: 50%;
        transform: translate(-50%, -50%);
        width: 1320px;
        background: rgba(253, 252, 248, 0.97);
        border-radius: 27px;
        padding: 87px 96px 72px;
        text-align: center;
        box-shadow: 0 45px 90px rgba(0, 0, 0, 0.4);
      }
      .quote-mark { font-size: 96px; line-height: 0.6; color: #ac8a21; margin-bottom: 39px; }
      .msg-text { font-size: 46.5px; line-height: 1.5; color: #22301f; }
      .msg-sign {
        font-family: Arial, Helvetica, sans-serif;
        font-size: 28.5px; letter-spacing: 0.08em; text-transform: uppercase;
        color: #7a6a35; margin-top: 45px;
      }
      /* Closing */
      .closing-line { font-size: 69px; line-height: 1.3; font-weight: 700; max-width: 1350px; }
      .closing-sign { margin-top: 9px; }
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
console.log(`Wrote index.html for ${config.celebrantName}`);
console.log(`Scenes: title 0-${TITLE_DUR}s, montage ${MONTAGE_START}-${COLLAGE_START}s, collage ${COLLAGE_START}-${MESSAGES_START}s, messages ${MESSAGES_START}-${CLOSING_START}s, closing ${CLOSING_START}-${TOTAL}s`);
console.log(`Total duration: ${TOTAL}s`);
