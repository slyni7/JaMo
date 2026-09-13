import test from 'node:test';
import assert from 'node:assert/strict';
import { Interpreter, MemoryFiles } from '../dist/runtime.js';

// Exercise the shipped worker handler; only its message transport is replaced.
await import('../dist/worker.js');
const receive = globalThis.onmessage;
async function run(source, path = '/main.txt', files = {}) {
  const messages = [];
  globalThis.postMessage = message => messages.push(message);
  try {
    await receive({ data: { type: 'run', source, path, files, maxSteps: 1000 } });
  } finally {
    delete globalThis.postMessage;
  }
  return messages;
}
const output = messages => messages.filter(message => message.type === 'output').map(message => message.text);

test('worker entry self-import matches CLI initialization and cycle detection', async () => {
  const source = 'ㅂ("init")\nㅑ\nㅚ "main.txt" self\nㅏ error\nㅂ("cycle caught")\nㅋ';
  const cliOutput = [];
  await new Interpreter({ files: new MemoryFiles({ '/main.txt': source }), output: text => cliOutput.push(text) }).runFile('/main.txt');
  const messages = await run(source);
  assert.deepEqual(cliOutput, ['init', 'cycle caught']);
  assert.deepEqual(output(messages), cliOutput);
  assert.equal(messages.at(-1).type, 'done');
});

test('worker detects an indirect cycle before reexecuting the entry', async () => {
  const messages = await run('ㅂ("entry")\nㅚ "helper.txt" helper', '/project/main.txt', {
    '/project/helper.txt': 'ㅂ("helper")\nㅚ "./main.txt" main'
  });
  assert.deepEqual(output(messages), ['entry', 'helper']);
  assert.equal(messages.at(-1).type, 'error');
  assert.match(messages.at(-1).message, /순환 가져오기/);
});

test('worker runs the current editor buffer and caches ordinary imports', async () => {
  const messages = await run('ㅂ("edited")\nㅚ "helper.txt" first\nㅚ "helper.txt" second\nㅂ(first.값,second.값)', '/main.txt', {
    '/main.txt': 'ㅂ("stale")',
    '/helper.txt': 'ㅂ("helper")\nㅒ 값=7'
  });
  assert.deepEqual(output(messages), ['edited', 'helper', '7 7']);
  assert.equal(messages.at(-1).type, 'done');
});

test('worker normalizes entry and workspace paths before file execution', async () => {
  for (const path of ['./project/main.txt', '/project/./main.txt', '\\project\\main.txt']) {
    const messages = await run('ㅚ "helper.txt" helper\nㅂ(helper.값)', path, {
      './project/./helper.txt': 'ㅒ 값=9'
    });
    assert.deepEqual(output(messages), ['9'], path);
    assert.equal(messages.at(-1).type, 'done', path);
  }
});

test('worker accepts a new run after a cycle error', async () => {
  const failed = await run('ㅚ "main.txt" self');
  assert.equal(failed.at(-1).type, 'error');
  const messages = await run('ㅂ("next")');
  assert.deepEqual(output(messages), ['next']);
  assert.equal(messages.at(-1).type, 'done');
});
