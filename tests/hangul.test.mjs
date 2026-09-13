import test from 'node:test';
import assert from 'node:assert/strict';
import { commandParts } from '../dist/hangul.js';
import { parse, ParseError } from '../dist/frontend.js';
import { Interpreter, MemoryFiles } from '../dist/runtime.js';
import { decode, encode } from '../dist/node-host.js';
async function output(source, options={}) {
 const lines=[]; const vm=new Interpreter({output:line=>lines.push(line),...options});
 await vm.execute(source); return {lines,vm};
}

test('all 11172 modern syllables agree with independent canonical NFD decomposition', () => {
 for(let point=0xac00;point<=0xd7a3;point++) {
  const char=String.fromCodePoint(point);
  const expected=Array.from(char.normalize('NFD'),part=>commandParts(part)).join('');
  assert.equal(commandParts(char),expected,char);
 }
 assert.equal(commandParts('몍'),'ㅁㅖㄱ');
 assert.equal(commandParts('값'),'ㄱㅏㅂㅅ');
 assert.equal(commandParts('꽦'),'ㄲㅙㄲ');
});

test('CP949 UHC extension covers all modern syllables and rejects invalid bytes', () => {
 // Python 3.12 cp949 independently confirms 91 75 is 몍.
 assert.equal(decode(Uint8Array.of(0x91,0x75),'cp949'),'몍');
 const syllables=Array.from({length:11172},(_,index)=>String.fromCodePoint(0xac00+index)).join('');
 assert.equal(decode(encode(syllables,'cp949'),'cp949'),syllables);
 for(const values of [[0x80],[0xff],[0x81],[0x81,0x40],[0x81,0x7f]])
  assert.throws(()=>decode(Uint8Array.from(values),'cp949'),/잘못된 CP949/);
 assert.throws(()=>encode('😀','cp949'),/표현할 수 없는/);
});

test('complete, partial, canonical and filler spellings execute the same conditional', async () => {
 for(const header of ['몍','몌ㄱ','ㅁㅖㄱ','몍','ㅁᅨᆨ','ᄆㅖㄱ','ㅁᅟᅨᆨ','ㅁᅟᅨㄱ','ㅁㅤㅖᆨ']) {
  assert.deepEqual((await output(`${header}\nㅂ("실행")\nㅋ`)).lines,['실행'],header);
 }
});

test('registered word mapping wins over an existing declared spelling and vanilla', async () => {
 const lines=[];
 const vm=new Interpreter({output:line=>lines.push(line),wordAliases:new Map([['몍','ㅁㅗㄱ']])});
 vm.globals.declare('몍',7n);
 await vm.execute('몍\nㅂ("틀림")\nㅇ\nㅂ("대응단어 우선")\nㅋ');
 assert.deepEqual(lines,['대응단어 우선']);
 assert.equal(vm.globals.lookup('몍').read(),7n);
});

test('declarations win over vanilla decomposition including later reads and references', async () => {
 const {lines}=await output('ㅒ 몍=3\nㅒ 자리=ㅟ 몍\nㅢ 자리=9\nㅂ(몍)\nㅒ 꾜=7\nㅂ(꾜)');
 assert.deepEqual(lines,['9','7']);
});

test('existing environment names remain names across execute calls', async () => {
 const {vm,lines}=await output('ㅒ 몍=4');
 await vm.execute('몍=몍+1\nㅂ(몍)');
 assert.deepEqual(lines,['5']);
});

test('function parameters, loop bindings and lambdas preserve their declared spelling', async () => {
 const source='ㅎ 계산(몍)\nㄷ 몍+1\nㅋ\nㅂ(계산(4))\nㅃ 몌 ㅔ [1,2]\nㅂ(몌)\nㅋ\nㅂ([1,2] ㅞ 노 => 노>1)';
 assert.deepEqual((await output(source)).lines,['5','1','2','[2]']);
});

test('custom registration and constructor fields are protected names', async () => {
 const source='ㅊ챣\n몍\nㅂ("매크로")\nㅋ\nㅋ\n챣\nㅊ상자(초기값)\nㅒ 노=초기값\nㅎ 읽음()\nㄷ 노\nㅋ\nㅋ\nㅒ 객체=상자(8)\nㅂ(객체.노,객체.읽음())';
 assert.deepEqual((await output(source)).lines,['매크로','8 8']);
});

test('matching custom name is not decomposed before macro expansion', async () => {
 assert.deepEqual((await output('ㅊ몍=+\nㅂ(2 몍 3)')).lines,['5']);
});

test('declarations introduced through custom keyword aliases protect their names', async () => {
 const source='ㅊ소개=ㅒ\nㅊ도입=소개\n도입 몍=7\nㅂ(몍)\nㅊ함수선언=ㅎ\n함수선언 계산(노)\nㄷ 노+1\nㅋ\nㅂ(계산(2))';
 assert.deepEqual((await output(source)).lines,['7','3']);
});

test('strings chars and comments keep original codepoints including canonical jamo', async () => {
 const source='# 몍\n/* 몌ㄱ 몍 */\nㅂ("몍",\'몍\',"몌ㄱ","몍",ㅐ("몍"))';
 assert.deepEqual((await output(source)).lines,['몍 몍 몌ㄱ 몍 3']);
});

test('mixed identifier markers prevent vanilla decomposition without removing the marker', async () => {
 const source='ㅒ _몍=1\nㅒ 몍1=2\nㅒ 몍x=3\nㅂ(_몍,몍1,몍x)';
 assert.deepEqual((await output(source)).lines,['1 2 3']);
});

test('real ieung is retained while the empty initial filler adds no command', () => {
 assert.equal(commandParts('옉'),'ㅇㅖㄱ');
 assert.throws(()=>parse('ㅁ옉\nㅋ'),ParseError);
});

test('locations refer to original glyph columns after decomposition', () => {
 assert.throws(()=>parse('몍;ㅂ(1)\nㅋ\n  몍+\nㅋ'), error=>error instanceof ParseError && error.line===3 && error.col===4);
 const node=parse('  몌ㄱ\nㅋ')[0];
 assert.deepEqual([node.line,node.col],[1,3]);
});

test('word IF whitespace remains distinct from compact native commands', async () => {
 const options={wordAliases:new Map([['if','ㅁ'],['print','ㅂ']])};
 assert.deepEqual((await output('if ㅖㄱ\nprint(1)\nㅋ\n몍\nprint(2)\nㅋ',options)).lines,['1','2']);
 assert.throws(()=>parse('if(ㅖ)ㄱ\nㅋ',options),/if 뒤에는 공백/);
});

test('declaration spelling collection does not execute skipped declarations or change scope', async () => {
 const source='ㅁㅗㄱ\nㅒ 몍=7\nㅋ\nㅑ\nㅂ(몍)\nㅏ\nㅂ("미선언")\nㅋ';
 assert.deepEqual((await output(source)).lines,['미선언']);
});

test('module aliases and members preserve declared names', async () => {
 for(const suffix of [' 도구','']) {
  const files=new MemoryFiles({'/도구.txt':'ㅒ 몍=9','/시작.txt':`ㅚ "도구.txt"${suffix}\nㅂ(도구.몍)`});
  const lines=[]; await new Interpreter({readFile:files.readFile,output:line=>lines.push(line)}).runFile('/시작.txt');
  assert.deepEqual(lines,['9']);
 }
});
