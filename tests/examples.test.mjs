import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Interpreter, MemoryFiles } from '../dist/runtime.js';
import { examples } from '../dist/examples.js';

const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
const blocks = [...readme.matchAll(/```text\r?\n([\s\S]*?)```/g)].map(match => match[1].replaceAll('\r\n', '\n'));
const expectedReadme = [['합계: 350','90점 이상: [100, 95]'],['모아쓰기 실행'],['압축 조건문','같은 매크로'],['3'],['A'],['첫 번째','두 번째'],['철수'],['90','100']];
assert.equal(blocks.length, expectedReadme.length, '모든 README 자모 예제를 실행 대상으로 등록해야 합니다.');
for (let index = 0; index < blocks.length; index++) {
  test(`README executable example ${index + 1}`, async () => {
    const stdout = [];
    await new Interpreter({ output: line => stdout.push(line) }).execute(blocks[index]);
    assert.deepEqual(stdout, expectedReadme[index]);
  });
}
const expectedExamples = [
  ['전체 합계: 350', '90점 이상: [100, 95]', '100점이 있나요? ㅖ', '참조로 고친 목록: [110, 85, 100, 95]'],
  ['1 2 3','99 2 3'],
  ['3','첫 번째','두 번째'],
  ['안녕하세요, 철수','안녕하세요, 영희','안녕하세요, 새 이름','영희의 이름: 영희','자료형: 사람'],
  ['반갑습니다, 아디나','계속 버튼을 눌러 실행을 재개했습니다.'],
  ['도구의 결과: 42','계산 결과: 42'],
  ['완성형','부분 조합','중성 종성']
];
assert.equal(examples.length, expectedExamples.length);
examples.forEach((example, index) => {
  test(`browser bundled example: ${example.title}`, async () => {
    const stdout = [], prompts = [], debugLines = [];
    const fs = new MemoryFiles(example.files);
    const vm = new Interpreter({ output: line => stdout.push(line), input: prompt => { prompts.push(prompt); return '아디나'; }, readFile: fs.readFile, writeFile: fs.writeFile, debugger: (_vm,_env,node) => { debugLines.push(node.line); } });
    await vm.runFile(example.path);
    assert.deepEqual(stdout, expectedExamples[index]);
    if (index === 4) { assert.deepEqual(prompts,['이름을 알려주세요.']); assert.deepEqual(debugLines,[4]); }
    if (index === 5) assert.equal(await fs.readFile('/결과.txt'),'계산 결과: 42');
  });
});
