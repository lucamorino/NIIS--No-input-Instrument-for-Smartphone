import '@soundworks/helpers/polyfills.js';
import { Client } from '@soundworks/core/client.js';
import { loadConfig, launcher } from '@soundworks/helpers/browser.js';
import { html, render } from 'lit';
import '@ircam/sc-components';
//import devicemotion from '@ircam/devicemotion';

import "../lib/guardrails.js";

import { Scheduler } from '@ircam/sc-scheduling'; 
import loadAudioBuffer from '../lib/load-audio-buffer.js';
import LoopSampler from '../lib/LoopSampler.js';

import pluginPlatformInit from '@soundworks/plugin-platform-init/client.js'; 
import pluginSync from '@soundworks/plugin-sync/client.js'; 
import pluginCheckin from '@soundworks/plugin-checkin/client.js'; 
//import { start } from 'repl';
//import { send } from 'process';

//import FeedbackDelay from '../lib/FeedbackDelay.js';

// - General documentation: https://soundworks.dev/
// - API documentation:     https://soundworks.dev/api
// - Issue Tracker:         https://github.com/collective-soundworks/soundworks/issues
// - Wizard & Tools:        `npx soundworks`

/**
 * Attempts to request full-screen mode for the document.
 * Logs a warning if the API is not supported or if the request fails.
 */


let oscilloscopeStarted = false;
let backgroundRAF = null;
let backgroundState = { mode: 'idle', gain: 0, color: 'black' };
//let currentHarsh = 0;
//let currentPenalty = 0;

// Create the device
async function main($container) {
  
  const config = loadConfig();
  const client = new Client(config);
  const audioContext = new AudioContext();
  console.log(audioContext.sampleRate);
 
  client.pluginManager.register('checkin', pluginCheckin);
  client.pluginManager.register('platform-init', pluginPlatformInit, { 
    audioContext, //devicemotion
    /* onActivate: (plugin) => {
      // tryEnterFullscreen now returns a Promise
      return tryEnterFullscreen();
    } */
  }); 
  client.pluginManager.register('sync', pluginSync, {
    getTimeFunction: () => audioContext.currentTime, 
  }, ['platform-init']); 

  // cf. https://soundworks.dev/tools/helpers.html#browserlauncher
  launcher.register(client, { initScreensContainer: $container });

  await client.start();

  const platformInit = await client.pluginManager.get('platform-init');


  // Attempt to enter full-screen mode automatically after initial user gesture
  //tryEnterFullscreen();

  // retrieve initialized sync plugin 
  const sync = await client.pluginManager.get('sync'); 
  const scheduler = new Scheduler(() => sync.getSyncTime(), { 
    currentTimeToProcessorTimeFunction: syncTime => sync.getLocalTime(syncTime), 
  });

  const checkin = await client.pluginManager.get('checkin');
  const index = checkin.getIndex();
  //const instr = checkin.getData();
  const global = await client.stateManager.attach('global');
  const user = await client.stateManager.create('user');
  const control = await client.stateManager.create('control');

  user.set({id: index});
  control.set({id: index});

  // Create gain node and connect it to audio output
  const outputNode = audioContext.createGain();
  outputNode.connect(audioContext.destination);

  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.3;
  analyser.connect(outputNode)
  const baseColor = '#000000';

  const humGain = audioContext.createGain();
  humGain.gain.value = 0.2;
  humGain.connect(outputNode);


  const humSample = './assets/samples/hum.wav';
  const humBuffer = await loadAudioBuffer(humSample, audioContext.sampleRate);
  const volume = 0.2;
  const startTime = sync.getLocalTime() + 0.5; // 1 second in the future
  const isRunning = global.get('running');

  const humLoop = new LoopSampler(audioContext, humBuffer, volume, startTime);
  humLoop.output.connect(humGain);

  function playerLoop(startTime, isRunning) {
    if (!isRunning && !scheduler.has(humLoop.play)) {
        scheduler.add(humLoop.play, startTime);
        //console.log('adding scheduler');
      } else if (!isRunning && scheduler.has(humLoop.play)) {
        scheduler.remove(humLoop.play);
        humLoop.stop(startTime);
        scheduler.add(humLoop.play, startTime+0.5);
        //console.log('reset scheduler');
      } else if (isRunning && scheduler.has(humLoop.play)) { 
        scheduler.remove(humLoop.play);
        humLoop.stop(startTime);
      }
  };

  playerLoop(startTime, isRunning);


  const patchExportURL = "assets/rnbo_export/patch.export.json";
  let response, patcher;
  try {
      response = await fetch(patchExportURL);
      patcher = await response.json();
  
      if (!window.RNBO) {
          // Load RNBO script dynamically
          await loadRNBOScript(patcher.desc.meta.rnboversion);
      }
  } catch (err) {
      // Your existing error handling logic here...
      console.error("Failed to load patcher or RNBO script:", err);
      return;
  }

  let presets = patcher.presets || [];
  if (presets.length < 1) {
      console.log("No presets defined");
  } else {
      console.log(`Found ${presets.length} presets`);
  }


  let device;
  console.log("Attempting to create RNBO device...");
  console.log("audioContext:", audioContext);
  console.log("patcher:", patcher);
  
  try {
      // RNBO is loaded into the window object, so we use RNBO.createDevice()
      // Also, the audio context variable is `audioContext`, not `context`
      device = await RNBO.createDevice({ context: audioContext, patcher });
  } catch (err) {
      // Your existing error handling logic here...
      console.error("Failed to create RNBO device:", err);
      return;
  }
  //console.log("device:", device)

  const hitSampleFiles = [
    'drakqs-NS-A#5-ff-75.wav',
    'drakqs-NS-A#5-pp-826.wav',
    'drakqs-NS-A#6-pp-206.wav',
    'drakqs-NS-A#7-ff-1039.wav',
    'drakqs-NS-A6-ff-1025.wav',
    'drakqs-NS-A6-ff-663.wav',
    'drakqs-NS-A7-ff-518.wav',
    'drakqs-NS-B5-f-654.wav',
    'drakqs-NS-B6-f-1225.wav',
    'drakqs-NS-B7-pp-721.wav',
  ];
  const hitBufferDependencies = hitSampleFiles.map((filename, index) => ({
    id: `samples.${index + 1}`,
    file: `./assets/samples/hit/${encodeURIComponent(filename)}`,
  }));

  try {
    if (typeof device.loadDataBufferDependencies === 'function') {
      const results = await device.loadDataBufferDependencies(hitBufferDependencies);
      const failed = results.filter((entry) => entry.type !== 'success');
      if (failed.length > 0) {
        console.warn('Some hit buffers failed to load:', failed);
      }
    } else {
      for (const dependency of hitBufferDependencies) {
        const buffer = await loadAudioBuffer(dependency.file, audioContext.sampleRate);
        await device.setDataBuffer(dependency.id, buffer);
      }
    }
  } catch (err) {
    console.error('Failed to load hit sample buffers:', err);
  }

  // Connect the device to the web audio graph
  device.node.connect(analyser);

  const inports = getInports(device);
  console.log("Inports:")
  console.log(inports);
  function stopBackground() {
    if (backgroundRAF) {
      cancelAnimationFrame(backgroundRAF);
      backgroundRAF = null;
    }
    backgroundState = { mode: 'idle', gain: 0, color: 'black' };
    document.body.style.background = baseColor;
    document.body.style.backgroundColor = baseColor;
  }

  function startBackgroundLoop() {
    if (backgroundRAF) return;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const render = () => {
      const { mode, gain, color } = backgroundState;
      let brightness = 0;

      if (gain > 0 && mode !== 'idle') {
        analyser.getByteTimeDomainData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += Math.abs(dataArray[i] - 128);
        }
        const amplitude = sum / bufferLength;
        brightness = Math.min(255, Math.floor((amplitude / 128) * 255 * gain));
        if (mode === 'penalty') brightness = Math.min(255, brightness + 30);
        if (mode === 'harsh') brightness = Math.max(20, brightness);
      }

      if (mode === 'penalty' && color === 'red') {
        const val = `rgba(255, ${brightness}, ${brightness}, 1)`;
        document.body.style.background = val;
        document.body.style.backgroundColor = val;
      } else if (mode === 'harsh') {
        const val = `rgb(${brightness}, ${brightness}, ${brightness})`;
        document.body.style.background = val;
        document.body.style.backgroundColor = val;
      } else {
        document.body.style.background = baseColor;
        document.body.style.backgroundColor = baseColor;
      }

      if (backgroundState.mode === 'idle') {
        stopBackground();
        return;
      }

      backgroundRAF = requestAnimationFrame(render);
    };

    backgroundRAF = requestAnimationFrame(render);
  }

  function applyBackgroundMode(harshness, penalty) {
    if (harshness > 0) {
      backgroundState = { mode: 'harsh', gain: 0.8, color: 'white' };
    } else if (penalty > 0) {
      backgroundState = { mode: 'penalty', gain: 0.4, color: 'red' };
    } else {
      backgroundState = { mode: 'idle', gain: 0, color: 'black' };
    }

    if (backgroundState.mode === 'idle') {
      stopBackground();
    } else {
      startBackgroundLoop();
    }
  }

  // initial goal message
  const goal = user.get('goal');
  console.log('Initial goal:', goal);
  sendMessageToInport(device, 'goal', goal);

  // Penalty counter state
  let penaltyCounter = 10.0;
  let penaltyInterval = null;
  let setGameoverOverlay = () => {};

  function updatePenaltyDisplay() {
    const el = document.getElementById('penalty-counter-value');
    const fill = document.getElementById('life-fill');
    const pct = Math.max(0, Math.min(100, (penaltyCounter / 10) * 100));
    if (el) el.textContent = penaltyCounter.toFixed(1);
    if (fill) fill.style.width = `${pct}%`;
  }

  function updateHarshnessDisplay(value) {
    const el = document.getElementById('harshness-value');
    if (!el) return;
    const v = Number(value);
    el.textContent = Number.isFinite(v) ? v.toFixed(2) : '0.00';
  }
  
  function updateEnergyDisplay(energyValue) {
    const el = document.getElementById('energy-counter-value');
    const fill = document.getElementById('energy-fill');
    const normalized = Math.max(0, Math.min(1, energyValue));
    if (el) el.textContent = normalized.toFixed(2);
    if (fill) fill.style.width = `${normalized * 100}%`;
  }

  const vibrationPattern = [140, 80, 140];
  const vibrationRepeatMs = 600;
  let vibrationInterval = null;

  function canVibrate() {
    return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
    console.warn('Vibration API not supported in this environment');
  }

  function startVibration() {
    if (!canVibrate() || vibrationInterval) return;
    navigator.vibrate(vibrationPattern);
    vibrationInterval = setInterval(() => {
      navigator.vibrate(vibrationPattern);
    }, vibrationRepeatMs);
  }

  function stopVibration() {
    if (!canVibrate()) return;
    if (vibrationInterval) {
      clearInterval(vibrationInterval);
      vibrationInterval = null;
    }
    navigator.vibrate(0);
  }

  function startPenaltyCounter() {
    if (penaltyInterval) return; // already running
    // ensure display shows current counter
    updatePenaltyDisplay();
    penaltyInterval = setInterval(() => {
      penaltyCounter = Math.max(0, +(penaltyCounter - 0.1).toFixed(1));
      updatePenaltyDisplay();
      if (penaltyCounter <= 0) {
        clearInterval(penaltyInterval);
        penaltyInterval = null;
        user.set({ life: false });
        console.log('you loose :(');
        sendMessageToInport(device, 'start', 0);
      }
    }, 200);
  }

  function stopPenaltyCounter(reset = true) {
    if (penaltyInterval) {
      clearInterval(penaltyInterval);
      penaltyInterval = null;
    }
    if (reset) {
      penaltyCounter = 10.0;
      updatePenaltyDisplay();
    }
  }

  // Listen for messages from RNBO device
  device.messageEvent.subscribe((ev) => {
    /* if (ev.tag === "out5") {
      const zone = ev.payload;
      console.log(`Received message ${ev.tag}: ${ev.payload}`);
      user.set({zone: zone});// store in user state
    } */
    if (ev.tag === "out2") {
      const harshness = ev.payload; // first value in the message
      const penalty = global.get('penalty');
      console.log(`Received message ${ev.tag}: ${harshness}`);
      user.set({harsh: harshness});// store in user state
      if (harshness > 0) {
        const countPenalty = penalty + 1;
        console.log('Increasing penalty to', countPenalty);
        global.set({penalty: countPenalty});
        applyBackgroundMode(harshness, countPenalty);
      } else if (harshness == 0 && penalty > 1) {
        const countPenalty = penalty - 1;
        global.set({penalty: countPenalty});
        applyBackgroundMode(harshness, countPenalty);
      } else if (harshness == 0 && penalty <= 1) {
        const countPenalty = 0;
        global.set({penalty: countPenalty});
        applyBackgroundMode(harshness, countPenalty);
      }
    }
    if (ev.tag === "out3") {
      const violence = ev.payload;
      updateHarshnessDisplay(violence);
      //console.log(`Received message ${ev.tag}: ${ev.payload}`); 
    }
    if (ev.tag === "out4") {
      const energy = ev.payload;
      updateEnergyDisplay(energy);
      //console.log(`Received message ${ev.tag}: ${ev.payload}`);
      //user.set({energy: energy});// store in user state
    }
    if (ev.tag === "out5") {
      const style = ev.payload;
      console.log('Style received:', style);
      user.set({style: style});
      control.set({del: style[0]}); // trigger update
      control.set({phase: style[1]});
      control.set({bp: style[2]});
    }
  });

  global.onUpdate(updates => {
    if ('running' in updates) {
      const isRunning = updates['running'];
      const enterOverlay = document.getElementById("enter-overlay");
      const gameOverOverlay = document.getElementById('gameover-overlay');
      const startTime = sync.getLocalTime() + 0.5; // 1 second in the future

      if (isRunning) {
        user.set({ life: true });
        console.log('you live!');
        enterOverlay.style.display = "none";
        gameOverOverlay.style.display = "none";
      } else { 
        stopPenaltyCounter(true);
        gameOverOverlay.style.display = "flex";
      }
      console.log('Running state updated:', isRunning);
      playerLoop(startTime, isRunning);
      //sendMessageToInport(device, 'start', isRunning ? [1] : [0]);
    }
    if ('penalty' in updates) {
      const penalty = updates['penalty'];
      const harshness = user.get('harsh');
      // start/stop penalty countdown
      if (penalty > 0 && harshness == 0) {
        sendMessageToInport(device, 'penalty', penalty);
        startPenaltyCounter();
      } else {
        sendMessageToInport(device, 'penalty', 0);
        stopPenaltyCounter(false);
      }
      applyBackgroundMode(harshness, penalty);
    }
    if ('hrsh_threshold' in updates) {
      const param = getParameter(device, "hrsh_threshold");
      console.log('Updating hrsh_threshold to', updates['hrsh_threshold']);
      param.value = updates['hrsh_threshold'];
    }
  }); 

  user.onUpdate(updates => {
    if ('harsh' in updates) {
      const harshness = Number(updates['harsh'] ?? 0);
      if (harshness > 0) {
        startVibration();
      } else {
        stopVibration();
      }
    }
    if ('goal' in updates) {
      const newGoal = updates['goal'];
      //console.log('Goal updated:', newGoal);
      sendMessageToInport(device, 'goal', newGoal);
    }
    if ('preset' in updates) {
      const newPreset = updates['preset'];
      console.log('Preset updated:', newPreset);
      loadPresetAtIndex(device, presets, newPreset);
    }
    if ('life' in updates) {
      const isAlive = updates['life'];
      setGameoverOverlay(!isAlive);
    }
    if ('LFO' in updates) {
      sendMessageToInport(device, 'LFO', updates['LFO']);
      console.log('Updating LFO to', updates['LFO']);
    }
    if ('del' in updates) {
      const param = getParameter(device, "del");
      console.log('Updating del to', updates['del']);
      param.value = updates['del'];
    }
    if ('phase' in updates) {
      const param = getParameter(device, "phase");
      console.log('Updating phase to', updates['phase']);
      param.value = updates['phase'];
    }
    if ('bp' in updates) {
      const param = getParameter(device, "bp");
      console.log('Updating bp to', updates['bp']);
      param.value = updates['bp'];
    }
    if ('fb_gain' in updates) {
      const param = getParameter(device, "fb_gain");
      console.log('Updating fb_gain to', updates['fb_gain']);
      param.value = updates['fb_gain'];
    }
    if ('fb_trim' in updates) {
      const param = getParameter(device, "fb_trim");
      console.log('Updating fb_trim to', updates['fb_trim']);
      param.value = updates['fb_trim'];
    }
  });


  // -------------------------------------------------------------------
  // RENDER FUNCTION AND GRID SETUP
  // -------------------------------------------------------------------
  function renderApp() {
    render(html`
      <div id="app-root" class="centered-app">

        <div id="enter-overlay">
            <div id="enter-content">
              <div id="enter-text"></div>
              <div class="spacer"></div>
              <div class="spacer"></div>
              <button id="enter-button" type="button"> >>> </button>
            </div>
        </div>

        <div id="gameover-overlay">
          <div id="gameover-content">G4M3 0V3R</div>
        </div>

        <div class="ui-frame">
        <section class="panel">
          <section class="panel panel-top">
            <div class="panel-inner">
              <div class="oscillo-row">
                <div id="oscilloscope-container" class="control-frame controls">
                  <canvas id="oscilloscope" width="320" height="70"></canvas>
                </div>
                <!-- <div class="lfo-badge">LFO</div> -->
              </div>

              <div class="meter-group">
                <div class="metrics-meter">
                  <div id="penalty-counter" class="metric-box">
                    <div class="metric-label">LIFE</div>
                    <div class="metric-value" id="penalty-counter-value">10.0</div>
                  </div>
                  <div id="harshness-counter" class="metric-box">
                    <div class="metric-label">HARSHNESS</div>
                    <div class="metric-value" id="harshness-value">0.00</div>
                  </div>
                </div>

                <div id="energy-counter" class="meter-row energy-meter">
                  <div class="meter-label">ENERGY</div>
                  <div class="energy-bar" min=0 max=1 step=0.01>
                    <div id="energy-fill"></div>
                  </div>
                  <div class="energy-value" id="energy-counter-value">0.80</div>
                </div>
              </div>
            </div>
          </section>

          <section class="panel panel-bottom">
            <div class="panel-inner">
              <div class="control-grid">
                <div id="xy-pad-container" class="control-frame controls pad-frame">
                  <canvas id="xy-pad" width="320" height="320"></canvas>
                </div>
              </div>

              <div id="touch-debug" class="debug-box">[--, --, --]</div>

               <section class="panel panel-presets"> 
              <div class="preset-row-up">
                  <button class="preset-btn" type="button" data-preset="0">P1</button>
                  <button class="preset-btn" type="button" data-preset="1">P2</button>
                  <button class="preset-btn" type="button" data-preset="2">P3</button>
                  <button class="preset-btn" type="button" data-preset="3">P4</button>
                </div>
                <div class="preset-row-bottom">
                  <button class="preset-btn" type="button" data-preset="4">P5</button>
                  <button class="preset-btn" type="button" data-preset="5">P6</button>
                  <button class="preset-btn" type="button" data-preset="6">P7</button>
                  <button class="preset-btn" type="button" data-preset="7">P8</button>
                </div> 
                </section>

              <div id="xy-slider-container" class="control-frame controls slider-frame">
                <input id="xy-slider" type="range" min="0" max="100" value="0" />
              </div>
            
              </div>
          <!-- </section>
          <section class="panel panel-presets"> -->
              
              </section>
            </section>
        </div>

      </div>
    `, $container);
    }
    renderApp();
    //setupStartStop(device, audioContext);
    setGameoverOverlay = (visible) => {
      const overlay = document.getElementById('gameover-overlay');
      if (overlay) overlay.style.display = visible ? 'flex' : 'none';
    };
    setGameoverOverlay(false);
    setupUI(device, control, user, presets);
    startOscilloscope(analyser);
  }

// load RNBO script dynamically
function loadRNBOScript(version) {
  return new Promise((resolve, reject) => {
    if (/^\d+\.\d+\.\d+-dev$/.test(version)) {
      throw new Error("Patcher exported with a Debug Version! Please specify the correct RNBO version to use in the code.");
    }

    // Try same-origin local copy first to avoid COEP/CORS issues.
    const localSrc = `assets/rnbo/${encodeURIComponent(version)}/rnbo.min.js`;
    const cdnSrc = `https://c74-public.nyc3.digitaloceanspaces.com/rnbo/${encodeURIComponent(version)}/rnbo.min.js`;

    function appendScript(src, useCrossOrigin) {
      const el = document.createElement('script');
      if (useCrossOrigin) {
        // when requesting cross-origin script, set crossorigin so proper CORS flow
        // can occur if the CDN returns Access-Control-Allow-Origin.
        el.crossOrigin = 'anonymous';
      }
      el.src = src;
      el.onload = () => resolve();
      el.onerror = (err) => {
        // If the local copy failed, try the CDN as a fallback. If CDN fails too, reject.
        if (src === localSrc) {
          console.warn(`Local RNBO not found at ${localSrc}, falling back to CDN`);
          // try CDN (may still be blocked by COEP if the CDN doesn't provide proper headers)
          appendScript(cdnSrc, true);
        } else {
          console.error(err);
          reject(new Error("Failed to load rnbo.js v" + version));
        }
      };
      document.body.append(el);
    }

    appendScript(localSrc, false);
  });
}
// helper functions
function getInports(device) {
  const messages = device.messages;
  const inports = messages.filter(
    (message) => message.type === RNBO.MessagePortType.Inport
  );
  return inports;
}
function getParameters(device) {
  const parameters = device.parameters;
  return parameters;
}
function getParameter(device, parameterName) {
  const parameters = device.parameters;
  const parameter = parameters.find((param) => param.name === parameterName);
  return parameter;
}
function loadPresetAtIndex(device, presets, index) {
    const preset = presets[index];
    console.log(`Loading preset ${preset.name}`);
    device.setPreset(preset.preset);
}
function sendMessageToInport(device, inportTag, values) {
  //Turn the text into a list of numbers (RNBO messages must be numbers, not text)
  //const messsageValues = values.split(/\s+/).map((s) => parseFloat(s));

  // Send the message event to the RNBO device
  let messageEvent = new RNBO.MessageEvent(
    RNBO.TimeNow,
    inportTag,
    values
  );
  device.scheduleEvent(messageEvent);
}

function startOscilloscope(analyser) {
  if (!analyser || oscilloscopeStarted) return;
  const canvas = document.getElementById('oscilloscope');
  if (!canvas) {
    // retry once the UI is rendered
    requestAnimationFrame(() => startOscilloscope(analyser));
    return;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  oscilloscopeStarted = true;

  // ensure consistent pixel size in case CSS resizes the canvas
  const width = canvas.width;
  const height = canvas.height;
  const bufferLength = analyser.fftSize;
  const dataArray = new Uint8Array(bufferLength);

  const draw = () => {
    analyser.getByteTimeDomainData(dataArray);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(0, 0, width, height);

    // midline for reference
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();

    ctx.lineWidth = 1;
    ctx.strokeStyle = '#f4f4f4';
    ctx.beginPath();

    const sliceWidth = width / bufferLength;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
      const v = dataArray[i] / 128.0; // 128 is midline
      const y = (v * height) / 2;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }

      x += sliceWidth;
    }

    ctx.stroke();
    requestAnimationFrame(draw);
  };

  draw();
}

function setupUI(device, control, user, presets) {
    // Get all UI elements we need
    const canvas = document.getElementById('xy-pad');
    const ctx = canvas.getContext('2d');
    const slider = document.getElementById('xy-slider');
    const sliderValue = document.getElementById('xy-slider-value');
    const touchDebug = document.getElementById('touch-debug');
    const presetButtons = document.querySelectorAll('.preset-btn');
    //const waveButtons = document.querySelectorAll('.wave-btn');
    //const randomizeButton = document.getElementById('randomize-button');
    const accentColor = getComputedStyle(document.documentElement)
      .getPropertyValue('--sw-accent-color').trim() || '#ff44b4';

    const updateControlPosition = (x, y, z) => {
      if (control) control.set({ X: x, Y: y, Z: z });
    };

    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const toPercent = (value) => Math.round((value / padSize) * 100);
    const zoomFromZ = (z) => 1 + (clamp(z, 0, 100) / 100) * 3;
    const sliderMaxValue = Number(slider?.max ?? 100) || 100;
    let sliderWasAtMax = Number(slider?.value || 0) >= sliderMaxValue;
    const triggerLfoOnSliderMax = (value) => {
      const isAtMax = Number(value) >= sliderMaxValue;
      if (isAtMax && !sliderWasAtMax) {
        sendMessageToInport(device, 'LFO', 1);
        console.log('Slider reached max, triggering LFO');
      }
      sliderWasAtMax = isAtMax;
    };
    const emitTouch = (mapped, z, reason) => {
        updateControlPosition(mapped.touchX, mapped.touchY, z);
        sendMessageToInport(device, 'touch', [mapped.touchX, mapped.touchY, z]);
        if (touchDebug) touchDebug.textContent = `[${mapped.touchX}, ${mapped.touchY}, ${z}]`;
    };

    // --- Multitouch: Use pointer events for pad and slider ---
    // Setup slider event handling
    if (slider) {
      slider.addEventListener('input', (e) => {
        const v = Number(e.target.value);
        const focusX = focusPoint.x;
        const focusY = focusPoint.y;

        if (sliderValue) sliderValue.textContent = String(v);
        triggerLfoOnSliderMax(v);

        const mapped = mapToOutput(lastRaw.x, lastRaw.y, focusX, focusY);
        focusPoint.x = mapped.zoomedX;
        focusPoint.y = mapped.zoomedY;

        zoomFactor = zoomFromZ(v);
        console.log('Zoom factor:', zoomFactor);
        updateGridFocus();

        //const mapped = mapToOutput(lastRaw.x, lastRaw.y, focusPoint.x, focusPoint.y);
        //emitTouch(mapped, v, 'slider');
      });
    }

    if (presetButtons && presetButtons.length) {
      presetButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
          const presetIndex = Number(btn.dataset.preset || 0);
          if (!Array.isArray(presets) || presets.length <= presetIndex) {
            console.warn('Preset index out of range:', presetIndex);
            return;
          }
          if (user?.set) {
            user.set({ preset: presetIndex });
          } else {
            loadPresetAtIndex(device, presets, presetIndex);
          }
        });
      });
    }

    // Setup pad
    const padSize = canvas.width;
    const dotRadius = 10;
    let dotX = padSize / 2 + Math.random() * 200 - 100;
    let dotY = padSize / 2 + Math.random() * 200 - 100;
    let dragging = false;
    let startActive = false;
    let targetPoint = Array.isArray(user?.get?.('goal')) ? user.get('goal') : [50, 50];
    let showTarget = false;
    let focusPoint = { x: dotX, y: dotY };
    let lastRaw = { x: dotX, y: dotY };
    let lastMapped = { x: dotX, y: dotY };
    let zoomFactor = zoomFromZ(Number(slider?.value || 50));
    let zoomResetRAF = null;
    let focusLerpRAF = null;
    const baseGridSize = 32;

    // --- Pad: Use pointer events for multitouch ---
    // padSize, dotRadius, dotX, dotY, dragging now declared only once (see pointer events section below)
    let activePointerId = null;

    function getXY(e) {
        const rect = canvas.getBoundingClientRect();
        let clientX;
        let clientY;

        if (e.touches && e.touches.length > 0) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else if (e.clientX !== undefined && e.clientY !== undefined) {
            clientX = e.clientX;
            clientY = e.clientY;
        } else {
            return { x: dotX, y: dotY };
        }

        // Convert from CSS pixels to canvas coordinates to avoid drift when
        // canvas is displayed at a different size than its internal buffer.
        const scaleX = rect.width > 0 ? canvas.width / rect.width : 1;
        const scaleY = rect.height > 0 ? canvas.height / rect.height : 1;
        let x = (clientX - rect.left) * scaleX;
        let y = (clientY - rect.top) * scaleY;
        
        x = Math.max(dotRadius, Math.min(padSize - dotRadius, x));
        y = Math.max(dotRadius, Math.min(padSize - dotRadius, y));
        return { x, y };
    }

    function getTargetCoords() {
        const gx = Number(targetPoint?.[0] ?? 50);
        const gy = Number(targetPoint?.[1] ?? 50);
        const tx = Math.max(0, Math.min(100, gx));
        const ty = Math.max(0, Math.min(100, gy));
        return {
          x: (tx / 100) * padSize,
          y: (ty / 100) * padSize,
        };
    }

    function updateGridFocus() {
        if (!canvas) return;
        const grid = baseGridSize * zoomFactor;
        const zoomedFocusX = focusPoint.x;
        const zoomedFocusY = focusPoint.y;
        const offsetX = ((zoomedFocusX % grid) + grid) % grid;
        const offsetY = ((zoomedFocusY % grid) + grid) % grid;
        canvas.style.backgroundSize = `${grid}px ${grid}px`;
        canvas.style.backgroundPosition = `${offsetX}px ${offsetY}px`;
    }

    function cancelZoomReset() {
        if (zoomResetRAF) {
          cancelAnimationFrame(zoomResetRAF);
          zoomResetRAF = null;
        }
    }

    function cancelFocusLerp() {
        if (focusLerpRAF) {
          cancelAnimationFrame(focusLerpRAF);
          focusLerpRAF = null;
        }
    }

    function animateFocusToLastRaw(durationMs = 200) {
        cancelFocusLerp();
        const start = performance.now();
        const startX = focusPoint.x;
        const startY = focusPoint.y;
        const targetX = lastRaw.x;
        const targetY = lastRaw.y;

        const step = (now) => {
          const t = Math.min(1, (now - start) / durationMs);
          focusPoint.x = startX + (targetX - startX) * t;
          focusPoint.y = startY + (targetY - startY) * t;
          updateGridFocus();
          if (t < 1) {
            focusLerpRAF = requestAnimationFrame(step);
          } else {
            focusLerpRAF = null;
          }
        };

        focusLerpRAF = requestAnimationFrame(step);
    }

    function animateZoomToZero(durationMs = 1000) {
        if (!slider) return;
        cancelZoomReset();
        const start = performance.now();
        const fromVal = Number(slider.value || 0);
        const toVal = 0;

        const step = (now) => {
          const t = Math.min(1, (now - start) / durationMs);
          const v = Math.round(fromVal + (toVal - fromVal) * t);
          slider.value = String(v);
          if (sliderValue) sliderValue.textContent = String(v);
          triggerLfoOnSliderMax(v);

          zoomFactor = zoomFromZ(v);
          updateGridFocus();

          const mapped = mapToOutput(lastRaw.x, lastRaw.y, focusPoint.x, focusPoint.y);
          emitTouch(mapped, v, 'zoom-reset');

          if (t < 1) {
            zoomResetRAF = requestAnimationFrame(step);
          } else {
            zoomResetRAF = null;
          }
        };

        zoomResetRAF = requestAnimationFrame(step);
    }

    /* function updateFocusFromPointer(rawX, rawY) {
        if (zoomFactor <= 1) {
          focusPoint = { x: rawX, y: rawY };
          return;
        }
        const halfWindow = padSize / (2 * zoomFactor);
        const speed = 0.25;
        let nextX = focusPoint.x;
        let nextY = focusPoint.y;

        if (rawX > focusPoint.x + halfWindow) {
          nextX = focusPoint.x + (rawX - (focusPoint.x + halfWindow)) * speed;
        } else if (rawX < focusPoint.x - halfWindow) {
          nextX = focusPoint.x + (rawX - (focusPoint.x - halfWindow)) * speed;
        }

        if (rawY > focusPoint.y + halfWindow) {
          nextY = focusPoint.y + (rawY - (focusPoint.y + halfWindow)) * speed;
        } else if (rawY < focusPoint.y - halfWindow) {
          nextY = focusPoint.y + (rawY - (focusPoint.y - halfWindow)) * speed;
        }

        focusPoint = {
          x: clamp(nextX, halfWindow, padSize - halfWindow),
          y: clamp(nextY, halfWindow, padSize - halfWindow),
        };
    } */

    function mapToOutput(rawX, rawY, focusX, focusY) {
        const zoomedX = clamp(focusX+(rawX-focusX)/zoomFactor, Math.max(0, focusX - padSize/zoomFactor), Math.min(padSize, focusX + padSize/zoomFactor));
        const zoomedY = clamp(focusY+(rawY-focusY)/zoomFactor, Math.max(0, focusY - padSize/zoomFactor), Math.min(padSize, focusY + padSize/zoomFactor));
        return {
          zoomedX,
          zoomedY,
          touchX: toPercent(zoomedX),
          touchY: toPercent(zoomedY),
        };
    }

    function drawPad() {
        ctx.clearRect(0, 0, padSize, padSize);
        if (showTarget) {
          const target = getTargetCoords();
          ctx.save();
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(target.x, target.y, 8, 0, 2 * Math.PI);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(target.x - 12, target.y);
          ctx.lineTo(target.x + 12, target.y);
          ctx.moveTo(target.x, target.y - 12);
          ctx.lineTo(target.x, target.y + 12);
          ctx.stroke();
          ctx.restore();
        }
        ctx.beginPath();
        ctx.arc(dotX, dotY, dotRadius, 0, 2 * Math.PI);
        ctx.fillStyle = accentColor || '#ff44b4';
        ctx.fill();
        ctx.strokeStyle = '#000';
        ctx.stroke();
    }

    // Use pointer events for multitouch
    canvas.addEventListener('pointerdown', (e) => {
        if (activePointerId === null) {
            cancelZoomReset();
            activePointerId = e.pointerId;
            dragging = true;
            let { x, y } = getXY(e);
            dotX = x;
            dotY = y;
            focusPoint = { x: dotX, y: dotY };
            lastRaw = { x: dotX, y: dotY };
            //updateGridFocus();
            drawPad();
            const mapped = mapToOutput(dotX, dotY, focusPoint.x, focusPoint.y);
            lastMapped = mapped;
            const sliderVal = Number(slider?.value || 50);
            emitTouch(mapped, sliderVal, 'pointerdown');
            if (!startActive) {
              sendMessageToInport(device, 'randomize', [1]);
              sendMessageToInport(device, 'start', [1]);
              if (control) control.set({active: 1});
              startActive = true;
        }
      }
    });

    canvas.addEventListener('pointermove', (e) => {
        if (dragging && e.pointerId === activePointerId) {
            let { x, y } = getXY(e);
            dotX = x;
            dotY = y;
            lastRaw = { x: dotX, y: dotY };
            //focusPoint = { x: dotX, y: dotY };
            //updateFocusFromPointer(dotX, dotY);
            //updateGridFocus();
            drawPad();
            const mapped = mapToOutput(dotX, dotY, focusPoint.x, focusPoint.y);
            lastMapped = mapped;
            console.log('Pointer move mapped:', mapped);
            const sliderVal = Number(slider?.value || 50);
            emitTouch(mapped, sliderVal, 'pointermove');
        }
    });

    const handlePointerEnd = (e, reason) => {
        if (e.pointerId !== activePointerId) return;
        dragging = false;
        activePointerId = null;
        const mapped = mapToOutput(dotX, dotY, focusPoint.x, focusPoint.y);
        const sliderVal = Number(slider?.value || 50);
        emitTouch(mapped, sliderVal, reason);
        if (startActive) {
          sendMessageToInport(device, 'start', [0]);
          if (control) control.set({active: 0});
          startActive = false;
        }
        animateZoomToZero(1000);
    };

    canvas.addEventListener('pointerup', (e) => handlePointerEnd(e, 'pointerup'));
    canvas.addEventListener('pointerleave', (e) => handlePointerEnd(e, 'pointerleave'));
    canvas.addEventListener('pointercancel', (e) => handlePointerEnd(e, 'pointercancel'));
    canvas.addEventListener('pointerout', (e) => handlePointerEnd(e, 'pointerout'));

    if (user?.onUpdate) {
      user.onUpdate(updates => {
        if ('goal' in updates && Array.isArray(updates.goal)) {
          targetPoint = updates.goal;
          drawPad();
        }
      });
    }

    updateGridFocus();
    drawPad();

    /* if (randomizeButton) {
      randomizeButton.addEventListener('click', () => {
        try {
          const msg = new RNBO.MessageEvent(RNBO.TimeNow, 'randomize', [1]);
          device.scheduleEvent(msg);
          randomizeButton.classList.add('active');
          setTimeout(() => randomizeButton.classList.remove('active'), 120);
        } catch (err) {
          console.debug('Could not schedule randomize message', err);
        }
      });
    } */

    // Overlay text can be advanced as soon as UI is rendered (DOMContentLoaded may already have fired)
    const enterButton = document.getElementById("enter-button");
    const enterText = document.getElementById("enter-text");
    const enterTexts = [
      [
        'Welcome to B3-H4RSH!',
        'This a noise game, you have to harsh. ', 
        'The goal is to seek the harshest sound possible.',
        'Be careful: if another player harshes, you lose life points.',
        'Stay alive and be the last player still sounding to win.',
      ],
      [
        'Tap and hold the pad to generate the sound.',
        'Every time you tap, a new sound can come up.',
        'Drag around and move the slider to shape the noise',
        'Find the best point to harsh!',
      ],
      [
        'Turn up the volume on your device.',
        'Turn up the brightness of your screen.',
        'Wait for the game to start.',
        'Good luck and enjoy!',
      ],
    ];
    let enterTextIndex = 0;

    const renderEnterText = (index) => {
      if (!enterText) return;
      const lines = enterTexts[index] || [];
      const nodes = lines.map((line) => {
        const p = document.createElement('p');
        const em = document.createElement('em');
        em.textContent = line;
        p.appendChild(em);
        return p;
      });
      enterText.replaceChildren(...nodes);
      if (enterButton) {
        enterButton.style.display = index < enterTexts.length - 1 ? 'flex' : 'none';
      }
    };
    if (enterButton && enterText) {
      const enterOverlay = document.getElementById("enter-overlay");
      enterOverlay.style.display = "none";
      /* renderEnterText(enterTextIndex);
      enterButton.onclick = () => {
        enterTextIndex = Math.min(enterTextIndex + 1, enterTexts.length - 1);
        renderEnterText(enterTextIndex);
      }; */
    }
}

// The launcher allows to launch multiple clients in the same browser window
// e.g. `http://127.0.0.1:8000?emulate=10` to run 10 clients side-by-side
launcher.execute(main, {
  numClients: parseInt(new URLSearchParams(window.location.search).get('emulate') || '') || 1,
});
   
