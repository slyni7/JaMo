/** Faithful asynchronous port of the managed-storage Python interpreter.
 * Host I/O is injected; this module has no Node or browser API dependency.
 */
import { type Node } from './frontend.js';
export type Value = null | boolean | bigint | number | string | Char | Table | Ref | UserFunction | Module | Builtin | CustomType | Instance;
type MaybePromise<T> = T | Promise<T>;
export declare class Fault extends Error {
    value: Value;
    line: number;
    col: number;
    path: string | null;
    constructor(message: string, node?: Node | null, options?: {
        value?: Value;
        path?: string | null;
    });
    toString(): string;
}
export declare class DebugAbort extends Error {
    constructor(message?: string);
}
export declare class InputEOF extends Error {
    constructor();
}
export declare class Flow {
}
export declare class Returned extends Flow {
    value: Value;
    hasValue: boolean;
    constructor(value: Value, hasValue?: boolean);
}
export declare class BreakFlow extends Flow {
}
export declare class ContinueFlow extends Flow {
}
export declare class Jump extends Flow {
    name: string;
    constructor(name: string);
}
export declare class Cell {
    value: Value;
    alive: boolean;
    constructor(value: Value);
    read(): Value;
    write(value: Value): void;
}
export declare class Ref {
    cell: Cell;
    strict: boolean;
    constructor(cell: Cell, strict?: boolean);
}
export declare class Char {
    readonly value: string;
    constructor(value: string);
    toString(): string;
}
export declare class Table {
    cells: Cell[];
    constructor(values?: Iterable<Value>);
    get length(): number;
    values(): Value[];
    at(index: Value): Cell;
}
export declare class Env {
    parent: Env | null;
    cells: Map<string, Cell>;
    declarations: Map<string, Node | null>;
    constructor(parent?: Env | null);
    declare(name: string, value: Value, owner?: Node | null): Cell;
    lookup(name: string): Cell;
}
export declare class UserFunction {
    params: string[];
    body: Node[] | Node;
    closure: Env;
    path: string | null;
    expression: boolean;
    name: string;
    constructor(params: string[], body: Node[] | Node, closure: Env, path: string | null, expression?: boolean, name?: string);
}
export declare class Module {
    env: Env;
    path: string;
    constructor(env: Env, path: string);
}
export declare class CustomType {
    name: string;
    params: string[];
    body: Node[];
    closure: Env;
    path: string | null;
    constructor(name: string, params: string[], body: Node[], closure: Env, path: string | null);
}
export declare class Instance {
    type: CustomType;
    env: Env;
    constructor(type: CustomType, env: Env);
}
export declare class Builtin {
    name: string;
    fn: (...values: Value[]) => MaybePromise<Value>;
    min: number;
    max: number;
    constructor(name: string, fn: (...values: Value[]) => MaybePromise<Value>, min: number, max?: number);
    accepts(count: number): boolean;
}
export declare function truth(value: Value): boolean;
export declare function equal(left: Value, right: Value, seen?: Map<Table, Set<Table>>): boolean;
export declare function display(value: Value, seen?: Set<Table>): string;
export declare function typeName(value: Value): string;
/** POSIX virtual paths, with slash-form Windows drive roots for the Node host. */
export declare function normalizePath(path: string, base?: string): string;
export declare class MemoryFiles {
    files: Map<string, string>;
    constructor(initial?: Record<string, string> | Map<string, string>);
    readFile: (path: string) => string;
    writeFile: (path: string, text: string) => void;
}
export interface InterpreterOptions {
    output?: (text: string) => void;
    input?: (prompt: string) => MaybePromise<string>;
    readFile?: (path: string) => MaybePromise<string>;
    writeFile?: (path: string, text: string) => MaybePromise<void>;
    debugger?: (vm: Interpreter, env: Env, node: Node) => MaybePromise<void>;
    maxSteps?: number;
    files?: MemoryFiles;
    wordAliases?: ReadonlyMap<string, string>;
}
type Validation = {
    inFunction: boolean;
    loopDepth: number;
    inHandler: boolean;
    visibleLabels: Set<string>;
};
export declare class Interpreter {
    wordAliases: ReadonlyMap<string, string>;
    output: (text: string) => void;
    input: (prompt: string) => MaybePromise<string>;
    readFile: (path: string) => MaybePromise<string>;
    writeFile: (path: string, text: string) => MaybePromise<void>;
    debugger?: InterpreterOptions['debugger'];
    maxSteps: number;
    steps: number;
    path: string | null;
    modules: Map<string, Module>;
    loading: Set<string>;
    activeErrors: Fault[];
    callDepth: number;
    activeLoopDepth: number;
    base: Env;
    globals: Env;
    files: MemoryFiles;
    readonly loopBindings = "fresh";
    constructor(options?: InterpreterOptions);
    private installBuiltins;
    resolvePath(path: Value): string;
    tick(node: Node): void;
    private at;
    private wrap;
    execute(source: string, path?: string, env?: Env): Promise<Env>;
    runFile(path: string): Promise<Env>;
    validate(nodes: Node[], context?: Partial<Validation>): void;
    block(nodes: Node[], env: Env): Promise<void>;
    private loopBody;
    statement(n: Node, env: Env): Promise<void>;
    place(n: Node, env: Env, allowValue?: boolean): Promise<Cell>;
    expr(n: Node, env: Env): Promise<Value>;
    private arithmetic;
    call(callee: Value, values: Value[], node: Node): Promise<Value>;
}
export {};
