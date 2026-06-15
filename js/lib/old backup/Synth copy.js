const contexts = new Map();

export default class LoopSynth {
    constructor(audioContext, buffer, volume, startTime, frequency) {
      this.audioContext = audioContext;
      this.buffer = buffer;
      this.startTime = startTime;
      this.volume = volume;
      this.frequency = frequency;
      this.output = this.audioContext.createGain();
      this.play = this.play.bind(this);
      //this.finished = false;
    }
    play(currentTime) {
      //const startTime = this.startTime;
      let playTime = currentTime-this.startTime+0.5;
      console.log(playTime);

      const src = this.audioContext.createBufferSource();
      const osc = this.audioContext.createOscillator();
      osc.frequency.value = this.frequency;
      const envelope = this.audioContext.createGain();
      envelope.gain.value = 0;
      
      src.buffer = this.buffer;
      const duration = src.buffer.duration;
      src.connect(envelope.gain);
      src.start(playTime);

      const env = this.audioContext.createGain();
      env.gain.linearRampToValueAtTime(this.volume, playTime + 0.01);
      osc.connect(envelope).connect(env).connect(this.output);
      osc.start(playTime);
   

      return currentTime + duration;
    } 

    // Method for triggering a single sound event
    trigger(startTime=this.startTime, triggerVolume = this.volume, triggerFrequency = this.frequency) {
      console.log(`LoopSynth.trigger scheduled for: ${startTime}, Freq: ${triggerFrequency}, Vol: ${triggerVolume}`);

      const src = this.audioContext.createBufferSource();
      const osc = this.audioContext.createOscillator();
      // Use the frequency passed to the trigger, or the instance default
      osc.frequency.setValueAtTime(triggerFrequency, startTime);

      const envelope = this.audioContext.createGain();
      envelope.gain.value = 0; // Start silent

      src.buffer = this.buffer; // The control buffer
      const duration = src.buffer.duration;

      // Use the buffer to control the gain of the oscillator
      src.connect(envelope.gain);
      src.start(startTime);
      // Stop the source buffer when it finishes
      src.stop(startTime + duration);

      const env = this.audioContext.createGain();
      // Use the volume passed to the trigger, or the instance default
      env.gain.setValueAtTime(triggerVolume, startTime);
      // Optional: Add a small fade out at the end of the buffer's duration
      // env.gain.linearRampToValueAtTime(0, startTime + duration);

      osc.connect(envelope).connect(env).connect(this.output);
      osc.start(startTime);
      // Stop the oscillator slightly after the buffer ends
      osc.stop(startTime + duration + 0.01);

      // No return value needed as this is a one-shot trigger
  }
}
