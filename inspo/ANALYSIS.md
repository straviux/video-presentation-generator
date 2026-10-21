# Inspo Video Analysis: Nur Birthday Video (reference for effects)

Source file: `d5aaabf947a1f9a2b0fe7477b4382b4718feea34f7eefc838e91ec9ad2b03b64.mp4`
Analyzed from extracted frames only. The audio track was not listened to.

## Probe data

| Item | Value |
|---|---|
| Duration | 65.55 s |
| Resolution | 1920 x 1080 (16:9) |
| Frame rate | 30 fps |
| Video codec | H.264 (Main profile, yuv420p, BT.709) |
| Video bitrate | about 7.9 Mbps |
| Audio | AAC LC stereo, 44.1 kHz, about 198 kbps (present, not analyzed) |
| File size | 66,277,142 bytes (about 63 MB) |
| Total bitrate | about 8.1 Mbps |

Note: the reference renders at full 1080p with a healthy bitrate, which is part of why it looks crisper than our current 720p sample at about 2.5 Mbps.

## Scene cuts

ffmpeg scene detection at threshold 0.35 found only two hard cuts:

| Time | What happens |
|---|---|
| 22.17 s | Hard cut from the collage scene to the greeting card scene |
| 55.57 s | Hard cut inside the final photo montage |

At a lower threshold (0.18) one more boundary appears at 51.57 s, where the typewriter scene gives way to the full-bleed montage. Every other scene change is gradual (slides, fades, fade-through-white), which is why detection finds so few cuts. The video is built as a small number of long animated scenes, not a fast-cut edit.

## Scene by scene

| # | Time | Scene | What is shown and how it moves |
|---|---|---|---|
| 1 | 0.0 to 5.0 s | Title | Cream paper-textured background. A background-removed cutout of the celebrant fades in at center. The word "Happy" in thin gold script sits above a giant bold "Birthday" in amber orange that slides in from the left, passing behind the cutout so the person stays in front of the text. "6 October 2026" in small gray type at top right. Small line-art floral doodles in the corners. |
| 2 | 5.0 to 10.5 s | Name reveal | Full-body cutout stands center frame. "HAPPY BIRTHDAY" in small caps at top left, date at top right. The name arrives in two halves: "NUR" in huge condensed amber letters slides in from the left edge, "AINA" in huge condensed hot pink letters slides in from the right edge. The two halves meet around the cutout. |
| 3 | 10.5 to 22.2 s | Collage build | A masonry photo grid builds itself one photo at a time, roughly one photo per second, each popping or scaling in. Layout: one tall portrait on the left, mixed portrait and landscape tiles to the right, one tile is a solid orange block holding a cutout. Gold decorations throughout: painted hearts at the top left corner, confetti dashes top right, dot clusters and a gold brush stroke along the bottom. Near the end an italic caption fades in at the right: "May your day be filled with love, laughter, and beautiful memories". Photos have sharp corners, no rounding, thin white gaps between tiles. |
| 4 | 22.2 to 33.0 s | Greeting card | Hard cut in. Scrapbook card layout held for about 10 s with only gentle motion. Two-tone background (cream left, light gray right), torn kraft paper corners, fern sprigs. Big gold brush script "Happy Birthday", then "Ma'am Nur" in wide letterspaced serif, a short message in olive green serif, and the sign-off "From your YSE Family" printed on a torn kraft tape strip. One main photo in a thin white frame at center right, plus a vertical stack of three small slightly rotated polaroid-style photos along the right edge. |
| 5 | 33.0 to 51.6 s | Typewriter message | Cream background dressed with gold palm leaves, four-point sparkles, rainbow arc doodles, and a peach starburst. First a serif line types on character by character: "We just wanted to take a moment to say..." followed by "Thank you." in script that blurs and sharpens into place (a write-on feel). Then the main message types on in a handwritten print font, dark brown shading into gold: "Happy Birthday, Ma'am Nur! You bring so much warmth and light to everyone around you. We hope this year gives back all the kindness you share so freely. Your YSE Family loves you and is cheering you on, today and always." Beside the text, the celebrant cutout stands on a slanted parallelogram panel in solid orange with rounded corners. Halfway through, the panel and text swap sides. The typing runs about 12 s for the full message, roughly 15 to 19 characters per second. |
| 6 | 51.6 to 65.5 s | Full-bleed montage | Seven full-screen photos, each held about 2 s with a slow push-in zoom. Transitions are fades through white (the outgoing photo washes out to white, the next fades in from white), not plain crossfades. Sequence: cafe photo with plush toys, beach photo, book close-up, mountain lake, gym selfie, peace-sign close-up, and a final portrait on a gold background that closes the video. |

## Look and feel

- Palette: warm cream background (about #F7F2E7), amber and gold (about #D9930D) as the main accent, solid orange (about #F58A3C) for panels, one hot pink (about #EC008C) used only for the second half of the name, olive green and kraft brown as supporting tones.
- Typography mixes four voices: brush script for "Happy Birthday", a heavy condensed sans for the giant name and title words, a letterspaced serif for the name line and the "We just wanted to" line, and a handwritten print font for the typed message. Italic serif for the collage caption.
- Texture: a subtle paper grain sits over every designed scene. Decorations are flat gold illustrations (hearts, palms, sparkles, confetti, brush strokes), not 3D elements.
- Pacing: slow and deliberate. Six scenes in 65 s, holds of 5 to 18 s per scene. Motion comes from elements entering and building inside a scene, not from cutting.

## Effect inventory and reproducibility in our stack

Our stack: HTML/CSS compositions animated with GSAP timelines, rendered frame by frame by HyperFrames.

| Effect | Rating | How |
|---|---|---|
| Collage that builds photo by photo into a masonry grid | Easy | CSS grid with fixed tile slots; GSAP stagger on scale and opacity, one tile every 0.8 to 1 s. |
| Split name reveal, halves sliding in from opposite edges in two colors | Easy | Two absolutely positioned text blocks, GSAP x from off-canvas with a power ease. |
| Giant title word sliding in behind the subject | Possible with effort | The slide itself is a simple GSAP x tween, but the subject in front needs a background-removed cutout. Our app takes regular photos, so either add a background-removal step or put the photo in a frame beside the text instead. |
| Typewriter message reveal | Easy | Split the message into character spans and stagger opacity, or use a GSAP text tween. No plugin strictly required. |
| Full-bleed montage with fade-through-white and slow zoom | Easy | Stack photos, GSAP scale 1 to 1.08 over each hold, and overlap a white layer fade at each change. |
| Greeting card scene with torn paper, tape strip sign-off, polaroid stack | Easy | Static layout with PNG or SVG torn-edge assets, slight rotations on the polaroids, one gentle GSAP entrance per element group. Torn edges need prepared asset images. |
| Slanted solid color panel holding a photo | Easy for the panel, effort for the cutout | Panel is a CSS clip-path parallelogram. The person standing on it needs background removal; a framed photo clipped inside the same slanted shape is the no-cutout fallback and still looks close. |
| Script word write-on (the "Thank you." moment) | Possible with effort | True stroke write-on needs the word as SVG paths with dash animation. A blur plus opacity plus slight scale settle reads almost the same at a glance and is far cheaper. |
| Gold doodle decorations (hearts, sparkles, palms, confetti) | Easy | A small set of SVG assets placed per scene, faded or drifted in with GSAP. |
| Paper grain background | Easy | One repeating noise texture or an SVG turbulence overlay at low opacity. |
| Two-tone gradient handwritten text | Easy | CSS background-clip: text with a linear gradient. |

## Top 5 effects to steal first

1. Collage build, photo by photo. It is the visual peak of the reference, it matches the collage scene already in our template, and it is pure GSAP stagger work. Biggest payoff for the least effort.
2. Split name reveal on the title. Two giant halves sliding in from opposite edges instantly makes the opening feel designed instead of assembled. It needs no special assets.
3. Typewriter message cards. Our message scenes are currently static text on a card. Typing the greeting on gives the middle of the video a heartbeat and a reason to keep watching.
4. Fade-through-white montage with slow push-in. A one-line change from plain crossfades, and it is the transition language of the whole reference video.
5. Scrapbook greeting card as the closing scene. Torn tape sign-off, one framed main photo, and a small polaroid stack replace our plain closing card and end the video on the warmest layout in the reference.

## Audio note

The file contains an AAC stereo audio stream (44.1 kHz, about 198 kbps). It was not listened to during this analysis, so nothing here verifies the music choice, volume, or whether any beat sync exists. The scene pacing (long holds, typing speed) does not appear to depend on beat cuts.

## Files from this analysis

- `frames/sec-001.jpg` to `frames/sec-066.jpg`: one frame per second at 640 px wide.
- `frames/key-*.jpg`: 14 key frames at full 1920 x 1080, including frames just before and after the cuts at 22.17 s, 51.57 s, and 55.57 s.
- `contact-sheet-1.jpg`: seconds 0 to 32 in a labeled grid.
- `contact-sheet-2.jpg`: seconds 33 to 65 in a labeled grid.
