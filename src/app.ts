import { examples } from './examples.js';
import type { Request, Reply } from './protocol.js';

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const editor = element<HTMLTextAreaElement>('editor');
const output = element<HTMLDivElement>('output');
const runButton = element<HTMLButtonElement>('run');
const stopButton = element<HTMLButtonElement>('stop');
const select = element<HTMLSelectElement>('examples');
const inputForm = element<HTMLFormElement>('input-form');
const programInput = element<HTMLInputElement>('program-input');
const debugPanel = element<HTMLDivElement>('debug-panel');
const storageKey = 'jamo-workspace-v1';
let files: Record<string, string> = { ...examples[0].files };
let active = examples[0].path;
let worker: Worker | null = null;
let pendingInput: number | null = null;
let pendingDebug: number | null = null;
let outputCount = 0;
let outputLimited = false;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let busy = false;

function status(text: string) { element('status').textContent = text; }
function persist() {
  files[active] = editor.value;
  try { localStorage.setItem(storageKey, JSON.stringify({ files, active })); }
  catch { element('storage-note').textContent = '브라우저 저장 공간을 사용할 수 없습니다. 내려받기로 파일을 보관하세요.'; }
}
function refreshPosition() {
  const before = editor.value.slice(0, editor.selectionStart).split('\n');
  element('cursor').textContent = `${before.length}행 ${Array.from(before.at(-1) || '').length + 1}열`;
  element('line-numbers').textContent = Array.from({ length: editor.value.split('\n').length }, (_, index) => String(index + 1)).join('\n');
}
function renderFiles() {
  const nav = element('files');
  nav.replaceChildren();
  for (const path of Object.keys(files)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `file${path === active ? ' active' : ''}`;
    button.textContent = path.slice(1);
    button.title = path;
    button.setAttribute('aria-current', path === active ? 'page' : 'false');
    button.onclick = () => { files[active] = editor.value; active = path; renderEditor(); persist(); };
    nav.append(button);
  }
  element('file-count').textContent = String(Object.keys(files).length);
}
function renderEditor() {
  editor.value = files[active];
  element('active-path').textContent = active.slice(1);
  refreshPosition(); renderFiles();
}
function line(text: string, className = 'output-line') {
  output.querySelector('.output-placeholder')?.remove();
  const node = document.createElement('p');
  node.className = className;
  node.textContent = text;
  output.append(node);
  output.scrollTop = output.scrollHeight;
}
function finish(message: string) {
  worker?.terminate(); worker = null; busy = false;
  runButton.disabled = false; stopButton.disabled = true;
  inputForm.hidden = true; debugPanel.hidden = true;
  pendingInput = pendingDebug = null;
  status(message); persist();
}
function post(message: Request) { worker?.postMessage(message); }
function showError(reply: Extract<Reply, { type: 'error' }>) {
  line(reply.message, 'output-error');
  if (reply.line && (!reply.path || reply.path === active)) {
    const lines = editor.value.split('\n');
    const start = lines.slice(0, reply.line - 1).reduce((sum, item) => sum + item.length + 1, 0);
    editor.focus(); editor.setSelectionRange(start, start + (lines[reply.line - 1]?.length || 0));
    editor.scrollTop = Math.max(0, (reply.line - 3) * 24.7);
    refreshPosition();
  }
  finish('오류');
}
function run() {
  if (busy) return;
  persist();
  output.replaceChildren(); outputCount = 0; outputLimited = false;
  busy = true; runButton.disabled = true; stopButton.disabled = false; status('실행 중');
  try { worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }); }
  catch (error) { showError({ type: 'error', message: `실행 환경을 열지 못했습니다: ${String(error)}` }); return; }
  worker.onmessage = ({ data }: MessageEvent<Reply>) => {
    switch (data.type) {
      case 'output':
        if (++outputCount <= 3000) line(data.text);
        else if (!outputLimited) { outputLimited = true; line('출력이 3,000줄을 넘어 화면 표시를 생략합니다. 프로그램은 계속 실행합니다.', 'output-note'); }
        break;
      case 'input':
        pendingInput = data.id; inputForm.hidden = false;
        element('input-label').textContent = data.prompt || '입력'; programInput.value = ''; programInput.focus(); status('입력 대기'); break;
      case 'debug':
        pendingDebug = data.id; debugPanel.hidden = false;
        element('debug-location').textContent = `${data.path.slice(1)} · ${data.line}행에서 정지`;
        element('debug-values').textContent = data.variables.map(([name, value]) => `${name} = ${value}`).join('\n') || '(현재 범위에 선언한 값 없음)';
        status('ㅙ 정지'); element('debug-continue').focus(); break;
      case 'file':
        files[data.path] = data.text;
        if (data.path === active) { editor.value = data.text; refreshPosition(); }
        renderFiles(); persist(); break;
      case 'done':
        line(`실행 완료 · ${data.elapsed.toFixed(1)} ms`, 'output-note'); finish('완료'); break;
      case 'error': showError(data); break;
    }
  };
  worker.onerror = event => { event.preventDefault(); showError({ type: 'error', message: `실행기 오류: ${event.message || '스크립트를 불러오지 못했습니다.'}` }); };
  post({ type: 'run', source: editor.value, path: active, files, maxSteps: 1_000_000 });
}

try {
  const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
  if (saved && typeof saved.active === 'string' && saved.files && typeof saved.files === 'object'
      && Object.keys(saved.files).length > 0 && Object.entries(saved.files).every(([name, text]) => name.startsWith('/') && typeof text === 'string')
      && Object.hasOwn(saved.files, saved.active)) {
    files = saved.files; active = saved.active;
  }
} catch { /* Initial example remains available without browser storage. */ }
examples.forEach((example, index) => {
  const option = new Option(example.title, String(index)); select.add(option);
});
select.selectedIndex = -1;
const placeholder = new Option('예제 선택', '', true, true); placeholder.disabled = true; select.prepend(placeholder);
select.onchange = () => {
  if (busy) { select.value = ''; return; }
  persist();
  const example = examples[Number(select.value)];
  let suffix = 1;
  while (Object.keys(example.files).some(path => Object.hasOwn(files, `/예제${suffix}${path}`))) suffix++;
  for (const [path, source] of Object.entries(example.files)) files[`/예제${suffix}${path}`] = source;
  active = `/예제${suffix}${example.path}`;
  renderEditor(); persist(); status('예제 준비됨');
};
editor.addEventListener('input', () => {
  refreshPosition(); clearTimeout(saveTimer); saveTimer = setTimeout(persist, 250);
});
editor.addEventListener('click', refreshPosition);
editor.addEventListener('keyup', refreshPosition);
editor.addEventListener('scroll', () => { element('line-numbers').scrollTop = editor.scrollTop; });
editor.addEventListener('keydown', event => {
  if (event.isComposing) return;
  if (event.key === 'Tab') { event.preventDefault(); editor.setRangeText('    ', editor.selectionStart, editor.selectionEnd, 'end'); editor.dispatchEvent(new Event('input')); }
});
document.addEventListener('keydown', event => {
  if (!event.isComposing && (event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); run(); }
});
runButton.onclick = run;
stopButton.onclick = () => { if (!busy) return; line('실행을 중단했습니다.', 'output-note'); finish('중단됨'); };
element('clear-output').onclick = () => output.replaceChildren();
inputForm.onsubmit = event => {
  event.preventDefault(); if (pendingInput === null) return;
  line(`› ${programInput.value}`, 'output-note'); post({ type: 'input', id: pendingInput, value: programInput.value });
  pendingInput = null; inputForm.hidden = true; status('실행 중');
};
element('input-eof').onclick = () => {
  if (pendingInput === null) return;
  post({ type: 'input', id: pendingInput, value: '', closed: true }); pendingInput = null; inputForm.hidden = true; status('실행 중');
};
element('debug-continue').onclick = () => {
  if (pendingDebug === null) return;
  post({ type: 'debug', id: pendingDebug, action: 'continue' }); pendingDebug = null; debugPanel.hidden = true; status('실행 중');
};
element('guide-toggle').onclick = () => {
  const guide = element('guide'); guide.hidden = !guide.hidden;
  element('guide-toggle').setAttribute('aria-expanded', String(!guide.hidden));
};
element('download').onclick = () => {
  persist(); const url = URL.createObjectURL(new Blob([editor.value], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = active.split('/').at(-1) || '프로그램.txt'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const picker = element<HTMLInputElement>('file-picker');
element('open').onclick = () => picker.click();
picker.onchange = async () => {
  persist();
  const batch: [string, string][] = [];
  try {
    const selected = Array.from(picker.files || []);
    let prefix = '';
    if (selected.some(file => Object.hasOwn(files, `/${file.name}`))) {
      let number = 2;
      while (Object.keys(files).some(path => path.startsWith(`/불러옴${number}/`))) number++;
      prefix = `/불러옴${number}`;
    }
    for (const file of selected) {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      batch.push([`${prefix}/${file.name}`, text]);
    }
    for (const [path, source] of batch) files[path] = source;
    if (batch.length) active = batch[0][0];
    renderEditor(); persist(); status('파일 열림');
  } catch { line('UTF-8 파일로 저장한 뒤 다시 열어주세요. 열린 파일은 그대로 유지했습니다.', 'output-error'); }
  picker.value = '';
};
const dialog = element<HTMLDialogElement>('new-file-dialog');
element('new').onclick = () => { element('new-file-error').textContent = ''; dialog.showModal(); element<HTMLInputElement>('new-file-name').select(); };
element('create-file').onclick = event => {
  const raw = element<HTMLInputElement>('new-file-name').value.trim().replaceAll('\\', '/');
  const parts = raw.split('/').filter(Boolean);
  const path = '/' + parts.join('/');
  if (!parts.length || parts.some(part => part === '.' || part === '..') || Object.hasOwn(files, path)) {
    event.preventDefault(); element('new-file-error').textContent = '겹치지 않는 파일 이름을 입력해 주세요. 경로에 . 또는 ..는 쓸 수 없습니다.'; return;
  }
  persist(); files[path] = ''; active = path; renderEditor(); persist();
};
const symbols = [
  ['ㄱ','then'],['ㄲ','goto'],['ㄴ','not'],['ㄷ','return'],['ㄸ','while'],['ㄹ','continue'],['ㅁ','if'],['ㅂ','print'],['ㅃ','for'],['ㅅ','int'],['ㅆ','float'],['ㅇ','else'],['ㅈ','char'],['ㅉ','string'],['ㅊ','custom'],['ㅋ','end'],['ㅌ','list'],['ㅍ','pass'],['ㅎ','function'],['ㅏ','except'],['ㅑ','try'],['ㅓ','ref'],['ㅕ','value'],['ㅗ','false'],['ㅛ','label'],['ㅜ','nil'],['ㅠ','throw'],['ㅡ','break'],['ㅣ','or'],['ㅐ','len'],['ㅒ','new'],['ㅔ','in'],['ㅖ','true'],['ㅘ','and'],['ㅙ','check'],['ㅚ','import'],['ㅝ','typeof'],['ㅞ','where'],['ㅟ','address'],['ㅢ','deref']
];
for (const [symbol, description] of symbols) {
  const button = document.createElement('button'); button.type = 'button';
  const label = document.createElement('span'); label.textContent = symbol;
  const small = document.createElement('small'); small.textContent = description;
  button.append(label, small); button.setAttribute('aria-label', `${symbol} ${description} 넣기`);
  button.onclick = () => {
    const text = symbol === 'ㅁ' ? 'ㅁ ' : symbol;
    editor.setRangeText(text, editor.selectionStart, editor.selectionEnd, 'end'); editor.focus(); editor.dispatchEvent(new Event('input'));
  };
  element('jamo-keys').append(button);
}
window.addEventListener('beforeunload', persist);
renderEditor();
