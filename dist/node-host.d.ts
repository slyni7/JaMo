export type Encoding = 'utf-8-sig' | 'utf-8' | 'cp949';
export declare function decode(bytes: Uint8Array, encoding?: Encoding): string;
export declare function encode(text: string, encoding: Encoding): Uint8Array;
export declare function fileHost(encoding?: Encoding): {
    readFile: (path: string) => Promise<string>;
    writeFile: (path: string, text: string) => Promise<void>;
};
export declare function inputLines(): AsyncGenerator<string>;
