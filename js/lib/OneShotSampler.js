const contexts = new Map(); // Assuming similar pattern for offline context if ever needed, though not used here.

export default class OneShotSampler {
    constructor(audioContext, buffers, defaultVolume = 1) {
        this.audioContext = audioContext;
        this.buffers = buffers;
        this.defaultVolume = defaultVolume;
        this.output = this.audioContext.createGain();
        // activeSources could be a Set to track multiple playing instances if overlap is possible and stopping them is needed
        // For simple one-shots without explicit stop, this might be overkill.
    }

    trigger(time, volume, numBuffer) {
        if (!this.buffers || this.buffers.length === 0) {
            console.warn('OneShotSampler: No buffers loaded or buffers array is empty.');
            return;
        }

        // Randomly select a buffer from the array
        const randomIndex = Math.floor(Math.random() * this.buffers.length);
        const selectedBuffer = this.buffers[numBuffer !== undefined ? numBuffer : randomIndex];
        const vol = volume !== undefined ? volume : this.defaultVolume;
        const src = this.audioContext.createBufferSource();
        src.buffer = selectedBuffer; // Use the randomly selected buffer

        const env = this.audioContext.createGain();
        // Simple envelope: quick attack, play full buffer
        env.gain.setValueAtTime(0, time); // Start silent
        env.gain.linearRampToValueAtTime(vol, time + 0.01); // Quick fade in

        src.connect(env);
        env.connect(this.output);
        src.start(time);

        // Optional: if you want the sound to fade out after its natural duration + a bit
        // const naturalEndTime = time + src.buffer.duration;
        // env.gain.setValueAtTime(vol, naturalEndTime); // Hold volume until end of buffer
        // env.gain.linearRampToValueAtTime(0, naturalEndTime + 0.5); // Fade out over 0.5s
        // src.stop(naturalEndTime + 0.5 + 0.01); // Stop source after fade
    }
}