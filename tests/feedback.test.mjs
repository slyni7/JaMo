import test from "node:test";
import assert from "node:assert/strict";
import { SoundFeedback } from "../dist/feedback.js";

function fakeAudio() {
  const contexts = [];
  const param = () => ({ value: 0, setValueAtTime(value) { this.value = value; }, linearRampToValueAtTime() {} });
  class Audio {
    state = "running";
    currentTime = 0;
    destination = {};
    oscillators = [];
    gains = [];
    suspendCalls = 0;
    closeCalls = 0;
    constructor() { contexts.push(this); }
    createGain() {
      const gain = { gain: param(), connect() {}, disconnected: false, disconnect() { this.disconnected = true; } };
      this.gains.push(gain);
      return gain;
    }
    createOscillator() {
      const oscillator = {
        frequency: param(), type: "sine", onended: null, stops: [], disconnected: false,
        connect() {}, start() {}, stop(time) { this.stops.push(time); },
        disconnect() { this.disconnected = true; },
      };
      this.oscillators.push(oscillator);
      return oscillator;
    }
    async resume() { this.state = "running"; }
    async suspend() { this.suspendCalls++; this.state = "suspended"; }
    async close() { this.closeCalls++; this.state = "closed"; }
  }
  return { Audio, contexts };
}

test("optional UI audio respects mute, pending resumes and browser failures", async t => {
  const originalAudio = Object.getOwnPropertyDescriptor(globalThis, "AudioContext");
  const originalWebkit = Object.getOwnPropertyDescriptor(globalThis, "webkitAudioContext");
  t.after(() => {
    if (originalAudio) Object.defineProperty(globalThis, "AudioContext", originalAudio);
    else delete globalThis.AudioContext;
    if (originalWebkit) Object.defineProperty(globalThis, "webkitAudioContext", originalWebkit);
    else delete globalThis.webkitAudioContext;
  });
  delete globalThis.webkitAudioContext;

  await t.test("default off creates no AudioContext; all four cues work after enabling", async () => {
    const { Audio, contexts } = fakeAudio();
    globalThis.AudioContext = Audio;
    const feedback = new SoundFeedback();
    feedback.play("key");
    assert.equal(feedback.enabled, false);
    assert.equal(contexts.length, 0);
    feedback.setEnabled(true);
    assert.equal(contexts.length, 0, "enabling alone does not allocate audio");
    for (const kind of ["key", "done", "error", "attention"]) feedback.play(kind);
    assert.equal(contexts.length, 1);
    assert.equal(contexts[0].oscillators.length, 7);
    await feedback.dispose();
    assert.equal(contexts[0].closeCalls, 1);
  });

  await t.test("muting immediately disconnects playing and future scheduled notes", async () => {
    const { Audio, contexts } = fakeAudio();
    globalThis.AudioContext = Audio;
    const feedback = new SoundFeedback();
    feedback.setEnabled(true);
    feedback.play("done");
    feedback.setEnabled(false);
    assert.equal(contexts[0].suspendCalls, 1);
    assert.ok(contexts[0].oscillators.every(voice => voice.disconnected && voice.stops.at(-1) === undefined));
    feedback.play("error");
    assert.equal(contexts[0].oscillators.length, 2);
    await feedback.dispose();
  });

  await t.test("an AudioContext resume resolving after mute cannot play a stale cue", async () => {
    const { Audio, contexts } = fakeAudio();
    let resume;
    globalThis.AudioContext = class extends Audio {
      state = "suspended";
      resume() { return new Promise(resolve => { resume = () => { this.state = "running"; resolve(); }; }); }
    };
    const feedback = new SoundFeedback();
    feedback.setEnabled(true);
    feedback.play("attention");
    feedback.setEnabled(false);
    resume();
    await Promise.resolve();
    assert.equal(contexts[0].oscillators.length, 0);
    await feedback.dispose();
  });

  await t.test("volume is bounded; zero volume cancels sound without creating another context", async () => {
    const { Audio, contexts } = fakeAudio();
    globalThis.AudioContext = Audio;
    const feedback = new SoundFeedback();
    feedback.setEnabled(true);
    feedback.setVolume(2);
    feedback.play("key");
    assert.equal(feedback.volume, 1);
    assert.equal(contexts[0].gains[0].gain.value, 0.12);
    feedback.setVolume(-1);
    assert.equal(feedback.volume, 0);
    assert.equal(contexts[0].gains[0].gain.value, 0);
    assert.ok(contexts[0].oscillators[0].disconnected);
    feedback.setVolume(NaN);
    feedback.play("done");
    assert.equal(contexts[0].oscillators.length, 1);
    await feedback.dispose();
  });

  await t.test("rapid repeated keys are bounded and finished voices are disconnected", async () => {
    const { Audio, contexts } = fakeAudio();
    globalThis.AudioContext = Audio;
    const feedback = new SoundFeedback();
    feedback.setEnabled(true);
    for (let i = 0; i < 100; i++) feedback.play("key");
    assert.equal(contexts[0].oscillators.length, 1);
    contexts[0].oscillators[0].onended();
    assert.ok(contexts[0].oscillators[0].disconnected);
    for (let i = 0; i < 30; i++) feedback.play("done");
    assert.equal(contexts[0].oscillators.filter(voice => !voice.disconnected).length, 12);
    feedback.stop();
    assert.ok(contexts[0].oscillators.every(voice => voice.disconnected));
    await feedback.dispose();
    feedback.setEnabled(true);
    feedback.play("done");
    assert.equal(feedback.enabled, false);
    assert.equal(contexts.length, 1);
  });

  await t.test("unsupported audio, constructor failure and denied resume remain optional", async () => {
    delete globalThis.AudioContext;
    const absent = new SoundFeedback();
    absent.setEnabled(true);
    assert.doesNotThrow(() => absent.play("done"));
    await absent.dispose();
    globalThis.AudioContext = class { constructor() { throw new Error("blocked"); } };
    const blocked = new SoundFeedback();
    blocked.setEnabled(true);
    assert.doesNotThrow(() => blocked.play("key"));
    await blocked.dispose();
    const { Audio, contexts } = fakeAudio();
    globalThis.AudioContext = class extends Audio {
      state = "suspended";
      async resume() { throw new Error("gesture required"); }
    };
    const denied = new SoundFeedback();
    denied.setEnabled(true);
    denied.play("done");
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(contexts[0].oscillators.length, 0);
    await denied.dispose();
  });
});
