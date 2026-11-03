# NIIS — No-Input Instrument for Smartphone

_"Let's make some harsh noise from your phone ,)"_

A no-input feedback instrument built with RNBO. This repository is the
**public, static build of the NINA node**: the same RNBO device and the same
channel-strip interface as the networked NINA player, packaged as a plain
website so the audio engine can be tested and shared from GitHub Pages.

No server, no network audio, no shared state — open the page, press
**enter**, play.

## Using it

- **Knobs** — drag up/down (shift for fine), mouse wheel, double-click to reset.
- **Inputs** — stand-ins for NINA's receive buses, both off by default so the
  device starts as a true no-input instrument:
  - **LOOP** returns this node's own output into the device input, padded and
    delayed the way a peer would send it back over the network.
  - **MIC** feeds the microphone into the device (needs https, which Pages provides).
  - Click the LED to switch an input on or off; the knob sets its level in dB.
- **Level / mute** — channel fader, post device (also affects LOOP).
- **coupled** — the lamp in the bandpass section latches the `bp_coupled` inport.
- **trig / start-stop / motion** — RNBO `trig` and `start` inports, and a
  readout of the accelerometer data sent to the `accelerometer` inport.
- The corner button switches between the compact (one-screen) and expanded
  (with visualisers) layouts.

On iOS, motion sensors are enabled from the permission prompt shown on **enter**.

## Layout

```
index.html                    entry point
js/app.js                     the interface + audio graph (ES module, no build step)
js/vendor/lit-html.js         lit-html 3.3.3 (BSD-3-Clause, see lit-html.LICENSE)
style/app.scss → app.css      styles (app.css is committed, compiled from app.scss)
assets/rnbo_export/           RNBO export of the device (NINA.export.json)
assets/rnbo/<version>/        rnbo.js matching the export
tools/sync-from-nina.sh       pull a new export from a NINA checkout
```

`rnbo.js` is loaded for the version recorded in the export
(`desc.meta.rnboversion`), from `assets/rnbo/<version>/` first and from the
Cycling '74 CDN if that copy is missing.

## Updating the device

Re-export the patch from Max into the NINA project, then:

```bash
tools/sync-from-nina.sh ../NINA_netNIMB
```

This copies `NINA.export.json` and the matching `rnbo.js` here (dropping
the old ones) and recompiles the stylesheet. Set `EXPORT=<name>.export.json`
if the export is renamed, and update `PATCH_EXPORT_URL` in `js/app.js` to match. The
interface reads parameter ranges from the export, so renamed or new
parameters still show up (unknown ones land in a "parameters" section).

## Running locally

Any static server works — the page uses ES modules and `fetch`, so it can't be
opened as a `file://` URL:

```bash
python3 -m http.server 8000
```

## Publishing on GitHub Pages

Settings → Pages → *Deploy from a branch* → `main` / `(root)`. The `.nojekyll`
file makes Pages serve the files as they are.
