import test from "node:test";
import assert from "node:assert/strict";
import { KEYWORDS, MAX_SYNTAX_DEPTH, ParseError, isIdentifier, parse } from "../dist/frontend.js";
import { Interpreter } from "../dist/runtime.js";

const expression = (source, declaredNames = []) => parse(source, { declaredNames })[0].args.value;
async function runtimeOutput(source) {
  const lines = [];
  await new Interpreter({ output: line => lines.push(line), maxSteps: 10000 }).execute(source);
  return lines;
}
function parseError(source, fragment, position, declaredNames = []) {
  let result;
  assert.throws(() => parse(source, { declaredNames }), error => {
    assert.ok(error instanceof ParseError, `Expected ParseError, got ${error}`);
    if (fragment) assert.ok(error.message.includes(fragment), error.message);
    if (position) assert.deepEqual([error.line, error.col], position);
    result = error;
    return true;
  });
  return result;
}

test("empty sources and comment-only programs", () => {
  assert.deepEqual(parse("\ufeff# 주석\r\n/* 여러\r줄 */;\n"), []);
});

test("40 assigned characters include the new custom introducer", () => {
  assert.equal(KEYWORDS.size, 40);
  assert.ok(KEYWORDS.has("ㅊ"));
  assert.ok(!KEYWORDS.has("ㄳ"));
});

test("a custom introducer alias consumes caller tokens inside a block macro", async () => {
  for (const name of ["newCommand", "새명령"]) {
    for (const definition of ["ㅊ정의=ㅊ", "ㅊ정의=등록\nㅊ등록=ㅊ"]) {
      const source = `${definition}\nㅊ공장\n정의 ${name}=1\nㅋ\n공장\nㅂ(${name})`;
      assert.deepEqual(await runtimeOutput(source), ["1"], source);
    }
  }
});

test("custom aliases preserve nested block and type definitions", async () => {
  const block = "ㅊ정의=ㅊ\nㅊ공장\n정의 인사\nㅂ(3)\nㅋ\nㅋ\n공장\n인사";
  const type = "ㅊ정의=ㅊ\nㅊ공장\n정의 상자()\nㅒ 값=4\nㅋ\nㅋ\n공장\nㅂ(상자().값)";
  assert.deepEqual(await runtimeOutput(block), ["3"]);
  assert.deepEqual(await runtimeOutput(type), ["4"]);
});

test("a closing alias is consumed once across nested custom definitions", async () => {
  const source = "ㅊ정의=ㅊ\nㅊ두끝=ㅋ ㅋ\nㅊ공장\n정의 인사\nㅂ(3)\n두끝\n공장\n인사";
  assert.deepEqual(await runtimeOutput(source), ["3"]);
  assert.deepEqual(await runtimeOutput(source + "\n공장\n인사".repeat(99)), Array(100).fill("3"));
});

test("closing aliases match literal terminators at multiple nesting depths", async () => {
  for (const introducer of ["ㅊ", "정의"]) {
    for (const depth of [1, 2, 3, 4]) {
      const names = Array.from({ length: depth }, (_, index) => `내부${index}`);
      const closing = Array(depth + 1).fill("ㅋ").join(" ");
      const prefix = `ㅊ정의=ㅊ\nㅊ닫기=${closing}\nㅊ공장\n`
        + names.map(name => `${introducer} ${name}\n`).join("") + "ㅂ(3)\n";
      const suffix = `\n공장\n${names.join("\n")}`;
      assert.deepEqual(await runtimeOutput(prefix + closing + suffix), ["3"]);
      assert.deepEqual(await runtimeOutput(prefix + "닫기" + suffix), ["3"], `${introducer}, depth ${depth}`);
    }
  }
});

test("splitting a closing alias preserves statements before, between and after terminators", async () => {
  const cases = [
    ["ㅂ(2) ㅋ ㅋ", ["3", "2"]],
    ["ㅋ ㅋ ㅂ(9)", ["9", "3"]],
    ["ㅂ(2) ㅋ ㅂ(4) ㅋ ㅂ(9)", ["9", "4", "3", "2"]],
  ];
  for (const introducer of ["ㅊ", "정의"]) {
    for (const [closing, expected] of cases) {
      const prefix = `ㅊ정의=ㅊ\nㅊ닫기=${closing}\nㅊ공장\n${introducer} 인사\nㅂ(3)\n`;
      const suffix = "\n공장\n인사";
      assert.deepEqual(await runtimeOutput(prefix + closing + suffix), expected);
      assert.deepEqual(await runtimeOutput(prefix + "닫기" + suffix), expected, `${introducer}: ${closing}`);
    }
  }
});

test("consumed closing aliases stay fixed while ordinary body aliases remain lexical", async () => {
  for (const introducer of ["ㅊ", "정의"]) {
    const source = `ㅊ정의=ㅊ\nㅊ값=1\nㅊ마침=ㅋ ㅋ\nㅊ닫기=마침\nㅊ공장\n${introducer} 인사\nㅂ(값)\n닫기\nㅊ마침=ㅂ(9)\nㅊ값=7\n공장\n인사`;
    assert.deepEqual(await runtimeOutput(source), ["7"], introducer);
    if (introducer === "정의") {
      const redefined = source.replace("\n공장\n", "\nㅊ정의=ㅂ(9)ㅊ\n공장\n");
      assert.deepEqual(await runtimeOutput(redefined), ["9", "7"], "introducer aliases also stay lexical");
    }
  }
});

test("closing aliases preserve nested declarations inside a yo payload", async () => {
  const source = closing => "ㅊC=ㅊㅛㅋ\nㅊ닫기=ㅂ(2)ㅋㅂ(3)\nㅊ공장\nC(안쪽\nㅊ인사\nㅂ(1)\n"
    + closing + "\n)\nㅋ\n공장\n안쪽\n인사";
  assert.deepEqual(await runtimeOutput(source("ㅂ(2)ㅋㅂ(3)")), ["3", "1", "2"]);
  assert.deepEqual(await runtimeOutput(source("닫기")), ["3", "1", "2"]);
  const doubleClose = "ㅊC=ㅊㅛㅋ\nㅊ닫기=ㅋㅋ\nㅊ공장\nC(안쪽\nㅊ더안\nㅊ인사\nㅂ(1)\n닫기\n)\nㅋ\n공장\n안쪽\n더안\n인사";
  assert.deepEqual(await runtimeOutput(doubleClose), ["1"]);
});

test("nested closing aliases still reject missing, extra and cyclic terminators", () => {
  const prefix = closing => `ㅊ정의=ㅊ\nㅊ닫기=${closing}\nㅊ공장\n정의 인사\nㅂ(3)\n닫기`;
  parseError(prefix("ㅋ"), "custom 공장 본문을 닫는 ㅋ가 없습니다");
  parseError(prefix("ㅋ ㅋ ㅋ") + "\n공장\n인사", "이 위치에는 ㅋ 블록 구분자를 쓸 수 없습니다");
  parseError(prefix("닫기"), "custom 매크로가 순환합니다");
  parseError(prefix("ㅋ ㅋ").replace("ㅂ(3)", "인사") + "\n공장\n인사", "custom 매크로가 순환합니다");
});

test("declaration aliases preserve Hangul names at the actual macro invocation", async () => {
  for (const name of ["value", "몍", "노"]) {
    for (const early of [true, false]) {
      for (const declaration of ["ㅊ선언=ㅒ", "ㅊ선언=도입\nㅊ도입=ㅒ"]) {
        const block = `ㅊ동작\n선언 ${name}=7\nㅋ`;
        const source = `${early ? declaration + "\n" + block : block + "\n" + declaration}\n동작\nㅂ(${name})`;
        assert.deepEqual(await runtimeOutput(source), ["7"], source);
      }
    }
  }
});

test("later alias redefinition does not erase an earlier expanded declaration", async () => {
  const source = "ㅊ동작\n선언 몍=7\nㅋ\nㅊ선언=ㅒ\n동작\nㅊ선언=ㅂ\nㅂ(몍)";
  assert.deepEqual(await runtimeOutput(source), ["7"]);
});

test("an unused late declaration alias does not reserve command spellings", async () => {
  const source = "ㅊ사용안함\n선언 노=7\nㅋ\nㅊ선언=ㅒ\nㅂ(노)";
  assert.deepEqual(await runtimeOutput(source), ["ㅖ"]);
});

test("a future declaration alias does not change an earlier empty alias expansion", async () => {
  const source = "ㅊ선언=\n선언 몍\nㅂ(1)\nㅋ\nㅊ선언=ㅒ";
  assert.deepEqual(await runtimeOutput(source), ["1"]);
});

test("speculative declaration discovery retains normal macro cycle errors", () => {
  const source = "ㅊ기다림\n선언 노=7\nㅋ\nㅊ선언=ㅒ\nㅊ순환=순환\n순환\n기다림";
  parseError(source, "custom 매크로가 순환합니다", [6, 1]);
});

test("ordinary names preserve syllables and Unicode identity", () => {
  const statements = parse("ㅒ 꾜 = 1\nㅒ 값이름 = 꾜\nㅒ K = 2\nㅒ K = 3");
  assert.deepEqual(statements.map(n => n.args.name), ["꾜", "값이름", "K", "K"]);
  assert.equal(statements[1].args.value.args.name, "꾜");
});

test("jamo membership remains separate beside punctuation", () => {
  const node = expression("3ㅔ[1,2,3]");
  assert.equal(node.args.op, "ㅔ");
  assert.deepEqual(node.args.right.args.items.map(n => n.args.value), [1n, 2n, 3n]);
});

test("string and char content is not tokenized", () => {
  const values = parse('"ㅊ ㄳ # /* */ 꾜"\n\'ㅊ\'');
  assert.equal(values[0].args.value.args.value, "ㅊ ㄳ # /* */ 꾜");
  assert.equal(values[1].args.value.args.value, "ㅊ");
});

test("block-comment newlines preserve statement boundaries", () => {
  const statements = parse("ㅒ 첫째 = 1 /* 설명\n끝 */ ㅒ 둘째 = 2");
  assert.deepEqual(statements.map(n => n.kind), ["declare", "declare"]);
  assert.deepEqual([statements[1].line, statements[1].col], [2, 6]);
});

test("comments and newlines inside delimiters", () => {
  const node = expression("합(\n 1, /* 주석\n 계속 */ 2, # 한 줄\n [3,\n4],\n)", ["합"]);
  assert.equal(node.kind, "call");
  assert.equal(node.args.args.length, 3);
});

test("block comments do not nest", () => {
  assert.equal(expression("/* 바깥 /* 중첩처럼 보여도 */ 7").args.value, 7n);
  parseError("/* 닫지 않음", "*/", [1, 1]);
});

test("source positions count Unicode codepoints", () => {
  const declaration = parse("# 첫 줄\n  ㅒ 이름 = 3")[0];
  assert.deepEqual([declaration.line, declaration.col], [2, 3]);
  assert.deepEqual([declaration.args.value.line, declaration.args.value.col], [2, 10]);
  const astral = parse('"😀"; ㅒ 이름 = 3')[1];
  assert.deepEqual([astral.line, astral.col], [1, 6]);
});

test("CRLF and lone CR physical line endings", () => {
  assert.deepEqual(parse("ㅍ\r\nㅍ\rㅍ").map(n => n.line), [1, 2, 3]);
});

test("literal values retain bigint, number, boolean, null and text distinctions", () => {
  const nodes = parse('ㅖ;ㅗ;ㅜ;123;1.25;1e-3;.5;"가\\n나";\'😀\'');
  assert.deepEqual(nodes.map(n => n.args.value.args.value), [true, false, null, 123n, 1.25, 0.001, 0.5, "가\n나", "😀"]);
  assert.equal(typeof expression("1").args.value, "bigint");
  assert.equal(typeof expression("1.0").args.value, "number");
});

test("escapes and one-codepoint char width", () => {
  assert.equal(expression(String.raw`'\uAC00'`).args.value, "가");
  assert.equal(expression("'가'").args.char, true);
  assert.ok(!("char" in expression('"가"').args));
  assert.equal(expression(String.raw`'\U0001F600'`).args.value, "😀");
  assert.equal(expression(String.raw`'\x41'`).args.value, "A");
  for (const source of ["''", "'가나'", "'é'"]) parseError(source, "코드포인트 하나");
});

test("invalid literals produce language errors", () => {
  for (const source of ['"안 닫힘', '"줄\n바꿈"', String.raw`"\q"`, String.raw`"\uZZZZ"`, String.raw`"\UFFFFFFFF"`, "1e+", "'\\"])
    parseError(source);
});

test("large integer literals preserve every digit", () => {
  assert.equal(expression("1" + "0".repeat(4999)).args.value, 10n ** 4999n);
  assert.equal(expression("9007199254740993").args.value, 9007199254740993n);
});

test("floating overflow is a positioned source error", () => {
  parseError("1e999", "유한 실수", [1, 1]);
  parseError("-1e999", "유한 실수", [1, 2]);
  assert.equal(expression("1.7976931348623157e308").args.value, Number.MAX_VALUE);
  assert.equal(expression("1e-999").args.value, 0);
});

test("surrogates are rejected while valid scalar boundaries work", () => {
  for (const source of [String.raw`'\uD800'`, String.raw`'\uDFFF'`, String.raw`"\uD800\uDC00"`, '"\ud800"'])
    parseError(source, "서로게이트");
  for (const point of [0xd7ff, 0xe000, 0x10ffff]) {
    const source = "'\\U" + point.toString(16).padStart(8, "0") + "'";
    assert.equal(expression(source).args.value, String.fromCodePoint(point));
  }
});

test("arithmetic precedence and associativity", () => {
  let node = expression("1 + 2 * 3");
  assert.equal(node.args.op, "+");
  assert.equal(node.args.right.args.op, "*");
  node = expression("10 - 3 - 2");
  assert.equal(node.args.left.args.op, "-");
  node = expression("2 ** 3 ** 2");
  assert.equal(node.args.right.args.op, "**");
  node = expression("-2 ** 2");
  assert.equal(node.kind, "unary");
  assert.equal(node.args.value.args.op, "**");
  assert.equal(expression("2 ** -2").args.right.kind, "unary");
});

test("not, comparisons and boolean precedence", () => {
  const node = expression("ㄴ 1 == 2 ㅘ ㅖ ㅣ ㅗ");
  assert.equal(node.args.op, "ㅣ");
  assert.equal(node.args.left.args.op, "ㅘ");
  assert.equal(node.args.left.args.left.args.op, "ㄴ");
  assert.equal(node.args.left.args.left.args.value.args.op, "==");
});

test("comparison chains are not silently given different semantics", () => {
  parseError("1 < 2 < 3", "연속 비교");
  assert.equal(expression("(1 < 2) == ㅖ").args.op, "==");
});

test("builtin symbols are callable name nodes", () => {
  for (const keyword of "ㅂㅅㅆㅈㅉㅌㅐㅝ")
    assert.equal(expression(`${keyword}(값)`, ["값"]).args.callee.args.name, keyword);
});

test("reference prefixes bind around postfix access", () => {
  for (const keyword of "ㅓㅕㅟㅢ") {
    const node = expression(`${keyword} 목록[번호()].값`, ["목록", "번호"]);
    assert.equal(node.args.op, keyword);
    assert.equal(node.args.value.kind, "member");
    assert.equal(node.args.value.args.target.kind, "index");
  }
});

test("postfix calls, indexing and member chains", () => {
  const node = expression("만들기()(1)[0].이름", ["만들기"]);
  assert.equal(node.kind, "member");
  assert.equal(node.args.name, "이름");
  assert.equal(node.args.target.args.target.kind, "call");
});

test("slice optional components preserve null", () => {
  for (const [source, expected] of [["목록[:2]", [null, 2n, null]], ["목록[1:]", [1n, null, null]],
    ["목록[::2]", [null, null, 2n]], ["목록[:]", [null, null, null]]]) {
    const node = expression(source, ["목록"]);
    assert.equal(node.kind, "slice");
    assert.deepEqual(["start", "stop", "step"].map(key => node.args[key]?.args.value ?? null), expected);
  }
});

test("where with lambda preserves the predicate body", () => {
  const node = expression("[1, 2, 3] ㅞ 항목 => 항목 > 1 ㅘ 항목 < 3");
  assert.equal(node.args.op, "ㅞ");
  const predicate = node.args.right;
  assert.equal(predicate.kind, "lambda");
  assert.deepEqual(predicate.args.params, ["항목"]);
  assert.equal(predicate.args.body.args.op, "ㅘ");
});

test("where accepts an existing function name", () => {
  assert.equal(expression("목록 ㅞ 판정", ["목록", "판정"]).args.right.kind, "name");
});

test("declaration and assignment AST shapes", () => {
  const nodes = parse("ㅒ 점수 = 70\n점수 = 100\nㅕ 자리 = 20\nㅢ 엄격 = 30\n목록[0] = 2\n모듈.값 = 4", { declaredNames: ["자리", "엄격", "목록", "모듈"] });
  assert.equal(nodes[0].kind, "declare");
  assert.deepEqual(nodes.slice(1).map(n => n.kind), Array(5).fill("assign"));
  assert.equal(nodes[2].args.target.args.op, "ㅕ");
});

test("slice assignment explicitly stays unsupported", () => {
  parseError("목록[:] = []", "슬라이스는 현재 읽기만", [1, 1], ["목록"]);
  parseError("목록[1:3:2] = [4]", "슬라이스는 현재 읽기만", undefined, ["목록"]);
  assert.equal(expression("목록[1:3]", ["목록"]).kind, "slice");
});

test("invalid assignment targets and declarations", () => {
  for (const source of ["1 = 2", "함수() = 2", "a + b = 2", "ㅓ a = 2", "ㅒ 값", "ㅒ ㅅ = 2", "ㅒ 값 ="])
    parseError(source);
});

test("if, elseif and else structure", () => {
  const node = parse("ㅁ 값 > 3 ㄱ\n ㅂ(1)\nㅇ ㅁ 값 > 1 ㄱ\n ㅂ(2)\nㅇ\n ㅍ\nㅋ", { declaredNames: ["값"] })[0];
  assert.equal(node.kind, "if");
  assert.equal(node.args.branches.length, 2);
  assert.equal(node.args.otherwise[0].kind, "pass");
});

test("empty blocks and absent else", () => {
  const node = parse("ㅁ ㅖ ㄱ\nㅋ")[0];
  assert.deepEqual(node.args.branches[0][1], []);
  assert.equal(node.args.otherwise, null);
});

test("nested loops and optional then", () => {
  const outer = parse("ㅃ 항목 ㅔ [1,2] ㄱ\n ㄸ ㅖ\n  ㅁ 항목 == 1 ㄱ\n   ㄹ\n  ㅇ\n   ㅡ\n  ㅋ\n ㅋ\nㅋ")[0];
  assert.equal(outer.kind, "for");
  const conditional = outer.args.body[0].args.body[0];
  assert.equal(conditional.args.branches[0][1][0].kind, "continue");
  assert.equal(conditional.args.otherwise[0].kind, "break");
});

test("function parameters, return and continue mappings", () => {
  const fn = parse("ㅎ 더하기(왼쪽, 오른쪽,)\n ㄷ 왼쪽 + 오른쪽\nㅋ")[0];
  assert.equal(fn.kind, "function");
  assert.deepEqual(fn.args.params, ["왼쪽", "오른쪽"]);
  assert.equal(fn.args.body[0].kind, "return");
  assert.equal(parse("ㄷ")[0].args.value, null);
  assert.equal(parse("ㄹ")[0].kind, "continue");
  parseError("ㅎ 함수(값, 값)\nㅋ", "중복");
});

test("try, throw and bare rethrow", () => {
  const node = parse('ㅑ\n ㅠ "실패"\nㅏ 오류\n ㅠ\nㅋ')[0];
  assert.equal(node.kind, "try");
  assert.equal(node.args.error_name, "오류");
  assert.equal(node.args.body[0].kind, "throw");
  assert.equal(node.args.handler[0].args.value, null);
  assert.equal(parse("ㅑ\nㅏ\nㅋ")[0].args.error_name, null);
});

test("goto, label, import and debug AST", () => {
  const nodes = parse('ㅛ 다시\nㄲ 다시\nㅚ "부품.txt" 부품\nㅚ "다른.txt"\nㅙ ㅖ\nㅙ');
  assert.deepEqual(nodes.map(n => n.kind), ["label", "goto", "import", "import", "debug", "debug"]);
  assert.equal(nodes[2].args.alias, "부품");
  assert.equal(nodes[3].args.alias, null);
  assert.equal(nodes.at(-1).args.value, null);
});

test("semicolon-delimited blocks", () => {
  assert.deepEqual(parse("ㅒ 값 = 1; ㅁ 값 ㄱ; ㅍ; ㅋ; ㅂ(값)").map(n => n.kind), ["declare", "if", "expr"]);
});

test("missing and misplaced block syntax", () => {
  for (const source of ["ㅁ ㅖ\nㅋ", "ㅁ ㅖ ㄱ\nㅍ", "ㄸ ㅖ\nㅍ", "ㅎ 함수()\nㅍ", "ㅑ\nㅍ\nㅋ",
    "ㅋ", "ㅇ", "ㅏ", "ㅁ ㅖ ㄱ ㅍ ㅋ", "ㅍ ㅍ", "ㅚ 경로"]) parseError(source);
});

test("custom registration has specific malformed-body errors; unassigned jamo still fail", () => {
  parseError("\n ㅊ챣", "custom 이름 뒤에는", [2, 2]);
  parseError("ㅊ 챣\nㅂ(1)", "본문을 닫는 ㅋ");
  for (const char of "ㅥㆆﾡ") parseError(char, "배정된 문법");
  assert.equal(expression("챣", ["챣"]).args.name, "챣");
});

test("custom can register operators and expression fragments", () => {
  const nodes = parse("ㅊ합침 = +\nㅊ두배 = * 2\nㅂ(1 합침 2)\nㅂ(3 두배)");
  assert.equal(nodes.length, 2);
  assert.equal(nodes[0].args.value.args.args[0].args.op, "+");
  assert.equal(nodes[1].args.value.args.args[0].args.op, "*");
  assert.equal(nodes[1].args.value.args.args[0].args.right.args.value, 2n);
});

test("custom block invocation expands complete statement sequences", () => {
  const nodes = parse('ㅊ챣\nㅂ("첫번째")\nㅂ("두번째")\nㅋ\n챣');
  assert.equal(nodes.length, 2);
  assert.deepEqual(nodes.map(n => n.args.value.args.args[0].args.value), ["첫번째", "두번째"]);
  assert.deepEqual(nodes.map(n => [n.line, n.col]), [[5, 1], [5, 1]]);
});

test("custom replaces exact NAME tokens without touching text or larger names", () => {
  const nodes = parse('ㅊ짧음 = 3\nㅒ 짧음이름 = 2\nㅂ("짧음", 짧음이름, 짧음)');
  assert.equal(nodes[0].args.name, "짧음이름");
  const values = nodes[1].args.value.args.args;
  assert.equal(values[0].args.value, "짧음");
  assert.equal(values[1].args.name, "짧음이름");
  assert.equal(values[2].args.value, 3n);
});

test("custom block collection balances every old block and elseif", () => {
  const source = 'ㅊ여러기능\nㅎ 함수(값)\nㅁ 값 ㄱ\nㄷ 1\nㅇ ㅁ ㄴ 값 ㄱ\nㄷ 2\nㅇ\nㄷ 3\nㅋ\nㅋ\nㅃ 항목 ㅔ [1]\nㄸ ㅗ\nㅑ\nㅍ\nㅏ\nㅍ\nㅋ\nㅋ\nㅋ\nㅋ\n여러기능';
  const nodes = parse(source);
  assert.deepEqual(nodes.map(n => n.kind), ["function", "for"]);
  assert.equal(nodes[0].args.body[0].args.branches.length, 2);
  assert.equal(nodes[1].args.body[0].args.body[0].kind, "try");
});

test("custom may register more custom definitions when invoked", () => {
  const nodes = parse('ㅊ만들기\nㅊ합침 = +\nㅊ인사\nㅂ("안녕")\nㅋ\nㅋ\n만들기\n인사\nㅂ(1 합침 2)');
  assert.equal(nodes.length, 2);
  assert.equal(nodes[0].args.value.args.args[0].args.value, "안녕");
  assert.equal(nodes[1].args.value.args.args[0].args.op, "+");
});

test("custom references other definitions at invocation and allows sequential registration", () => {
  const nodes = parse("ㅊ갑 = 을\nㅊ을 = 2\nㅂ(갑)\nㅊ을 = 3\nㅂ(갑)");
  assert.deepEqual(nodes.map(n => n.args.value.args.args[0].args.value), [2n, 3n]);
});

test("custom IF aliases keep actual invocation whitespace requirements", () => {
  assert.equal(parse("ㅊ만약 = ㅁ\n만약 ㅖ ㄱ\nㅋ")[0].kind, "if");
  parseError("ㅊ만약 = ㅁ\n만약(ㅖ) ㄱ\nㅋ", "만약 뒤에는 공백", [2, 1]);
  parseError("ㅊ갑 = 을\nㅊ을 = ㅁ\n갑(ㅖ) ㄱ\nㅋ", "갑 뒤에는 공백", [3, 1]);
});

test("known aliases participate in custom block boundary collection", () => {
  const nodes = parse('ㅊ만약 = ㅁ\nㅊ동작\n만약 ㅖ ㄱ\nㅂ(1)\nㅋ\nㅋ\n동작');
  assert.equal(nodes[0].kind, "if");
  const nested = parse('ㅊ동작\nㅊ만약 = ㅁ\n만약 ㅖ ㄱ\nㅂ(1)\nㅋ\nㅋ\n동작');
  assert.equal(nested[0].kind, "if");
});

test("recursive custom expansion is rejected at invocation", () => {
  parseError("ㅊ반복 = 반복\n반복", "순환", [2, 1]);
  parseError("ㅊ갑 = 을\nㅊ을 = 갑\n갑", "순환", [3, 1]);
  let source = "";
  for (let index = 0; index < MAX_SYNTAX_DEPTH + 2; index++)
    source += `ㅊ이름${index} = 이름${index + 1}\n`;
  source += "이름0";
  parseError(source, "custom 확장 깊이 한도");
});

test("custom type header generates a distinct constructor definition AST", () => {
  const node = parse('ㅊ사람(이름값)\nㅒ 이름 = 이름값\nㅎ 소개()\nㅂ(이름)\nㅋ\nㅋ')[0];
  assert.equal(node.kind, "custom_type");
  assert.equal(node.args.name, "사람");
  assert.deepEqual(node.args.params, ["이름값"]);
  assert.deepEqual(node.args.body.map(n => n.kind), ["declare", "function"]);
  const nodes = parse('ㅊ점(가, 나)\nㅒ 가로 = 가\nㅒ 세로 = 나\nㅋ\nㅒ 원점 = 점(0, 0)');
  assert.equal(nodes[1].args.value.args.callee.args.name, "점");
  parseError("ㅊ점(가, 가)\nㅋ", "중복");
});

test("custom types can appear inside custom macro bodies", () => {
  const nodes = parse('ㅊ타입만들기\nㅊ점(값)\nㅒ 좌표 = 값\nㅋ\nㅋ\n타입만들기\n점(1)');
  assert.deepEqual(nodes.map(n => n.kind), ["custom_type", "expr"]);
  assert.equal(nodes[0].args.name, "점");
});

test("custom macros and types cannot register the same name in either order", () => {
  parseError("ㅊ이름 = 1\nㅊ이름()\nㅋ", "이미 매크로로 등록", [2, 1]);
  parseError("ㅊ이름()\nㅋ\nㅊ이름 = 1", "이미 타입으로 등록", [3, 1]);
  parseError("ㅊ이름()\nㅋ\nㅊ이름\nㅍ\nㅋ", "이미 타입으로 등록", [3, 1]);
  parseError("ㅊ정의\nㅊ이름()\nㅋ\nㅋ\nㅊ이름 = 1\n정의", "이미 매크로로 등록", [6, 1]);
  assert.equal(parse("ㅊ이름 = 1\nㅊ이름 = 2\nㅂ(이름)")[0].args.value.args.args[0].args.value, 2n);
  assert.deepEqual(parse("ㅊ이름()\nㅋ\nㅊ이름()\nㅋ").map(n => n.kind), ["custom_type", "custom_type"]);
});

test("invalid punctuation and delimiter pairing", () => {
  for (const source of ["$", "[1)", "함수(", "목록[", ")", "[1,,2]", "목록[]", "목록[:::]", "[] 1"])
    parseError(source);
});

test("public error and Node structure", () => {
  assert.deepEqual(expression("2"), { kind: "literal", args: { value: 2n }, line: 1, col: 1 });
  const error = new ParseError("문제", 2, 4);
  assert.equal(error.message, "문제");
  assert.equal(String(error), "2행 4열: 문제");
  error.path = "가/나.txt";
  assert.equal(error.path, "가/나.txt");
});

test("deep recursive grammar gives positioned implementation limits", () => {
  const n = 1200;
  const sources = ["(".repeat(n) + "1" + ")".repeat(n), "[".repeat(n) + "1" + "]".repeat(n),
    "ㄴ ".repeat(n) + "ㅖ", "ㅁ ㅖ ㄱ\n".repeat(n) + "ㅍ\n" + "ㅋ\n".repeat(n), Array(n).fill("1").join("**")];
  for (const source of sources) {
    const error = parseError(source, `한도 ${MAX_SYNTAX_DEPTH}`);
    assert.ok(error.line >= 1 && error.col >= 1);
  }
});

test("deep left-associative and postfix trees are bounded", () => {
  for (const source of [Array(2000).fill("1").join("+"), "목록" + "[0]".repeat(2000),
    "객체" + ".이름".repeat(2000), "함수" + "()".repeat(2000)]) parseError(source, "구문 트리 깊이 한도", undefined, ["목록", "객체", "함수"]);
});

test("depth limits do not cap wide lists or long programs", () => {
  assert.equal(parse("ㅍ\n".repeat(5000)).length, 5000);
  assert.equal(expression("[" + Array(5000).fill("1").join(",") + "]").args.items.length, 5000);
  let nested = expression("[".repeat(80) + "1" + "]".repeat(80));
  for (let n = 0; n < 80; n++) nested = nested.args.items[0];
  assert.equal(nested.args.value, 1n);
});

test("a failed deep parse does not poison later parses", () => {
  parseError("(".repeat(200) + "1" + ")".repeat(200), "한도");
  assert.equal(expression("3").args.value, 3n);
});

test("native jamo IF allows adjacent conditions, including elseif", () => {
  for (const source of ["ㅁ(ㅖ) ㄱ\nㅋ", "ㅁㅖ ㄱ\nㅋ", "ㅁ/* 설명 */ㅖ ㄱ\nㅋ",
    "ㅁㅗㄱ\nㅇㅁ(ㅖ)ㄱ\nㅋ", "ㅁ_조건ㄱ\nㅋ", "ㅁ조건ㄱ\nㅋ"])
    assert.equal(parse(source, { declaredNames: ["조건"] })[0].kind, "if");
  assert.equal(parse("ㅁ_조건ㄱ\nㅋ")[0].args.branches[0][0].args.name, "_조건");
  assert.equal(parse("ㅁ\t(ㅖ) ㄱ\nㅋ")[0].kind, "if");
  parseError("ㅁㄱ\nㅋ");
  parseError("ㅁㅖ\nㅋ", "ㄱ");
});

test("English IF word alias requires whitespace without restricting native jamo", () => {
  assert.equal(parse("ㅊif = ㅁ\nif (ㅖ) ㄱ\nㅋ")[0].kind, "if");
  parseError("ㅊif = ㅁ\nif(ㅖ)ㄱ\nㅋ", "if 뒤에는 공백");
  assert.equal(parse("ㅊif = ㅁ\nㅁㅖㄱ\nㅋ")[0].kind, "if");
  assert.equal(parse("ㅊ실행\nㅁㅖㄱ\nㅍ\nㅋ\nㅋ\n실행")[0].kind, "if");
});

test("proposed IF spellings are ordinary names, not aliases", () => {
  for (const name of ["if", "만일", "만약에", "만약"])
    assert.equal(parse(`ㅒ ${name} = 3`)[0].args.name, name);
});

test("arithmetic characters are always operators, never identifier parts", () => {
  for (const op of ["+", "-", "*", "/"]) {
    const node = expression(`왼쪽${op}오른쪽`, ["왼쪽", "오른쪽"]);
    assert.equal(node.args.op, op);
    assert.equal(node.args.left.args.name, "왼쪽");
    assert.equal(node.args.right.args.name, "오른쪽");
    assert.equal(isIdentifier(`왼쪽${op}오른쪽`), false);
  }
});

test("Unicode identifier digits and combining marks match the legacy categories", () => {
  for (const name of ["값１", "값١", "값²", "값①", "값፩", "값𐒠", "e\u0301", "K", "𐐀값"])
    assert.equal(isIdentifier(name), true, name);
  for (const name of ["", "１값", "١값", "값½", "값Ⅻ", "ㄱ", "값ㄱ", "값\u20dd", "가-나"])
    assert.equal(isIdentifier(name), false, name);
  assert.equal(parse("ㅒ 값１ = 2")[0].args.name, "값１");
  for (const source of ["１２", "١٢"]) parseError(source);
});
