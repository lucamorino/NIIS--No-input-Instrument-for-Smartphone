//console.log("app.js loaded");

async function setup(context) {
    const patchExportURL = "export/patch.export.json";

    // Create gain node and connect it to audio output
    const outputNode = context.createGain();
    outputNode.connect(context.destination);

    // Fetch the exported patcher
    let response, patcher;
    try {
        response = await fetch(patchExportURL);
        patcher = await response.json();
    
        if (!window.RNBO) {
            // Load RNBO script dynamically
            // Note that you can skip this by knowing the RNBO version of your patch
            // beforehand and just include it using a <script> tag
            await loadRNBOScript(patcher.desc.meta.rnboversion);
        }

    } catch (err) {
        const errorContext = {
            error: err
        };
        if (response && (response.status >= 300 || response.status < 200)) {
            errorContext.header = `Couldn't load patcher export bundle`,
            errorContext.description = `Check app.js to see what file it's trying to load. Currently it's` +
            ` trying to load "${patchExportURL}". If that doesn't` + 
            ` match the name of the file you exported from RNBO, modify` + 
            ` patchExportURL in app.js.`;
        }
        if (typeof guardrails === "function") {
            guardrails(errorContext);
        } else {
            throw err;
        }
        return;
    }

    // Create the device
    let device;
    try {
        device = await RNBO.createDevice({ context, patcher });
    } catch (err) {
        if (typeof guardrails === "function") {
            guardrails({ error: err });
        } else {
            throw err;
        }
        return;
    }
    // Connect the device to the web audio graph
    device.node.connect(outputNode);

    const inports = getInports(device);
    console.log("Inports:")
    console.log(inports);

    //setupStartStop(device, context);
    setupXYPad(device);

    /* document.body.onclick = () => {
        context.resume();
    } */

    // Skip if you're not using guardrails.js
    if (typeof guardrails === "function")
        guardrails();
}

function loadRNBOScript(version) {
    return new Promise((resolve, reject) => {
        if (/^\d+\.\d+\.\d+-dev$/.test(version)) {
            throw new Error("Patcher exported with a Debug Version!\nPlease specify the correct RNBO version to use in the code.");
        }
        const el = document.createElement("script");
        el.src = "https://c74-public.nyc3.digitaloceanspaces.com/rnbo/" + encodeURIComponent(version) + "/rnbo.min.js";
        el.onload = resolve;
        el.onerror = function(err) {
            console.log(err);
            reject(new Error("Failed to load rnbo.js v" + version));
        };
        document.body.append(el);
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
function sendMessageToInport(device, inportTag, values) {
  // Turn the text into a list of numbers (RNBO messages must be numbers, not text)
  const messsageValues = values.split(/\s+/).map((s) => parseFloat(s));

  // Send the message event to the RNBO device
  let messageEvent = new RNBO.MessageEvent(
    RNBO.TimeNow,
    inportTag,
    messsageValues
  );
  device.scheduleEvent(messageEvent);
}


// START AND STOP BUTTON
// This function sets up the start/stop button to toggle playback of the device

/* function setupStartStop(device) {  //(device, context) {
  const startButton = document.getElementById("start-button");
  let isPlaying = false;

  startButton.onclick = async () => {
    if (!isPlaying && context.state !== "running") {
      await context.resume();
      console.log("AudioContext resumed");
    }
    if (isPlaying && context.state === "running") {
      await context.suspend();
      console.log("AudioContext suspended");
    } 
    isPlaying = !isPlaying;
    startButton.textContent = isPlaying ? "STOP" : "PLAY";
    console.log(`Device is now ${isPlaying ? "playing" : "stopped"}`);

    const messageEvent = new RNBO.MessageEvent(
      RNBO.TimeNow,
      "start",
      isPlaying ? [1] : [0]
    );
    device.scheduleEvent(messageEvent);
  };
} */


// XY PAD
// This code creates a simple XY pad using a canvas element

function setupXYPad(device) {
    const canvas = document.getElementById('xy-pad');
    const ctx = canvas.getContext('2d');
    const padSize = canvas.width;
    const dotRadius = 12;
    let dotX = padSize / 2 + Math.random() * 200 - 100;
    let dotY = padSize / 2 + Math.random() * 200 - 100;
    let dragging = false;

    function drawPad() {
        ctx.clearRect(0, 0, padSize, padSize);
        ctx.beginPath();
        ctx.arc(dotX, dotY, dotRadius, 0, 2 * Math.PI);
        ctx.fillStyle = '#ffffffff';
        ctx.fill();
        ctx.strokeStyle = '#222';
        ctx.stroke();
    }

    function getXY(e) {
        let rect = canvas.getBoundingClientRect();
        let x, y;
        if (e.touches) {
            x = e.touches[0].clientX - rect.left;
            y = e.touches[0].clientY - rect.top;
        } else {
            x = e.clientX - rect.left;
            y = e.clientY - rect.top;
        }
        x = Math.max(dotRadius, Math.min(padSize - dotRadius, x));
        y = Math.max(dotRadius, Math.min(padSize - dotRadius, y));
        return { x, y };
    }

    canvas.addEventListener('mousedown', (e) => {
        dragging = true;
        let { x, y } = getXY(e);
        dotX = x;
        dotY = y;
        drawPad();
        // Send start=1
        const startEvent = new RNBO.MessageEvent(
            RNBO.TimeNow,
            "start",
            [1]
        );
        device.scheduleEvent(startEvent);
        // Send touch coordinates
        let touchX = Math.round(dotX / 3 + 86);
        let touchY = Math.round(dotY / 3 + 86);
        const messageEvent = new RNBO.MessageEvent(
            RNBO.TimeNow,
            "touch",
            [touchX, touchY]
        );
        device.scheduleEvent(messageEvent);
    });

    canvas.addEventListener('mousemove', (e) => {
        if (dragging) {
            let { x, y } = getXY(e);
            dotX = x;
            dotY = y;
            drawPad();
            let touchX = Math.round(dotX / 3 + 86);
            let touchY = Math.round(dotY / 3 + 86);
            const messageEvent = new RNBO.MessageEvent(
                RNBO.TimeNow,
                "touch",
                [touchX, touchY]
            );
            device.scheduleEvent(messageEvent);
        }
    });

    canvas.addEventListener('mouseup', () => {
        dragging = false;
        // Send start=0
        const stopEvent = new RNBO.MessageEvent(
            RNBO.TimeNow,
            "start",
            [0]
        );
        device.scheduleEvent(stopEvent);
    });

    canvas.addEventListener('mouseleave', () => {
        dragging = false;
        // Send start=0
        const stopEvent = new RNBO.MessageEvent(
            RNBO.TimeNow,
            "start",
            [0]
        );
        device.scheduleEvent(stopEvent);
    });

    canvas.addEventListener('touchstart', (e) => {
        dragging = true;
        let { x, y } = getXY(e);
        dotX = x;
        dotY = y;
        drawPad();
        // Send start=1
        const startEvent = new RNBO.MessageEvent(
            RNBO.TimeNow,
            "start",
            [1]
        );
        device.scheduleEvent(startEvent);
        // Send touch coordinates
        let touchX = Math.round(dotX / 3 + 86);
        let touchY = Math.round(dotY / 3 + 86);
        const messageEvent = new RNBO.MessageEvent(
            RNBO.TimeNow,
            "touch",
            [touchX, touchY]
        );
        device.scheduleEvent(messageEvent);
        e.preventDefault();
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
        if (dragging) {
            let { x, y } = getXY(e);
            dotX = x;
            dotY = y;
            drawPad();
            let touchX = Math.round(dotX / 3 + 86);
            let touchY = Math.round(dotY / 3 + 86);
            const messageEvent = new RNBO.MessageEvent(
                RNBO.TimeNow,
                "touch",
                [touchX, touchY]
            );
            device.scheduleEvent(messageEvent);
        }
        e.preventDefault();
    }, { passive: false });

    canvas.addEventListener('touchend', () => {
        dragging = false;
        // Send start=0
        const stopEvent = new RNBO.MessageEvent(
            RNBO.TimeNow,
            "start",
            [0]
        );
        device.scheduleEvent(stopEvent);
    });

    drawPad();
}

document.addEventListener("DOMContentLoaded", () => {
  const enterButton = document.getElementById("enter-button");
  const enterOverlay = document.getElementById("enter-overlay");

  enterButton.onclick = async () => {
    // Remove overlay
    enterOverlay.style.display = "none";

    // Create and resume AudioContext in direct response to user gesture
    const WAContext = window.AudioContext || window.webkitAudioContext;
    const context = new WAContext();
    console.log("AudioContext created:", context);
    await context.resume();
    console.log("AudioContext resumed");

    // Call setup and pass context
    await setup(context);
  };
});
