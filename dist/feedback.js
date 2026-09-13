const NOTES = {
    key: [[660, 0, 0.035]],
    done: [[523.25, 0, 0.09], [783.99, 0.095, 0.12]],
    error: [[220, 0, 0.1], [174.61, 0.11, 0.14]],
    attention: [[659.25, 0, 0.07], [659.25, 0.12, 0.09]],
};
/** Optional, local UI feedback. Audio failures never interrupt editing or execution. */
export class SoundFeedback {
    context = null;
    master = null;
    voices = new Set();
    active = false;
    level = 0.2;
    generation = 0;
    disposed = false;
    lastKeyTime = -Infinity;
    get enabled() { return this.active; }
    get volume() { return this.level; }
    setEnabled(enabled) {
        this.active = enabled && !this.disposed;
        if (!this.active) {
            this.stop();
            if (this.context && this.context.state !== "closed")
                void this.context.suspend().catch(() => { });
        }
    }
    setVolume(volume) {
        this.level = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0;
        if (this.master && this.context)
            this.master.gain.setValueAtTime(this.level * 0.12, this.context.currentTime);
        if (this.level === 0)
            this.stop();
    }
    /** Call from a user gesture to unlock browser audio on the first use. */
    play(kind) {
        if (!this.active || this.level === 0 || this.disposed)
            return;
        const context = this.audioContext();
        if (!context)
            return;
        const generation = this.generation;
        const playWhenReady = () => {
            if (generation !== this.generation || !this.active || this.level === 0 ||
                this.context !== context || context.state !== "running")
                return;
            this.schedule(kind, context);
        };
        if (context.state === "suspended") {
            void context.resume().then(playWhenReady).catch(() => { });
        }
        else {
            playWhenReady();
        }
    }
    stop() {
        this.generation++;
        this.lastKeyTime = -Infinity;
        for (const voice of this.voices)
            this.release(voice, true);
    }
    async dispose() {
        this.disposed = true;
        this.active = false;
        this.stop();
        const context = this.context;
        this.context = null;
        this.master?.disconnect();
        this.master = null;
        if (context && context.state !== "closed")
            await context.close().catch(() => { });
    }
    audioContext() {
        if (this.context?.state === "closed") {
            this.context = null;
            this.master = null;
        }
        if (this.context)
            return this.context;
        const browser = globalThis;
        const Audio = browser.AudioContext ?? browser.webkitAudioContext;
        if (!Audio)
            return null;
        try {
            this.context = new Audio();
            this.master = this.context.createGain();
            this.master.gain.value = this.level * 0.12;
            this.master.connect(this.context.destination);
            return this.context;
        }
        catch {
            if (this.context)
                void this.context.close().catch(() => { });
            this.context = null;
            this.master = null;
            return null;
        }
    }
    release(voice, stop) {
        voice.oscillator.onended = null;
        if (stop) {
            try {
                voice.oscillator.stop();
            }
            catch { /* The voice may already have ended. */ }
        }
        voice.oscillator.disconnect();
        voice.envelope.disconnect();
        this.voices.delete(voice);
    }
    schedule(kind, context) {
        if (!this.master)
            return;
        const now = context.currentTime;
        // Rapid key repeats need one short tick, not an accumulating chord.
        if (kind === "key") {
            if (now - this.lastKeyTime < 0.035)
                return;
            this.lastKeyTime = now;
        }
        for (const [frequency, offset, duration] of NOTES[kind]) {
            let voice;
            try {
                while (this.voices.size >= 12)
                    this.release(this.voices.values().next().value, true);
                voice = { oscillator: context.createOscillator(), envelope: context.createGain() };
                const start = now + offset;
                voice.oscillator.type = "sine";
                voice.oscillator.frequency.setValueAtTime(frequency, start);
                voice.envelope.gain.setValueAtTime(0, start);
                voice.envelope.gain.linearRampToValueAtTime(1, start + 0.005);
                voice.envelope.gain.linearRampToValueAtTime(0, start + duration);
                voice.oscillator.connect(voice.envelope);
                voice.envelope.connect(this.master);
                const currentVoice = voice;
                voice.oscillator.onended = () => this.release(currentVoice, false);
                this.voices.add(voice);
                voice.oscillator.start(start);
                voice.oscillator.stop(start + duration + 0.005);
            }
            catch {
                if (voice)
                    this.release(voice, true);
            }
        }
    }
}
//# sourceMappingURL=feedback.js.map