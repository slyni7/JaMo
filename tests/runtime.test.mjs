import test from 'node:test';
import assert from 'node:assert/strict';
import { Interpreter, Fault, DebugAbort, InputEOF, MemoryFiles, Table, Ref, Char, Instance, CustomType, display, equal, normalizePath } from '../dist/runtime.js';
import { ParseError } from '../dist/frontend.js';

async function run(source, options = {}, path) {
  const out = [];
  const vm = new Interpreter({ output: text => out.push(text), ...options });
  await vm.execute(source, path);
  return {out, vm};
}
async function output(source, expected, options = {}) { assert.deepEqual((await run(source, options)).out, expected); }
async function rejects(source, pattern, options = {}) {
  await assert.rejects(run(source, options), error => {
    assert.ok(error instanceof Fault || error instanceof ParseError);
    if (pattern) assert.match(error.message, pattern);
    return true;
  });
}

test('arithmetic, boolean type distinction and short circuit', async () => {
  await output('ㅂ(2 + 3 * 4, -7 // 3, -7 % 3, 3 / 2)\nㅂ(ㄴ ㅗ, ㅗ ㅘ _없는함수(), ㅖ ㅣ _없는함수(), ㅖ == 1)', ['14 -3 2 1.5','ㅖ ㅗ ㅖ ㅗ']);
  for (const source of ['ㅖ + 1', '+ㅖ', '1 / 0', '1 // 0', '1 % 0']) await rejects(source);
});
test('declaration, outer binding and missing names', async () => {
  await output('ㅒ 원본 = 4\nㅎ 계산(값)\nㅒ 원본 = 값 + 1\nㄷ 원본\nㅋ\nㅂ(계산(8), 원본)', ['9 4']);
  for (const source of ['이름 = 1','ㅒ 이름 = 1\nㅒ 이름 = 2','ㅂ(없음)']) await rejects(source);
});
test('if, elseif and final else each execute the selected branch', async () => {
  await output('ㅁ ㅗ ㄱ\nㅂ(1)\nㅇ ㅁ ㅖ ㄱ\nㅂ(2)\nㅇ\nㅂ(3)\nㅋ', ['2']);
  await output('ㅁ ㅗ ㄱ\nㅂ(1)\nㅇ\nㅂ(3)\nㅋ', ['3']);
  await output('ㅁ ㅗ ㄱ\nㅋ\nㅂ(4)', ['4']);
});
test('recursive function and return mapping', async () => {
  await output('ㅎ 팩토리얼(수)\nㅁ 수 <= 1 ㄱ\nㄷ 1\nㅋ\nㄷ 수 * 팩토리얼(수 - 1)\nㅋ\nㅂ(팩토리얼(6))', ['720']);
  await output('ㅎ 빈함수()\nㄷ\nㅋ\nㅂ(빈함수())', ['ㅜ']);
});
test('for and while preserve continue and break', async () => {
  await output('ㅒ 합 = 0\nㅃ 수 ㅔ 범위(6)\nㅁ 수 == 2 ㄱ\nㄹ\nㅋ\nㅁ 수 == 5 ㄱ\nㅡ\nㅋ\n합 = 합 + 수\nㅋ\nㄸ 합 < 10\n합 = 합 + 1\nㅋ\nㅂ(합)', ['10']);
});
test('fresh loop cells are independent and survive through references', async () => {
  const {out,vm} = await run('ㅒ 참조들 = []\nㅃ 번호 ㅔ [1, 2, 3]\nㅒ 값 = 번호\n추가(참조들, ㅓ 값)\nㅋ\nㅂ(ㅕ 참조들[0], ㅕ 참조들[1], ㅕ 참조들[2])');
  assert.deepEqual(out, ['1 2 3']); assert.equal(vm.loopBindings, 'fresh');
  const refs = vm.globals.lookup('참조들').read().values();
  assert.equal(new Set(refs.map(ref => ref.cell)).size, 3);
  refs[0].cell.write(99n); assert.deepEqual(refs.map(ref => ref.cell.read()), [99n,2n,3n]);
  assert.equal(vm.globals.cells.has('값'), false); assert.equal(vm.globals.cells.has('번호'), false);
});
test('each iteration starts without the previous declaration', async () => {
  await output('ㅃ 번호 ㅔ [1, 2, 3]\nㅑ\nㅂ(값)\nㅏ\nㅂ("새 반복")\nㅋ\nㅒ 값 = 번호\nㅋ', ['새 반복','새 반복','새 반복']);
});
test('while references remain valid after continue and break', async () => {
  const {out,vm} = await run('ㅒ 횟수 = 0\nㅒ 일반 = []\nㅒ 엄격 = []\nㄸ 횟수 < 4\n횟수 = 횟수 + 1\nㅒ 값 = 횟수\n추가(일반, ㅓ 값)\n추가(엄격, ㅟ 값)\nㅁ 횟수 == 2 ㄱ\nㄹ\nㅋ\nㅁ 횟수 == 3 ㄱ\nㅡ\nㅋ\nㅋ\nㅕ 일반[0] = 10\nㅢ 엄격[1] = 20\nㅂ(ㅕ 일반[0], ㅕ 일반[1], ㅕ 일반[2])');
  assert.deepEqual(out, ['10 20 3']); assert.equal(vm.activeLoopDepth, 0);
  const normal = vm.globals.lookup('일반').read().values(), strict = vm.globals.lookup('엄격').read().values();
  assert.equal(new Set(normal.map(ref => ref.cell)).size, 3);
  normal.forEach((ref,i) => { assert.equal(ref.cell, strict[i].cell); assert.equal(ref.cell.alive,true); });
});
test('nested loop bindings do not overwrite their outer scope', async () => {
  const {out,vm} = await run('ㅒ 번호 = 99\nㅒ 참조들 = []\nㅃ 번호 ㅔ [1, 2]\nㅒ 값 = 번호\n추가(참조들, ㅓ 값)\nㅃ 번호 ㅔ [10, 20]\nㅒ 값 = 번호\n추가(참조들, ㅓ 값)\nㅋ\nㅂ(번호, 값)\nㅋ\nㅂ(번호)');
  assert.deepEqual(out, ['1 1','2 2','99']);
  const refs = vm.globals.lookup('참조들').read().values();
  assert.deepEqual(refs.map(ref => ref.cell.read()), [1n,10n,20n,2n,10n,20n]); assert.equal(new Set(refs.map(ref => ref.cell)).size,6);
});
test('function calls and duplicate declarations inside a loop', async () => {
  await output('ㅎ 만들기(수)\nㅒ 결과 = 수 + 1\nㄷ 결과\nㅋ\nㅃ 수 ㅔ [1, 2]\nㅂ(만들기(수))\nㅋ', ['2','3']);
  await rejects('ㅃ 수 ㅔ [1]\nㅒ 값 = 1\nㅒ 값 = 2\nㅋ', /이미 선언/);
});
test('fresh loop closures remember each iteration', async () => {
  await output('ㅒ 함수들 = []\nㅃ 수 ㅔ [1, 2, 3]\nㅎ 읽음()\nㄷ 수\nㅋ\n추가(함수들, 읽음)\nㅋ\nㅂ(함수들[0](), 함수들[1](), 함수들[2]())', ['1 2 3']);
});
test('goto forward and forbidden control contexts', async () => {
  await output('ㄲ 끝부분\nㅂ(1)\nㅛ 끝부분\nㅂ(2)', ['2']);
  for (const source of ['ㄲ 없음','ㅛ 같은곳\nㅛ 같은곳','ㅁ ㅖ ㄱ\nㅛ 내부\nㅋ\nㄲ 내부','ㄷ 1','ㄹ','ㅡ']) await rejects(source);
});
test('goto exits nested loops and restores loop context', async () => {
  const {out,vm} = await run('ㅒ 상태 = 0\nㄸ ㅖ\nㅃ 번호 ㅔ [1, 2]\nㅁ 번호 == 1 ㄱ\n상태 = 7\nㄲ 도착\nㅋ\nㅋ\nㅋ\nㅛ 도착\nㅒ 결과 = 상태 + 1\nㅂ(결과)');
  assert.deepEqual(out,['8']); assert.equal(vm.activeLoopDepth,0);
});
test('goto backward, sibling scope and function boundaries', async () => {
  await output('ㅒ 횟수 = 0\nㅛ 다시\n횟수 = 횟수 + 1\nㅁ 횟수 < 3 ㄱ\nㄲ 다시\nㅋ\nㅂ(횟수)', ['3']);
  for (const source of ['ㅁ ㅖ ㄱ\nㅛ 내부\nㅋ\nㅁ ㅖ ㄱ\nㄲ 내부\nㅋ','ㅛ 바깥\nㅎ 잘못된함수()\nㄲ 바깥\nㅋ','ㅎ 함수()\nㅛ 내부\nㅋ\nㄲ 내부']) await rejects(source,/보이지 않는 라벨/);
});
test('nearest goto label and exception stack unwinding', async () => {
  const {out,vm} = await run('ㅁ ㅖ ㄱ\nㄲ 끝\nㅂ("실패")\nㅛ 끝\nㅂ("안")\nㅋ\nㄲ 종료\nㅛ 끝\nㅂ("실패")\nㅛ 종료\nㅑ\nㅠ 1\nㅏ 오류\nㄲ 도착\nㅋ\nㅛ 도착\nㅂ("밖")');
  assert.deepEqual(out,['안','밖']); assert.deepEqual(vm.activeErrors,[]);
  await rejects('ㄲ 도착\nㅒ 값 = 1\nㅛ 도착\nㅂ(값)',/선언하지 않은/);
});
test('throw, rethrow, nil payload and pass are distinct', async () => {
  await output('ㅑ\nㅑ\nㅠ "실패"\nㅏ 내부\nㅠ\nㅋ\nㅏ 외부\nㅂ(외부)\nㅍ\nㅋ', ['실패']);
  await output('ㅑ\nㅠ ㅜ\nㅏ 오류\nㅂ(오류 == ㅜ, ㅝ(오류))\nㅋ', ['ㅖ 없음']);
  await rejects('ㅍ\nㅂ(1 / 0)'); await rejects('ㅠ',/예외/);
});
test('handlers cannot swallow return, continue or break', async () => {
  await output('ㅎ 반환()\nㅑ\nㄷ 9\nㅏ\nㄷ 0\nㅋ\nㅋ\nㅂ(반환())\nㅃ 수 ㅔ [1, 2]\nㅑ\nㄹ\nㅏ\nㅂ("실패")\nㅋ\nㅋ\nㄸ ㅖ\nㅑ\nㅡ\nㅏ\nㅂ("실패")\nㅋ\nㅋ', ['9']);
});
test('primitive conversion, character and string types', async () => {
  await output('ㅂ(ㅅ("12"), ㅆ("1.5"), ㅈ(44032), ㅉ(ㅜ), ㅐ("가😀"), ㅝ(3), ㅝ(ㅖ))\nㅂ(ㅌ(1, 2), ㅌ("가나"))', ['12 1.5 가 ㅜ 2 정수 참거짓','[1, 2] [가, 나]']);
  await output('ㅂ(ㅝ(\'가\'), ㅝ(ㅈ(44032)), ㅝ("가"))', ['문자 문자 문자열']);
  for (const source of ['ㅈ("두글자")','ㅈ(55296)','ㅈ(1114112)',"ㅅ('7')","ㅆ('7')"]) await rejects(source);
});
test('string indexing, iteration and conversion use codepoints', async () => {
  await output('ㅂ(ㅝ("😀"[0]), ㅝ(ㅌ("가")[0]))\nㅃ 문자 ㅔ "가😀"\nㅂ(ㅝ(문자), 문자)\nㅋ', ['문자 문자','문자 가','문자 😀']);
  await output('ㅂ("😀" > "\uE000", "😀가"[::-1], ㅐ("😀가"))', ['ㅖ 가😀 2']);
});
test('membership, filtering and Python slices', async () => {
  await output('ㅒ 목록 = [1, 2, 3, 4]\nㅒ 선택 = 목록 ㅞ 값 => 값 % 2 == 0\nㅂ(선택, 3 ㅔ 목록, 목록[-1], 목록[1:3], 목록[::-1])', ['[2, 4] ㅖ 4 [2, 3] [4, 3, 2, 1]']);
  await output('ㅂ([1,2,3][-100:100], [1,2,3][100:-100:-1], [1,2,3][:-1:-1])', ['[1, 2, 3] [3, 2, 1] []']);
  for (const source of ['[1][ㅖ]','[1][::0]','"가"[9]','1 ㅔ 3']) await rejects(source);
});
test('where named predicates run once in original order', async () => {
  await output('ㅒ 기록 = []\nㅎ 검사(값)\n추가(기록, 값)\nㄷ 값 > 1\nㅋ\nㅂ([3, 1, 2] ㅞ 검사)\nㅂ(기록)', ['[3, 2]','[3, 1, 2]']);
});
test('for and where snapshot their original input values', async () => {
  await output('ㅒ 목록=[1,2]\nㅃ 값 ㅔ 목록\n추가(목록,9)\nㅂ(값)\nㅋ\nㅂ(목록)', ['1','2','[1, 2, 9, 9]']);
  await output('ㅒ 목록=[1,2]\nㅎ 검사(값)\n추가(목록,9)\nㄷ ㅖ\nㅋ\nㅂ(목록 ㅞ 검사,목록)', ['[1, 2] [1, 2, 9, 9]']);
});
test('empty filter validates predicate and builtin arity', async () => {
  for (const source of ['[] ㅞ 3','[] ㅞ 추가','[] ㅞ 삭제','ㅎ 잘못된함수(가,나)\nㄷ ㅖ\nㅋ\n[] ㅞ 잘못된함수']) await rejects(source);
  await output('ㅂ([] ㅞ ㅅ, [] ㅞ ㅐ)', ['[] []']);
});
test('five thousand digit integer literal and conversion', async () => {
  const digits='9'.repeat(5000); await output(`ㅂ(${digits})\nㅂ(ㅅ("${digits}"))`,[digits,digits]);
});
test('Unicode decimal integer conversion is independent of length', async () => {
  for (const size of [4000,4001,5000]) await output(`ㅂ(ㅅ("${'１'.repeat(size)}"))`,['1'.repeat(size)]);
  await output('ㅂ(ㅅ("١٢٣"), ㅅ("𝟡𝟠"), ㅅ("+1_000"), ㅆ("١.٥"))',['123 98 1000 1.5']);
  for (const source of ['ㅅ("")','ㅅ("1__0")','ㅆ("1__0")','ㅆ("nan")','ㅆ("inf")']) await rejects(source);
});
test('bigint division rounds finite huge ratios without operand overflow', async () => {
  await output('ㅂ((10**5000)/(10**5000), (10**5000)/(10**4999), 1/(10**5000), 0 / -1)', ['1.0 10.0 0.0 -0.0']);
  await rejects('(10**5000)/1');
});
test('float floor/modulo and display preserve Python behavior', async () => {
  await output('ㅂ(1.0//0.1, -7.0//3.0, -7.0%3.0, 7.0%-3.0, 1.0, -0.0, 1e-5, 1e16)', ['9.0 -3.0 2.0 -2.0 1.0 -0.0 1e-05 1e+16']);
  await output('ㅂ(0.0 // -1.0, 0.0 % -1.0, 2**-2, -2**2, 2**3**2)', ['-0.0 -0.0 0.25 -4 512']);
});
test('mixed bigint/float comparisons do not lose integer precision', async () => {
  await output('ㅂ(9007199254740993 == 9007199254740992.0, 9007199254740993 > 9007199254740992.0, 1 == 1.0)', ['ㅗ ㅖ ㅖ']);
});
test('legacy nonfinite conversion and zero slice-step diagnostics are preserved', async () => {
  await rejects('ㅆ("inf")', /^유한한 실수 범위를 벗어났습니다\.$/);
  await rejects('[1,2][::0]', /^실행 오류: slice step cannot be zero$/);
});
test('general references alias source and value boxes retain lifetime', async () => {
  await output('ㅒ 점수=70\nㅒ 가리킴=ㅓ 점수\nㅒ 복제=가리킴\nㅕ 복제=100\nㅎ 보관()\nㄷ ㅓ (2+3)\nㅋ\nㅒ 자리=보관()\nㅕ 자리=8\nㅂ(점수,ㅕ 자리,ㅕ 3)', ['100 8 3']);
});
test('returned local reference remains writable', async () => {
  await output('ㅎ 만들기()\nㅒ 값=10\nㄷ ㅓ 값\nㅋ\nㅒ 자리=만들기()\nㅕ 자리=20\nㅂ(ㅕ 자리)', ['20']);
});
test('readonly reference expression evaluates its index once', async () => {
  await output('ㅒ 횟수=0\nㅎ 번호()\n횟수=횟수+1\nㄷ 0\nㅋ\nㅒ 문자자리=ㅓ "가"[번호()]\nㅒ 값자리=ㅓ (ㅕ 3)\nㅂ(ㅕ 문자자리,ㅕ 값자리,횟수)', ['가 3 1']);
});
test('strict references and their rejection cases', async () => {
  await output('ㅒ 값=1\nㅒ 자리=ㅟ 값\nㅢ 자리=2\nㅂ(값,ㅢ 자리, (ㅓ 값)==(ㅟ 값))', ['2 2 ㅗ']);
  for (const source of ['ㅟ 3','ㅢ 3','ㅒ 값=1\nㅒ 자리=ㅓ 값\nㅢ 자리','ㅕ 3 = 4']) await rejects(source);
});
test('index evaluated once, cell follows insertion and detects deletion', async () => {
  await output('ㅒ 횟수=0\nㅎ 다음()\n횟수=횟수+1\nㄷ 1\nㅋ\nㅒ 목록=[10,20]\nㅒ 자리=ㅓ 목록[다음()]\n삽입(목록,0,5)\nㅕ 자리=99\nㅂ(횟수,목록)\n삭제(목록,2)\nㅑ\nㅂ(ㅕ 자리)\nㅏ\nㅂ("삭제 감지")\nㅋ',['1 [5, 10, 99]','삭제 감지']);
});
test('list sharing, shallow copy and cyclic values', async () => {
  await output('ㅒ 원본=[1]\nㅒ 공유=원본\nㅒ 사본=복사(원본)\n공유[0]=2\nㅂ(원본,사본)\n추가(원본,원본)\nㅂ(원본)', ['[2] [1]','[2, [순환]]']);
  const a=new Table(),b=new Table();a.cells.push({read:()=>a});b.cells.push({read:()=>b});assert.equal(equal(a,b),true);
});
test('debugger events, async resumption and missing debugger', async () => {
  const events=[];
  await output('ㅙ ㅖ\nㅙ ㅗ\nㅙ\nㅂ(1)',['1'],{debugger:async(vm,env,n)=>{await Promise.resolve();events.push(n.line);}});
  assert.deepEqual(events,[2,3]); await rejects('ㅙ ㅗ',/디버거/);
});
test('debugger user abort is not swallowed by a language handler', async () => {
  await assert.rejects(run('ㅑ\nㅙ\nㅏ\nㅂ("중단 실패")\nㅋ',{debugger:()=>{throw new DebugAbort('사용자 중단');}}),DebugAbort);
});
test('async input yields and resumes with the same prompt', async () => {
  const prompts=[];
  await output('ㅂ(입력("이름: "))',['아디나'],{input:async prompt=>{prompts.push(prompt);await Promise.resolve();return '아디나';}});
  assert.deepEqual(prompts,['이름: ']);
});
test('input EOF becomes a catchable language error', async () => {
  await output('ㅑ\n입력()\nㅏ 오류\nㅂ(오류)\nㅋ',['입력이 끝났습니다.'],{input:()=>{throw new InputEOF();}});
  await rejects('입력()',/입력이 끝났습니다/);
});
test('step limit and runtime locations remain observable', async () => {
  await rejects('ㄸ ㅖ\nㅍ\nㅋ',/실행 한도/,{maxSteps:30});
  await assert.rejects(run('ㅒ 값=1\nㅂ(값/0)'),error=>error instanceof Fault && error.line===2);
});
test('virtual paths preserve source-relative modules and Windows roots', () => {
  assert.equal(normalizePath('../도구.txt','/project/src'),'/project/도구.txt');
  assert.equal(normalizePath('C:\\work\\src\\..\\도구.txt'),'C:/work/도구.txt');
});
test('module cache, source-relative I/O and cycle detection', async () => {
  const files=new MemoryFiles({'/project/도구.txt':'ㅂ("불러옴")\nㅎ 두배(값)\nㄷ 값*2\nㅋ','/project/시작.txt':'ㅚ "도구.txt" 도구\nㅚ "도구.txt" 다시\nㅂ(도구.두배(21))\n쓰기("결과.txt","한글")\nㅂ(읽기("결과.txt"))','/project/순환.txt':'ㅚ "순환.txt" 나'});
  const out=[],vm=new Interpreter({files,output:text=>out.push(text)});await vm.runFile('/project/시작.txt');
  assert.deepEqual(out,['불러옴','42','한글']);assert.equal(files.readFile('/project/결과.txt'),'한글');
  await assert.rejects(new Interpreter({files}).runFile('/project/순환.txt'),/순환/);
});
test('imported syntax and control errors retain the imported path', async () => {
  const files=new MemoryFiles({'/시작.txt':'ㅚ "깨진모듈.txt" 모듈','/깨진모듈.txt':'ㅁ ㅖ'});
  for (const source of ['ㅁ ㅖ','ㄷ 1']) {
    files.writeFile('/깨진모듈.txt',source);
    await assert.rejects(new Interpreter({files}).runFile('/시작.txt'),error=>error instanceof Fault&&error.path==='/깨진모듈.txt');
  }
});
test('failed import is catchable and can be rewritten then retried', async () => {
  const files=new MemoryFiles({'/모듈.txt':'ㅁ ㅖ'});
  const {out}=await run('ㅑ\nㅚ "모듈.txt" 도구\nㅏ 오류\nㅂ(오류)\nㅋ\n쓰기("모듈.txt","ㅒ 값=42")\nㅚ "모듈.txt" 도구\nㅂ(도구.값)',{files},'/시작.txt');
  assert.match(out[0],/구문 오류/);assert.equal(out[1],'42');
});
test('invalid default import name is diagnosed before initialization', async () => {
  const files=new MemoryFiles({'/잘못-된이름.txt':'ㅂ("초기화")\nㅒ 값=42'}),out=[];
  const vm=new Interpreter({files,output:text=>out.push(text)});
  await assert.rejects(vm.execute('ㅚ "잘못-된이름.txt"','/시작.txt'),/별칭/);assert.deepEqual(out,[]);
  await vm.execute('ㅚ "잘못-된이름.txt" 도구\nㅂ(도구.값)','/시작.txt');assert.deepEqual(out,['초기화','42']);
});
test('module initialization does not inherit its callers loop scope', async () => {
  const files=new MemoryFiles({'/모듈.txt':'ㅒ 값=42\nㅂ("모듈 초기화")'});
  const {out,vm}=await run('ㅃ 번호 ㅔ [1,2]\nㅒ 값=번호\nㅚ "모듈.txt" 도구\nㅂ(도구.값,값)\nㅋ',{files},'/시작.txt');
  assert.deepEqual(out,['모듈 초기화','42 1','42 2']);assert.equal(vm.modules.get('/모듈.txt').env.parent,vm.base);
  for(const name of ['번호','값','도구'])assert.equal(vm.globals.cells.has(name),false);assert.equal(vm.activeLoopDepth,0);
});
test('async host reads and writes preserve serialized execution order', async () => {
  const events=[],files=new MemoryFiles({'/도구.txt':'ㅒ 값=7'});
  const {out}=await run('ㅚ "도구.txt" 도구\n쓰기("결과.txt",ㅉ(도구.값))\nㅂ(읽기("결과.txt"))',{
    readFile:async path=>{events.push('read:'+path);await Promise.resolve();return files.readFile(path);},
    writeFile:async(path,text)=>{events.push('write:'+path);await Promise.resolve();files.writeFile(path,text);}
  },'/시작.txt');
  assert.deepEqual(out,['7']);assert.deepEqual(events,['read:/도구.txt','write:/결과.txt','read:/결과.txt']);
});

test('custom type records, methods and distinct type names', async () => {
  const {out,vm}=await run('ㅊ사람(이름값)\nㅒ 이름=이름값\nㅎ 소개()\nㅂ(이름)\nㅋ\nㅋ\nㅒ 철수=사람("철수")\n철수.소개()\nㅂ(ㅝ(철수),ㅝ(사람),철수,사람)');
  assert.deepEqual(out,['철수','사람 사용자자료형 <사람 객체> <자료형 사람>']);
  assert.ok(vm.globals.lookup('철수').read() instanceof Instance);assert.ok(vm.globals.lookup('사람').read() instanceof CustomType);
});
test('custom instances have independent fields, lists and method closures', async () => {
  await output('ㅊ상자(초깃값)\nㅒ 값=초깃값\nㅒ 항목=[]\nㅎ 변경(새값)\n값=새값\n추가(항목,새값)\nㄷ 자신\nㅋ\nㅋ\nㅒ 첫째=상자(1)\nㅒ 둘째=상자(2)\nㅂ(첫째.변경(9)==첫째)\nㅂ(첫째.값,둘째.값,첫째.항목,둘째.항목,첫째==둘째)', ['ㅖ','9 2 [9] [] ㅗ']);
});
test('custom member assignment and normal/strict references share the field', async () => {
  await output('ㅊ기록(초기)\nㅒ 값=초기\nㅋ\nㅒ 대상=기록(1)\nㅒ 일반=ㅓ 대상.값\nㅒ 엄격=ㅟ 대상.값\n대상.값=2\nㅕ 일반=3\nㅢ 엄격=4\nㅂ(대상.값,ㅕ 일반,ㅢ 엄격)', ['4 4 4']);
});
test('constructor parameters remain private to the construction scope', async () => {
  await rejects('ㅊ기록(초기)\nㅒ 값=초기\nㅋ\nㅒ 대상=기록(1)\nㅂ(대상.초기)', /해당 이름/);
  await rejects('ㅊ기록(초기)\nㅋ\n기록()', /인수/);
});
test('constructors permit empty early return but cannot replace identity', async () => {
  await output('ㅊ기록()\nㅒ 값=1\nㄷ\nㅒ 늦음=2\nㅋ\nㅂ(기록().값)', ['1']);
  for(const expression of ['1','ㅜ'])await rejects(`ㅊ기록()\nㄷ ${expression}\nㅋ\n기록()`, /값을 반환/);
});
test('methods extracted from an instance retain the instance field scope', async () => {
  await output('ㅊ상자(초기)\nㅒ 값=초기\nㅎ 증가()\n값=값+1\nㄷ 값\nㅋ\nㅋ\nㅒ 대상=상자(5)\nㅒ 동작=대상.증가\nㅂ(동작(),대상.값)', ['6 6']);
});
