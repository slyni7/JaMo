/** Faithful asynchronous port of the managed-storage Python interpreter.
 * Host I/O is injected; this module has no Node or browser API dependency.
 */
import { parse, ParseError, isIdentifier } from './frontend.js';
export class Fault extends Error {
    value;
    line;
    col;
    path;
    constructor(message, node, options = {}) {
        super(message);
        this.name = 'Fault';
        this.value = Object.prototype.hasOwnProperty.call(options, 'value') ? options.value : message;
        this.line = node?.line ?? 0;
        this.col = node?.col ?? 0;
        this.path = options.path ?? null;
    }
    toString() {
        return `${this.path ?? '<소스>'}${this.line ? `:${this.line}:${this.col}` : ''}: ${this.message}`;
    }
}
export class DebugAbort extends Error {
    constructor(message = '사용자가 실행을 중단했습니다.') { super(message); this.name = 'DebugAbort'; }
}
export class InputEOF extends Error {
    constructor() { super('입력이 끝났습니다.'); this.name = 'InputEOF'; }
}
export class Flow {
}
export class Returned extends Flow {
    value;
    hasValue;
    constructor(value, hasValue = true) {
        super();
        this.value = value;
        this.hasValue = hasValue;
    }
}
export class BreakFlow extends Flow {
}
export class ContinueFlow extends Flow {
}
export class Jump extends Flow {
    name;
    constructor(name) {
        super();
        this.name = name;
    }
}
export class Cell {
    value;
    alive = true;
    constructor(value) {
        this.value = value;
    }
    read() { if (!this.alive)
        throw new Fault('삭제된 저장 자리를 읽을 수 없습니다.'); return this.value; }
    write(value) { if (!this.alive)
        throw new Fault('삭제된 저장 자리에 쓸 수 없습니다.'); this.value = value; }
}
export class Ref {
    cell;
    strict;
    constructor(cell, strict = false) {
        this.cell = cell;
        this.strict = strict;
    }
}
export class Char {
    value;
    constructor(value) {
        this.value = value;
        const points = Array.from(value);
        const cp = points[0]?.codePointAt(0);
        if (points.length !== 1 || cp === undefined || (cp >= 0xd800 && cp <= 0xdfff))
            throw new Fault('문자는 유니코드 코드포인트 하나여야 합니다.');
    }
    toString() { return this.value; }
}
function textValue(value) { return typeof value === 'string' ? value : value instanceof Char ? value.value : null; }
function itemIndex(index, size) {
    if (typeof index !== 'bigint')
        throw new Fault('목록 번호는 정수여야 합니다.');
    const i = index < 0n ? BigInt(size) + index : index;
    if (i < 0n || i >= BigInt(size))
        throw new Fault(`목록 번호 ${index}가 범위를 벗어났습니다.`);
    return Number(i);
}
export class Table {
    cells;
    constructor(values = []) { this.cells = Array.from(values, value => new Cell(value)); }
    get length() { return this.cells.length; }
    values() { return this.cells.map(cell => cell.read()); }
    at(index) { return this.cells[itemIndex(index, this.length)]; }
}
export class Env {
    parent;
    cells = new Map();
    declarations = new Map();
    constructor(parent = null) {
        this.parent = parent;
    }
    declare(name, value, owner = null) {
        if (this.cells.has(name))
            throw new Fault(`이미 선언한 이름입니다: ${name}`);
        const cell = new Cell(value);
        this.cells.set(name, cell);
        this.declarations.set(name, owner);
        return cell;
    }
    lookup(name) {
        const cell = this.cells.get(name);
        if (cell)
            return cell;
        if (this.parent)
            return this.parent.lookup(name);
        throw new Fault(`선언하지 않은 이름입니다: ${name}`);
    }
}
export class UserFunction {
    params;
    body;
    closure;
    path;
    expression;
    name;
    constructor(params, body, closure, path, expression = false, name = '<익명 함수>') {
        this.params = params;
        this.body = body;
        this.closure = closure;
        this.path = path;
        this.expression = expression;
        this.name = name;
    }
}
export class Module {
    env;
    path;
    constructor(env, path) {
        this.env = env;
        this.path = path;
    }
}
export class CustomType {
    name;
    params;
    body;
    closure;
    path;
    constructor(name, params, body, closure, path) {
        this.name = name;
        this.params = params;
        this.body = body;
        this.closure = closure;
        this.path = path;
    }
}
export class Instance {
    type;
    env;
    constructor(type, env) {
        this.type = type;
        this.env = env;
    }
}
export class Builtin {
    name;
    fn;
    min;
    max;
    constructor(name, fn, min, max = min) {
        this.name = name;
        this.fn = fn;
        this.min = min;
        this.max = max;
    }
    accepts(count) { return count >= this.min && count <= this.max; }
}
export function truth(value) {
    if (value === null || value === false)
        return false;
    if (typeof value === 'bigint')
        return value !== 0n;
    if (typeof value === 'number')
        return value !== 0;
    const text = textValue(value);
    if (text !== null)
        return text.length !== 0;
    if (value instanceof Table)
        return value.length !== 0;
    return true;
}
export function equal(left, right, seen = new Map()) {
    if (left instanceof Ref && right instanceof Ref)
        return left.cell === right.cell && left.strict === right.strict;
    if (left instanceof Table && right instanceof Table) {
        if (seen.get(left)?.has(right))
            return true;
        if (!seen.has(left))
            seen.set(left, new Set());
        seen.get(left).add(right);
        return left.length === right.length && left.cells.every((cell, i) => equal(cell.read(), right.cells[i].read(), seen));
    }
    if (typeof left === 'boolean' || typeof right === 'boolean')
        return left === right;
    const lt = textValue(left), rt = textValue(right);
    if (lt !== null && rt !== null)
        return lt === rt;
    if (typeof left === 'bigint' && typeof right === 'number')
        return Number.isInteger(right) && left === BigInt(right);
    if (typeof left === 'number' && typeof right === 'bigint')
        return Number.isInteger(left) && BigInt(left) === right;
    return left === right;
}
function floatText(value) {
    if (Object.is(value, -0))
        return '-0.0';
    if (!Number.isFinite(value))
        return String(value);
    const magnitude = Math.abs(value);
    let result = magnitude !== 0 && (magnitude < 1e-4 || magnitude >= 1e16) ? value.toExponential() : value.toString();
    if (/[eE]/.test(result)) {
        const [mantissa, exponent] = result.toLowerCase().split('e');
        const e = Number(exponent);
        return `${mantissa}e${e < 0 ? '-' : '+'}${Math.abs(e).toString().padStart(2, '0')}`;
    }
    if (!result.includes('.'))
        result += '.0';
    return result;
}
export function display(value, seen = new Set()) {
    if (value === null)
        return 'ㅜ';
    if (value === true)
        return 'ㅖ';
    if (value === false)
        return 'ㅗ';
    if (typeof value === 'number')
        return floatText(value);
    if (typeof value === 'bigint')
        return value.toString();
    if (value instanceof Char)
        return value.value;
    if (value instanceof Table) {
        if (seen.has(value))
            return '[순환]';
        seen.add(value);
        const result = '[' + value.cells.map(cell => display(cell.read(), seen)).join(', ') + ']';
        seen.delete(value);
        return result;
    }
    if (value instanceof Ref)
        return value.strict ? '<엄격한 참조>' : '<자리 참조>';
    if (value instanceof UserFunction)
        return `<함수 ${value.name}>`;
    if (value instanceof Builtin)
        return `<기본 함수 ${value.name}>`;
    if (value instanceof Module)
        return `<모듈 ${basename(value.path)}>`;
    if (value instanceof CustomType)
        return `<자료형 ${value.name}>`;
    if (value instanceof Instance)
        return `<${value.type.name} 객체>`;
    return value;
}
export function typeName(value) {
    if (value === null)
        return '없음';
    if (typeof value === 'boolean')
        return '참거짓';
    if (typeof value === 'bigint')
        return '정수';
    if (typeof value === 'number')
        return '실수';
    if (value instanceof Char)
        return '문자';
    if (typeof value === 'string')
        return '문자열';
    if (value instanceof Table)
        return '목록';
    if (value instanceof UserFunction || value instanceof Builtin)
        return '함수';
    if (value instanceof Module)
        return '모듈';
    if (value instanceof CustomType)
        return '사용자자료형';
    if (value instanceof Instance)
        return value.type.name;
    if (value instanceof Ref)
        return value.strict ? '엄격한참조' : '참조';
    throw new Fault('알 수 없는 값 종류입니다.');
}
/** POSIX virtual paths, with slash-form Windows drive roots for the Node host. */
export function normalizePath(path, base = '/') {
    path = path.replace(/\\/g, '/');
    base = base.replace(/\\/g, '/');
    const isAbsolute = (p) => p.startsWith('/') || /^[A-Za-z]:\//.test(p);
    if (!isAbsolute(path))
        path = `${base.replace(/\/$/, '')}/${path}`;
    const drive = /^[A-Za-z]:/.exec(path)?.[0] ?? '';
    const rest = drive ? path.slice(drive.length) : path;
    const segments = [];
    for (const segment of rest.split('/')) {
        if (!segment || segment === '.')
            continue;
        if (segment === '..')
            segments.pop();
        else
            segments.push(segment);
    }
    return `${drive}/${segments.join('/')}`;
}
function dirname(path) { const i = path.lastIndexOf('/'); return i > 0 ? path.slice(0, i) : '/'; }
function basename(path) { return path.slice(path.lastIndexOf('/') + 1); }
function stem(path) { const name = basename(path), dot = name.lastIndexOf('.'); return dot > 0 && dot < name.length - 1 ? name.slice(0, dot) : name; }
export class MemoryFiles {
    files = new Map();
    constructor(initial = {}) {
        for (const [path, source] of initial instanceof Map ? initial.entries() : Object.entries(initial))
            this.writeFile(path, source);
    }
    readFile = (path) => {
        const normalized = normalizePath(path), result = this.files.get(normalized);
        if (result === undefined)
            throw new Error(`파일이 없습니다: ${normalized}`);
        return result;
    };
    writeFile = (path, text) => { this.files.set(normalizePath(path), text); };
}
const ND = /^\p{Nd}$/u;
const digitCache = new Map();
function decimalDigits(text) {
    return Array.from(text, char => {
        if (!ND.test(char))
            return char;
        let cached = digitCache.get(char);
        if (cached !== undefined)
            return cached;
        const cp = char.codePointAt(0);
        let start = cp;
        while (start > 0 && ND.test(String.fromCodePoint(start - 1)))
            start--;
        cached = String((cp - start) % 10);
        digitCache.set(char, cached);
        return cached;
    }).join('');
}
const PY_SPACE = /^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/g;
function stripped(value) { return value.replace(PY_SPACE, ''); }
function finite(value) { if (!Number.isFinite(value))
    throw new Fault('지원하는 실수 범위를 벗어났습니다.'); return value; }
function asFloat(value) { return finite(Number(value)); }
function toInteger(value = 0n) {
    if (typeof value === 'bigint')
        return value;
    if (typeof value === 'boolean')
        return value ? 1n : 0n;
    if (typeof value === 'number')
        return BigInt(Math.trunc(finite(value)));
    if (typeof value !== 'string')
        throw new Fault('정수로 바꿀 수 없는 값입니다.');
    const text = decimalDigits(stripped(value));
    if (!/^[+-]?[0-9](?:_?[0-9])*$/.test(text))
        throw new Fault('정수로 바꿀 수 없는 문자열입니다.');
    return BigInt(text.replaceAll('_', ''));
}
function toFloat(value = 0n) {
    if (typeof value === 'bigint' || typeof value === 'number')
        return asFloat(value);
    if (typeof value === 'boolean')
        return value ? 1 : 0;
    if (typeof value !== 'string')
        throw new Fault('실수로 바꿀 수 없는 값입니다.');
    const text = decimalDigits(stripped(value));
    const digits = '[0-9](?:_?[0-9])*';
    const decimal = new RegExp(`^[+-]?(?:${digits}(?:\\.(?:${digits})?)?|\\.${digits})(?:[eE][+-]?${digits})?$`);
    if (!decimal.test(text) && !/^[+-]?(?:inf(?:inity)?|nan)$/i.test(text))
        throw new Fault('실수로 바꿀 수 없는 문자열입니다.');
    const result = Number(text.replaceAll('_', ''));
    if (!Number.isFinite(result))
        throw new Fault('유한한 실수 범위를 벗어났습니다.');
    return result;
}
function floorBig(left, right) {
    if (right === 0n)
        throw new Fault('0으로 나눌 수 없습니다.');
    const q = left / right, r = left % right;
    return r !== 0n && (r < 0n) !== (right < 0n) ? q - 1n : q;
}
function roundedRatio(n, d) {
    const q = n / d, r = n % d, doubled = r * 2n;
    return doubled > d || (doubled === d && (q & 1n) === 1n) ? q + 1n : q;
}
/** Exact bigint rational -> correctly rounded binary64, without overflowing operands. */
function divideBig(left, right) {
    if (right === 0n)
        throw new Fault('0으로 나눌 수 없습니다.');
    const negative = (left < 0n) !== (right < 0n);
    const n = left < 0n ? -left : left, d = right < 0n ? -right : right;
    if (n === 0n)
        return negative ? -0 : 0;
    let exponent = n.toString(2).length - d.toString(2).length;
    if (exponent >= 0 ? n < (d << BigInt(exponent)) : (n << BigInt(-exponent)) < d)
        exponent--;
    let result;
    if (exponent < -1022)
        result = Number(roundedRatio(n << 1074n, d)) * 2 ** -1074;
    else {
        if (exponent > 1023)
            throw new Fault('지원하는 실수 범위를 벗어났습니다.');
        const shift = 52 - exponent;
        let significand = shift >= 0 ? roundedRatio(n << BigInt(shift), d) : roundedRatio(n, d << BigInt(-shift));
        if (significand === (1n << 53n)) {
            significand >>= 1n;
            exponent++;
        }
        result = Number(significand) * 2 ** (exponent - 52);
    }
    return finite(negative ? -result : result);
}
/** Matches Python float divmod, including floor-rounding and signed zero. */
function floatDivmod(left, right) {
    if (right === 0)
        throw new Fault('0으로 나눌 수 없습니다.');
    let mod = left % right, div = (left - mod) / right;
    if (mod !== 0) {
        if ((right < 0) !== (mod < 0)) {
            mod += right;
            div -= 1;
        }
    }
    else
        mod = right < 0 || Object.is(right, -0) ? -0 : 0;
    let floored;
    if (div !== 0) {
        floored = Math.floor(div);
        if (div - floored > 0.5)
            floored += 1;
    }
    else
        floored = (left < 0 || Object.is(left, -0)) !== (right < 0 || Object.is(right, -0)) ? -0 : 0;
    return [floored, mod];
}
function compareText(left, right) {
    const a = Array.from(left), b = Array.from(right);
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
        const delta = a[i].codePointAt(0) - b[i].codePointAt(0);
        if (delta)
            return Math.sign(delta);
    }
    return Math.sign(a.length - b.length);
}
function sliceIndices(length, start, stop, step) {
    if ([start, stop, step].some(value => value !== null && typeof value !== 'bigint'))
        throw new Fault('슬라이스 번호는 정수여야 합니다.');
    const stride = step === null ? 1n : step;
    if (stride === 0n)
        throw new Fault('실행 오류: slice step cannot be zero');
    const size = BigInt(length), positive = stride > 0n;
    const clamp = (value, lo, hi) => value < lo ? lo : value > hi ? hi : value;
    const normalize = (value, isStart) => {
        if (value === null)
            return positive ? (isStart ? 0n : size) : (isStart ? size - 1n : -1n);
        let index = value;
        if (index < 0n)
            index += size;
        return positive ? clamp(index, 0n, size) : clamp(index, -1n, size - 1n);
    };
    const indices = [], end = normalize(stop, false);
    for (let i = normalize(start, true); positive ? i < end : i > end; i += stride)
        indices.push(Number(i));
    return indices;
}
export class Interpreter {
    wordAliases = new Map();
    output;
    input;
    readFile;
    writeFile;
    debugger;
    maxSteps;
    steps = 0;
    path = null;
    modules = new Map();
    loading = new Set();
    activeErrors = [];
    callDepth = 0;
    activeLoopDepth = 0;
    base = new Env();
    globals = new Env(this.base);
    files;
    loopBindings = 'fresh';
    constructor(options = {}) {
        this.wordAliases = new Map(options.wordAliases ?? []);
        this.output = options.output ?? (text => console.log(text));
        this.input = options.input ?? (() => { throw new InputEOF(); });
        this.files = options.files ?? new MemoryFiles();
        this.readFile = options.readFile ?? this.files.readFile;
        this.writeFile = options.writeFile ?? this.files.writeFile;
        this.debugger = options.debugger;
        this.maxSteps = options.maxSteps ?? 1_000_000;
        if (!Number.isSafeInteger(this.maxSteps) || this.maxSteps < 1)
            throw new Error('maxSteps는 양의 안전한 정수여야 합니다.');
        this.installBuiltins();
    }
    installBuiltins() {
        const add = (name, min, max, fn) => this.base.declare(name, new Builtin(name, fn, min, max));
        add('ㅂ', 0, Infinity, (...values) => { this.output(values.map(value => display(value)).join(' ')); return null; });
        add('ㅅ', 0, 1, toInteger);
        add('ㅆ', 0, 1, toFloat);
        add('ㅈ', 1, 1, value => {
            if (typeof value === 'bigint') {
                if (value < 0n || value > 0x10ffffn || value >= 0xd800n && value <= 0xdfffn)
                    throw new Fault('유효한 유니코드 문자 번호가 아닙니다.');
                return new Char(String.fromCodePoint(Number(value)));
            }
            const text = textValue(value);
            if (text !== null)
                return new Char(text);
            throw new Fault('문자는 유니코드 코드포인트 하나여야 합니다.');
        });
        add('ㅉ', 0, 1, (value = '') => display(value));
        add('ㅌ', 0, Infinity, (...values) => {
            if (values.length === 1) {
                if (values[0] instanceof Table)
                    return new Table(values[0].values());
                const text = textValue(values[0]);
                if (text !== null)
                    return new Table(Array.from(text, char => new Char(char)));
            }
            return new Table(values);
        });
        add('ㅐ', 1, 1, value => {
            if (value instanceof Table)
                return BigInt(value.length);
            const text = textValue(value);
            if (text !== null)
                return BigInt(Array.from(text).length);
            throw new Fault('길이는 문자열이나 목록에서 구합니다.');
        });
        add('ㅝ', 1, 1, value => typeName(value));
        add('입력', 0, 1, async (prompt = '') => {
            try {
                const value = await this.input(display(prompt));
                if (typeof value !== 'string')
                    throw new InputEOF();
                return value;
            }
            catch (error) {
                if (error instanceof InputEOF || (error instanceof Error && error.name === 'EOFError'))
                    throw new Fault('입력이 끝났습니다.');
                throw error;
            }
        });
        add('범위', 1, 3, (...values) => {
            if (values.some(value => typeof value !== 'bigint'))
                throw new Fault('범위에는 정수 인수 1~3개가 필요합니다.');
            const nums = values, start = nums.length === 1 ? 0n : nums[0], stop = nums.length === 1 ? nums[0] : nums[1], step = nums[2] ?? 1n;
            if (step === 0n)
                throw new Fault('범위 간격은 0일 수 없습니다.');
            const distance = step > 0n ? stop - start : start - stop, stride = step > 0n ? step : -step;
            const count = distance <= 0n ? 0n : (distance + stride - 1n) / stride;
            if (count > BigInt(this.maxSteps))
                throw new Fault('범위가 실행 한도를 초과합니다.');
            const result = [];
            for (let i = 0n; i < count; i++)
                result.push(start + i * step);
            return new Table(result);
        });
        add('추가', 2, 2, (target, value) => { if (!(target instanceof Table))
            throw new Fault('추가할 대상은 목록이어야 합니다.'); target.cells.push(new Cell(value)); return target; });
        add('삽입', 3, 3, (target, index, value) => {
            if (!(target instanceof Table) || typeof index !== 'bigint')
                throw new Fault('삽입에는 목록과 정수 번호가 필요합니다.');
            if (index < 0n || index > BigInt(target.length))
                throw new Fault('삽입 번호가 범위를 벗어났습니다.');
            target.cells.splice(Number(index), 0, new Cell(value));
            return target;
        });
        add('삭제', 2, 2, (target, index) => {
            if (!(target instanceof Table))
                throw new Fault('삭제할 대상은 목록이어야 합니다.');
            const i = itemIndex(index, target.length), cell = target.cells[i], result = cell.read();
            target.cells.splice(i, 1);
            cell.alive = false;
            return result;
        });
        add('복사', 1, 1, target => { if (!(target instanceof Table))
            throw new Fault('복사할 대상은 목록이어야 합니다.'); return new Table(target.values()); });
        add('읽기', 1, 1, async (path) => this.readFile(this.resolvePath(path)));
        add('쓰기', 2, 2, async (path, value) => { const text = textValue(value); if (text === null)
            throw new Fault('파일에 쓸 내용은 문자열이어야 합니다.'); await this.writeFile(this.resolvePath(path), text); return null; });
    }
    resolvePath(path) {
        const text = textValue(path);
        if (text === null)
            throw new Fault('파일 경로는 문자열이어야 합니다.');
        return normalizePath(text, this.path ? dirname(this.path) : '/');
    }
    tick(node) { if (++this.steps > this.maxSteps)
        throw new Fault(`실행 한도 ${this.maxSteps}단계를 넘었습니다.`, node, { path: this.path }); }
    at(error, node) {
        if (!error.line) {
            error.line = node.line;
            error.col = node.col;
        }
        if (error.path === null)
            error.path = this.path;
        return error;
    }
    wrap(error, node) {
        if (error instanceof Fault)
            throw this.at(error, node);
        if (error instanceof Flow || error instanceof DebugAbort || error instanceof ParseError)
            throw error;
        throw new Fault(`실행 오류: ${error instanceof Error ? error.message : String(error)}`, node, { path: this.path });
    }
    async execute(source, path, env) {
        const oldPath = this.path, oldLoop = this.activeLoopDepth;
        this.path = path ? normalizePath(path) : null;
        this.activeLoopDepth = 0;
        const target = env ?? this.globals;
        const declaredNames = new Set();
        for (let scope = target; scope; scope = scope.parent)
            for (const name of scope.cells.keys())
                declaredNames.add(name);
        try {
            const nodes = parse(source, { declaredNames, wordAliases: this.wordAliases });
            this.validate(nodes);
            await this.block(nodes, target);
        }
        catch (error) {
            if (error instanceof ParseError) {
                if (!error.path)
                    error.path = this.path;
                throw error;
            }
            if (error instanceof Fault) {
                if (error.path === null)
                    error.path = this.path;
                throw error;
            }
            if (error instanceof Flow)
                throw new Fault('현재 위치에서 사용할 수 없는 실행 제어입니다.', null, { path: this.path });
            throw error;
        }
        finally {
            this.path = oldPath;
            this.activeLoopDepth = oldLoop;
        }
        return target;
    }
    async runFile(path) {
        path = normalizePath(path);
        let source;
        try {
            source = await this.readFile(path);
        }
        catch (error) {
            throw new Fault(`파일을 읽지 못했습니다: ${error instanceof Error ? error.message : String(error)}`, null, { path });
        }
        this.loading.add(path);
        try {
            return await this.execute(source, path);
        }
        finally {
            this.loading.delete(path);
        }
    }
    validate(nodes, context = {}) {
        const c = { inFunction: false, loopDepth: 0, inHandler: false, visibleLabels: new Set(), ...context };
        const labels = new Set();
        for (const n of nodes)
            if (n.kind === 'label') {
                if (labels.has(n.args.name))
                    throw new Fault(`중복 라벨입니다: ${n.args.name}`, n);
                labels.add(n.args.name);
            }
        const accessible = new Set([...c.visibleLabels, ...labels]);
        for (const n of nodes) {
            const a = n.args;
            if (n.kind === 'goto' && !accessible.has(a.name))
                throw new Fault(`현재 범위에서 보이지 않는 라벨입니다: ${a.name}`, n);
            if (n.kind === 'return' && !c.inFunction)
                throw new Fault('ㄷ 반환은 함수 안에서 사용합니다.', n);
            if (['break', 'continue'].includes(n.kind) && !c.loopDepth)
                throw new Fault('반복 제어는 반복문 안에서 사용합니다.', n);
            if (n.kind === 'throw' && a.value === null && !c.inHandler)
                throw new Fault('다시 발생시킬 예외가 없습니다.', n);
            const nested = { ...c, visibleLabels: accessible };
            if (n.kind === 'function' || n.kind === 'custom_type')
                this.validate(a.body, { inFunction: true });
            else if (n.kind === 'if') {
                for (const [, body] of a.branches)
                    this.validate(body, nested);
                this.validate(a.otherwise ?? [], nested);
            }
            else if (['while', 'for'].includes(n.kind))
                this.validate(a.body, { ...nested, loopDepth: c.loopDepth + 1 });
            else if (n.kind === 'try') {
                this.validate(a.body, nested);
                this.validate(a.handler, { ...nested, inHandler: true });
            }
        }
    }
    async block(nodes, env) {
        const labels = new Map();
        nodes.forEach((n, i) => { if (n.kind === 'label')
            labels.set(n.args.name, i); });
        for (let i = 0; i < nodes.length;) {
            try {
                await this.statement(nodes[i], env);
            }
            catch (error) {
                if (error instanceof Jump && labels.has(error.name)) {
                    i = labels.get(error.name);
                    continue;
                }
                throw error;
            }
            i++;
        }
    }
    async loopBody(body, env) { this.activeLoopDepth++; try {
        await this.block(body, env);
    }
    finally {
        this.activeLoopDepth--;
    } }
    async statement(n, env) {
        this.tick(n);
        const a = n.args;
        try {
            switch (n.kind) {
                case 'declare':
                    env.declare(a.name, await this.expr(a.value, env), n);
                    break;
                case 'assign': {
                    const cell = await this.place(a.target, env);
                    const value = await this.expr(a.value, env);
                    cell.write(value);
                    break;
                }
                case 'expr':
                    await this.expr(a.value, env);
                    break;
                case 'if': {
                    let chosen = false;
                    for (const [condition, body] of a.branches)
                        if (truth(await this.expr(condition, env))) {
                            await this.block(body, env);
                            chosen = true;
                            break;
                        }
                    if (!chosen)
                        await this.block(a.otherwise ?? [], env);
                    break;
                }
                case 'while':
                    while (truth(await this.expr(a.condition, env))) {
                        try {
                            await this.loopBody(a.body, new Env(env));
                        }
                        catch (error) {
                            if (error instanceof ContinueFlow)
                                continue;
                            if (error instanceof BreakFlow)
                                break;
                            throw error;
                        }
                    }
                    break;
                case 'for': {
                    const iterable = await this.expr(a.iterable, env), text = textValue(iterable);
                    const items = iterable instanceof Table ? iterable.values() : text !== null ? Array.from(text, char => new Char(char)) : null;
                    if (items === null)
                        throw new Fault('반복 대상은 목록이나 문자열이어야 합니다.');
                    for (const item of items) {
                        this.tick(n);
                        const local = new Env(env);
                        local.declare(a.name, item);
                        try {
                            await this.loopBody(a.body, local);
                        }
                        catch (error) {
                            if (error instanceof ContinueFlow)
                                continue;
                            if (error instanceof BreakFlow)
                                break;
                            throw error;
                        }
                    }
                    break;
                }
                case 'function':
                    env.declare(a.name, new UserFunction(a.params, a.body, env, this.path, false, a.name), n);
                    break;
                case 'custom_type':
                    env.declare(a.name, new CustomType(a.name, a.params, a.body, env, this.path), n);
                    break;
                case 'return': throw new Returned(a.value === null ? null : await this.expr(a.value, env), a.value !== null);
                case 'break': throw new BreakFlow();
                case 'continue': throw new ContinueFlow();
                case 'pass':
                case 'label': break;
                case 'goto': throw new Jump(a.name);
                case 'try':
                    try {
                        await this.block(a.body, env);
                    }
                    catch (error) {
                        if (!(error instanceof Fault))
                            throw error;
                        if (a.error_name) {
                            const cell = env.cells.get(a.error_name);
                            if (cell)
                                cell.write(error.value);
                            else
                                env.declare(a.error_name, error.value);
                        }
                        this.activeErrors.push(error);
                        try {
                            await this.block(a.handler, env);
                        }
                        finally {
                            this.activeErrors.pop();
                        }
                    }
                    break;
                case 'throw': {
                    if (a.value === null) {
                        if (!this.activeErrors.length)
                            throw new Fault('다시 발생시킬 예외가 없습니다.');
                        throw this.activeErrors[this.activeErrors.length - 1];
                    }
                    const value = await this.expr(a.value, env);
                    throw new Fault(display(value), n, { value, path: this.path });
                }
                case 'debug':
                    if (a.value === null || !truth(await this.expr(a.value, env))) {
                        if (!this.debugger)
                            throw new Fault('ㅙ 정지: 연결된 대화형 디버거가 없습니다.');
                        await this.debugger(this, env, n);
                    }
                    break;
                case 'import': {
                    const path = this.resolvePath(a.path), alias = a.alias ?? stem(path);
                    if (!isIdentifier(alias))
                        throw new Fault('이 파일 이름은 코드의 이름으로 쓸 수 없습니다. 가져오기 경로 뒤에 별칭을 적어 주세요.');
                    if (this.loading.has(path))
                        throw new Fault(`순환 가져오기입니다: ${basename(path)}`);
                    if (!this.modules.has(path)) {
                        const moduleEnv = new Env(this.base);
                        this.loading.add(path);
                        try {
                            let source;
                            try {
                                source = await this.readFile(path);
                            }
                            catch (error) {
                                throw new Fault(`가져올 파일을 읽지 못했습니다: ${path}: ${error instanceof Error ? error.message : String(error)}`);
                            }
                            try {
                                await this.execute(source, path, moduleEnv);
                            }
                            catch (error) {
                                if (error instanceof ParseError) {
                                    const fault = new Fault(`가져온 파일의 구문 오류: ${error.message}`, null, { path });
                                    fault.line = error.line;
                                    fault.col = error.col;
                                    throw fault;
                                }
                                throw error;
                            }
                        }
                        finally {
                            this.loading.delete(path);
                        }
                        this.modules.set(path, new Module(moduleEnv, path));
                    }
                    env.declare(alias, this.modules.get(path), n);
                    break;
                }
                default: throw new Fault(`지원하지 않는 문장 노드입니다: ${n.kind}`);
            }
        }
        catch (error) {
            this.wrap(error, n);
        }
    }
    async place(n, env, allowValue = false) {
        const a = n.args;
        if (n.kind === 'name')
            return env.lookup(a.name);
        if (n.kind === 'index') {
            const target = await this.expr(a.target, env), index = await this.expr(a.index, env);
            if (target instanceof Table)
                return target.at(index);
            const text = textValue(target);
            if (text !== null && typeof index === 'bigint') {
                const chars = Array.from(text), value = new Char(chars[itemIndex(index, chars.length)]);
                if (allowValue)
                    return new Cell(value);
                throw new Fault('문자열의 항목은 읽기만 가능합니다.', n);
            }
            throw new Fault('번호 접근에는 목록 또는 문자열과 정수 번호가 필요합니다.', n);
        }
        if (n.kind === 'member') {
            const target = await this.expr(a.target, env);
            if (!(target instanceof Module) && !(target instanceof Instance))
                throw new Fault('멤버에 접근할 수 있는 모듈 또는 객체가 아닙니다.', n);
            if (!target.env.cells.has(a.name))
                throw new Fault(target instanceof Module ? '모듈에 해당 이름이 없습니다.' : '객체에 해당 이름이 없습니다.', n);
            return target.env.cells.get(a.name);
        }
        if (n.kind === 'unary' && ['ㅕ', 'ㅢ'].includes(a.op)) {
            const ref = await this.expr(a.value, env);
            if (a.op === 'ㅕ' && !(ref instanceof Ref) && allowValue)
                return new Cell(ref);
            if (!(ref instanceof Ref) || (a.op === 'ㅢ' && !ref.strict))
                throw new Fault('이 쓰기에는 올바른 자리 참조가 필요합니다.', n);
            return ref.cell;
        }
        if (allowValue)
            return new Cell(await this.expr(n, env));
        throw new Fault('값을 저장할 수 있는 자리가 아닙니다.', n);
    }
    async expr(n, env) {
        this.tick(n);
        const a = n.args;
        try {
            switch (n.kind) {
                case 'literal': return a.char ? new Char(a.value) : a.value;
                case 'name': return env.lookup(a.name).read();
                case 'list': {
                    const values = [];
                    for (const item of a.items)
                        values.push(await this.expr(item, env));
                    return new Table(values);
                }
                case 'lambda': return new UserFunction(a.params, a.body, env, this.path, true);
                case 'unary': {
                    if (a.op === 'ㅓ' || a.op === 'ㅟ') {
                        const cell = await this.place(a.value, env, a.op === 'ㅓ');
                        cell.read();
                        return new Ref(cell, a.op === 'ㅟ');
                    }
                    const value = await this.expr(a.value, env);
                    if (a.op === 'ㅕ')
                        return value instanceof Ref ? value.cell.read() : value;
                    if (a.op === 'ㅢ') {
                        if (!(value instanceof Ref) || !value.strict)
                            throw new Fault('ㅢ에는 엄격한 참조가 필요합니다.');
                        return value.cell.read();
                    }
                    if (a.op === 'ㄴ')
                        return !truth(value);
                    if (typeof value !== 'bigint' && typeof value !== 'number')
                        throw new Fault('부호 연산은 수에만 적용합니다.');
                    if (a.op === '+')
                        return value;
                    if (a.op === '-')
                        return -value;
                    throw new Fault(`알 수 없는 단항 연산입니다: ${a.op}`);
                }
                case 'binary': {
                    const op = a.op, left = await this.expr(a.left, env);
                    if (op === 'ㅘ')
                        return truth(left) && truth(await this.expr(a.right, env));
                    if (op === 'ㅣ')
                        return truth(left) || truth(await this.expr(a.right, env));
                    const right = await this.expr(a.right, env);
                    if (op === 'ㅞ') {
                        if (!(left instanceof Table))
                            throw new Fault('ㅞ 왼쪽에는 목록이 필요합니다.');
                        if (!(right instanceof UserFunction) && !(right instanceof Builtin))
                            throw new Fault('ㅞ 오른쪽에는 검사 함수가 필요합니다.');
                        if (right instanceof UserFunction && right.params.length !== 1)
                            throw new Fault('ㅞ 검사 함수에는 매개변수 하나가 필요합니다.');
                        if (right instanceof Builtin && !right.accepts(1))
                            throw new Fault('ㅞ 검사 함수는 인수 하나로 호출할 수 있어야 합니다.');
                        const result = [];
                        for (const value of left.values()) {
                            this.tick(n);
                            if (truth(await this.call(right, [value], n)))
                                result.push(value);
                        }
                        return new Table(result);
                    }
                    if (op === 'ㅔ') {
                        if (right instanceof Table)
                            return right.values().some(item => equal(left, item));
                        const lt = textValue(left), rt = textValue(right);
                        if (lt !== null && rt !== null)
                            return rt.includes(lt);
                        throw new Fault('ㅔ 오른쪽에는 목록이나 문자열이 필요합니다.');
                    }
                    if (op === '==')
                        return equal(left, right);
                    if (op === '!=')
                        return !equal(left, right);
                    if (op === '+' && left instanceof Table && right instanceof Table)
                        return new Table([...left.values(), ...right.values()]);
                    const lt = textValue(left), rt = textValue(right);
                    if (op === '+' && lt !== null && rt !== null)
                        return lt + rt;
                    if (['<', '<=', '>', '>='].includes(op) && lt !== null && rt !== null) {
                        const c = compareText(lt, rt);
                        return op === '<' ? c < 0 : op === '<=' ? c <= 0 : op === '>' ? c > 0 : c >= 0;
                    }
                    return this.arithmetic(op, left, right);
                }
                case 'call': {
                    const callee = await this.expr(a.callee, env), values = [];
                    for (const arg of a.args)
                        values.push(await this.expr(arg, env));
                    return await this.call(callee, values, n);
                }
                case 'index': {
                    const target = await this.expr(a.target, env), index = await this.expr(a.index, env);
                    if (target instanceof Table)
                        return target.at(index).read();
                    const text = textValue(target);
                    if (text !== null && typeof index === 'bigint') {
                        const chars = Array.from(text);
                        return new Char(chars[itemIndex(index, chars.length)]);
                    }
                    throw new Fault('번호 접근에는 목록 또는 문자열과 정수 번호가 필요합니다.');
                }
                case 'slice': {
                    const target = await this.expr(a.target, env), parts = [];
                    for (const key of ['start', 'stop', 'step'])
                        parts.push(a[key] === null ? null : await this.expr(a[key], env));
                    const text = textValue(target), values = target instanceof Table ? target.values() : text !== null ? Array.from(text) : null;
                    if (values === null)
                        throw new Fault('슬라이스 대상은 목록이나 문자열이어야 합니다.');
                    const selected = sliceIndices(values.length, parts[0], parts[1], parts[2]).map(index => values[index]);
                    return target instanceof Table ? new Table(selected) : selected.join('');
                }
                case 'member': return (await this.place(n, env)).read();
                default: throw new Fault(`지원하지 않는 식 노드입니다: ${n.kind}`);
            }
        }
        catch (error) {
            this.wrap(error, n);
        }
    }
    arithmetic(op, left, right) {
        if ((typeof left !== 'bigint' && typeof left !== 'number') || (typeof right !== 'bigint' && typeof right !== 'number'))
            throw new Fault(`${op}의 두 값은 수여야 합니다.`);
        // JS relational comparison between bigint and number compares exact integer values.
        if (op === '<')
            return left < right;
        if (op === '<=')
            return left <= right;
        if (op === '>')
            return left > right;
        if (op === '>=')
            return left >= right;
        if (typeof left === 'bigint' && typeof right === 'bigint') {
            if (op === '+')
                return left + right;
            if (op === '-')
                return left - right;
            if (op === '*')
                return left * right;
            if (op === '/')
                return divideBig(left, right);
            if (op === '//')
                return floorBig(left, right);
            if (op === '%')
                return left - floorBig(left, right) * right;
            if (op === '**' && right >= 0n)
                return left ** right;
        }
        const l = asFloat(left), r = asFloat(right);
        if (op === '+')
            return finite(l + r);
        if (op === '-')
            return finite(l - r);
        if (op === '*')
            return finite(l * r);
        if (op === '/') {
            if (r === 0)
                throw new Fault('0으로 나눌 수 없습니다.');
            return finite(l / r);
        }
        if (op === '//' || op === '%')
            return finite(floatDivmod(l, r)[op === '//' ? 0 : 1]);
        if (op === '**')
            return finite(l ** r);
        throw new Fault(`알 수 없는 연산입니다: ${op}`);
    }
    async call(callee, values, node) {
        if (callee instanceof Builtin) {
            if (!callee.accepts(values.length))
                throw new Fault(`${callee.name}: 인수 개수가 맞지 않습니다.`, node);
            return await callee.fn(...values);
        }
        if (callee instanceof CustomType) {
            if (values.length !== callee.params.length)
                throw new Fault(`${callee.name}: 인수 ${callee.params.length}개가 필요합니다.`, node);
            if (this.callDepth >= 150)
                throw new Fault('함수 호출 깊이가 150을 넘었습니다.', node);
            const parameters = new Env(callee.closure), fields = new Env(parameters);
            callee.params.forEach((name, i) => parameters.declare(name, values[i]));
            const instance = new Instance(callee, fields);
            fields.declare('자신', instance);
            const oldPath = this.path, oldLoop = this.activeLoopDepth;
            this.path = callee.path;
            this.activeLoopDepth = 0;
            this.callDepth++;
            try {
                try {
                    await this.block(callee.body, fields);
                }
                catch (error) {
                    if (!(error instanceof Returned))
                        throw error;
                    if (error.hasValue)
                        throw new Fault('자료형 생성자에서는 값을 반환할 수 없습니다.', node);
                }
                return instance;
            }
            finally {
                this.callDepth--;
                this.path = oldPath;
                this.activeLoopDepth = oldLoop;
            }
        }
        if (!(callee instanceof UserFunction))
            throw new Fault('호출할 수 있는 함수가 아닙니다.', node);
        if (values.length !== callee.params.length)
            throw new Fault(`${callee.name}: 인수 ${callee.params.length}개가 필요합니다.`, node);
        if (this.callDepth >= 150)
            throw new Fault('함수 호출 깊이가 150을 넘었습니다.', node);
        const local = new Env(callee.closure);
        callee.params.forEach((name, i) => local.declare(name, values[i]));
        const oldPath = this.path, oldLoop = this.activeLoopDepth;
        this.path = callee.path;
        this.activeLoopDepth = 0;
        this.callDepth++;
        try {
            if (callee.expression)
                return await this.expr(callee.body, local);
            try {
                await this.block(callee.body, local);
            }
            catch (error) {
                if (error instanceof Returned)
                    return error.value;
                throw error;
            }
            return null;
        }
        finally {
            this.callDepth--;
            this.path = oldPath;
            this.activeLoopDepth = oldLoop;
        }
    }
}
//# sourceMappingURL=runtime.js.map