// NIIS — static, single-node build of the NINA (netNIMB) player.
//
// Same RNBO device, same channel strip as NINA's `src/clients/player.js`, but
// with no server: no soundworks, no WebRTC mesh, no shared state. It runs from
// any static host (GitHub Pages) and is meant to test and share the audio
// engine on its own.
//
// What changed from the networked player:
//   - the "receive buses" (one per peer) become local "inputs": LOOP, which
//     feeds this node's own output back into the device the way a peer would
//     return it, and MIC, the device microphone. Both start switched off, so
//     out of the box the device runs as a true no-input instrument.
//   - device motion is read from the browser directly (with the iOS permission
//     prompt on the enter button) instead of through @ircam/devicemotion.
//   - the enter screen replaces the soundworks platform-init screen.

import { html, render, svg } from './vendor/lit-html.js';

// Where the RNBO export lives — drop a new export in this folder to update
const PATCH_EXPORT_URL = 'assets/rnbo_export/NINA.export.json';

// Input bus fader range, in dB (same as NINA's receive buses)
const BUS_MIN_DB = -30;
const BUS_MAX_DB = 15;
const BUS_DEFAULT_DB = 0;

// LOOP emulates a peer returning this node's output: NINA sends the channel at
// this padding, and the network adds roughly this much latency.
const LOOP_SEND_PADDING = 0.45;
const LOOP_DELAY_S = 0.12;

// The channel strip, section by section — identical to NINA. Each section names
// the RNBO parameters it drives, with a curated musical sub-range clamped
// against whatever the exported device actually declares, so the patch can be
// re-exported without breaking the interface. A section whose parameters are
// all missing is skipped, and parameters the patch exposes that no section
// claims land in a trailing "parameters" section. A split section can also
// carry a `toggle`, a latching button between its two knobs that drives an
// inport with 0 / 1. A `hidden` section is not drawn (in NINA it is driven from
// the controller only); its parameter keeps the value the patch exports.
const SECTIONS = [
  {
    title: 'bandpass filter',
    layout: 'split',
    viz: 'curve',
    left: { id: 'bp', label: 'cutoff', min: 120, max: 1000, decimals: 0, unit: 'Hz' },
    toggle: { id: 'bp_coupled', label: 'coupled' },
    right: { id: 'bp_q', label: 'q', min: 0.0, max: 1.0, decimals: 2 },
  },
  {
    title: 'phase',
    layout: 'split',
    viz: 'line',
    left: { id: 'phase', label: 'cutoff', min: 20, max: 500, decimals: 0, unit: 'Hz' },
    right: { id: 'phase_q', label: 'q', min: 0.0, max: 1.0, decimals: 2 },
  },
  {
    title: 'delay',
    layout: 'split',
    viz: 'taps',
    left: { id: 'del', label: 'time', min: 1, max: 1800, decimals: 0, unit: 'ms' },
    right: { id: 'fb_trim', label: 'feedback', min: 0.001, max: 3.99, decimals: 3 },
  },
  {
    title: 'drive',
    layout: 'center',
    knobs: [
      { id: 'fb_gain', label: 'fb gain', min: 0.001, max: 3.9, decimals: 2, dots: true },
      { id: 'modulation', label: 'modulation', min: 0.0, max: 1.0, decimals: 2, dots: true },
    ],
  },
  {
    // Controller only in NINA, for now
    title: 'fade',
    layout: 'center',
    hidden: true,
    knobs: [
      { id: 'fade', label: 'fade', min: 20, max: 1000, decimals: 0, unit: 'ms' },
    ],
  },
];

// Channel fader taper — anchor points the labelled scale marks sit on
const LEVEL_ANCHORS = [
  { pos: 0.00, db: -60 },
  { pos: 0.22, db: -24 },
  { pos: 0.45, db: -12 },
  { pos: 0.66, db: 0 },
  { pos: 0.84, db: 6 },
  { pos: 1.00, db: 12 },
];
const LEVEL_SILENT_POS = 0.008;

// Input states shown by the LEDs
const STATUS_TEXT = { live: 'live', sync: 'wait', fail: 'fail', idle: 'off' };

// Number of dots in a knob's tick ring
const KNOB_DOTS = 19;

const dbToGain = db => Math.pow(10, db / 20);
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const formatDb = db => `${db >= 0 ? '+' : '-'}${Math.abs(db).toFixed(1)}`;

function valueToAngle(value, min, max) {
  return -135 + clamp((value - min) / (max - min), 0, 1) * 270;
}

// Knob tick ring — dot positions over the same 270° sweep as the needle
const KNOB_RING = Array.from({ length: KNOB_DOTS }, (_, i) => {
  const norm = i / (KNOB_DOTS - 1);
  const angle = (-135 + norm * 270) * Math.PI / 180;
  return { norm, x: 50 + 42 * Math.sin(angle), y: 50 - 42 * Math.cos(angle) };
});

// Channel fader taper, both ways. Position 0 is silence, not -60 dB.
function levelPosToDb(pos) {
  if (pos <= LEVEL_SILENT_POS) {
    return -Infinity;
  }
  for (let i = 1; i < LEVEL_ANCHORS.length; i++) {
    const lo = LEVEL_ANCHORS[i - 1];
    const hi = LEVEL_ANCHORS[i];
    if (pos <= hi.pos) {
      return lo.db + (pos - lo.pos) / (hi.pos - lo.pos) * (hi.db - lo.db);
    }
  }
  return LEVEL_ANCHORS[LEVEL_ANCHORS.length - 1].db;
}

function levelDbToPos(db) {
  for (let i = 1; i < LEVEL_ANCHORS.length; i++) {
    const lo = LEVEL_ANCHORS[i - 1];
    const hi = LEVEL_ANCHORS[i];
    if (db <= hi.db) {
      return lo.pos + (db - lo.db) / (hi.db - lo.db) * (hi.pos - lo.pos);
    }
  }
  return 1;
}

// Load rnbo.js for the version the patch was exported with: the copy shipped
// in assets/rnbo/<version>/ first, then Cycling '74's CDN as a fallback.
function loadRNBOScript(version) {
  if (/^\d+\.\d+\.\d+-dev$/.test(version)) {
    return Promise.reject(new Error(`Patch exported with a debug RNBO version (${version}) — export a release build.`));
  }

  const v = encodeURIComponent(version);
  const sources = [
    `assets/rnbo/${v}/rnbo.min.js`,
    `https://c74-public.nyc3.digitaloceanspaces.com/rnbo/${v}/rnbo.min.js`,
  ];

  const tryLoad = i => new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = sources[i];
    if (i > 0) {
      el.crossOrigin = 'anonymous';
    }
    el.onload = resolve;
    el.onerror = () => {
      el.remove();
      if (i + 1 < sources.length) {
        console.warn(`[rnbo] ${sources[i]} not found, trying ${sources[i + 1]}`);
        tryLoad(i + 1).then(resolve, reject);
      } else {
        reject(new Error(`Failed to load rnbo.js v${version}`));
      }
    };
    document.body.append(el);
  });

  return tryLoad(0);
}

// iOS only delivers devicemotion after an explicit permission, which has to be
// requested from inside a user gesture.
function requestMotionPermission() {
  const DME = window.DeviceMotionEvent;
  if (DME && typeof DME.requestPermission === 'function') {
    return DME.requestPermission().catch(() => 'denied');
  }
  return Promise.resolve('granted');
}

async function main($container, audioContext) {
  // ── RNBO device ────────────────────────────────────────────────────────────

  const response = await fetch(PATCH_EXPORT_URL);
  if (!response.ok) {
    throw new Error(`Could not fetch ${PATCH_EXPORT_URL} (${response.status})`);
  }
  const patcher = await response.json();

  if (!window.RNBO) {
    await loadRNBOScript(patcher.desc.meta.rnboversion);
  }

  const device = await RNBO.createDevice({ context: audioContext, patcher });
  console.log(`[rnbo] ${patcher.desc.meta.name} — rnbo.js ${patcher.desc.meta.rnboversion}`);

  // Audio graph:
  //
  //   [device.node] ──► [masterGain] ──► [outputNode] ──► [destination]
  //                                   ──► [loopSend] ──► [loopDelay] ──► [LOOP bus] ──┐
  //   microphone ──────────────────────────────────────────────────────► [MIC bus]  ──┤
  //                                                                                   ▼
  //                                                       [busSum] ──► [device.node]

  const outputNode = audioContext.createGain();
  outputNode.connect(audioContext.destination);

  // Channel fader — post device, so LEVEL and MUTE act on what the node plays
  // *and* on what it feeds back through LOOP, as they do on the network.
  const masterGain = audioContext.createGain();
  masterGain.gain.value = 1;

  device.node.connect(masterGain);
  masterGain.connect(outputNode);

  // Sum of every input bus, fed into the device input
  const busSum = audioContext.createGain();
  busSum.gain.value = 1;
  busSum.connect(device.node);

  // ── Rendering ──────────────────────────────────────────────────────────────

  let uiReady = false;
  let renderRequested = false;

  function scheduleRender() {
    if (!uiReady || renderRequested) {
      return;
    }
    renderRequested = true;
    requestAnimationFrame(() => {
      renderRequested = false;
      renderApp();
    });
  }

  // ── Generic drag-controlled range ──────────────────────────────────────────

  function createControl({ min, max, value, sensitivity = 200, onInput }) {
    const ctrl = {
      min,
      max,
      value: clamp(value, min, max),
      defaultValue: clamp(value, min, max),
      dragging: false,
      startY: 0,
      startValue: 0,
      fine: false,
    };

    ctrl.setValue = (v, silent = false) => {
      const next = clamp(v, ctrl.min, ctrl.max);
      if (next === ctrl.value) {
        return;
      }
      ctrl.value = next;
      onInput(next);
      if (!silent) {
        scheduleRender();
      }
    };

    ctrl.onPointerDown = e => {
      ctrl.dragging = true;
      ctrl.fine = e.shiftKey;
      ctrl.startY = e.clientY;
      ctrl.startValue = ctrl.value;
      e.currentTarget.setPointerCapture(e.pointerId);
      e.preventDefault();
    };

    ctrl.onPointerMove = e => {
      if (!ctrl.dragging) {
        return;
      }
      const span = (ctrl.max - ctrl.min) / sensitivity * (ctrl.fine ? 0.2 : 1);
      ctrl.setValue(ctrl.startValue + (ctrl.startY - e.clientY) * span);
    };

    ctrl.onPointerUp = e => {
      ctrl.dragging = false;
      if (e && e.pointerId !== undefined) {
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch { /* pointer already released */ }
      }
      scheduleRender();
    };

    ctrl.onWheel = e => {
      e.preventDefault();
      const step = (ctrl.max - ctrl.min) / (e.shiftKey ? 400 : 60);
      ctrl.setValue(ctrl.value - Math.sign(e.deltaY) * step);
    };

    ctrl.onDblClick = () => ctrl.setValue(ctrl.defaultValue);

    return ctrl;
  }

  // ── Input buses ────────────────────────────────────────────────────────────
  // Stand-ins for NINA's receive buses. Each one is a gain into `busSum`, a
  // knob in dB, and an LED that switches its source on and off.

  function createBus(label, title) {
    const gainNode = audioContext.createGain();
    gainNode.gain.value = dbToGain(BUS_DEFAULT_DB);
    gainNode.connect(busSum);

    const bus = { label, title, gainNode, status: 'idle', error: '' };

    bus.control = createControl({
      min: BUS_MIN_DB,
      max: BUS_MAX_DB,
      value: BUS_DEFAULT_DB,
      sensitivity: 220,
      onInput: db => {
        gainNode.gain.setTargetAtTime(dbToGain(db), audioContext.currentTime, 0.01);
      },
    });

    return bus;
  }

  // LOOP — this node's own output, padded and delayed like a peer's return
  const loopSend = audioContext.createGain();
  loopSend.gain.value = 0;
  const loopDelay = audioContext.createDelay(1);
  loopDelay.delayTime.value = LOOP_DELAY_S;
  masterGain.connect(loopSend).connect(loopDelay);

  const loopBus = createBus('LOOP', 'local loopback — this node\'s output returned as a peer would send it');
  loopDelay.connect(loopBus.gainNode);

  loopBus.toggle = () => {
    const on = loopBus.status !== 'live';
    loopSend.gain.setTargetAtTime(on ? LOOP_SEND_PADDING : 0, audioContext.currentTime, 0.02);
    loopBus.status = on ? 'live' : 'idle';
    scheduleRender();
  };

  // MIC — the device microphone, with every voice-call processing turned off
  const micBus = createBus('MIC', 'microphone input');
  let micStream = null;
  let micSource = null;

  micBus.toggle = async () => {
    if (micBus.status === 'sync') {
      return;
    }

    if (micStream) {
      micSource.disconnect();
      micStream.getTracks().forEach(t => t.stop());
      micStream = null;
      micSource = null;
      micBus.status = 'idle';
      scheduleRender();
      return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      micBus.status = 'fail';
      micBus.error = 'microphone not available (needs https)';
      scheduleRender();
      return;
    }

    micBus.status = 'sync';
    scheduleRender();

    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      micSource = audioContext.createMediaStreamSource(micStream);
      micSource.connect(micBus.gainNode);
      micBus.status = 'live';
      micBus.error = '';
      micStream.getAudioTracks().forEach(track => {
        track.onended = () => {
          if (micStream) {
            micBus.toggle();
          }
        };
      });
    } catch (err) {
      console.warn('[mic]', err);
      micStream = null;
      micBus.status = 'fail';
      micBus.error = err.message || String(err);
    }

    scheduleRender();
  };

  const buses = [loopBus, micBus];

  // ── RNBO parameters ────────────────────────────────────────────────────────

  function sendMessageToInport(inportTag, values) {
    device.scheduleEvent(new RNBO.MessageEvent(RNBO.TimeNow, inportTag, values));
  }

  // Build one dial per declared parameter that the device actually exposes.
  function makeDial(cfg) {
    const param = device.parametersById.get(cfg.id);

    if (!param) {
      console.warn(`[rnbo] parameter "${cfg.id}" not found, skipped`);
      return null;
    }

    const min = Math.max(cfg.min, param.min);
    const max = Math.min(cfg.max, param.max);

    if (!(max > min)) {
      console.warn(`[rnbo] parameter "${cfg.id}" has an empty range, skipped`);
      return null;
    }

    const dial = {
      id: cfg.id,
      label: cfg.label,
      unit: cfg.unit ?? '',
      decimals: cfg.decimals,
      dots: cfg.dots ?? false,
    };

    dial.control = createControl({
      min,
      max,
      value: clamp(param.value, min, max),
      sensitivity: 200,
      onInput: v => {
        param.value = v;
      },
    });

    param.value = dial.control.value;
    return dial;
  }

  // Latching button bound to an inport — sends 1 when engaged, 0 when released
  function makeToggle(cfg) {
    if (!patcher.desc.inports.some(port => port.tag === cfg.id)) {
      console.warn(`[rnbo] inport "${cfg.id}" not found, skipped`);
      return null;
    }

    const toggle = {
      id: cfg.id,
      label: cfg.label,
      kind: 'toggle',
      on: false,
    };

    toggle.set = on => {
      if (on === toggle.on) {
        return;
      }
      toggle.on = on;
      sendMessageToInport(cfg.id, [on ? 1 : 0]);
      scheduleRender();
    };

    sendMessageToInport(cfg.id, [0]);
    return toggle;
  }

  function buildSections() {
    const sections = [];
    const claimed = new Set();

    for (const cfg of SECTIONS) {
      const declared = cfg.layout === 'center'
        ? cfg.knobs
        : [cfg.left, cfg.right];

      declared.forEach(k => claimed.add(k.id));

      if (cfg.layout === 'center') {
        const knobs = cfg.knobs.map(makeDial).filter(Boolean);
        if (knobs.length) {
          sections.push({ ...cfg, knobs });
        }
        continue;
      }

      const left = makeDial(cfg.left);
      const right = makeDial(cfg.right);
      const toggle = cfg.toggle ? makeToggle(cfg.toggle) : null;

      if (left || right || toggle) {
        sections.push({ ...cfg, left, right, toggle });
      }
    }

    // Anything the patch exposes that no section claims still gets a knob
    const extra = [];
    for (const param of device.parameters) {
      if (!claimed.has(param.id)) {
        const dial = makeDial({
          id: param.id,
          label: (param.name || param.id).replace(/_/g, ' '),
          min: param.min,
          max: param.max,
          decimals: param.max - param.min > 20 ? 0 : 2,
          dots: true,
        });
        if (dial) {
          extra.push(dial);
        }
      }
    }

    if (extra.length) {
      sections.push({ title: 'parameters', layout: 'center', knobs: extra });
    }

    return sections;
  }

  const sections = buildSections();
  const visibleSections = sections.filter(section => !section.hidden);

  // Every control of a section, in the order it reads on the strip
  function sectionItems(section) {
    return section.layout === 'center'
      ? section.knobs
      : [section.left, section.toggle, section.right].filter(Boolean);
  }

  // ── Channel fader + mute ───────────────────────────────────────────────────

  let muted = false;

  // Compact is the performing layout: everything on one screen, no scrolling.
  // Expanded is the full strip, with the section visualisers.
  let expanded = false;

  function toggleView() {
    expanded = !expanded;
    scheduleRender();
  }

  const level = createControl({
    min: 0,
    max: 1,
    value: levelDbToPos(0),
    sensitivity: 1,
    onInput: () => applyLevel(),
  });

  function levelDb() {
    return levelPosToDb(level.value);
  }

  function applyLevel() {
    const db = levelDb();
    const gain = muted || db === -Infinity ? 0 : dbToGain(db);
    masterGain.gain.setTargetAtTime(gain, audioContext.currentTime, 0.015);
  }

  applyLevel();

  // The fader is horizontal, so it is driven by pointer x over its own width
  // rather than by the shared vertical drag of `createControl`.
  function onFaderDown(e) {
    level.dragging = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    onFaderMove(e);
  }

  function onFaderMove(e) {
    if (!level.dragging) {
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    level.setValue((e.clientX - rect.left) / rect.width);
    scheduleRender();
  }

  function onFaderUp(e) {
    level.dragging = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch { /* pointer already released */ }
    scheduleRender();
  }

  function toggleMute() {
    muted = !muted;
    applyLevel();
    scheduleRender();
  }

  // ── Device motion ──────────────────────────────────────────────────────────

  const motionSmoothingWindowSize = 50;
  const motionXHistory = [];
  const motionYHistory = [];
  const motionZHistory = [];
  const motionLogWeights = Array.from(
    { length: motionSmoothingWindowSize },
    (_, i) => Math.log(i + 2),
  );

  const smoothMotionValue = (history, nextValue) => {
    history.push(nextValue);
    if (history.length > motionSmoothingWindowSize) {
      history.shift();
    }
    const offset = motionSmoothingWindowSize - history.length;
    let weightedSum = 0;
    let weightsSum = 0;
    for (let i = 0; i < history.length; i++) {
      const weight = motionLogWeights[offset + i];
      weightedSum += history[i] * weight;
      weightsSum += weight;
    }
    return weightsSum > 0 ? weightedSum / weightsSum : nextValue;
  };

  const formatMotionValue = v => (typeof v === 'number' ? v.toFixed(2) : '--');

  const formatMotionEvent = e => {
    const acc = e.accelerationIncludingGravity || {};
    const rot = e.rotationRate || {};
    return [
      `interval: ${formatMotionValue(e.interval)} ms`,
      `accG: x ${formatMotionValue(acc.x)} y ${formatMotionValue(acc.y)} z ${formatMotionValue(acc.z)}`,
      `rot: a ${formatMotionValue(rot.alpha)} b ${formatMotionValue(rot.beta)} g ${formatMotionValue(rot.gamma)}`,
    ].join('\n');
  };

  let motionDebugVisible = false;
  let motionDebugText = 'no motion data from this device';
  let lastMotionDebugUpdate = 0;
  const motionUpdateInterval = 50;

  // Start from rest, so the patch has a defined state on devices without sensors
  sendMessageToInport('accelerometer', [0, 0, 0]);

  if (typeof window.DeviceMotionEvent !== 'undefined') {
    window.addEventListener('devicemotion', e => {
      const acc = e.accelerationIncludingGravity || {};
      // Desktop browsers may fire empty events — ignore those
      if (typeof acc.x !== 'number' && typeof acc.y !== 'number' && typeof acc.z !== 'number') {
        return;
      }
      const rawX = typeof acc.x === 'number' ? acc.x : 0;
      const rawY = typeof acc.y === 'number' ? acc.y : 0;
      const rawZ = typeof acc.z === 'number' ? acc.z : 0;
      const x = smoothMotionValue(motionXHistory, rawX);
      const y = smoothMotionValue(motionYHistory, rawY);
      const z = smoothMotionValue(motionZHistory, rawZ);
      sendMessageToInport('accelerometer', [x, y, z]);
      if (motionDebugVisible) {
        const now = performance.now();
        if (now - lastMotionDebugUpdate >= motionUpdateInterval) {
          lastMotionDebugUpdate = now;
          motionDebugText = formatMotionEvent(e);
          const el = $container.querySelector('#devicemotion-debug');
          if (el) {
            el.textContent = motionDebugText;
          }
        }
      }
    });
  }

  let isRunning = true;
  sendMessageToInport('start', [1]);

  // ── Interface ──────────────────────────────────────────────────────────────

  // Knob, drawn as in a hardware channel strip: outline, radial needle, and —
  // for the levels that carry a scale — a ring of ticks lit up to the value.
  function renderKnob(ctrl, { dots = false, origin = null } = {}) {
    const norm = (ctrl.value - ctrl.min) / (ctrl.max - ctrl.min);
    const boosted = origin !== null && ctrl.value > origin;

    return html`
      <div
        class="knob ${ctrl.dragging ? 'is-dragging' : ''} ${boosted ? 'is-boost' : ''}"
        @pointerdown=${ctrl.onPointerDown}
        @pointermove=${ctrl.onPointerMove}
        @pointerup=${ctrl.onPointerUp}
        @pointercancel=${ctrl.onPointerUp}
        @wheel=${ctrl.onWheel}
        @dblclick=${ctrl.onDblClick}
      >
        <svg class="knob-svg" viewBox="0 0 100 100" aria-hidden="true">
          ${dots ? KNOB_RING.map(d => svg`
            <circle
              class="knob-dot ${d.norm <= norm ? 'is-lit' : ''}"
              cx="${d.x.toFixed(2)}" cy="${d.y.toFixed(2)}" r="1.9"
            />
          `) : null}
          <circle class="knob-body" cx="50" cy="50" r="30" />
          <line
            class="knob-needle"
            x1="50" y1="50" x2="50" y2="21"
            transform="rotate(${valueToAngle(ctrl.value, ctrl.min, ctrl.max)} 50 50)"
          />
        </svg>
      </div>
    `;
  }

  function renderKnobCell(dial) {
    if (!dial) {
      return html`<div class="cell is-empty"></div>`;
    }

    return html`
      <div class="cell">
        <span class="cell-label">${dial.label}</span>
        ${renderKnob(dial.control, { dots: dial.dots })}
        <span class="cell-value">
          ${dial.control.value.toFixed(dial.decimals)}${dial.unit
            ? html`<i class="unit">${dial.unit}</i>` : null}
        </span>
      </div>
    `;
  }

  // Small lamp button for an inport toggle. The compact view drops the text.
  function renderToggle(toggle) {
    return html`
      <button
        class="trig ${toggle.on ? 'is-on' : ''}"
        type="button"
        title=${toggle.label}
        aria-pressed=${toggle.on ? 'true' : 'false'}
        @click=${() => toggle.set(!toggle.on)}
      >
        <span class="trig-lamp"></span>
        <span class="trig-text">${toggle.label}</span>
      </button>
    `;
  }

  function renderItemCell(item) {
    return item.kind === 'toggle'
      ? html`<div class="cell cell--toggle">${renderToggle(item)}</div>`
      : renderKnobCell(item);
  }

  // Resonant bandpass response, drawn from the section's own two knobs
  function renderCurveViz(section) {
    const cutoff = section.left ? section.left.control : null;
    const q = section.right ? section.right.control : null;
    const peak = cutoff
      ? (cutoff.value - cutoff.min) / (cutoff.max - cutoff.min)
      : 0.5;
    const sharpness = 1.5 + (q ? (q.value - q.min) / (q.max - q.min) : 0.5) * 16;

    const points = [];
    for (let i = 0; i <= 60; i++) {
      const x = i / 60;
      const mag = 1 / (1 + Math.pow((x - peak) * sharpness, 2));
      points.push(`${(x * 200).toFixed(2)},${(58 - mag * 48).toFixed(2)}`);
    }

    const cx = (peak * 200).toFixed(2);

    return html`
      <div class="viz">
        <svg class="viz-svg" viewBox="0 0 200 62" preserveAspectRatio="none" aria-hidden="true">
          <line class="viz-guide" x1="${cx}" y1="2" x2="${cx}" y2="60" />
          <polyline class="viz-curve" points="${points.join(' ')}" />
        </svg>
        ${cutoff ? html`
          <span class="viz-caption">
            ${cutoff.value.toFixed(0)}<i class="unit">Hz</i>
          </span>
        ` : null}
      </div>
    `;
  }

  // Delay taps — spacing follows the time knob, decay follows the feedback knob
  function renderTapsViz(section) {
    const time = section.left ? section.left.control : null;
    const fb = section.right ? section.right.control : null;
    const spread = time ? (time.value - time.min) / (time.max - time.min) : 0.5;
    const decay = fb ? (fb.value - fb.min) / (fb.max - fb.min) : 0.4;

    const step = 18 + spread * 22;
    const taps = [];
    for (let i = 0; i < 6; i++) {
      const x = 8 + i * step;
      if (x > 192) {
        break;
      }
      const amp = Math.pow(0.35 + decay * 0.6, i);
      taps.push({ x, r: 2.5 + amp * 5, lit: amp > 0.3 });
    }

    return html`
      <div class="viz">
        <svg class="viz-svg" viewBox="0 0 200 62" preserveAspectRatio="none" aria-hidden="true">
          <line class="viz-guide is-dashed" x1="4" y1="26" x2="196" y2="26" />
          ${taps.map(t => svg`
            <circle
              class="viz-tap ${t.lit ? 'is-lit' : ''}"
              cx="${t.x.toFixed(2)}" cy="26" r="${t.r.toFixed(2)}"
            />
          `)}
          <path class="viz-arrow" d="M 12 40 L 12 52 L 188 52 L 188 42" />
          <path class="viz-arrow" d="M 8 45 L 12 38 L 16 45" />
        </svg>
      </div>
    `;
  }

  function renderLineViz() {
    return html`
      <div class="viz viz--plain">
        <svg class="viz-svg" viewBox="0 0 200 62" preserveAspectRatio="none" aria-hidden="true">
          <line class="viz-guide" x1="4" y1="31" x2="196" y2="31" />
        </svg>
      </div>
    `;
  }

  function renderSection(section) {
    let body;

    if (!expanded) {
      // Compact: controls only, side by side, no visualiser
      body = html`
        <div class="section-body section-body--center">
          ${sectionItems(section).map(renderItemCell)}
        </div>
      `;
    } else if (section.layout === 'center') {
      body = html`
        <div class="section-body section-body--center">
          ${section.knobs.map(renderKnobCell)}
        </div>
      `;
    } else {
      const viz = section.viz === 'curve' ? renderCurveViz(section)
        : section.viz === 'taps' ? renderTapsViz(section)
          : renderLineViz();

      body = html`
        <div class="section-body section-body--split">
          ${renderKnobCell(section.left)}
          ${section.toggle ? html`
            <div class="section-center">${viz}${renderToggle(section.toggle)}</div>
          ` : viz}
          ${renderKnobCell(section.right)}
        </div>
      `;
    }

    return html`
      <section class="section">
        <h2 class="section-title">${section.title}</h2>
        ${body}
      </section>
    `;
  }

  function renderBus(bus) {
    const status = bus.status;
    const hint = bus.error ? ` (${bus.error})` : '';

    return html`
      <div class="cell cell--bus is-${status}">
        <span class="cell-label" title=${bus.title}>${bus.label}</span>
        ${renderKnob(bus.control, { dots: true, origin: BUS_DEFAULT_DB })}
        <span class="cell-value">
          ${formatDb(bus.control.value)}<i class="unit">dB</i>
        </span>
        <button
          class="led is-${status}"
          type="button"
          title="${bus.label}: ${STATUS_TEXT[status]}${hint} — click to switch on / off"
          @click=${bus.toggle}
        >
          <span class="led-lamp"></span>
          <span class="led-text">${STATUS_TEXT[status]}</span>
        </button>
      </div>
    `;
  }

  function renderLevel() {
    const db = levelDb();
    const pos = `${(level.value * 100).toFixed(2)}%`;

    return html`
      <section class="section section--level">
        <h2 class="section-title">
          level
          ${expanded ? null : html`
            <span class="section-readout">
              ${db === -Infinity ? '-∞' : formatDb(db)}<i class="unit">dB</i>
            </span>
          `}
        </h2>
        <div class="level-row">
        <div class="fader ${muted ? 'is-muted' : ''}">
          <div class="fader-scale">
            ${LEVEL_ANCHORS.map((a, i) => html`
              <span class="fader-mark" style="left: ${(a.pos * 100).toFixed(2)}%">
                ${i === 0 ? '-∞' : a.db === 0 ? '0' : formatDb(a.db).replace('.0', '')}
              </span>
            `)}
          </div>
          <div
            class="fader-track"
            @pointerdown=${onFaderDown}
            @pointermove=${onFaderMove}
            @pointerup=${onFaderUp}
            @pointercancel=${onFaderUp}
          >
            <div class="fader-ticks">
              ${Array.from({ length: 25 }, (_, i) => html`
                <span class="fader-tick ${i % 4 === 0 ? 'is-strong' : ''}"></span>
              `)}
            </div>
            <div class="fader-rail"></div>
            <div class="fader-handle" style="left: ${pos}"></div>
          </div>
          ${expanded ? html`
            <span class="fader-value">
              ${db === -Infinity ? '-∞' : formatDb(db)}<i class="unit">dB</i>
            </span>
          ` : null}
        </div>

        <div class="mute-row">
          ${expanded ? html`<span class="cell-label">mute</span>` : null}

          <button
            class="mute ${muted ? 'is-on' : ''}"
            type="button"
            title="mute"
            aria-pressed=${muted ? 'true' : 'false'}
            @click=${toggleMute}
          >
            <svg viewBox="0 0 24 20" aria-hidden="true">
              <path d="M 3 7 L 7 7 L 12 3 L 12 17 L 7 13 L 3 13 Z" />
              <line x1="16" y1="7" x2="21" y2="13" />
              <line x1="21" y1="7" x2="16" y2="13" />
            </svg>
          </button>
        </div>
        </div>
      </section>
    `;
  }

  function renderApp() {
    const liveCount = buses.filter(b => b.status === 'live').length;

    render(html`
      <div class="player">
        <header class="transport">
          <span class="transport-title">NO—INPUT</span>
          <span class="transport-node">NIIS</span>
          <span class="transport-mesh" title="inputs switched on">
            <span class="mesh-dot ${liveCount > 0 ? 'is-live' : ''}"></span>
            ${liveCount}/${buses.length}
          </span>
          <button
            class="view-toggle"
            type="button"
            title=${expanded ? 'compact view' : 'expanded view'}
            @click=${toggleView}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              ${expanded ? svg`
                <path d="M 7 2 L 7 7 L 2 7" />
                <path d="M 9 14 L 9 9 L 14 9" />
              ` : svg`
                <path d="M 2 6 L 2 2 L 6 2" />
                <path d="M 14 10 L 14 14 L 10 14" />
              `}
            </svg>
          </button>
        </header>

        <main class="player-body">
          <div class="console ${expanded ? 'is-expanded' : 'is-compact'}">
            <section class="section">
              <h2 class="section-title">inputs</h2>
              <div class="section-body section-body--center">
                ${buses.map(renderBus)}
              </div>
              <p class="inputs-note">
                standalone node — loop returns this output, mic feeds the device
              </p>
            </section>

            ${expanded
              ? visibleSections.map(renderSection)
              : html`<div class="section-grid">${visibleSections.map(renderSection)}</div>`}
            ${renderLevel()}
          </div>

          ${motionDebugVisible ? html`
            <pre id="devicemotion-debug" class="motion-debug">${motionDebugText}</pre>
          ` : null}
        </main>

        <footer class="actions">
          <button class="btn" type="button"
            @click=${() => sendMessageToInport('trig', [1])}>trig</button>
          <button class="btn ${isRunning ? 'is-on' : ''}" type="button"
            @click=${() => {
              isRunning = !isRunning;
              sendMessageToInport('start', [isRunning ? 1 : 0]);
              renderApp();
            }}>${isRunning ? 'stop' : 'start'}</button>
          <button class="btn ${motionDebugVisible ? 'is-on' : ''}" type="button"
            @click=${() => {
              motionDebugVisible = !motionDebugVisible; renderApp();
            }}>motion</button>
        </footer>
      </div>
    `, $container);
  }

  uiReady = true;
  renderApp();

  // Mobile browsers suspend the context when the page is backgrounded
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && audioContext.state !== 'running') {
      audioContext.resume().catch(() => {});
    }
  });
}

// ── Enter screen ─────────────────────────────────────────────────────────────
// Audio (and, on iOS, motion sensors) can only start from a user gesture.

function renderEnter($container, { busy = false, error = null } = {}) {
  render(html`
    <div class="player">
      <header class="transport">
        <span class="transport-title">NO—INPUT</span>
        <span class="transport-node">NIIS</span>
      </header>
      <main class="enter">
        <div class="enter-panel">
          <h2 class="section-title">no—input instrument</h2>
          <p class="enter-lead">a feedback instrument for smartphone</p>
          <p>Turn the knobs to shape the feedback, tilt the phone to move it.<br>
             Turn the volume up gently — this gets loud.</p>
          <p>This is the standalone build of a NINA node:
            same RNBO device, no network.</p>
          ${error ? html`<p class="enter-error">${error}</p>` : null}
          <button class="btn" type="button" ?disabled=${busy} @click=${() => start($container)}>
            ${busy ? 'loading…' : 'enter'}
          </button>
        </div>
      </main>
    </div>
  `, $container);
}

let starting = false;

async function start($container) {
  if (starting) {
    return;
  }
  starting = true;

  // Both of these must be called synchronously inside the click
  const motionPermission = requestMotionPermission();
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const audioContext = new AudioCtx();
  const resumed = audioContext.resume();

  renderEnter($container, { busy: true });

  try {
    await Promise.all([motionPermission, resumed]);
    await main($container, audioContext);
  } catch (err) {
    console.error(err);
    audioContext.close().catch(() => {});
    starting = false;
    renderEnter($container, { error: `Could not start the device: ${err.message || err}` });
  }
}

const $app = document.getElementById('app');
renderEnter($app);
