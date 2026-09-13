import test from 'node:test';
import assert from 'node:assert/strict';
import { CLUSTER_PAIRS, DEFAULT_COMBINE_TIMEOUT_MS, transitionInputAssist, createTextareaInputAssist } from '../dist/input-assist.js';

const defaults = { enabled: true, timeoutMs: 300 };
const snap = (value, start = value.length, end = start) => ({ value, start, end });
function step(state, before, after, time, options = defaults, kind = 'typing') {
  return transitionInputAssist(state, { before, after, kind }, options, time);
}
const fresh = () => ({ pending: null });
const first = (char, at = 0) => step(fresh(), snap(''), snap(char), at).state;

test('300ms default joins all 11 supported pairs and leaves the first character visible', () => {
  assert.equal(DEFAULT_COMBINE_TIMEOUT_MS, 300);
  assert.equal(CLUSTER_PAIRS.size, 11);
  const expected = { 'ㄱㅅ':'ㄳ', 'ㄴㅈ':'ㄵ', 'ㄴㅎ':'ㄶ', 'ㄹㄱ':'ㄺ', 'ㄹㅁ':'ㄻ', 'ㄹㅂ':'ㄼ',
    'ㄹㅅ':'ㄽ', 'ㄹㅌ':'ㄾ', 'ㄹㅍ':'ㄿ', 'ㄹㅎ':'ㅀ', 'ㅂㅅ':'ㅄ' };
  for (const [pair, cluster] of Object.entries(expected)) {
    const initial = step(fresh(), snap(''), snap(pair[0]), 10);
    assert.equal(initial.replacement, null, pair);
    assert.equal(initial.state.pending.value, pair[0]);
    const next = step(initial.state, snap(pair[0]), snap(pair), 310);
    assert.deepEqual(next.replacement, { start: 0, end: 2, text: cluster }, pair);
    assert.equal(next.state.pending, null);
  }
});

test('timing boundary is inclusive and out-of-window or backward clocks never join', () => {
  for (const [time, joined] of [[10, true], [309.999, true], [310, true], [310.001, false], [9, false]])
    assert.equal(!!step(first('ㅂ', 10), snap('ㅂ'), snap('ㅂㅅ'), time).replacement, joined, String(time));
  assert.ok(step(first('ㅂ', 10), snap('ㅂ'), snap('ㅂㅅ'), 10, { enabled: true, timeoutMs: 0 }).replacement);
});

test('disabled assistance and invalid timing cannot combine', () => {
  for (const options of [{ enabled: false, timeoutMs: 300 }, { enabled: true, timeoutMs: -1 }, { enabled: true, timeoutMs: NaN }])
    assert.deepEqual(step(first('ㅂ'), snap('ㅂ'), snap('ㅂㅅ'), 100, options), { state: fresh(), replacement: null });
});

test('only adjacent insertion into the same unchanged document can join', () => {
  for (const [before, after] of [[snap('ㅂ', 0), snap('ㅅㅂ', 1)], [snap('ㅂ', 0, 1), snap('ㅅ')],
    [snap('xㅂ'), snap('xㅂㅅ')], [snap('ㅂ'), snap('ㅂㅅ', 0)]])
    assert.equal(step(first('ㅂ'), before, after, 100).replacement, null);
});

test('paste, bulk insertion and pre-existing text do not seed a later combination', () => {
  for (const kind of ['paste', 'other']) {
    assert.equal(step(first('ㅂ'), snap('ㅂ'), snap('ㅂㅅ'), 100, defaults, kind).replacement, null);
    assert.equal(step(fresh(), snap(''), snap('ㅂ'), 100, defaults, kind).state.pending, null);
  }
  assert.equal(step(fresh(), snap(''), snap('ㅂㅅ'), 100).replacement, null);
  assert.equal(step(fresh(), snap('ㅂ'), snap('ㅂㅅ'), 100).replacement, null);
});

test('local range replacement preserves prefix, suffix, emoji and unrelated spelling', () => {
  const before = snap('😀ㅂㅅ|', 5);
  const firstEdit = step(fresh(), before, snap('😀ㅂㅅ|ㄹ', 6), 0);
  assert.deepEqual(step(firstEdit.state, snap('😀ㅂㅅ|ㄹ', 6), snap('😀ㅂㅅ|ㄹㅎ', 7), 1).replacement,
    { start: 5, end: 7, text: 'ㅀ' });
  assert.equal(step(first('ㅂ'), snap('ㅂ'), snap('ㅂᄉ'), 1).replacement, null);
  assert.equal(step(first('ㅂ'), snap('ㅂ'), snap('ㅂㅆ'), 1).replacement, null);
});

// Small EventTarget textarea double exercises the actual controller without a DOM dependency.
class Editor extends EventTarget {
  value = '';
  selectionStart = 0;
  selectionEnd = 0;
  replacements = [];
  setRangeText(text, start = this.selectionStart, end = this.selectionEnd) {
    this.replacements.push({ text, start, end });
    this.value = this.value.slice(0, start) + text + this.value.slice(end);
    this.selectionStart = this.selectionEnd = start + text.length;
  }
  focus() {}
  event(type, fields = {}) {
    const event = new Event(type);
    Object.assign(event, fields);
    this.dispatchEvent(event);
  }
  type(text, inputType = 'insertText', isComposing = false) {
    this.event('beforeinput', { inputType, data: text, isComposing });
    this.setRangeText(text);
    this.event('input', { inputType, data: text, isComposing });
  }
}
function fixture(options = {}) {
  const editor = new Editor();
  let time = 0;
  const assist = createTextareaInputAssist(editor, options, undefined, () => time);
  return { editor, assist, at: value => { time = value; } };
}

test('controller joins native typing and palette input through the same editing run', () => {
  for (const [a, b] of [['native', 'native'], ['palette', 'palette'], ['native', 'palette'], ['palette', 'native']]) {
    const { editor, assist, at } = fixture();
    const insert = (kind, text) => kind === 'native' ? editor.type(text) : assist.insert(text);
    insert(a, 'ㅂ');
    assert.equal(editor.value, 'ㅂ');
    at(300); insert(b, 'ㅅ');
    assert.equal(editor.value, 'ㅄ', `${a}/${b}`);
    assert.equal(editor.selectionStart, 1);
    assist.dispose();
  }
});

test('controller respects configurable delay and off switch without delaying display', () => {
  const { editor, assist, at } = fixture({ timeoutMs: 50 });
  editor.type('ㅂ'); at(51); editor.type('ㅅ');
  assert.equal(editor.value, 'ㅂㅅ');
  assist.configure({ enabled: false });
  editor.type('ㄴ'); editor.type('ㅎ');
  assert.equal(editor.value, 'ㅂㅅㄴㅎ');
});

test('cursor navigation, blur, paste, cut, drop, deletion and settings cancel the pending character', () => {
  for (const action of [
    editor => editor.event('keydown', { key: 'ArrowLeft' }),
    editor => editor.event('keydown', { key: 'Backspace' }),
    editor => editor.event('blur'), editor => editor.event('pointerdown'),
    editor => editor.event('paste'), editor => editor.event('cut'), editor => editor.event('drop'),
    (editor, assist) => assist.configure({ timeoutMs: 300 }), (editor, assist) => assist.cancel(),
  ]) {
    const { editor, assist } = fixture(); editor.type('ㅂ'); action(editor, assist); editor.type('ㅅ');
    assert.equal(editor.value, 'ㅂㅅ', String(action));
  }
});

test('selection replacement and unchanged select notifications behave differently', () => {
  const { editor } = fixture();
  editor.type('ㅂ'); editor.event('select'); editor.type('ㅅ');
  assert.equal(editor.value, 'ㅄ');
  editor.type('ㅂ'); editor.selectionStart = 0; editor.event('select');
  editor.selectionStart = editor.selectionEnd = editor.value.length;
  editor.type('ㅅ'); assert.equal(editor.value, 'ㅄㅂㅅ');
  editor.type('ㅂ'); editor.selectionStart--;
  editor.type('ㅅ'); assert.equal(editor.value, 'ㅄㅂㅅㅅ');
});

test('single-character paste, bulk palette text and programmatic input never combine', () => {
  const { editor, assist } = fixture();
  editor.type('ㅂ'); editor.type('ㅅ', 'insertFromPaste'); assert.equal(editor.value, 'ㅂㅅ');
  assist.insert('ㄴㅎ'); assert.equal(editor.value, 'ㅂㅅㄴㅎ');
  editor.type('ㅂ'); editor.setRangeText('ㅅ'); editor.event('input');
  assert.equal(editor.value, 'ㅂㅅㄴㅎㅂㅅ');
});

test('IME text remains untouched during composition and combines once after it commits', () => {
  const { editor, assist, at } = fixture();
  editor.type('ㅂ'); at(100);
  editor.event('compositionstart');
  editor.type('ㅅ', 'insertCompositionText', true);
  assert.equal(editor.value, 'ㅂㅅ');
  assist.insert('ㄱ'); assert.equal(editor.value, 'ㅂㅅ');
  editor.event('compositionend', { data: 'ㅅ' });
  assert.equal(editor.value, 'ㅄ');
  editor.event('input', { inputType: 'insertFromComposition', data: 'ㅅ', isComposing: false });
  assert.equal(editor.value, 'ㅄ');
  assert.equal(editor.replacements.filter(item => item.text === 'ㅄ').length, 1);
});

test('successive IME-completed standalone consonants use their commit times', () => {
  const { editor, at } = fixture();
  editor.event('compositionstart'); editor.type('ㄴ', 'insertCompositionText', true);
  at(100); editor.event('compositionend', { data: 'ㄴ' });
  editor.event('input', { inputType: 'insertText', data: 'ㄴ', isComposing: false });
  at(200); editor.event('compositionstart'); editor.type('ㅎ', 'insertCompositionText', true);
  at(400); editor.event('compositionend', { data: 'ㅎ' });
  assert.equal(editor.value, 'ㄶ');
});

test('IME can insert final text after compositionend without duplicate handling', () => {
  const { editor } = fixture(); editor.type('ㅂ');
  editor.event('compositionstart'); editor.event('compositionend', { data: 'ㅅ' });
  editor.type('ㅅ', 'insertFromComposition');
  assert.equal(editor.value, 'ㅄ');
});

test('cancelled IME and paste after an empty composition do not combine', () => {
  const { editor } = fixture(); editor.type('ㅂ');
  editor.event('compositionstart'); editor.event('compositionend', { data: '' });
  editor.type('ㅅ'); assert.equal(editor.value, 'ㅂㅅ');
  editor.type('ㅂ'); editor.event('compositionstart'); editor.event('compositionend', { data: 'ㅅ' });
  editor.type('ㅅ', 'insertFromPaste'); assert.equal(editor.value, 'ㅂㅅㅂㅅ');
});

test('multi-character IME commits and normal syllables are preserved verbatim', () => {
  const { editor } = fixture(); editor.type('ㅂ'); editor.event('compositionstart');
  editor.type('ㅅㅈ', 'insertCompositionText', true); editor.event('compositionend', { data: 'ㅅㅈ' });
  assert.equal(editor.value, 'ㅂㅅㅈ');
  editor.event('compositionstart'); editor.type('안녕', 'insertCompositionText', true);
  editor.event('compositionend', { data: '안녕' }); assert.equal(editor.value, 'ㅂㅅㅈ안녕');
});

test('palette changes notify existing input listeners once and disposal removes assistance', () => {
  const { editor, assist } = fixture();
  const values = []; editor.addEventListener('input', () => values.push(editor.value));
  assist.insert('ㅂ'); assist.insert('ㅅ');
  assert.deepEqual(values, ['ㅂ', 'ㅄ']);
  assist.dispose(); editor.type('ㄴ'); editor.type('ㅎ');
  assert.equal(editor.value, 'ㅄㄴㅎ');
  assist.insert('ㄱ'); assert.equal(editor.value, 'ㅄㄴㅎ');
});

test('synchronous select from setRangeText does not interrupt a palette combination', () => {
  class SelectingEditor extends Editor {
    setRangeText(...args) { super.setRangeText(...args); this.event('select'); }
  }
  const editor = new SelectingEditor();
  let time = 0;
  const assist = createTextareaInputAssist(editor, defaults, undefined, () => time);
  assist.insert('ㅂ'); time = 69; assist.insert('ㅅ');
  assert.equal(editor.value, 'ㅄ');
});
