export type RunRequest = {
    type: 'run';
    source: string;
    path: string;
    files: Record<string, string>;
    maxSteps: number;
};
export type Request = RunRequest | {
    type: 'input';
    id: number;
    value: string;
    closed?: boolean;
} | {
    type: 'debug';
    id: number;
    action: 'continue' | 'abort';
};
export type Reply = {
    type: 'output';
    text: string;
} | {
    type: 'input';
    id: number;
    prompt: string;
} | {
    type: 'debug';
    id: number;
    path: string;
    line: number;
    variables: [string, string][];
} | {
    type: 'file';
    path: string;
    text: string;
} | {
    type: 'done';
    elapsed: number;
} | {
    type: 'error';
    message: string;
    line?: number;
    col?: number;
    path?: string;
};
