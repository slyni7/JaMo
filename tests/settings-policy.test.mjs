import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, ParseError } from '../dist/frontend.js';
import { Interpreter, MemoryFiles } from '../dist/runtime.js';
import { COMMANDS, SYMBOLS, CLUSTER_DEFAULTS, defaultSettings, copySettings, validateSettings, wordAliases } from '../dist/settings.js';

async function output(source, options = {}) {
  const lines = [];
  const vm = new Interpreter({ output: value => lines.push(value), ...options });
  await vm.execute(source);
  return { lines, vm };
}
function disabledError(symbol) {
  return error => {
    assert.ok(error instanceof ParseError || error.name === 'Fault', String(error));
    assert.ok(error.message.includes(`꺼진 자모 '${symbol}'`), error.message);
    return true;
  };
}
async function blocked(source, symbol, options = {}) {
  const lines = [];
  const vm = new Interpreter({ output: value => lines.push(value), disabledSymbols: [symbol], ...options });
  await assert.rejects(vm.execute(source, '/시작.txt'), disabledError(symbol));
  assert.deepEqual(lines, []);
}

test('default settings contain exactly 40 commands and 11 clusters without changing spellings', async () => {
  assert.equal(COMMANDS.length, 40);
  assert.equal(Object.keys(CLUSTER_DEFAULTS).length, 11);
  assert.equal(SYMBOLS.length, 51);
  assert.equal(new Set(SYMBOLS).size, 51);
  const settings = defaultSettings();
  assert.equal(settings.assist.timeoutMs, 300);
  assert.equal(settings.assist.enabled, true);
  assert.deepEqual(settings.disabledSymbols, []);
  assert.deepEqual(wordAliases(settings), []);
  assert.deepEqual(validateSettings(settings), settings);
  assert.deepEqual((await output('몍\nㅂ(ㅅ("12"))\nㅋ', {
    wordAliases: new Map(wordAliases(settings)), disabledSymbols: settings.disabledSymbols,
  })).lines, ['12']);
});

test('settings copies and validation results do not share editable arrays or nested records', () => {
  const original = defaultSettings();
  original.aliases['ㅂ'] = ['보여줘'];
  const copied = copySettings(original);
  copied.assist.timeoutMs = 10; copied.sound.enabled = true;
  copied.aliases['ㅂ'].push('print'); copied.disabledSymbols.push('ㅄ');
  assert.equal(original.assist.timeoutMs, 300);
  assert.equal(original.sound.enabled, false);
  assert.deepEqual(original.aliases['ㅂ'], ['보여줘']);
  assert.deepEqual(original.disabledSymbols, []);
  const validated = validateSettings(original);
  validated.aliases['ㅂ'].push('출력'); validated.assist.enabled = false;
  assert.deepEqual(original.aliases['ㅂ'], ['보여줘']);
  assert.equal(original.assist.enabled, true);
  assert.deepEqual(defaultSettings().aliases['ㅂ'], []);
});

test('settings validate supported versions, timing, skin, sound and disabled slots', () => {
  for (const mutate of [
    value => { value.version = 2; }, value => { value.assist = null; },
    value => { value.assist.enabled = 1; }, value => { value.assist.timeoutMs = -1; },
    value => { value.assist.timeoutMs = 2001; }, value => { value.assist.timeoutMs = 0.5; },
    value => { value.theme = 'unknown'; }, value => { value.accent = 'red'; },
    value => { value.sound = null; }, value => { value.sound.volume = NaN; },
    value => { value.sound.volume = -0.1; }, value => { value.sound.volume = 1.1; },
    value => { value.disabledSymbols = ['A']; }, value => { value.disabledSymbols = ['ㅂ', 'ㅂ']; },
  ]) {
    const settings = defaultSettings(); mutate(settings);
    assert.throws(() => validateSettings(settings), Error, String(mutate));
  }
  for (const input of [null, undefined, false, 3, 'settings']) assert.throws(() => validateSettings(input));
  for (const timeoutMs of [0, 300, 2000]) {
    const settings = defaultSettings(); settings.assist.timeoutMs = timeoutMs;
    assert.equal(validateSettings(settings).assist.timeoutMs, timeoutMs);
  }
});

test('alias validation rejects invalid names, duplicate ownership and incomplete slot tables', () => {
  for (const aliases of [['a+b'], ['+'], ['two words'], [''], ['1word'], ['a'.repeat(101)], [3], Array(51).fill('word')]) {
    const settings = defaultSettings(); settings.aliases['ㅂ'] = aliases;
    assert.throws(() => validateSettings(settings), Error, JSON.stringify(aliases));
  }
  for (const second of ['ㅂ', 'ㅄ', 'ㅅ']) {
    const settings = defaultSettings(); settings.aliases['ㅂ'] = ['보여줘'];
    settings.aliases[second].push('보여줘');
    assert.throws(() => validateSettings(settings), /중복/);
  }
  const incomplete = defaultSettings(); delete incomplete.aliases['ㅄ'];
  assert.throws(() => validateSettings(incomplete), /ㅄ/);
});

test('word alias editing maps names to fixed slots including disabled and cluster slots', () => {
  const settings = defaultSettings();
  settings.aliases['ㅂ'] = ['print', '보여줘']; settings.aliases['ㅄ'] = ['출력정수'];
  settings.disabledSymbols = ['ㅄ'];
  const aliases = new Map(wordAliases(validateSettings(settings)));
  assert.equal(aliases.get('print'), 'ㅂ'); assert.equal(aliases.get('보여줘'), 'ㅂ');
  assert.equal(aliases.get('출력정수'), 'ㅄ');
  assert.equal(aliases.size, 3);
});

test('disabled print rejects raw, conjoining, filler and composed command spelling', async () => {
  for (const source of ['ㅂ(1)', 'ᄇ(1)', 'ᄇᅠ(1)', 'ㅊ코드=밥\nㅍ', 'ㅊ코드=밥'.normalize('NFD') + '\nㅍ'])
    await blocked(source, 'ㅂ');
});

test('disabled print cannot be reached through word aliases or custom macros', async () => {
  await blocked('print(1)', 'ㅂ', { wordAliases: new Map([['print', 'ㅂ']]) });
  await blocked('보여줘(1)', 'ㅂ', { wordAliases: new Map([['보여줘', 'ㅂ']]) });
  await blocked('ㅊ보여줘=ㅂ\n보여줘(1)', 'ㅂ');
  await blocked('ㅊ출력\nㅂ(1)\nㅋ\n출력', 'ㅂ');
});

test('imports retain the same disabled-symbol and alias policy', async () => {
  const files = new MemoryFiles({ '/도구.txt': 'print(1)' });
  await blocked('ㅚ "도구.txt" 도구', 'ㅂ', { files, wordAliases: new Map([['print', 'ㅂ']]) });
  const rawFiles = new MemoryFiles({ '/도구.txt': 'ㅂ(2)' });
  await blocked('ㅚ "도구.txt" 도구', 'ㅂ', { files: rawFiles });
});

test('disabled label also disables every supported spelling of the yo payload combination', async () => {
  for (const header of ['묙', '묘ㄱ', 'ㅁㅛㄱ', '묙'.normalize('NFD')])
    await blocked(`${header}(ㅖ)\nㅍ\nㅋ`, 'ㅛ');
  await blocked('ㅛ 위치\nㅍ', 'ㅛ');
  assert.deepEqual((await output('ㅁㅖㄱ\nㅂ(1)\nㅋ', { disabledSymbols: ['ㅛ'] })).lines, ['1']);
});

test('disabled cluster identity survives raw spelling, Unicode final jamo and full syllables', () => {
  for (const spelling of ['ㅄ', 'ᆹ', '값', '값'.normalize('NFD')]) {
    // A token macro may store a fragment; its standalone syntactic validity is not assumed.
    const source = `ㅊ조각=${spelling}\nㅍ`;
    assert.doesNotThrow(() => parse(source));
    assert.throws(() => parse(source, { disabledSymbols: ['ㅄ'] }), disabledError('ㅄ'));
  }
});

test('all 11 disabled cluster slots retain their identity through Unicode final spelling', () => {
  const clusters = Array.from('ㄳㄵㄶㄺㄻㄼㄽㄾㄿㅀㅄ');
  const finals = Array.from('ᆪᆬᆭᆰᆱᆲᆳᆴᆵᆶᆹ');
  for (const [index, cluster] of clusters.entries()) {
    assert.throws(() => parse(`ㅊ조각=${cluster}`, { disabledSymbols: [cluster] }), disabledError(cluster));
    assert.throws(() => parse(`ㅊ조각=${finals[index]}`, { disabledSymbols: [cluster] }), disabledError(cluster));
  }
});

test('disabled cluster rejects aliases targeting that slot without changing its builtin expansion', async () => {
  await blocked('ㅊ조각=출력정수\nㅍ', 'ㅄ', { wordAliases: new Map([['출력정수', 'ㅄ']]) });
  const options = { wordAliases: new Map([['출력정수', 'ㅄ']]) };
  assert.deepEqual(parse('ㅊ조각=출력정수\nㅍ', options), parse('ㅊ조각=ㅄ\nㅍ'));
});

test('disabling a cluster slot does not disable its two independently enabled consonants', async () => {
  assert.doesNotThrow(() => parse('ㅊ조각=ㅂㅅ\nㅍ', { disabledSymbols: ['ㅄ'] }));
  assert.deepEqual((await output('ㅂ(ㅅ("12"))', { disabledSymbols: ['ㅄ'] })).lines, ['12']);
  assert.doesNotThrow(() => parse('ㅊ조각=ㄱㅅ\nㅍ', { disabledSymbols: ['ㄳ'] }));
});

test('an enabled cluster cannot bypass a disabled component command', async () => {
  for (const symbol of ['ㅂ', 'ㅅ']) {
    await blocked('ㅊ조각=ㅄ\nㅍ', symbol);
    await blocked('ㅊ조각=ᆹ\nㅍ', symbol);
    await blocked('ㅊ조각=출력정수\nㅍ', symbol, { wordAliases: new Map([['출력정수', 'ㅄ']]) });
  }
});

test('strings, characters and comments preserve disabled spellings without executing them', async () => {
  const symbols = SYMBOLS.join('');
  const source = `# ${symbols}\n/* ${symbols} */\n"${symbols}"\n'ㅄ'\n"묙(ㅖ)"`;
  const nodes = parse(source, { disabledSymbols: SYMBOLS });
  assert.equal(nodes[0].args.value.args.value, symbols);
  assert.equal(nodes[1].args.value.args.value, 'ㅄ');
  assert.deepEqual((await output(source, { disabledSymbols: SYMBOLS })).lines, []);
});

test('declared syllable, cluster and combo names remain names when their command slots are disabled', async () => {
  for (const [name, disabled] of [['밥', 'ㅂ'], ['값', 'ㅄ'], ['ㅄ', 'ㅄ'], ['묙', 'ㅛ']]) {
    const { vm } = await output(`ㅒ ${name}=7\n${name}=${name}+1`, { disabledSymbols: [disabled] });
    assert.equal(vm.globals.lookup(name).read(), 8n, `${name}/${disabled}`);
  }
});

test('word aliases retain priority over previously declared names and cannot bypass disabled slots', async () => {
  const aliases = new Map([['보여줘', 'ㅂ']]);
  const lines = [];
  const enabled = new Interpreter({ wordAliases: aliases, output: value => lines.push(value) });
  enabled.globals.declare('보여줘', 7n);
  await enabled.execute('보여줘(9)');
  assert.deepEqual(lines, ['9']); assert.equal(enabled.globals.lookup('보여줘').read(), 7n);
  const disabled = new Interpreter({ wordAliases: aliases, disabledSymbols: ['ㅂ'] });
  disabled.globals.declare('보여줘', 7n);
  await assert.rejects(disabled.execute('보여줘(9)'), disabledError('ㅂ'));
  assert.equal(disabled.globals.lookup('보여줘').read(), 7n);
});

test('disabled symbol errors identify original source positions and reject unknown option slots', () => {
  assert.throws(() => parse('# 먼저\n  ㅂ(1)', { disabledSymbols: ['ㅂ'] }), error => {
    disabledError('ㅂ')(error); assert.deepEqual([error.line, error.col], [2, 3]); return true;
  });
  assert.throws(() => parse('ㅍ', { disabledSymbols: ['unknown'] }), /알 수 없는 자모 설정/);
});
