export interface ParseOptions {
    wordAliases?: ReadonlyMap<string, string>;
    declaredNames?: Iterable<string>;
}
export interface Node {
    kind: string;
    args: Record<string, any>;
    line: number;
    col: number;
}
export declare class ParseError extends Error {
    line: number;
    col: number;
    path?: string;
    constructor(message: string, line: number, col: number);
    toString(): string;
}
export declare const KEYWORDS: Set<string>;
export declare const MAX_SYNTAX_DEPTH = 128;
export declare function isIdentifier(value: string): boolean;
export declare const MAX_MACRO_EXPANSION_TOKENS = 1000000;
export declare function parse(source: string, options?: ParseOptions): Node[];
