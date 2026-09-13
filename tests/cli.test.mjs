import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { encode } from '../dist/node-host.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const work = path.resolve(root, '../../work/ts-cli-checks');
await mkdir(work, { recursive: true });
const fixtureRoot = await mkdtemp(path.join(work, '한글 공백 '));
if (!fixtureRoot.startsWith(work + path.sep)) throw Error('테스트 파일 경로가 범위를 벗어났습니다.');
async function execute(source, options = [], input = Buffer.alloc(0), encoding = 'utf-8-sig') {
  const file = path.join(fixtureRoot, '실행.txt');
  await writeFile(file, encode(source, encoding));
  const result = spawnSync(process.execPath, [path.join(root, 'dist/cli.js'), file, ...options], { input, timeout: 10000, encoding: 'utf8' });
  if (result.error) throw result.error;
  return result;
}
test('CLI actual txt custom macros and custom classes', async () => {
  const result = await execute('ㅊ합침 = +\nㅊ사람(입력값)\nㅒ 이름 = 입력값\nㅎ 소개()\nㅂ(이름)\nㅋ\nㅋ\nㅒ 철수 = 사람("철수")\n철수.소개()\nㅂ(2 합침 3)');
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, '철수\n5\n');
});
test('CLI check does not execute side effects', async () => {
  const result = await execute('ㅂ("실행되면안됨")', ['--check']);
  assert.equal(result.status, 0); assert.match(result.stdout, /실행하지 않음/); assert.doesNotMatch(result.stdout, /실행되면안됨/);
});
test('CLI fresh default and shared rejection', async () => {
  const source = 'ㅒ 참조들 = []\nㅃ 값 ㅔ [1,2,3]\n추가(참조들, ㅓ 값)\nㅋ\nㅂ(ㅕ 참조들[0],ㅕ 참조들[1],ㅕ 참조들[2])';
  assert.equal((await execute(source)).stdout, '1 2 3\n');
  const bad = await execute(source, ['--loop-bindings', 'shared']); assert.equal(bad.status, 2); assert.match(bad.stderr, /fresh/);
});
test('CLI CP949 file roundtrip and unrepresentable output rejection', async () => {
  const good = await execute('쓰기("결과.txt", "한글 저장")\nㅂ(읽기("결과.txt"))', ['--encoding','cp949'], Buffer.alloc(0), 'cp949');
  assert.equal(good.status, 0, good.stderr); assert.equal(good.stdout, '한글 저장\n');
  const file = await readFile(path.join(fixtureRoot, '결과.txt')); assert.equal(new TextDecoder('euc-kr', { fatal: true }).decode(file), '한글 저장');
  const bad = await execute('쓰기("결과.txt", ㅈ(128512))', ['--encoding','cp949'], Buffer.alloc(0), 'cp949');
  assert.equal(bad.status, 1); assert.equal(new TextDecoder('euc-kr').decode(await readFile(path.join(fixtureRoot, '결과.txt'))), '한글 저장');
});
test('CLI strict stdin rejects malformed UTF8 and can catch EOF', async () => {
  const bad = await execute('ㅂ(입력())', [], Buffer.from([255,10])); assert.equal(bad.status,1); assert.equal(bad.stdout,''); assert.doesNotMatch(bad.stderr,/\n\s+at /);
  const eof = await execute('ㅑ\n입력()\nㅏ\nㅂ("끝")\nㅋ'); assert.equal(eof.status,0); assert.equal(eof.stdout,'끝\n');
});
test('CLI debugger input continue and abort', async () => {
  const continued = await execute('ㅙ\nㅂ("재개")', ['--debug'], Buffer.from('계속\n')); assert.equal(continued.status,0); assert.match(continued.stdout,/재개/);
  const aborted = await execute('ㅑ\nㅙ\nㅏ\nㅂ("잡으면안됨")\nㅋ', ['--debug'], Buffer.from('중단\n')); assert.equal(aborted.status,130); assert.doesNotMatch(aborted.stdout,/잡으면안됨/);
});
test('CLI compact jamo IF, word boundary and finite step diagnostic', async () => {
  const compact = await execute('ㅒ _조건=ㅖ\nㅁ_조건ㄱ\nㅂ("밑줄 이름")\nㅋ\nㅁ(ㅖ)ㄱ\nㅂ("괄호")\nㅋ\nㅁㅗㄱ\nㅂ("실패")\nㅇㅁㅖㄱ\nㅂ("다른 분기")\nㅋ');
  assert.equal(compact.status,0,compact.stderr); assert.equal(compact.stdout,'밑줄 이름\n괄호\n다른 분기\n');
  const word = await execute('ㅊif=ㅁ\nif (ㅖ)ㄱ\nㅂ("영문")\nㅋ'); assert.equal(word.status,0,word.stderr); assert.equal(word.stdout,'영문\n');
  const syntax = await execute('ㅊif=ㅁ\nif(ㅖ)ㄱ\nㅍ\nㅋ'); assert.equal(syntax.status,1); assert.match(syntax.stderr,/if 뒤에는 공백/);
  const loop = await execute('ㄸ ㅖ\nㅍ\nㅋ', ['--max-steps','10']); assert.equal(loop.status,1); assert.match(loop.stderr,/단계/);
});

test('CLI composed partial and canonical Hangul in UTF8 and CP949', async () => {
  const source='몍\nㅂ("완성형")\nㅋ\n몌ㄱ\nㅂ("부분 조합")\nㅋ\nㅁᅟᅨᆨ\nㅂ("중성 종성")\nㅋ';
  const result=await execute(source); assert.equal(result.status,0,result.stderr); assert.equal(result.stdout,'완성형\n부분 조합\n중성 종성\n');
  const cp949=await execute('몍\nㅂ("한글")\nㅋ',['--encoding','cp949'],Buffer.alloc(0),'cp949');
  assert.equal(cp949.status,0,cp949.stderr); assert.equal(cp949.stdout,'한글\n');
  const checked=await execute(source,['--check']); assert.equal(checked.status,0,checked.stderr); assert.match(checked.stdout,/실행하지 않음/);
});
