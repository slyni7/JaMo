/** Direct lexer/Pratt parser port. No source normalization or JS evaluation. */
import { commandParts, commandSymbols, decomposableSpelling } from './hangul.js';
export class ParseError extends Error {
    line;
    col;
    path;
    constructor(message, line, col) {
        super(message);
        this.line = line;
        this.col = col;
        this.name = "ParseError";
    }
    toString() { return `${this.line}행 ${this.col}열: ${this.message}`; }
}
export const KEYWORDS = new Set(Array.from("ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎㅏㅑㅓㅕㅗㅛㅜㅠㅡㅣㅐㅒㅔㅖㅘㅙㅚㅝㅞㅟㅢ"));
const BUILTINS = new Set(Array.from("ㅂㅅㅆㅈㅉㅌㅐㅝ"));
const LITERALS = new Map([["ㅖ", true], ["ㅗ", false], ["ㅜ", null]]);
export const MAX_SYNTAX_DEPTH = 128;
function jamo(char) {
    const point = char.codePointAt(0);
    return (point >= 0x1100 && point <= 0x11ff) || (point >= 0x3130 && point <= 0x318f)
        || (point >= 0xa960 && point <= 0xa97f) || (point >= 0xd7b0 && point <= 0xd7ff)
        || (point >= 0xffa0 && point <= 0xffdc);
}
// Python 3.12 / Unicode 15 isdigit() includes these non-Nd digit characters.
// Fractions and other numeric characters must not silently become name parts.
const EXTRA_DIGITS = [
    [178, 179], [185, 185], [4969, 4977], [6618, 6618], [8304, 8304],
    [8308, 8313], [8320, 8329], [9312, 9320], [9332, 9340], [9352, 9360],
    [9450, 9450], [9461, 9469], [9471, 9471], [10102, 10110], [10112, 10120],
    [10122, 10130], [68160, 68163], [69216, 69224], [69714, 69722], [127232, 127242],
];
function nameStart(char) {
    return char === "_" || (/^\p{L}$/u.test(char) && !jamo(char));
}
function namePart(char) {
    if (jamo(char))
        return false;
    if (nameStart(char) || /^[\p{Nd}\p{Mn}\p{Mc}]$/u.test(char))
        return true;
    const point = char.codePointAt(0);
    return EXTRA_DIGITS.some(([start, end]) => point >= start && point <= end);
}
export function isIdentifier(value) {
    const chars = Array.from(value);
    return chars.length > 0 && nameStart(chars[0]) && chars.slice(1).every(namePart);
}
const digit = (char) => char !== undefined && /^[0-9]$/.test(char);
const whitespace = (char) => char !== undefined && /^[ \t\f\v\n\r]$/.test(char);
class Lexer {
    chars;
    pos = 0;
    line = 1;
    col = 1;
    tokens = [];
    delimiters = [];
    constructor(source) {
        // Count positions in codepoints, not JavaScript UTF-16 code units.
        this.chars = Array.from(source.replace(/\r\n/g, "\n").replace(/\r/g, "\n"));
    }
    advance() {
        const char = this.chars[this.pos++];
        if (char === "\n") {
            this.line++;
            this.col = 1;
        }
        else
            this.col++;
        return char;
    }
    emit(kind, value, line = this.line, col = this.col) {
        this.tokens.push({ kind, value, line, col, whitespaceAfter: whitespace(this.chars[this.pos]) });
    }
    pair() { return this.chars.slice(this.pos, this.pos + 2).join(""); }
    newline() {
        this.emit(this.delimiters.length === 0 ? "SEP" : "SOFT_NL", "\n");
        this.advance();
    }
    string() {
        const { line, col } = this;
        const quote = this.advance();
        const chars = [];
        const escapes = {
            n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", a: "\x07", "0": "\0",
            "\\": "\\", "'": "'", '"': '"',
        };
        while (this.pos < this.chars.length) {
            const char = this.advance();
            if (char === quote) {
                const value = chars.join("");
                if (quote === "'" && Array.from(value).length !== 1)
                    throw new ParseError("문자 리터럴에는 유니코드 코드포인트 하나가 필요합니다", line, col);
                this.emit(quote === "'" ? "CHAR" : "STRING", value, line, col);
                return;
            }
            if (char === "\n")
                throw new ParseError("문자열 안의 줄바꿈은 \\n으로 써 주세요", line, col);
            if (char !== "\\") {
                const point = char.codePointAt(0);
                if (point >= 0xd800 && point <= 0xdfff)
                    throw new ParseError("서로게이트는 독립적인 유니코드 문자로 쓸 수 없습니다", this.line, this.col - 1);
                chars.push(char);
                continue;
            }
            if (this.pos >= this.chars.length)
                break;
            const escapeLine = this.line, escapeCol = this.col;
            const escape = this.advance();
            if (Object.hasOwn(escapes, escape))
                chars.push(escapes[escape]);
            else if (["x", "u", "U"].includes(escape)) {
                const size = { x: 2, u: 4, U: 8 }[escape];
                const digits = this.chars.slice(this.pos, this.pos + size).join("");
                if (digits.length !== size || !/^[0-9a-fA-F]+$/.test(digits))
                    throw new ParseError(`\\${escape} 뒤에는 16진수 ${size}자리가 필요합니다`, escapeLine, escapeCol);
                for (let index = 0; index < size; index++)
                    this.advance();
                const value = Number.parseInt(digits, 16);
                if (value > 0x10ffff)
                    throw new ParseError("유니코드 코드포인트 범위를 벗어났습니다", escapeLine, escapeCol);
                if (value >= 0xd800 && value <= 0xdfff)
                    throw new ParseError("서로게이트는 독립적인 유니코드 문자로 쓸 수 없습니다", escapeLine, escapeCol);
                chars.push(String.fromCodePoint(value));
            }
            else
                throw new ParseError(`알 수 없는 이스케이프 \\${escape}`, escapeLine, escapeCol);
        }
        throw new ParseError("문자열을 닫는 따옴표가 없습니다", line, col);
    }
    number() {
        const begin = this.pos, { line, col } = this;
        while (digit(this.chars[this.pos]))
            this.advance();
        let floating = false;
        if (this.chars[this.pos] === ".") {
            floating = true;
            this.advance();
            while (digit(this.chars[this.pos]))
                this.advance();
        }
        if (["e", "E"].includes(this.chars[this.pos])) {
            floating = true;
            this.advance();
            if (["+", "-"].includes(this.chars[this.pos]))
                this.advance();
            const beginExponent = this.pos;
            while (digit(this.chars[this.pos]))
                this.advance();
            if (this.pos === beginExponent)
                throw new ParseError("지수 뒤에 숫자가 필요합니다", line, col);
        }
        const spelling = this.chars.slice(begin, this.pos).join("");
        const value = floating ? Number(spelling) : BigInt(spelling);
        if (typeof value === "number" && !Number.isFinite(value))
            throw new ParseError("유한 실수 범위를 벗어난 숫자 리터럴입니다", line, col);
        this.emit("NUMBER", value, line, col);
    }
    run() {
        while (this.pos < this.chars.length) {
            const char = this.chars[this.pos];
            if ([" ", "\t", "\f", "\v"].includes(char) || (char === "\ufeff" && this.pos === 0))
                this.advance();
            else if (char === "\n")
                this.newline();
            else if (char === "#") {
                while (this.pos < this.chars.length && this.chars[this.pos] !== "\n")
                    this.advance();
            }
            else if (this.pair() === "/*") {
                const { line, col } = this;
                this.advance();
                this.advance();
                while (this.pos < this.chars.length && this.pair() !== "*/") {
                    if (this.chars[this.pos] === "\n")
                        this.newline();
                    else
                        this.advance();
                }
                if (this.pos >= this.chars.length)
                    throw new ParseError("여러 줄 주석을 닫는 */가 없습니다", line, col);
                this.advance();
                this.advance();
            }
            else if (["'", '"'].includes(char))
                this.string();
            else if (digit(char) || (char === "." && digit(this.chars[this.pos + 1])))
                this.number();
            else if (KEYWORDS.has(char)) {
                this.tokens.push({ kind: char, value: char, line: this.line, col: this.col,
                    whitespaceAfter: whitespace(this.chars[this.pos + 1]) });
                this.advance();
            }
            else if (jamo(char) && commandParts(char) !== null) {
                const begin = this.pos, { line, col } = this;
                this.advance();
                while (this.pos < this.chars.length && jamo(this.chars[this.pos])
                    && !KEYWORDS.has(this.chars[this.pos]) && commandParts(this.chars[this.pos]) !== null)
                    this.advance();
                this.emit("NAME", this.chars.slice(begin, this.pos).join(""), line, col);
            }
            else if (jamo(char))
                throw new ParseError(`자모 '${char}'에는 배정된 문법이 없습니다`, this.line, this.col);
            else if (nameStart(char)) {
                const begin = this.pos, { line, col } = this;
                this.advance();
                while (this.pos < this.chars.length && namePart(this.chars[this.pos]))
                    this.advance();
                this.emit("NAME", this.chars.slice(begin, this.pos).join(""), line, col);
            }
            else if (char === ";") {
                this.emit("SEP", ";");
                this.advance();
            }
            else {
                const { line, col } = this;
                const pair = this.pair();
                if (["==", "!=", "<=", ">=", "//", "**", "=>"].includes(pair)) {
                    this.emit(pair, pair);
                    this.advance();
                    this.advance();
                }
                else if ("+-*/%<>=()[]:,.".includes(char)) {
                    if ("([".includes(char))
                        this.delimiters.push({ char, line, col });
                    else if (")]".includes(char)) {
                        const expected = char === ")" ? "(" : "[";
                        if (this.delimiters.at(-1)?.char !== expected)
                            throw new ParseError(`짝이 맞지 않는 닫는 괄호 ${char}`, line, col);
                        this.delimiters.pop();
                    }
                    this.emit(char, char);
                    this.advance();
                }
                else
                    throw new ParseError(`알 수 없는 문자 ${JSON.stringify(char)}`, line, col);
            }
        }
        if (this.delimiters.length) {
            const { char, line, col } = this.delimiters.at(-1);
            throw new ParseError(`${char}에 대응하는 닫는 괄호가 없습니다`, line, col);
        }
        this.emit("EOF", null);
        return this.tokens;
    }
}
const CONSONANTS = new Set(Array.from("ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"));
function spellingTokens(token) {
    if (token.kind !== "NAME" || !decomposableSpelling(token.value))
        return [{ ...token, sourceEnd: token.sourceEnd ?? token.col + 1 }];
    const result = [];
    const chars = Array.from(token.value);
    chars.forEach((char, offset) => {
        const symbols = Array.from(commandSymbols(char));
        const parts = Array.from(commandParts(char));
        parts.forEach((part, index) => result.push({ ...token, kind: part, value: part,
            col: token.col + offset, sourceEnd: token.col + offset + 1,
            origins: [...(token.origins ?? []), ...symbols],
            clusterContinuation: index > 0 && CONSONANTS.has(part) && CONSONANTS.has(parts[index - 1]),
            whitespaceAfter: offset === chars.length - 1 && index === parts.length - 1 ? token.whitespaceAfter : false }));
    });
    return result;
}
/** Adjacency is source adjacency, never adjacency created by removing whitespace/comments. */
function packCombos(tokens) {
    const adjacent = (left, right) => right && left.line === right.line
        && !left.whitespaceAfter && (left.col === right.col || left.sourceEnd === right.col);
    const result = [];
    for (let index = 0; index < tokens.length; index++) {
        const first = tokens[index], middle = tokens[index + 1], last = tokens[index + 2];
        if (!CONSONANTS.has(first.kind) || middle?.kind !== "ㅛ" || !CONSONANTS.has(last?.kind)
            || !adjacent(first, middle) || !adjacent(middle, last)) {
            result.push(first);
            continue;
        }
        const suffix = [last];
        // A compound final is one source character, and retains both of its command parts.
        while (tokens[index + 3]?.clusterContinuation)
            suffix.push(tokens.splice(index + 3, 1)[0]);
        result.push({ ...first, kind: "COMBO", value: { prefix: [first], suffix },
            origins: [first, middle, ...suffix].flatMap(part => part.origins ?? [part.kind]),
            sourceEnd: suffix.at(-1).sourceEnd, whitespaceAfter: suffix.at(-1).whitespaceAfter });
        index += 2;
    }
    return result;
}
/** Word mappings precede declared spellings; only the remaining Hangul is command text. */
function resolveSpellings(raw, options) {
    const aliases = options.wordAliases ?? new Map();
    const disabled = new Set(options.disabledSymbols ?? []);
    const slots = new Set([...KEYWORDS, ...Array.from('ㄳㄵㄶㄺㄻㄼㄽㄾㄿㅀㅄ')]);
    for (const symbol of disabled)
        if (!slots.has(symbol))
            throw new ParseError(`알 수 없는 자모 설정: ${symbol}`, 1, 1);
    const mappedToken = (token) => {
        if (!slots.has(token.kind))
            return [token];
        const parts = Array.from(commandParts(token.kind));
        return parts.map((part, index) => ({ ...token, kind: part, value: part,
            origins: [...(token.origins ?? []), token.kind],
            ifWord: part === 'ㅁ' && parts.length === 1 ? token.ifWord : undefined,
            whitespaceAfter: index === parts.length - 1 ? token.whitespaceAfter : false }));
    };
    const tokens = [];
    for (const token of raw) {
        if (token.kind !== "NAME" || !aliases.has(token.value)) {
            appendTokens(tokens, mappedToken(token));
            continue;
        }
        const spelling = aliases.get(token.value);
        const parts = Array.from(spelling);
        if (!parts.length || parts.some(part => !slots.has(part)))
            throw new ParseError(`대응단어 '${token.value}'에는 배정된 자모 명령이 필요합니다`, token.line, token.col);
        parts.forEach((part, index) => appendTokens(tokens, mappedToken({ ...token, kind: part, value: part,
            ifWord: parts.length === 1 ? token.value : undefined,
            whitespaceAfter: index === parts.length - 1 ? token.whitespaceAfter : false })));
    }
    // Recognizing a declaration's spelling does not execute it or change runtime scopes.
    const names = new Set(["입력", "범위", "추가", "삽입", "삭제", "복사", "읽기", "쓰기", "자신", ...(options.declaredNames ?? [])]);
    const namePositions = new Set();
    const macroTails = new Map();
    const commandAt = (index) => {
        if (tokens[index].kind === "NAME" && names.has(tokens[index].value))
            return { token: tokens[index], next: index + 1 };
        const probe = [];
        let next = index;
        while (next < tokens.length && next < index + 3) {
            const candidate = tokens[next];
            if (next > index && candidate.kind === "NAME" && !decomposableSpelling(candidate.value))
                break;
            appendTokens(probe, candidate.kind === "NAME" && names.has(candidate.value) ? [candidate] : spellingTokens(candidate));
            next++;
            if (probe.length >= 3)
                break;
        }
        const packed = packCombos(probe)[0];
        return packed?.kind === "COMBO" ? { token: packed, next } : { token: tokens[index], next: index + 1 };
    };
    const introduce = (index, register = true) => {
        if (tokens[index]?.kind !== "NAME")
            return;
        namePositions.add(index);
        if (register)
            names.add(tokens[index].value);
    };
    const collect = (combos) => {
        for (let index = 0; index < tokens.length; index++) {
            if (tokens[index].kind === "ㅊ" && tokens[index + 1]?.kind === "NAME" && tokens[index + 2]?.kind === "=") {
                let end = index + 3;
                while (end < tokens.length && !["SEP", "EOF"].includes(tokens[end].kind))
                    end++;
                const body = packCombos(tokens.slice(index + 3, end).flatMap(token => token.kind === "NAME" && names.has(token.value) ? [token] : spellingTokens(token)));
                if (body.length)
                    macroTails.set(tokens[index + 1].value, body.at(-1).kind === "COMBO" ? body.at(-1) : tokens[end - 1]);
                else
                    macroTails.delete(tokens[index + 1].value);
            }
            // A custom spelling may introduce a declaration: ㅊ소개=ㅒ; 소개 몍=7.
            const command = combos ? commandAt(index) : { token: tokens[index], next: index + 1 };
            let effective = command.token;
            const visited = new Set();
            while (effective.kind === "NAME" && macroTails.has(effective.value) && !visited.has(effective.value)
                && visited.size < MAX_SYNTAX_DEPTH) {
                visited.add(effective.value);
                effective = macroTails.get(effective.value);
            }
            const combo = effective.kind === "COMBO";
            const kind = combo ? effective.value.prefix[0].kind : effective.kind;
            let next = command.next;
            if ((combo || kind === "ㅛ") && tokens[next]?.kind === "(")
                next++;
            while (tokens[next]?.kind === "SOFT_NL")
                next++;
            if (["ㅒ", "ㅎ", "ㅊ", "ㅃ", "ㅏ", "ㅛ", "ㄲ"].includes(kind))
                introduce(next);
            if (kind === ".")
                introduce(index + 1, false);
            if (tokens[index + 1]?.kind === "=>")
                introduce(index);
            if (kind === "ㅚ" && ["STRING", "CHAR"].includes(tokens[index + 1]?.kind)) {
                introduce(index + 2);
                if (tokens[index + 2]?.kind !== "NAME") {
                    const basename = String(tokens[index + 1].value).replaceAll('\\', '/').split('/').at(-1);
                    const dot = basename.lastIndexOf('.');
                    names.add(dot > 0 && dot < basename.length - 1 ? basename.slice(0, dot) : basename);
                }
            }
            if (["ㅎ", "ㅊ"].includes(kind) && tokens[next + 1]?.kind === "(") {
                let cursor = next + 2;
                while (cursor < tokens.length && ![")", "SEP", "EOF"].includes(tokens[cursor].kind)) {
                    introduce(cursor);
                    cursor++;
                }
            }
        }
    };
    collect(false);
    macroTails.clear();
    collect(true);
    const result = [];
    tokens.forEach((token, index) => {
        if (token.kind !== "NAME" || namePositions.has(index) || names.has(token.value) || !decomposableSpelling(token.value)) {
            result.push(token);
            return;
        }
        appendTokens(result, spellingTokens(token));
    });
    for (const token of result) {
        const prohibited = [...(token.origins ?? []), token.kind].find(symbol => disabled.has(symbol));
        if (prohibited)
            throw new ParseError(`설정에서 꺼진 자모 '${prohibited}'은 명령으로 실행할 수 없습니다`, token.line, token.col);
    }
    return packCombos(result.map(token => ({ ...token, sourceEnd: token.sourceEnd ?? token.col + 1 })));
}
export const MAX_MACRO_EXPANSION_TOKENS = 1_000_000;
function appendTokens(target, source) {
    for (const token of source)
        target.push(token);
}
/** The wrapper supplies a token payload; it does not add expression parentheses. */
function expandCombo(tokens, start) {
    const token = tokens[start], depth = token.comboDepth ?? 0;
    if (depth >= MAX_SYNTAX_DEPTH)
        throw new ParseError(`ㅛ 조합 중첩 한도 ${MAX_SYNTAX_DEPTH}단계를 넘었습니다`, token.line, token.col);
    const wrapped = tokens[start + 1]?.kind === "(";
    const begin = start + (wrapped ? 2 : 1);
    let end = begin, nesting = 0;
    const payload = [];
    for (; end < tokens.length; end++) {
        const part = tokens[end];
        if (nesting === 0 && (wrapped ? part.kind === ")" : ["SEP", "SOFT_NL", "EOF", ")", "]"].includes(part.kind)))
            break;
        if (part.kind === "EOF")
            break;
        if (part.kind === "SOFT_NL") {
            // Removing the outer wrapper restores physical statement lines inside whole blocks.
            if (wrapped && nesting === 0 && token.value.suffix.some((item) => item.kind === "ㅋ"))
                payload.push({ ...part, kind: "SEP" });
            continue;
        }
        if (["(", "["].includes(part.kind))
            nesting++;
        else if ([")", "]"].includes(part.kind))
            nesting--;
        payload.push(part.kind === "COMBO" ? { ...part, comboDepth: depth + 1 } : part);
    }
    if (wrapped && tokens[end]?.kind !== ")")
        throw new ParseError("ㅛ 조합의 내용을 닫는 )가 없습니다", token.line, token.col);
    const origin = (part) => ({ ...part, line: token.line, col: token.col,
        macroChain: token.macroChain, comboDepth: depth });
    return { body: [...token.value.prefix.map(origin), ...payload, ...token.value.suffix.map(origin)],
        end: wrapped ? end + 1 : end };
}
function spliceTokens(tokens, start, count, body) {
    tokens.splice(start, count);
    for (let offset = 0; offset < body.length; offset += 4096)
        tokens.splice(start + offset, 0, ...body.slice(offset, offset + 4096));
}
/** Sequential lexical macros. The parser receives only expanded language tokens. */
class MacroProcessor {
    produced = 0;
    macros = new Map();
    typeNames = new Set();
    openers = new Set(["ㅁ", "ㄸ", "ㅃ", "ㅎ", "ㅑ"]);
    replacement(token, body, chain) {
        if (chain.includes(token.value))
            throw new ParseError(`custom 매크로가 순환합니다: ${[...chain, token.value].join(" → ")}`, token.line, token.col);
        if (chain.length >= MAX_SYNTAX_DEPTH)
            throw new ParseError(`custom 확장 깊이 한도 ${MAX_SYNTAX_DEPTH}단계를 넘었습니다`, token.line, token.col);
        this.produced += body.length;
        if (this.produced > MAX_MACRO_EXPANSION_TOKENS)
            throw new ParseError(`custom 확장 토큰 한도 ${MAX_MACRO_EXPANSION_TOKENS}개를 넘었습니다`, token.line, token.col);
        return body.map((part, index) => ({ ...part, line: token.line, col: token.col,
            macroChain: [...chain, token.value],
            // Word aliases retain their invocation boundary; the native ㅁ does not need whitespace.
            ifWord: body.length === 1 && ["ㅁ", "NAME"].includes(part.kind)
                ? token.ifWord ?? String(token.value) : part.ifWord,
            whitespaceAfter: index === body.length - 1 ? token.whitespaceAfter : part.whitespaceAfter }));
    }
    inlineEnd(tokens, start) {
        let end = start;
        while (end < tokens.length && !["SEP", "EOF"].includes(tokens[end].kind))
            end++;
        return end;
    }
    typeHeaderEnd(tokens, start) {
        let depth = 0;
        for (let index = start + 2; index < tokens.length; index++) {
            if (tokens[index].kind === "(")
                depth++;
            else if (tokens[index].kind === ")" && --depth === 0)
                return index + 1;
        }
        const token = tokens[start];
        throw new ParseError("custom 타입의 매개변수 괄호가 닫히지 않았습니다", token.line, token.col);
    }
    nameAt(tokens, start) {
        const token = tokens[start + 1] ?? tokens[start];
        if (token.kind !== "NAME")
            throw new ParseError("ㅊ 뒤에는 등록할 이름이 필요합니다", token.line, token.col);
        return token.value;
    }
    /** Expand known names only for delimiter accounting; keep body references lexical. */
    balanceTokens(tokens, definitions, chain = []) {
        const result = [];
        for (let index = 0; index < tokens.length; index++) {
            const token = tokens[index];
            if (token.kind === "ㅊ") {
                // Registration names and inline bodies are syntax data, not active blocks.
                if (tokens[index + 2]?.kind === "=") {
                    index = this.inlineEnd(tokens, index + 3) - 1;
                    continue;
                }
                result.push(token);
                if (tokens[index + 1])
                    result.push(tokens[++index]);
            }
            else if (token.kind === "NAME" && definitions.has(token.value)) {
                const body = this.replacement(token, definitions.get(token.value), chain);
                appendTokens(result, this.balanceTokens(body, definitions, [...chain, token.value]));
            }
            else
                result.push(token);
        }
        return result;
    }
    collectBlock(tokens, start, definitions, nesting = 0) {
        const intro = tokens[start], name = this.nameAt(tokens, start);
        if (nesting >= MAX_SYNTAX_DEPTH)
            throw new ParseError(`custom 본문 중첩 한도 ${MAX_SYNTAX_DEPTH}단계를 넘었습니다`, intro.line, intro.col);
        if (tokens[start + 2]?.kind !== "SEP")
            throw new ParseError("custom 이름 뒤에는 = 또는 본문을 시작할 줄바꿈이 필요합니다", intro.line, intro.col);
        const local = new Map(definitions);
        const body = [];
        let level = 1, previous = "SEP";
        for (let index = start + 3; index < tokens.length; index++) {
            const token = tokens[index];
            if (token.kind === "EOF")
                break;
            if (token.kind === "ㅊ") {
                const nestedName = this.nameAt(tokens, index);
                if (tokens[index + 2]?.kind === "=") {
                    const end = this.inlineEnd(tokens, index + 3);
                    local.set(nestedName, tokens.slice(index + 3, end));
                    appendTokens(body, tokens.slice(index, end));
                    index = end - 1;
                    previous = "custom_definition";
                    continue;
                }
                if (tokens[index + 2]?.kind !== "(") {
                    const nested = this.collectBlock(tokens, index, local, nesting + 1);
                    local.set(nestedName, nested.body);
                    appendTokens(body, tokens.slice(index, nested.end));
                    index = nested.end - 1;
                    previous = "ㅋ";
                    continue;
                }
                const end = this.typeHeaderEnd(tokens, index);
                appendTokens(body, tokens.slice(index, end));
                level++;
                index = end - 1;
                previous = ")";
                continue;
            }
            const expanded = token.kind === "NAME" && local.has(token.value)
                ? this.balanceTokens(this.replacement(token, local.get(token.value), []), local, [token.value])
                : [token];
            let consumed = index + 1;
            for (let part = 0; part < expanded.length; part++) {
                const virtual = expanded[part];
                if (virtual.kind === "COMBO") {
                    // A deferred combo in an alias consumes the caller's following payload too.
                    const length = expanded.length;
                    const combo = expandCombo([...expanded, ...tokens.slice(consumed)], part);
                    consumed += Math.max(0, combo.end - length);
                    spliceTokens(expanded, part, Math.min(combo.end, length) - part, combo.body);
                    part--;
                    continue;
                }
                if (virtual.kind === "NAME" && local.has(virtual.value)) {
                    const chain = virtual.macroChain ?? [];
                    const replacement = this.balanceTokens(this.replacement(virtual, local.get(virtual.value), chain), local, [...chain, virtual.value]);
                    spliceTokens(expanded, part, 1, replacement);
                    part--;
                    continue;
                }
                if (virtual.kind === "ㅊ" && expanded[part + 1]?.kind === "NAME") {
                    const nestedName = expanded[part + 1].value;
                    if (expanded[part + 2]?.kind === "=") {
                        const end = this.inlineEnd(expanded, part + 3);
                        local.set(nestedName, expanded.slice(part + 3, end));
                        part = end - 1;
                        previous = "custom_definition";
                        continue;
                    }
                    if (expanded[part + 2]?.kind === "SEP") {
                        const nested = this.collectBlock(expanded, part, local, nesting + 1);
                        local.set(nestedName, nested.body);
                        part = nested.end - 1;
                        previous = "ㅋ";
                        continue;
                    }
                }
                if ((this.openers.has(virtual.kind) && !(virtual.kind === "ㅁ" && previous === "ㅇ")) || virtual.kind === "ㅊ")
                    level++;
                else if (virtual.kind === "ㅋ") {
                    level--;
                    if (level === 0) {
                        // A closing alias may contribute body tokens before the terminator.
                        appendTokens(body, expanded.slice(0, part));
                        const tail = expanded.slice(part + 1);
                        spliceTokens(tokens, consumed, 0, tail);
                        return { body, end: consumed };
                    }
                }
                previous = virtual.kind;
            }
            appendTokens(body, tokens.slice(index, consumed));
            index = consumed - 1;
        }
        throw new ParseError(`custom ${name} 본문을 닫는 ㅋ가 없습니다`, intro.line, intro.col);
    }
    expand(tokens) {
        const result = [];
        for (let index = 0; index < tokens.length; index++) {
            const token = tokens[index];
            if (token.kind === "COMBO") {
                const combo = expandCombo(tokens, index);
                spliceTokens(tokens, index, combo.end - index, combo.body);
                index--;
            }
            else if (token.kind === "ㅊ") {
                const name = this.nameAt(tokens, index);
                if (tokens[index + 2]?.kind === "(") {
                    if (this.macros.has(name))
                        throw new ParseError(`custom 이름 '${name}'은 이미 매크로로 등록되어 타입과 함께 쓸 수 없습니다`, token.line, token.col);
                    this.typeNames.add(name);
                    const end = this.typeHeaderEnd(tokens, index);
                    appendTokens(result, tokens.slice(index, end));
                    index = end - 1;
                }
                else if (tokens[index + 2]?.kind === "=") {
                    if (this.typeNames.has(name))
                        throw new ParseError(`custom 이름 '${name}'은 이미 타입으로 등록되어 매크로와 함께 쓸 수 없습니다`, token.line, token.col);
                    const end = this.inlineEnd(tokens, index + 3);
                    this.macros.set(name, tokens.slice(index + 3, end));
                    index = end - 1;
                }
                else {
                    if (this.typeNames.has(name))
                        throw new ParseError(`custom 이름 '${name}'은 이미 타입으로 등록되어 매크로와 함께 쓸 수 없습니다`, token.line, token.col);
                    const collected = this.collectBlock(tokens, index, this.macros);
                    this.macros.set(name, collected.body);
                    index = collected.end - 1;
                }
            }
            else if (token.kind === "NAME" && this.macros.has(token.value)) {
                const body = this.replacement(token, this.macros.get(token.value), token.macroChain ?? []);
                spliceTokens(tokens, index, 1, body);
                index--;
            }
            else
                result.push(token);
        }
        return result;
    }
    run(tokens) { return this.expand([...tokens]); }
}
class Parser {
    static BINDING = {
        "ㅞ": 5, "ㅣ": 10, "ㅘ": 20, "==": 30, "!=": 30, "<": 30, "<=": 30,
        ">": 30, ">=": 30, "ㅔ": 30, "+": 40, "-": 40, "*": 50, "/": 50,
        "//": 50, "%": 50, "**": 70,
    };
    static COMPARISONS = new Set(["==", "!=", "<", "<=", ">", ">=", "ㅔ"]);
    tokens;
    pos = 0;
    nesting = 0;
    constructor(source, options = {}) {
        this.tokens = new MacroProcessor().run(resolveSpellings(new Lexer(source).run(), options))
            .filter(token => token.kind !== "SOFT_NL");
    }
    get current() { return this.tokens[this.pos]; }
    take() { return this.tokens[this.pos++]; }
    accept(kind) { return this.current.kind === kind ? this.take() : null; }
    expect(kind, message) {
        if (this.current.kind !== kind)
            throw new ParseError(message ?? `${kind}이(가) 필요합니다`, this.current.line, this.current.col);
        return this.take();
    }
    name() { return this.expect("NAME", "이름이 필요합니다. 자모 키워드는 이름으로 쓸 수 없습니다").value; }
    node(kind, token, args = {}) {
        return { kind, args, line: token.line, col: token.col };
    }
    skipSeparators() { while (this.accept("SEP")) { /* physical statement separation */ } }
    headerEnd() {
        this.expect("SEP", "블록 시작 뒤에는 줄바꿈 또는 ;가 필요합니다");
        this.skipSeparators();
    }
    enterSyntax() {
        if (this.nesting >= MAX_SYNTAX_DEPTH)
            throw new ParseError(`구문 중첩 한도 ${MAX_SYNTAX_DEPTH}단계를 넘었습니다`, this.current.line, this.current.col);
        this.nesting++;
    }
    block(stoppers) {
        this.enterSyntax();
        try {
            const result = [];
            this.skipSeparators();
            while (!stoppers.has(this.current.kind) && this.current.kind !== "EOF") {
                if (["ㅋ", "ㅇ", "ㅏ"].includes(this.current.kind))
                    throw new ParseError(`이 위치에는 ${this.current.kind} 블록 구분자를 쓸 수 없습니다`, this.current.line, this.current.col);
                result.push(this.statement());
                if (!["SEP", "EOF"].includes(this.current.kind))
                    throw new ParseError("문장 사이에는 줄바꿈 또는 ;가 필요합니다", this.current.line, this.current.col);
                this.skipSeparators();
            }
            return result;
        }
        finally {
            this.nesting--;
        }
    }
    run() {
        const result = this.block(new Set(["EOF"]));
        this.expect("EOF");
        this.checkTreeDepth(result);
        return result;
    }
    checkTreeDepth(nodes) {
        const pending = nodes.map(node => [node, 1]);
        while (pending.length) {
            const [node, depth] = pending.pop();
            if (depth > MAX_SYNTAX_DEPTH)
                throw new ParseError(`구문 트리 깊이 한도 ${MAX_SYNTAX_DEPTH}단계를 넘었습니다`, node.line, node.col);
            const values = Object.values(node.args);
            while (values.length) {
                const value = values.pop();
                if (Array.isArray(value))
                    for (const item of value)
                        values.push(item);
                else if (value !== null && typeof value === "object" && "kind" in value && "args" in value)
                    pending.push([value, depth + 1]);
            }
        }
    }
    statement() {
        const token = this.current, kind = token.kind;
        if (kind === "ㅊ")
            return this.customType();
        if (kind === "ㅒ") {
            this.take();
            const name = this.name();
            this.expect("=", "새 선언에는 =와 초기값이 필요합니다");
            return this.node("declare", token, { name, value: this.expression() });
        }
        if (kind === "ㅁ")
            return this.ifStatement();
        if (["ㄸ", "ㅃ"].includes(kind)) {
            this.take();
            let name = null, iterable = null, condition = null;
            if (kind === "ㅃ") {
                name = this.name();
                this.expect("ㅔ", "for의 이름 뒤에는 ㅔ가 필요합니다");
                iterable = this.expression();
            }
            else
                condition = this.expression();
            this.accept("ㄱ");
            this.headerEnd();
            const body = this.block(new Set(["ㅋ"]));
            this.expect("ㅋ", "반복 블록을 닫는 ㅋ가 없습니다");
            return kind === "ㅃ" ? this.node("for", token, { name, iterable, body })
                : this.node("while", token, { condition, body });
        }
        if (kind === "ㅎ") {
            this.take();
            const name = this.name();
            this.expect("(", "함수 이름 뒤에는 매개변수 괄호가 필요합니다");
            const params = [];
            if (this.current.kind !== ")")
                while (true) {
                    const parameterToken = this.current, parameter = this.name();
                    if (params.includes(parameter))
                        throw new ParseError(`매개변수 '${parameter}'가 중복되었습니다`, parameterToken.line, parameterToken.col);
                    params.push(parameter);
                    if (!this.accept(",") || this.current.kind === ")")
                        break;
                }
            this.expect(")");
            this.headerEnd();
            const body = this.block(new Set(["ㅋ"]));
            this.expect("ㅋ", "함수 블록을 닫는 ㅋ가 없습니다");
            return this.node("function", token, { name, params, body });
        }
        if (["ㄷ", "ㅠ", "ㅙ"].includes(kind)) {
            this.take();
            const value = ["SEP", "EOF"].includes(this.current.kind) ? null : this.expression();
            return this.node({ "ㄷ": "return", "ㅠ": "throw", "ㅙ": "debug" }[kind], token, { value });
        }
        if (["ㅡ", "ㄹ", "ㅍ"].includes(kind)) {
            this.take();
            return this.node({ "ㅡ": "break", "ㄹ": "continue", "ㅍ": "pass" }[kind], token);
        }
        if (kind === "ㅑ") {
            this.take();
            this.headerEnd();
            const body = this.block(new Set(["ㅏ", "ㅋ"]));
            this.expect("ㅏ", "try 블록에는 ㅏ 예외 처리 구문이 필요합니다");
            const error_name = this.current.kind === "NAME" ? this.name() : null;
            this.headerEnd();
            const handler = this.block(new Set(["ㅋ"]));
            this.expect("ㅋ", "예외 처리 블록을 닫는 ㅋ가 없습니다");
            return this.node("try", token, { body, error_name, handler });
        }
        if (["ㄲ", "ㅛ"].includes(kind)) {
            this.take();
            const wrapped = kind === "ㅛ" && this.accept("(");
            const name = this.name();
            if (wrapped)
                this.expect(")", "라벨 괄호에는 이름 하나만 들어갑니다");
            return this.node(kind === "ㄲ" ? "goto" : "label", token, { name });
        }
        if (kind === "ㅚ") {
            this.take();
            const path = this.current;
            if (!["STRING", "CHAR"].includes(path.kind))
                throw new ParseError("import 경로는 따옴표로 감싼 문자열이어야 합니다", path.line, path.col);
            this.take();
            const alias = this.current.kind === "NAME" ? this.name() : null;
            return this.node("import", token, { path: path.value, alias });
        }
        const target = this.expression();
        if (this.accept("=")) {
            if (target.kind === "slice")
                throw new ParseError("슬라이스는 현재 읽기만 지원하며 대입할 수 없습니다", target.line, target.col);
            if (!["name", "index", "member"].includes(target.kind)
                && !(target.kind === "unary" && ["ㅕ", "ㅢ"].includes(target.args.op)))
                throw new ParseError("이 식에는 값을 대입할 수 없습니다", target.line, target.col);
            return this.node("assign", token, { target, value: this.expression() });
        }
        return this.node("expr", token, { value: target });
    }
    requireIfWhitespace(token) {
        if (token.ifWord && !token.whitespaceAfter)
            throw new ParseError(`조건문 단어 ${token.ifWord} 뒤에는 공백이 필요합니다`, token.line, token.col);
    }
    customType() {
        const token = this.expect("ㅊ"), name = this.name();
        this.expect("(", "custom 타입에는 매개변수 괄호가 필요합니다");
        const params = [];
        if (this.current.kind !== ")")
            while (true) {
                const parameterToken = this.current, parameter = this.name();
                if (params.includes(parameter))
                    throw new ParseError(`매개변수 '${parameter}'가 중복되었습니다`, parameterToken.line, parameterToken.col);
                params.push(parameter);
                if (!this.accept(",") || this.current.kind === ")")
                    break;
            }
        this.expect(")");
        this.headerEnd();
        const body = this.block(new Set(["ㅋ"]));
        this.expect("ㅋ", "custom 타입 본문을 닫는 ㅋ가 없습니다");
        return this.node("custom_type", token, { name, params, body });
    }
    ifStatement() {
        const token = this.expect("ㅁ");
        this.requireIfWhitespace(token);
        const branches = [];
        let otherwise = null;
        while (true) {
            const condition = this.expression();
            this.expect("ㄱ", "if 조건 뒤에는 ㄱ이 필요합니다");
            this.headerEnd();
            branches.push([condition, this.block(new Set(["ㅇ", "ㅋ"]))]);
            if (!this.accept("ㅇ"))
                break;
            const elseif = this.accept("ㅁ");
            if (elseif) {
                this.requireIfWhitespace(elseif);
                continue;
            }
            this.headerEnd();
            otherwise = this.block(new Set(["ㅋ"]));
            break;
        }
        this.expect("ㅋ", "조건 블록을 닫는 ㅋ가 없습니다");
        return this.node("if", token, { branches, otherwise });
    }
    expression(minimum = 0) {
        this.enterSyntax();
        try {
            return this.expressionInner(minimum);
        }
        finally {
            this.nesting--;
        }
    }
    expressionInner(minimum) {
        let token = this.take();
        const initialKind = token.kind;
        let left;
        if (["NUMBER", "STRING", "CHAR"].includes(initialKind)) {
            left = this.node("literal", token, { value: token.value });
            if (initialKind === "CHAR")
                left.args.char = true;
        }
        else if (LITERALS.has(initialKind))
            left = this.node("literal", token, { value: LITERALS.get(initialKind) });
        else if (initialKind === "NAME" || BUILTINS.has(initialKind)) {
            left = initialKind === "NAME" && this.accept("=>")
                ? this.node("lambda", token, { params: [token.value], body: this.expression() })
                : this.node("name", token, { name: token.value });
        }
        else if (["+", "-", "ㄴ", "ㅓ", "ㅕ", "ㅟ", "ㅢ"].includes(initialKind))
            left = this.node("unary", token, { op: initialKind, value: this.expression(initialKind === "ㄴ" ? 25 : 60) });
        else if (initialKind === "(") {
            left = this.expression();
            this.expect(")", "식을 닫는 )가 필요합니다");
        }
        else if (initialKind === "[")
            left = this.node("list", token, { items: this.commaExpressions("]") });
        else
            throw new ParseError("값이나 이름으로 시작하는 식이 필요합니다", token.line, token.col);
        let sawComparison = false;
        while (true) {
            token = this.current;
            const kind = token.kind;
            if (kind === "(" && 90 >= minimum) {
                this.take();
                left = this.node("call", left, { callee: left, args: this.commaExpressions(")") });
                continue;
            }
            if (kind === "[" && 90 >= minimum) {
                this.take();
                const start = this.current.kind === ":" ? null : this.expression();
                if (this.accept(":")) {
                    const stop = [":", "]"].includes(this.current.kind) ? null : this.expression();
                    let step = null;
                    if (this.accept(":"))
                        step = this.current.kind === "]" ? null : this.expression();
                    this.expect("]", "슬라이스를 닫는 ]가 필요합니다");
                    left = this.node("slice", left, { target: left, start, stop, step });
                }
                else {
                    this.expect("]", "인덱스를 닫는 ]가 필요합니다");
                    left = this.node("index", left, { target: left, index: start });
                }
                continue;
            }
            if (kind === "." && 90 >= minimum) {
                this.take();
                left = this.node("member", left, { target: left, name: this.name() });
                continue;
            }
            const binding = Parser.BINDING[kind] ?? -1;
            if (binding < minimum)
                break;
            if (Parser.COMPARISONS.has(kind)) {
                if (sawComparison)
                    throw new ParseError("연속 비교는 괄호 또는 ㅘ로 나누어 써 주세요", token.line, token.col);
                sawComparison = true;
            }
            this.take();
            const right = this.expression(kind === "**" ? 60 : binding + 1);
            left = this.node("binary", left, { op: kind, left, right });
        }
        return left;
    }
    commaExpressions(closing) {
        const values = [];
        if (this.current.kind !== closing)
            while (true) {
                values.push(this.expression());
                if (!this.accept(",") || this.current.kind === closing)
                    break;
            }
        this.expect(closing, `목록 또는 인수 뒤에는 ${closing}가 필요합니다`);
        return values;
    }
}
export function parse(source, options = {}) {
    if (typeof source !== "string")
        throw new TypeError("source must be str");
    const parser = new Parser(source, options);
    try {
        return parser.run();
    }
    catch (error) {
        if (error instanceof RangeError && /stack|recurs/i.test(error.message)) {
            const token = parser.tokens[Math.min(parser.pos, parser.tokens.length - 1)];
            throw new ParseError("구문 분석에 사용할 수 있는 실행 스택을 넘었습니다", token.line, token.col);
        }
        throw error;
    }
}
//# sourceMappingURL=frontend.js.map