import { Interpreter, DebugAbort, InputEOF } from '../dist/runtime.js';
import { fileHost } from '../dist/node-host.js';
let payload = '';
for await (const chunk of process.stdin) payload += chunk.toString('utf8');
const request = JSON.parse(payload);
const stdout = [], debug_events = [], input_prompts = [];
const inputs = [...(request.inputs || [])];
const vm = new Interpreter({
  ...fileHost(request.encoding || 'utf-8-sig'),
  maxSteps: request.step_limit || 10000,
  output: text => stdout.push(text),
  input: prompt => { input_prompts.push(prompt); if (!inputs.length) throw new InputEOF(); return inputs.shift(); },
  debugger: request.debugger ? (_vm, _env, node) => {
    debug_events.push(node.line);
    if (request.debugger === 'abort') throw new DebugAbort('사용자 중단');
  } : undefined
});
let error = null, error_type = null;
try {
  if (request.run_file !== false) await vm.runFile(request.path);
  else await vm.execute(request.source, request.path);
} catch (caught) { error = String(caught); error_type = caught?.constructor?.name || 'Error'; }
process.stdout.write(JSON.stringify({ stdout, error, error_type, debug_events, input_prompts }));
