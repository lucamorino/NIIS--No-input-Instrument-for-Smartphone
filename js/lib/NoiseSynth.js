const contexts = new Map();

export default class SynthRM {
    constructor(audioContext, volume, frequency) {
      this.audioContext = audioContext;
      this.volume = volume;
      this.frequency = frequency;
      this.output = this.audioContext.createGain();
      this.trigger = this.trigger.bind(this);
      this.activeTriggers = new Set(); // To keep track of active sound sources
    }

    // Method for triggering a single sound event
    trigger(startTime, triggerVolume = this.volume, triggerFrequency = this.frequency) {
      console.log(`SynthRM.trigger scheduled for: ${startTime}, Freq: ${triggerFrequency}, Vol: ${triggerVolume}`);
      
      const osc = this.audioContext.createNoise();
      const osc1 = this.audioContext.createOscillator();
      const duration = 0.4; // Long duration for the main oscillator

      // Use the frequency passed to the trigger, or the instance default
      osc.frequency.setValueAtTime(triggerFrequency*0.5, startTime);
      osc1.frequency.setValueAtTime(377, startTime);

      // Envelope for the main oscillator (osc)
      const envelope = this.audioContext.createGain();
      envelope.gain.setValueAtTime(0, startTime); // Start silent
      // Consider using triggerVolume to scale the envelope for dynamic loudness
      envelope.gain.linearRampToValueAtTime(triggerVolume*0.5, startTime + 0.003);
      envelope.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
      osc1.frequency.linearRampToValueAtTime(421, startTime + 0.55);

      // 'modulation' is the GainNode where AM occurs.
      // 'osc' will be its input, and 'osc1' (via 'depth') will control its gain.
      const modulation = this.audioContext.createGain();
      
      // 'depth' controls the intensity of the modulation.
      const depth = this.audioContext.createGain();
      depth.gain.value = 0.5;
      
      // Corrected AM wiring:
      osc1.connect(depth); // Modulator osc1 -> depth control
      depth.connect(modulation.gain); // Scaled modulator controls gain of 'modulation' node

      osc.connect(modulation); // Carrier osc is the input to the 'modulation' node
      modulation.connect(envelope); // The AM signal goes to the main envelope

      // This 'triggerSpecificEnv' is a local gain node for this specific trigger instance.
      const triggerSpecificEnv = this.audioContext.createGain();
      triggerSpecificEnv.gain.setValueAtTime(1, startTime); 
      // The envelope now processes the AM signal before it hits triggerSpecificEnv
      envelope.connect(triggerSpecificEnv);
      triggerSpecificEnv.connect(this.output);

      osc.start(startTime);
      osc1.start(startTime);

      // Schedule stops for natural end
      const naturalStopTimeOsc = startTime + duration + 0.02;
      const naturalStopTimeOsc1 = startTime + duration + 0.02;
      osc.stop(naturalStopTimeOsc);
      osc1.stop(naturalStopTimeOsc1);

      const activeSound = {
        osc,
        osc1,
        triggerSpecificEnv,
        // Store cleanup timeout ID to cancel if stopAll is called
        cleanupTimeoutId: null,
      };
      this.activeTriggers.add(activeSound);

      // Self-removal after natural end
      const timeToNaturalEnd = Math.max(naturalStopTimeOsc, naturalStopTimeOsc1) - startTime;
      activeSound.cleanupTimeoutId = setTimeout(() => {
        this.activeTriggers.delete(activeSound);
        // console.log('Synth trigger naturally ended and removed.');
      }, timeToNaturalEnd * 1000 + 50); // Add a small buffer
  }

  stopAll(stopTime) {
    console.log(`SynthRM.stopAll called at AC time: ${stopTime}. Active triggers: ${this.activeTriggers.size}`);
    this.activeTriggers.forEach(activeSound => {
      // Clear the self-removal timeout if it exists
      if (activeSound.cleanupTimeoutId) {
        clearTimeout(activeSound.cleanupTimeoutId);
      }

      // Cancel any future gain changes and ramp down quickly
      activeSound.triggerSpecificEnv.gain.cancelScheduledValues(stopTime);
      activeSound.triggerSpecificEnv.gain.setValueAtTime(activeSound.triggerSpecificEnv.gain.value, stopTime); // Hold current value
      activeSound.triggerSpecificEnv.gain.linearRampToValueAtTime(0, stopTime + 0.05); // Quick fade of 50ms

      // Stop oscillators shortly after the fade
      activeSound.osc.stop(stopTime + 0.06);
      activeSound.osc1.stop(stopTime + 0.06);
    });
    this.activeTriggers.clear(); // Remove all references
    console.log('All active synth triggers stopped and cleared.');
  }
}
