export type FeedbackKind = "key" | "done" | "error" | "attention";
/** Optional, local UI feedback. Audio failures never interrupt editing or execution. */
export declare class SoundFeedback {
    private context;
    private master;
    private voices;
    private active;
    private level;
    private generation;
    private disposed;
    private lastKeyTime;
    get enabled(): boolean;
    get volume(): number;
    setEnabled(enabled: boolean): void;
    setVolume(volume: number): void;
    /** Call from a user gesture to unlock browser audio on the first use. */
    play(kind: FeedbackKind): void;
    stop(): void;
    dispose(): Promise<void>;
    private audioContext;
    private release;
    private schedule;
}
