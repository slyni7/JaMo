import path from 'node:path';
import { parse } from './frontend.js';
import { Interpreter, DebugAbort, InputEOF, display } from './runtime.js';
import { fileHost, inputLines } from './node-host.js';
async function main() {
    const args = process.argv.slice(2);
    let file = '';
    let encoding = 'utf-8-sig';
    let check = false;
    let debug = Boolean(process.stdin.isTTY);
    let maxSteps = 1_000_000;
    const usage = '사용법: node dist/cli.js 파일.txt [--encoding utf-8-sig|utf-8|cp949] [--check] [--debug] [--max-steps 숫자]';
    if (args.includes('--help') || args.includes('-h')) {
        console.log(usage);
        return 0;
    }
    try {
        for (let index = 0; index < args.length; index++) {
            const argument = args[index];
            if (argument === '--check')
                check = true;
            else if (argument === '--debug')
                debug = true;
            else if (argument === '--encoding') {
                const candidate = args[++index];
                if (!['utf-8-sig', 'utf-8', 'cp949'].includes(candidate))
                    throw new Error('지원하는 소스 인코딩을 지정해 주세요.');
                encoding = candidate;
            }
            else if (argument === '--max-steps') {
                const candidate = args[++index];
                if (!candidate || !/^[0-9]+$/.test(candidate))
                    throw new Error('--max-steps는 양의 정수여야 합니다.');
                maxSteps = Number(candidate);
                if (!Number.isSafeInteger(maxSteps) || maxSteps < 1)
                    throw new Error('--max-steps 범위를 벗어났습니다.');
            }
            else if (argument === '--loop-bindings') {
                if (args[++index] !== 'fresh')
                    throw new Error('반복은 fresh 정책만 지원합니다.');
            }
            else if (argument.startsWith('-'))
                throw new Error(`알 수 없는 옵션: ${argument}`);
            else if (file)
                throw new Error('실행할 파일은 하나만 지정해 주세요.');
            else
                file = argument;
        }
        if (!file)
            throw new Error(usage);
    }
    catch (error) {
        console.error(String(error));
        return 2;
    }
    const lines = inputLines();
    const input = async (prompt) => {
        if (prompt)
            process.stdout.write(prompt);
        const item = await lines.next();
        if (item.done)
            throw new InputEOF();
        return item.value;
    };
    const host = fileHost(encoding);
    const vm = new Interpreter({
        ...host, maxSteps, input,
        output: text => console.log(text),
        debugger: debug ? async (interpreter, env, node) => {
            console.log(`ㅙ 정지 — ${interpreter.path}:${node.line}:${node.col}`);
            while (true) {
                let action;
                try {
                    action = (await input('계속 / 보기 / 중단 > ')).trim();
                }
                catch {
                    throw new DebugAbort('디버거 입력이 끝나 실행을 중단했습니다.');
                }
                if (['계속', 'c', ''].includes(action))
                    return;
                if (['중단', 'q'].includes(action))
                    throw new DebugAbort('디버거에서 실행을 중단했습니다.');
                if (['보기', 'p'].includes(action))
                    for (const [name, cell] of env.cells)
                        console.log(`${name} = ${display(cell.read())}`);
                else
                    console.log('계속, 보기, 중단 중 하나를 입력하세요.');
            }
        } : undefined
    });
    try {
        const sourcePath = path.resolve(file).replaceAll('\\', '/');
        if (check) {
            vm.validate(parse(await host.readFile(sourcePath)));
            console.log('구문·제어 문맥 검사 통과 (실행하지 않음)');
        }
        else
            await vm.runFile(sourcePath);
        return 0;
    }
    catch (error) {
        console.error(String(error));
        return error instanceof DebugAbort ? 130 : 1;
    }
}
process.exitCode = await main();
//# sourceMappingURL=cli.js.map