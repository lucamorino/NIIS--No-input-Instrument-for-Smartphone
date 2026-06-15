const contexts = new Map();

export default class TrackEngine {
    constructor(audioContext, buffer, track, BPM, running, startTime, step) {
      this.audioContext = audioContext;
      this.buffer = buffer;
      this.track = track;
      this.BPM = BPM;
      this.running = running;
      this.step = step;
      this.startTime = startTime
      // ouput node so that we can connect to the outside world
      this.output = this.audioContext.createGain();
      // bind the render method so that we don't loose the context
      this.render = this.render.bind(this);
      //this.stop = this.stop.bind(this);
    }
  
    render(currentTime) {
        const run = this.running;
        const startTime = this.startTime;
        let playTime = currentTime-startTime+0.5;
        //console.log(playTime);
        if (run) { // && currentTime >= startTime
          const isActive = this.track[this.step] === 1;
          const src = this.audioContext.createBufferSource();
          src.buffer = this.buffer;
          src.connect(this.output);
          if (isActive) {
            console.log(playTime, this.step);
            src.start(playTime);
          }
        }
        const numSteps = this.track.length;
        this.step = (this.step + 1) % numSteps;

        return currentTime + 60 / (this.BPM*2);
    }
  };