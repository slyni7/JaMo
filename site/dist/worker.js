import { Interpreter, InputEOF, DebugAbort, display, normalizePath } from './runtime.js';
const scope = globalThis;
let sequence = 0;
let running = false;
const pending = new Map();
const send = (reply) => scope.postMessage(reply);
scope.onmessage = async ({ data }) => {
    if (data.type !== 'run') {
        const item = pending.get(data.id);
        if (!item)
            return;
        pending.delete(data.id);
        if (data.type === 'input') {
            if (data.closed)
                item.reject(new InputEOF());
            else
                item.resolve(data.value);
        }
        else if (data.action === 'abort')
            item.reject(new DebugAbort('디버거에서 실행을 중단했습니다.'));
        else
            item.resolve('');
        return;
    }
    if (running)
        return;
    running = true;
    const files = new Map(Object.entries(data.files).map(([path, text]) => [normalizePath(path), text]));
    files.set(normalizePath(data.path), data.source);
    const started = performance.now();
    const vm = new Interpreter({
        wordAliases: new Map(data.wordAliases ?? []),
        disabledSymbols: data.disabledSymbols ?? [],
        maxSteps: data.maxSteps,
        output: text => send({ type: 'output', text }),
        input: prompt => new Promise((resolve, reject) => {
            const id = ++sequence;
            pending.set(id, { resolve, reject });
            send({ type: 'input', id, prompt });
        }),
        readFile: path => {
            if (!files.has(path))
                throw new Error(`열린 파일에 없습니다: ${path}`);
            return files.get(path);
        },
        writeFile: (path, text) => {
            files.set(path, text);
            send({ type: 'file', path, text });
        },
        debugger: (interpreter, env, node) => new Promise((resolve, reject) => {
            const id = ++sequence;
            pending.set(id, { resolve: () => resolve(), reject });
            const variables = [];
            for (const [name, cell] of env.cells) {
                try {
                    variables.push([name, display(cell.read())]);
                }
                catch {
                    variables.push([name, '<읽을 수 없는 자리>']);
                }
            }
            send({ type: 'debug', id, path: interpreter.path || data.path, line: node.line, variables });
        })
    });
    try {
        await vm.runFile(data.path);
        send({ type: 'done', elapsed: performance.now() - started });
    }
    catch (error) {
        const detail = error;
        send({ type: 'error', message: String(error), line: detail.line, col: detail.col, path: detail.path });
    }
    finally {
        running = false;
        pending.clear();
    }
};
//# sourceMappingURL=worker.js.map