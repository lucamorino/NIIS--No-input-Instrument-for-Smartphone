const contexts = new Map();

export default class TriggerSynth {
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
      console.log(`TriggerSynth.trigger scheduled for: ${startTime}, Freq: ${triggerFrequency}, Vol: ${triggerVolume}`);
      
      const osc = this.audioContext.createOscillator();
      osc.type = 'triangle';
      const osc1 = this.audioContext.createOscillator();
      const duration = 5; // Long duration for the main oscillator

      // Use the frequency passed to the trigger, or the instance default
      osc.frequency.setValueAtTime(triggerFrequency, startTime);
      osc1.frequency.setValueAtTime(triggerFrequency*4, startTime);

      // Envelope for the main oscillator (osc)
      const envelope = this.audioContext.createGain();
      envelope.gain.value = 0; // Start silent
      envelope.gain.linearRampToValueAtTime(triggerVolume*0.2, startTime + 0.5);
      envelope.gain.linearRampToValueAtTime(0.0001, startTime + duration);

      // Envelope for the secondary oscillator (osc1) - shorter, percussive
      const envelope1 = this.audioContext.createGain();
      envelope1.gain.value = 0; // Start silent
      envelope1.gain.linearRampToValueAtTime(triggerVolume*0.4, startTime + 0.08);
      envelope1.gain.linearRampToValueAtTime(0.0001, startTime + 0.8);

      // This 'triggerSpecificEnv' is a local gain node for this specific trigger instance.
      // It combines both oscillators before connecting to the main output.
      // This is the node we need to control for stopping this specific trigger.
      const triggerSpecificEnv = this.audioContext.createGain();
      // Volume is handled by individual envelopes, so this can be 1.
      triggerSpecificEnv.gain.setValueAtTime(1, startTime); 

      osc.connect(envelope).connect(triggerSpecificEnv);
      osc1.connect(envelope1).connect(triggerSpecificEnv);
      triggerSpecificEnv.connect(this.output);

      osc.start(startTime);
      osc1.start(startTime);

      // Schedule stops for natural end
      const naturalStopTimeOsc = startTime + duration + 0.02;
      const naturalStopTimeOsc1 = startTime + 0.8;
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
    console.log(`TriggerSynth.stopAll called at AC time: ${stopTime}. Active triggers: ${this.activeTriggers.size}`);
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
