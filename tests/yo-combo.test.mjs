import test from 'node:test';
import assert from 'node:assert/strict';
import { KEYWORDS, MAX_SYNTAX_DEPTH, ParseError, parse } from '../dist/frontend.js';
import { Fault, Interpreter } from '../dist/runtime.js';

async function run(source, options = {}, path = '/조합.txt') {
  const lines = [];
  const vm = new Interpreter({ output: line => lines.push(line), maxSteps: 10000, ...options });
  await vm.execute(source, path);
  return { lines, vm };
}

function semantic(value) {
  if (Array.isArray(value)) return value.map(semantic);
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => key !== 'line' && key !== 'col')
      .map(([key, item]) => [key, semantic(item)]));
  return value;
}

test('yo combinations preserve the forty commands and the ordinary if AST', () => {
  assert.equal(KEYWORDS.size, 40);
  assert.equal(KEYWORDS.has('묙'), false);
  const ordinary = parse('ㅁ 2 > 1 ㄱ\nㅂ(7)\nㅇ\nㅂ(8)\nㅋ');
  const compact = parse('묙(2 > 1)\nㅂ(7)\nㅇ\nㅂ(8)\nㅋ');
  assert.deepEqual(semantic(compact), semantic(ordinary));
});

test('yo expansion preserves arbitrary consonant roles outside block headers', async () => {
  const compact = 'ㅂ(뇬(ㅗㅘ)ㅗ)';
  const ordinary = 'ㅂ(ㄴㅗㅘㄴㅗ)';
  assert.deepEqual(semantic(parse(compact)), semantic(parse(ordinary)));
  assert.deepEqual((await run(compact)).lines, ['ㅖ']);
});

test('all 513 final-bearing yo syllables match ordinary commands in three parsing contexts', t => {
  // Independent Unicode syllable arithmetic and explicit command spellings: do not use commandParts.
  const initials = Array.from('ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ');
  const finals = ['ㄱ', 'ㄲ', 'ㄱㅅ', 'ㄴ', 'ㄴㅈ', 'ㄴㅎ', 'ㄷ', 'ㄹ', 'ㄹㄱ',
    'ㄹㅁ', 'ㄹㅂ', 'ㄹㅅ', 'ㄹㅌ', 'ㄹㅍ', 'ㄹㅎ', 'ㅁ', 'ㅂ', 'ㅂㅅ',
    'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
  const contexts = [
    ['block header', header => `${header}\nㅋ`],
    ['function body', header => `ㅎ _함수()\n${header}\nㅋ\nㅋ`],
    ['call argument', header => `ㅂ(${header})`],
  ];
  assert.equal(initials.length, 19);
  assert.equal(finals.length, 27);
  let valid = 0, invalid = 0, comparisons = 0;
  for (const [initialIndex, prefix] of initials.entries()) {
    for (const [finalIndex, suffix] of finals.entries()) {
      const syllable = String.fromCodePoint(0xac00 + initialIndex * 588 + 12 * 28 + finalIndex + 1);
      for (const [contextName, wrap] of contexts) {
        const label = `${syllable} (${prefix}/${suffix}), ${contextName}`;
        let ordinary;
        try {
          ordinary = semantic(parse(wrap(`${prefix} ㅖ ${suffix}`)));
          valid++;
        } catch (error) {
          assert.ok(error instanceof ParseError, `${label}: ordinary form threw ${error}`);
          invalid++;
        }
        for (const spelling of [syllable, syllable.normalize('NFD')]) {
          const source = wrap(`${spelling}(ㅖ)`);
          if (ordinary === undefined) assert.throws(() => parse(source), ParseError, label);
          else assert.deepEqual(semantic(parse(source)), ordinary, label);
          comparisons++;
        }
      }
    }
  }
  assert.equal(valid + invalid, 513 * 3);
  assert.equal(comparisons, 513 * 3 * 2);
  t.diagnostic(`1539 reference parses: ${valid} valid, ${invalid} syntax errors; 3078 composed/NFD comparisons`);
});

test('excessive combo nesting raises a language error and leaves subsequent parsing usable', () => {
  let source = 'ㅍ';
  for (let depth = 0; depth <= MAX_SYNTAX_DEPTH; depth++)
    source = `훀(_함수${depth}();${source};)`;
  assert.throws(() => parse(source), error => error instanceof ParseError
    && error.message.includes(`한도 ${MAX_SYNTAX_DEPTH}`));
  assert.equal(parse('묙(ㅖ)\nㅋ')[0].kind, 'if');
});

test('composed, partial, raw and canonical NFD yo headers execute alike', async () => {
  const forms = ['묙', '묘ㄱ', 'ㅁㅛㄱ', '묙'.normalize('NFD'), 'ㅁᅭᆨ', 'ᄆㅛㄱ'];
  for (const header of forms) {
    const { lines } = await run(`${header}(2 > 1)\nㅂ("참")\nㅇ\nㅂ("거짓")\nㅋ`);
    assert.deepEqual(lines, ['참'], header);
  }
});

test('unparenthesized payload ends at newline or semicolon', async () => {
  for (const header of ['묙 2 > 1', '묘ㄱ 2 > 1', 'ㅁㅛㄱ 2 > 1', '묙ㅖ']) {
    for (const separator of ['\n', ';']) {
      const source = `${header}${separator}ㅂ("진입")${separator}ㅋ${separator}ㅂ("종료")`;
      assert.deepEqual((await run(source)).lines, ['진입', '종료'], source);
    }
  }
});

test('if, elseif and else retain branch selection with yo headers', async () => {
  const source = '묙(ㅗ)\nㅂ(1)\nㅇ 묙(2 == 2)\nㅂ(2)\nㅇ\nㅂ(3)\nㅋ';
  assert.deepEqual((await run(source)).lines, ['2']);
  assert.deepEqual((await run('묙 ㅗ\nㅂ(1)\nㅇ 묙 ㅗ\nㅂ(2)\nㅇ\nㅂ(3)\nㅋ')).lines, ['3']);
});

test('while yo header preserves condition reevaluation, continue and break', async () => {
  const source = 'ㅒ 횟수=0\n뚁(횟수 < 5)\n횟수=횟수+1\n'
    + '묙(횟수 == 2)\nㄹ\nㅋ\n묙(횟수 == 4)\nㅡ\nㅋ\nㅂ(횟수)\nㅋ\nㅂ(횟수)';
  assert.deepEqual((await run(source)).lines, ['1', '3', '4']);
});

test('for yo header introduces its Hangul binding and retains the ordinary AST', async () => {
  const source = '뾱(항목 ㅔ [1,2,3])\nㅂ(항목)\nㅋ';
  assert.deepEqual(semantic(parse(source)), semantic(parse('ㅃ 항목 ㅔ [1,2,3] ㄱ\nㅂ(항목)\nㅋ')));
  assert.deepEqual((await run(source)).lines, ['1', '2', '3']);
  assert.deepEqual((await run('뾱 항목 ㅔ [4,5]\nㅂ(항목)\nㅋ')).lines, ['4', '5']);
});

test('nested compressed loops and conditions keep each block boundary', async () => {
  const source = 'ㅒ 합=0\n뾱(항목 ㅔ [1,2,3])\n묙(항목 > 1)\n'
    + 'ㅒ 남음=항목\n뚁 남음 > 0\n합=합+1\n남음=남음-1\nㅋ\nㅋ\nㅋ\nㅂ(합)';
  assert.deepEqual((await run(source)).lines, ['5']);
});

test('parenthesized payload respects nested calls, indexing and multiline brackets', async () => {
  const source = '묙(\n  [1,\n   2][1] == (1 + 1) ㅘ ㅐ([3,4]) == 2\n)\nㅂ("중첩")\nㅋ';
  assert.deepEqual((await run(source)).lines, ['중첩']);
});

test('unparenthesized payload ignores newlines inside balanced brackets', async () => {
  const source = '묙 [1,\n2][1] == (\n1 + 1\n)\nㅂ("괄호 경계")\nㅋ';
  assert.deepEqual((await run(source)).lines, ['괄호 경계']);
});

test('yo payload keeps arithmetic grouping and boolean short circuit semantics', async () => {
  const source = '묙((1 + 2) * 3 == 9 ㅣ _없는함수())\nㅂ("그대로")\nㅋ\n'
    + '묙(ㅗ ㅘ _없는함수())\nㅂ("실행 금지")\nㅋ';
  assert.deepEqual((await run(source)).lines, ['그대로']);
});

test('comments cannot end or fabricate a yo payload', async () => {
  const source = '묙(ㅖ # ) 묙(ㅗ)\n /* ) ; 묙(ㅗ) */)\nㅂ("괄호")\nㅋ\n'
    + '묙 ㅖ # 묙(ㅗ)\nㅂ("줄 끝")\nㅋ';
  assert.deepEqual((await run(source)).lines, ['괄호', '줄 끝']);
});

test('strings and char literals preserve yo spellings verbatim', async () => {
  const nfd = '묙'.normalize('NFD');
  const source = `# 묙(ㅗ)\n/* 묘ㄱ(ㅗ) */\nㅂ("묙(ㅖ)", '묙', "ㅁㅛㄱ", "${nfd}")`;
  assert.deepEqual((await run(source)).lines, [`묙(ㅖ) 묙 ㅁㅛㄱ ${nfd}`]);
});

test('declared yo names and mixed identifiers take priority over command expansion', async () => {
  const source = 'ㅒ 묙=7\nㅒ _묙=8\nㅒ 묙1=9\nㅒ 묙x=10\nㅂ(묙,_묙,묙1,묙x)';
  const { lines, vm } = await run(source);
  await vm.execute('묙=묙+1\nㅂ(묙)');
  assert.deepEqual(lines, ['7 8 9 10', '8']);
});

test('function names and parameters retain declared yo spellings', async () => {
  assert.deepEqual((await run('ㅎ 묙(값)\nㄷ 값+1\nㅋ\nㅂ(묙(2))')).lines, ['3']);
  assert.deepEqual((await run('ㅎ 돌려줌(묙)\nㄷ 묙\nㅋ\nㅂ(돌려줌(9))')).lines, ['9']);
});

test('a whole function combo retains its name, parameter and body statement boundaries', async () => {
  const compact = '훀(계산(몍)\nㄷ 몍+1\n)\nㅂ(계산(4))';
  const ordinary = 'ㅎ 계산(몍)\nㄷ 몍+1\nㅋ\nㅂ(계산(4))';
  assert.deepEqual(semantic(parse(compact)), semantic(parse(ordinary)));
  assert.deepEqual((await run(compact)).lines, ['5']);
});

test('a matching custom name expands before vanilla yo interpretation', async () => {
  assert.deepEqual((await run('ㅊ묙=ㅂ\n묙(3)')).lines, ['3']);
});

test('declared combo names do not invent parameter or loop bindings in their call arguments', async () => {
  const sources = [
    'ㅎ 훀(x);ㄷ x;ㅋ;ㅂ(훀(노))',
    'ㅊ훀=ㅂ\nㅊa=훀\na(노)',
    'ㅊ뾱=ㅂ\n뾱(노)',
  ];
  for (const source of sources)
    assert.deepEqual((await run(source)).lines, ['ㅖ'], source);
});

test('word mapping wins over an existing declared yo name', async () => {
  const lines = [];
  const vm = new Interpreter({ output: line => lines.push(line), wordAliases: new Map([['묙', 'ㅂ']]) });
  vm.globals.declare('묙', 7n);
  await vm.execute('묙(3)');
  assert.deepEqual(lines, ['3']);
  assert.equal(vm.globals.lookup('묙').read(), 7n);
});

test('a word mapping can introduce a yo command combination', async () => {
  const options = { wordAliases: new Map([['조건문', 'ㅁㅛㄱ']]) };
  assert.deepEqual((await run('조건문(ㅖ)\nㅂ(1)\nㅋ', options)).lines, ['1']);
});

test('custom token aliases can introduce a yo command combination', async () => {
  const source = 'ㅊ조건문=ㅁㅛㄱ\n조건문(ㅖ)\nㅂ(1)\nㅋ';
  assert.deepEqual((await run(source)).lines, ['1']);
});

test('custom block collection balances a compressed conditional in its body', async () => {
  const source = 'ㅊ실행\n묙(ㅗ)\nㅂ(1)\nㅇ 묙(ㅖ)\nㅂ(2)\nㅋ\nㅋ\n실행';
  assert.deepEqual((await run(source)).lines, ['2']);
});

test('a custom block balances a yo alias declared and invoked inside that block', async () => {
  const source = 'ㅊ실행\nㅊ조건문=ㅁㅛㄱ\n조건문(ㅖ)\nㅂ(1)\nㅋ\nㅋ\n실행';
  assert.deepEqual((await run(source)).lines, ['1']);
});

test('nested independent uses of a combo alias are not mistaken for recursive expansion', async () => {
  const compact = 'ㅊF=ㅎㅛㅋ; F(outer();F(inner();ㄷ 1;);ㄷ inner(););ㅂ(outer())';
  const ordinary = 'ㅎ outer();ㅎ inner();ㄷ 1;ㅋ;ㄷ inner();ㅋ;ㅂ(outer())';
  assert.deepEqual(semantic(parse(compact)), semantic(parse(ordinary)));
  assert.deepEqual((await run(compact)).lines, ['1']);
});

test('an alias registered by a macro resolves later redefinition without retaining its creation chain', async () => {
  const source = 'ㅊ공장\nㅊ별칭=공장\nㅋ\n공장\nㅊ공장=1\nㅂ(별칭)';
  assert.deepEqual((await run(source)).lines, ['1']);
});

test('inline custom registration inside a function combo does not add a block opener', async () => {
  const source = 'ㅊblock\n훀(f();ㅊx=1;ㄷ x;)\nㅋ\nblock\nㅂ(f())';
  assert.deepEqual((await run(source)).lines, ['1']);
});

test('inline custom registration stays balanced inside an aliased function combo', async () => {
  const source = 'ㅊF=ㅎㅛㅋ\nㅊblock\nF(f();ㅊx=1;ㄷ x;)\nㅋ\nblock\nㅂ(f())';
  assert.deepEqual((await run(source)).lines, ['1']);
});

test('an if alias inside a function combo participates in surrounding custom block balance', async () => {
  const source = 'ㅊT=ㅁ\nㅊblock\n훀(f();T ㅖ ㄱ;ㅍ;ㅋ;)\nㅋ\nblock\nf()';
  assert.deepEqual((await run(source)).lines, []);
});

test('an end alias inside a function combo participates in surrounding custom block balance', async () => {
  const source = 'ㅊK=ㅋ\nㅊblock\n훀(f();ㅁㅖㄱ;ㅍ;K;)\nㅋ\nblock\nf()';
  assert.deepEqual((await run(source)).lines, []);
});

test('bare yo label accepts existing and parenthesized names with real goto execution', async () => {
  for (const label of ['ㅛ 끝점', 'ㅛ(끝점)']) {
    const source = `ㄲ 끝점\nㅂ("건너뜀 실패")\n${label}\nㅂ("도착")`;
    assert.deepEqual((await run(source)).lines, ['도착'], label);
    assert.equal(parse(label)[0].kind, 'label');
    assert.equal(parse(label)[0].args.name, '끝점');
  }
});

test('parenthesized labels protect decomposable names and require one name', async () => {
  const source = 'ㄲ 묙\nㅂ("건너뜀 실패")\nㅛ(묙)\nㅂ("도착")';
  assert.deepEqual((await run(source)).lines, ['도착']);
  for (const invalid of ['ㅛ()', 'ㅛ(1)', 'ㅛ("이름")', 'ㅛ(가,나)', 'ㅛ(가+나)'])
    assert.throws(() => parse(invalid), ParseError, invalid);
});

test('a syllable without a final retains its initial instead of becoming a bare label', () => {
  for (const source of ['묘(이름)', '묘 이름', 'ㅁㅛ(이름)', '묘'.normalize('NFD') + '(이름)'])
    assert.throws(() => parse(source), ParseError, source);
  assert.equal(parse('ㅛ(이름)')[0].kind, 'label');
});

test('spaced consonants are not silently joined into a yo command header', () => {
  for (const source of ['ㅁ ㅛ ㄱ(ㅖ)\nㅋ', 'ㅁㅛ ㄱ(ㅖ)\nㅋ', 'ㅁ ㅛㄱ(ㅖ)\nㅋ',
    'ㅁ/*설명*/ㅛㄱ(ㅖ)\nㅋ'])
    assert.throws(() => parse(source), ParseError, source);
});

test('empty, malformed and invalid-command combinations remain syntax errors', () => {
  for (const source of ['묙()\nㅋ', '묙\nㅋ', '묙(ㅖ', '묙(ㅖ]\nㅋ',
    '묙 ㅖ\nㅘㅖ\nㅋ', '굑(ㅖ)', '훃(ㅖ)', '묙(ㅖ)\nㅍ'])
    assert.throws(() => parse(source), ParseError, source);
});

test('combo syntax and runtime failures point into the original source', async () => {
  const node = parse('# 앞줄\n  묙(ㅖ)\nㅋ')[0];
  assert.deepEqual([node.line, node.col], [2, 3]);
  assert.throws(() => parse('  묙(,)\nㅋ'),
    error => error instanceof ParseError && error.line === 1 && error.col === 5);
  await assert.rejects(run('# 앞줄\n묙(_없는이름)\nㅋ'),
    error => error instanceof Fault && error.path === '/조합.txt' && error.line === 2 && error.col === 3);
});
