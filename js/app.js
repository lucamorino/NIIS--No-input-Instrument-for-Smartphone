if (screen.orientation && screen.orientation.lock) {
  screen.orientation.lock('portrait').catch(() => {});
}

let oscilloscopeStarted = false;

// ── Parameter definitions (matching No-Input player.js) ──────
const FADER_DEFS = [
  { tag: 'fb_trim', label: 'FB GAIN', min: 0.05, max: 0.26,  value: 0.15,  decimals: 2 },
  { tag: 'bp_q',    label: 'BP Q',    min: 0.0,  max: 1.0,   value: 0.5,   decimals: 2 },
  { tag: 'phase',   label: 'PHASE',   min: 50.0, max: 270.0, value: 160.0, decimals: 0 },
  { tag: 'phase_q', label: 'PH Q',    min: 0.0,  max: 1.0,   value: 0.5,   decimals: 2 },
  { tag: 'bp',      label: 'BP',      min: 250,  max: 800,   value: 525,   decimals: 0 },
  { tag: 'del',     label: 'DEL',     min: 50,   max: 1200,  value: 625,   decimals: 0 },
];

async function main(audioContext) {

  // Audio graph
  const outputNode = audioContext.createGain();
  outputNode.connect(audioContext.destination);

  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.3;
  analyser.connect(outputNode);

  // Load RNBO patch
  const patchExportURL = 'export/patch.export.json';
  let patcher;
  try {
    const response = await fetch(patchExportURL);
    patcher = await response.json();
    if (!window.RNBO) await loadRNBOScript(patcher.desc.meta.rnboversion);
  } catch (err) {
    console.error('Failed to load patcher or RNBO script:', err);
    return;
  }

  let device;
  try {
    device = await RNBO.createDevice({ context: audioContext, patcher });
  } catch (err) {
    console.error('Failed to create RNBO device:', err);
    return;
  }

  device.node.connect(analyser);

  function setParam(name, value) {
    const p = device.parametersById.get(name);
    if (p) p.value = value;
    else console.warn(`[rnbo] parameter "${name}" not found`);
  }

  function sendMsg(tag, values) {
    device.scheduleEvent(new RNBO.MessageEvent(RNBO.TimeNow, tag, values));
  }

  // Read initial values from device
  FADER_DEFS.forEach(f => {
    const p = device.parametersById.get(f.tag);
    if (p) f.value = p.value;
  });

  // ── Build fader channel strips ──────────────────────────────
  const container = document.getElementById('faders-container');
  const thumbEls   = [];
  const readoutEls = [];

  FADER_DEFS.forEach(f => {
    const strip = document.createElement('div');
    strip.className = 'fader-strip';

    const labelEl = document.createElement('span');
    labelEl.className = 'fader-label';
    labelEl.textContent = f.label;

    const trackEl = document.createElement('div');
    trackEl.className = 'fader-track';

    const thumbEl = document.createElement('div');
    thumbEl.className = 'fader-thumb';
    trackEl.appendChild(thumbEl);

    const readoutEl = document.createElement('span');
    readoutEl.className = 'fader-readout';
    readoutEl.textContent = f.value.toFixed(f.decimals);

    strip.appendChild(labelEl);
    strip.appendChild(trackEl);
    strip.appendChild(readoutEl);
    container.appendChild(strip);

    thumbEls.push(thumbEl);
    readoutEls.push(readoutEl);

    // Pointer drag — drag up to increase, down to decrease
    let dragging = false, startY = 0, startValue = 0;

    trackEl.addEventListener('pointerdown', e => {
      dragging = true;
      startY = e.clientY;
      startValue = f.value;
      trackEl.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    trackEl.addEventListener('pointermove', e => {
      if (!dragging) return;
      const dy = startY - e.clientY;
      const range = f.max - f.min;
      const trackH = trackEl.clientHeight;
      f.value = Math.max(f.min, Math.min(f.max,
        startValue + (dy / Math.max(1, trackH)) * range));
      setParam(f.tag, f.value);
      positionThumb(thumbEl, readoutEl, f, trackEl);
    });

    const endDrag = () => { dragging = false; };
    trackEl.addEventListener('pointerup',     endDrag);
    trackEl.addEventListener('pointercancel', endDrag);
  });

  function positionThumb(thumbEl, readoutEl, f, trackEl) {
    const trackH = trackEl.clientHeight;
    const thumbH = thumbEl.offsetHeight || 9;
    const norm   = (f.value - f.min) / (f.max - f.min);
    thumbEl.style.top = `${(1 - norm) * Math.max(0, trackH - thumbH)}px`;
    readoutEl.textContent = f.value.toFixed(f.decimals);
  }

  function positionAllThumbs() {
    FADER_DEFS.forEach((f, i) => {
      const trackEl = thumbEls[i].parentElement;
      positionThumb(thumbEls[i], readoutEls[i], f, trackEl);
    });
  }

  // Position after layout is ready
  requestAnimationFrame(() => requestAnimationFrame(positionAllThumbs));
  window.addEventListener('resize', positionAllThumbs);

  // ── Accelerometer ───────────────────────────────────────────
  if (typeof window.DeviceMotionEvent !== 'undefined') {
    const WIN = 50;
    const logW = Array.from({ length: WIN }, (_, i) => Math.log(i + 2));
    const hist = { x: [], y: [], z: [] };

    function smooth(arr, v) {
      arr.push(v);
      if (arr.length > WIN) arr.shift();
      const off = WIN - arr.length;
      let s = 0, w = 0;
      arr.forEach((val, i) => { const ww = logW[off + i]; s += val * ww; w += ww; });
      return w > 0 ? s / w : v;
    }

    window.addEventListener('devicemotion', e => {
      const a = e.accelerationIncludingGravity || {};
      const x = smooth(hist.x, typeof a.x === 'number' ? a.x : 0);
      const y = smooth(hist.y, typeof a.y === 'number' ? a.y : 0);
      const z = smooth(hist.z, typeof a.z === 'number' ? a.z : 0);
      sendMsg('accelerometer', [x, y, z]);
    });
  } else {
    sendMsg('accelerometer', [0, 0, 0]);
  }

  // ── Transport ───────────────────────────────────────────────
  let isRunning = true;
  sendMsg('start', [1]);

  const btnStartStop = document.getElementById('btn-start-stop');
  if (btnStartStop) {
    btnStartStop.addEventListener('click', () => {
      isRunning = !isRunning;
      sendMsg('start', [isRunning ? 1 : 0]);
      btnStartStop.textContent = isRunning ? 'STOP' : 'START';
      btnStartStop.classList.toggle('active', isRunning);
    });
  }

  const btnTrig = document.getElementById('btn-trig');
  if (btnTrig) {
    btnTrig.addEventListener('click', () => sendMsg('trig', [1]));
  }

  startOscilloscope(analyser);
}

// ── Enter overlay ────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const enterButton  = document.getElementById('enter-button');
  const enterOverlay = document.getElementById('enter-overlay');
  const enterText    = document.getElementById('enter-text');

  if (enterText) {
    ['NO—INPUT INSTRUMENT FOR SMARTPHONE',
     'Drag the faders to shape the feedback.',
     'Turn up the volume. Tap TRIG to trigger.']
    .forEach(line => {
      const p = document.createElement('p');
      const em = document.createElement('em');
      em.textContent = line;
      p.appendChild(em);
      enterText.appendChild(p);
    });
  }

  if (enterButton) {
    enterButton.onclick = async () => {
      enterOverlay.style.display = 'none';
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      await ctx.resume();
      await main(ctx);
    };
  }
});

// ── RNBO loader ──────────────────────────────────────────────
function loadRNBOScript(version) {
  return new Promise((resolve, reject) => {
    if (/^\d+\.\d+\.\d+-dev$/.test(version)) {
      reject(new Error('Debug RNBO version — export a release build.'));
      return;
    }
    const localSrc = `assets/rnbo/${encodeURIComponent(version)}/rnbo.min.js`;
    const cdnSrc   = `https://c74-public.nyc3.digitaloceanspaces.com/rnbo/${encodeURIComponent(version)}/rnbo.min.js`;

    function appendScript(src, crossOrigin) {
      const el = document.createElement('script');
      if (crossOrigin) el.crossOrigin = 'anonymous';
      el.src = src;
      el.onload = () => resolve();
      el.onerror = () => {
        if (src === localSrc) {
          console.warn('Local RNBO not found, falling back to CDN');
          appendScript(cdnSrc, true);
        } else {
          reject(new Error('Failed to load rnbo.js v' + version));
        }
      };
      document.body.append(el);
    }

    appendScript(localSrc, false);
  });
}

// ── Oscilloscope ─────────────────────────────────────────────
function startOscilloscope(analyser) {
  if (!analyser || oscilloscopeStarted) return;
  const canvas = document.getElementById('oscilloscope');
  if (!canvas) { requestAnimationFrame(() => startOscilloscope(analyser)); return; }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  oscilloscopeStarted = true;

  const bufferLength = analyser.fftSize;
  const dataArray    = new Uint8Array(bufferLength);

  // Keep canvas buffer matching its CSS size
  const ro = new ResizeObserver(([entry]) => {
    canvas.width  = Math.floor(entry.contentRect.width)  || 320;
    canvas.height = Math.floor(entry.contentRect.height) || 70;
  });
  ro.observe(canvas.parentElement);

  const draw = () => {
    const w = canvas.width, h = canvas.height;
    analyser.getByteTimeDomainData(dataArray);

    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(244,244,244,0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2);
    ctx.stroke();

    ctx.strokeStyle = '#f4f4f4';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const sliceW = w / bufferLength;
    let x = 0;
    for (let i = 0; i < bufferLength; i++) {
      const y = (dataArray[i] / 128) * (h / 2);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      x += sliceW;
    }
    ctx.stroke();
    requestAnimationFrame(draw);
  };

  draw();
}
