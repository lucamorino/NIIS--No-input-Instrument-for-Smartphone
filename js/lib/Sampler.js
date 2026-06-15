const contexts = new Map();

export default class CVSampler {
    constructor(audioContext, buffers, volume, startTime, numBuf) {
      this.audioContext = audioContext;
      this.buffers = buffers;
      this.numBuf = numBuf;
      this.startTime = startTime;
      this.volume = volume;
      this.output = this.audioContext.createGain();
      this.play = this.play.bind(this);
      this.finished = false;
      this.activeSource = null;
      this.activeEnv = null;
    }
    play(currentTime) {
      //const startTime = this.startTime;
      let playTime = currentTime-this.startTime+0.5;
      console.log(playTime);

      const src = this.audioContext.createBufferSource();
      const env = this.audioContext.createGain();

      src.buffer = this.buffers[this.numBuf];
      // const duration = src.buffer.duration; // Not used for looping/rescheduling here

      env.gain.linearRampToValueAtTime(this.volume, playTime + 0.01);
      src.connect(env).connect(this.output);
      src.start(playTime);

      this.activeSource = src;
      this.activeEnv = env;

      // Cleanup references when sound naturally ends
      src.onended = () => {
        if (this.activeSource === src) {
          this.activeSource = null;
          this.activeEnv = null;
        }
      };
    } 

    stop(stopTime) {
      if (this.activeSource && this.activeEnv) {
        console.log(`CVSampler stopping at AC time: ${stopTime}`);
        this.activeEnv.gain.cancelScheduledValues(stopTime);
        this.activeEnv.gain.setValueAtTime(this.activeEnv.gain.value, stopTime);
        this.activeEnv.gain.linearRampToValueAtTime(0, stopTime + 0.05);
        this.activeSource.stop(stopTime + 0.06);
        this.activeSource = null;
        this.activeEnv = null;
      }
    }
  }