/** Local, timed input assistance. This never normalizes a document or changes a paste. */
export const DEFAULT_COMBINE_TIMEOUT_MS = 300;
export const CLUSTER_PAIRS: ReadonlyMap<string, string> = new Map([
  ['ㄱㅅ', 'ㄳ'], ['ㄴㅈ', 'ㄵ'], ['ㄴㅎ', 'ㄶ'], ['ㄹㄱ', 'ㄺ'], ['ㄹㅁ', 'ㄻ'],
  ['ㄹㅂ', 'ㄼ'], ['ㄹㅅ', 'ㄽ'], ['ㄹㅌ', 'ㄾ'], ['ㄹㅍ', 'ㄿ'], ['ㄹㅎ', 'ㅀ'], ['ㅂㅅ', 'ㅄ'],
]);
const FIRST_CONSONANTS = new Set(Array.from(CLUSTER_PAIRS.keys(), pair => pair[0]));

export interface InputAssistOptions { enabled: boolean; timeoutMs: number; }
export interface EditorSnapshot { value: string; start: number; end: number; }
interface PendingCharacter { value: string; caret: number; character: string; at: number; }
export interface InputAssistState { pending: PendingCharacter | null; }
export interface InputAssistEdit {
  before: EditorSnapshot;
  after: EditorSnapshot;
  kind: 'typing' | 'palette' | 'composition' | 'paste' | 'other';
}
export interface InputAssistTransition {
  state: InputAssistState;
  replacement: { start: number; end: number; text: string } | null;
}

/** Pure transition; UTF-16 offsets match textarea selectionStart/selectionEnd. */
export function transitionInputAssist(
  state: InputAssistState, edit: InputAssistEdit, options: InputAssistOptions, now: number,
): InputAssistTransition {
  const empty: InputAssistTransition = { state: { pending: null }, replacement: null };
  const { before, after, kind } = edit;
  if (!options.enabled || kind === 'paste' || kind === 'other'
      || !Number.isFinite(now) || !Number.isFinite(options.timeoutMs) || options.timeoutMs < 0
      || before.start !== before.end || after.start !== after.end
      || after.start !== before.start + 1) return empty;
  const character = after.value.slice(before.start, after.start);
  if (character.length !== 1
      || after.value !== before.value.slice(0, before.start) + character + before.value.slice(before.end)) return empty;

  const previous = state.pending;
  const cluster = previous && CLUSTER_PAIRS.get(previous.character + character);
  if (previous && cluster && previous.value === before.value && previous.caret === before.start
      && now >= previous.at && now - previous.at <= options.timeoutMs) {
    return { state: { pending: null }, replacement: { start: before.start - 1, end: after.start, text: cluster } };
  }
  if (!FIRST_CONSONANTS.has(character)) return empty;
  return {
    state: { pending: { value: after.value, caret: after.start, character, at: now } },
    replacement: null,
  };
}

export interface TextareaInputAssist {
  /** Insert a palette choice. Bulk strings and selections are inserted without combining. */
  insert(text: string): void;
  /** Settings changes always end the current combination opportunity. */
  configure(options: Partial<InputAssistOptions>): void;
  /** Call when switching files, loading text, or replacing the editor value programmatically. */
  cancel(): void;
  dispose(): void;
}

/**
 * Native input is inspected after the browser changes the value. A single local
 * setRangeText joins the last two characters; the first is never held back.
 * Palette buttons should prevent pointerdown's focus change, since blur cancels.
 */
export function createTextareaInputAssist(
  editor: HTMLTextAreaElement,
  initialOptions: Partial<InputAssistOptions> = {},
  onChange: () => void = () => {},
  now: () => number = () => performance.now(),
): TextareaInputAssist {
  const snapshot = (): EditorSnapshot => ({ value: editor.value, start: editor.selectionStart, end: editor.selectionEnd });
  const same = (a: EditorSnapshot, b: EditorSnapshot) => a.value === b.value && a.start === b.start && a.end === b.end;
  const normalize = (options: Partial<InputAssistOptions>): InputAssistOptions => ({
    enabled: options.enabled ?? true,
    timeoutMs: Number.isFinite(options.timeoutMs) && options.timeoutMs! >= 0
      ? options.timeoutMs! : DEFAULT_COMBINE_TIMEOUT_MS,
  });
  let options = normalize(initialOptions);
  let state: InputAssistState = { pending: null };
  let observed = snapshot();
  let beforeInput: EditorSnapshot | null = null;
  let compositionBefore: EditorSnapshot | null = null;
  let composing = false;
  let awaitingCompositionCommit = false;
  let compositionHandled: EditorSnapshot | null = null;
  let notifying = false;
  let editingRange = false;
  let disposed = false;
  const listeners: [string, EventListener, boolean][] = [];

  function cancel() {
    state = { pending: null };
    beforeInput = compositionBefore = compositionHandled = null;
    composing = awaitingCompositionCommit = false;
    observed = snapshot();
  }
  function notify() {
    notifying = true;
    try { editor.dispatchEvent(new Event('input', { bubbles: true })); }
    finally { notifying = false; }
  }
  function replaceRange(text: string, start: number, end: number) {
    // A browser may dispatch select from setRangeText before observed is updated.
    editingRange = true;
    try { editor.setRangeText(text, start, end, 'end'); }
    finally { editingRange = false; }
  }
  function apply(before: EditorSnapshot, kind: InputAssistEdit['kind']): boolean {
    const transition = transitionInputAssist(state, { before, after: snapshot(), kind }, options, now());
    state = transition.state;
    if (transition.replacement) {
      const { start, end, text } = transition.replacement;
      replaceRange(text, start, end);
    }
    observed = snapshot();
    onChange();
    return transition.replacement !== null;
  }
  function listen(type: string, callback: (event: any) => void, capture = false) {
    const listener: EventListener = event => { if (!disposed) callback(event); };
    editor.addEventListener(type, listener, { capture });
    listeners.push([type, listener, capture]);
  }

  listen('beforeinput', (event: InputEvent) => {
    if (notifying) return;
    beforeInput = snapshot();
    if (!composing && !event.isComposing && event.inputType !== 'insertText'
        && event.inputType !== 'insertFromComposition') state = { pending: null };
  });
  // Capture allows the existing editor input listener to save the combined value.
  listen('input', (event: InputEvent) => {
    if (notifying) return;
    if (composing || event.isComposing) { observed = snapshot(); return; }
    if (compositionHandled && same(compositionHandled, snapshot())) {
      compositionHandled = null; beforeInput = null; observed = snapshot(); return;
    }
    if (awaitingCompositionCommit && compositionBefore
        && (event.inputType === 'insertText' || event.inputType === 'insertFromComposition')) {
      apply(compositionBefore, 'composition');
      compositionBefore = null; awaitingCompositionCommit = false;
    } else {
      compositionBefore = null; awaitingCompositionCommit = false;
      const kind = event.inputType === 'insertText' || event.inputType === 'insertFromComposition' ? 'typing' : 'other';
      apply(beforeInput || observed, kind);
    }
    beforeInput = compositionHandled = null;
  }, true);
  listen('compositionstart', () => {
    compositionBefore = snapshot();
    beforeInput = compositionHandled = null;
    composing = true; awaitingCompositionCommit = false;
  });
  listen('compositionend', (event: CompositionEvent) => {
    if (!composing || !compositionBefore) { composing = false; return; }
    composing = false;
    const before = compositionBefore;
    beforeInput = null;
    // Some input methods dispatch their final DOM insertion after compositionend.
    if (same(before, snapshot())) {
      if (!event.data) { cancel(); return; }
      awaitingCompositionCommit = true; observed = snapshot(); return;
    }
    const changed = apply(before, 'composition');
    compositionBefore = null; awaitingCompositionCommit = false;
    compositionHandled = snapshot();
    if (changed) notify();
  });
  listen('select', () => {
    // setRangeText may queue select; an unchanged final caret is not a user move.
    if (!editingRange && !composing && !same(observed, snapshot())) cancel();
  });
  listen('keydown', (event: KeyboardEvent) => {
    if (event.isComposing || composing) return;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown',
      'Backspace', 'Delete', 'Escape', 'Tab'].includes(event.key) || event.ctrlKey || event.metaKey) cancel();
  });
  for (const type of ['pointerdown', 'blur', 'paste', 'cut', 'drop']) listen(type, cancel);

  return {
    insert(text) {
      if (disposed || composing) return;
      const before = snapshot();
      beforeInput = compositionBefore = compositionHandled = null;
      awaitingCompositionCommit = false;
      replaceRange(text, before.start, before.end);
      apply(before, 'palette');
      editor.focus();
      notify();
    },
    configure(next) { options = normalize({ ...options, ...next }); cancel(); },
    cancel,
    dispose() {
      for (const [type, listener, capture] of listeners) editor.removeEventListener(type, listener, { capture });
      disposed = true; cancel();
    },
  };
}
