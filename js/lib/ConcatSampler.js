const contexts = new Map();

export default class ConcatSampler {
    constructor(audioContext, buffers, volume, numSampl, startTime, score) {
      this.audioContext = audioContext;
      this.buffers = buffers;
      this.volume = volume;
      this.numSampl = numSampl;
      this.startTime = startTime;
      this.score = score;
      this.step = 0;
      this.output = this.audioContext.createGain();
      this.play = this.play.bind(this);
      this.finished = false;
    }
    play(currentTime) {
      const mute = this.score[this.step];
      const volume = this.volume*mute;
      const numBuff = this.step < this.numSampl;
      const startTime = this.startTime;
      let playTime = currentTime-startTime+0.5;
      console.log(playTime);
      console.log(volume);

      if (this.step == this.numSampl-1){
        this.finished = true;
      } 
      if (numBuff) {
        const src = this.audioContext.createBufferSource();
        src.buffer = this.buffers[this.step];
        const duration = src.buffer.duration;
        const env = this.audioContext.createGain();

        env.gain.linearRampToValueAtTime(volume, playTime + 0.01);
        src.connect(env).connect(this.output);
        src.start(playTime);
        this.step = this.step + 1;
        return currentTime + duration;
      } else {
        this.finished = true;
        return;
      }
    } 
  }