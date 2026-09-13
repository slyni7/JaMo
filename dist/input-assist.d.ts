/** Local, timed input assistance. This never normalizes a document or changes a paste. */
export declare const DEFAULT_COMBINE_TIMEOUT_MS = 300;
export declare const CLUSTER_PAIRS: ReadonlyMap<string, string>;
export interface InputAssistOptions {
    enabled: boolean;
    timeoutMs: number;
}
export interface EditorSnapshot {
    value: string;
    start: number;
    end: number;
}
interface PendingCharacter {
    value: string;
    caret: number;
    character: string;
    at: number;
}
export interface InputAssistState {
    pending: PendingCharacter | null;
}
export interface InputAssistEdit {
    before: EditorSnapshot;
    after: EditorSnapshot;
    kind: 'typing' | 'palette' | 'composition' | 'paste' | 'other';
}
export interface InputAssistTransition {
    state: InputAssistState;
    replacement: {
        start: number;
        end: number;
        text: string;
    } | null;
}
/** Pure transition; UTF-16 offsets match textarea selectionStart/selectionEnd. */
export declare function transitionInputAssist(state: InputAssistState, edit: InputAssistEdit, options: InputAssistOptions, now: number): InputAssistTransition;
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
 * edit joins the last two characters; the first is never held back.
 * Palette buttons should prevent pointerdown's focus change, since blur cancels.
 */
export declare function createTextareaInputAssist(editor: HTMLTextAreaElement, initialOptions?: Partial<InputAssistOptions>, onChange?: () => void, now?: () => number): TextareaInputAssist;
export {};
