import { COMMANDS, CLUSTER_DEFAULTS, SYMBOLS, BASIC_SYMBOLS, defaultSettings, copySettings, validateSettings, applyTheme } from './settings.js';
import { SoundFeedback } from './feedback.js';
const element = (id) => document.getElementById(id);
export function createSettingsPanel(read, apply) {
    const dialog = element('settings-dialog');
    const form = element('settings-form');
    const list = element('symbol-settings');
    const preview = new SoundFeedback();
    let draft = copySettings(read());
    const rows = new Map();
    const descriptions = new Map(COMMANDS.map(([symbol, english]) => [symbol, english]));
    for (const symbol of SYMBOLS) {
        const row = document.createElement('div');
        row.className = 'symbol-row';
        const checkLabel = document.createElement('label');
        checkLabel.className = 'check-label';
        const enabled = document.createElement('input');
        enabled.type = 'checkbox';
        enabled.setAttribute('aria-label', `${symbol} 사용`);
        checkLabel.append(enabled, '사용');
        const key = document.createElement('code');
        key.className = 'symbol-key';
        key.textContent = symbol;
        const name = document.createElement('span');
        name.className = 'symbol-name';
        name.textContent = descriptions.get(symbol) ?? Array.from(CLUSTER_DEFAULTS[symbol]).map(part => descriptions.get(part)).join(' · ');
        const original = document.createElement('small');
        original.textContent = CLUSTER_DEFAULTS[symbol] ?? '기본 명령';
        const label = document.createElement('label');
        label.textContent = '대응단어';
        const aliases = document.createElement('input');
        aliases.type = 'text';
        aliases.autocomplete = 'off';
        aliases.placeholder = descriptions.get(symbol) ? `${descriptions.get(symbol)}, 한글 별칭` : '별칭을 쉼표로 구분';
        aliases.setAttribute('aria-label', `${symbol} 대응단어`);
        label.append(aliases);
        enabled.onchange = () => { element('symbol-preset').value = 'custom'; updateCount(); };
        row.append(checkLabel, key, name, original, label);
        list.append(row);
        rows.set(symbol, { enabled, aliases });
    }
    function updateCount() {
        element('symbol-count').textContent = `${[...rows.values()].filter(row => row.enabled.checked).length} / 51개 사용`;
    }
    function render() {
        element('assist-enabled').checked = draft.assist.enabled;
        element('assist-delay').value = String(draft.assist.timeoutMs);
        element('skin-theme').value = draft.theme;
        element('skin-accent').value = draft.accent;
        element('sound-enabled').checked = draft.sound.enabled;
        element('sound-volume').value = String(Math.round(draft.sound.volume * 100));
        element('sound-volume-value').textContent = `${Math.round(draft.sound.volume * 100)}%`;
        for (const [symbol, row] of rows) {
            row.enabled.checked = !draft.disabledSymbols.includes(symbol);
            row.aliases.value = draft.aliases[symbol].join(', ');
        }
        element('symbol-preset').value = draft.disabledSymbols.length ? 'custom' : 'all';
        element('settings-error').textContent = '';
        updateCount();
        applyTheme(draft);
    }
    function readDraft() {
        const result = copySettings(draft);
        result.assist = { enabled: element('assist-enabled').checked, timeoutMs: Number(element('assist-delay').value) };
        result.theme = element('skin-theme').value;
        result.accent = element('skin-accent').value;
        result.sound = { enabled: element('sound-enabled').checked, volume: Number(element('sound-volume').value) / 100 };
        result.disabledSymbols = [...rows].filter(([, row]) => !row.enabled.checked).map(([symbol]) => symbol);
        for (const [symbol, row] of rows)
            result.aliases[symbol] = row.aliases.value.split(',').map(word => word.trim()).filter(Boolean);
        return validateSettings(result);
    }
    const cancel = () => { preview.setEnabled(false); applyTheme(read()); dialog.close(); };
    element('settings-close').onclick = cancel;
    element('settings-cancel').onclick = cancel;
    dialog.addEventListener('cancel', () => { preview.setEnabled(false); applyTheme(read()); });
    dialog.addEventListener('close', () => { preview.setEnabled(false); applyTheme(read()); });
    element('settings-reset').onclick = () => { draft = defaultSettings(); render(); preview.setEnabled(false); };
    element('symbol-preset').onchange = event => {
        const preset = event.target.value;
        if (preset === 'custom')
            return;
        const enabled = new Set(preset === 'all' ? SYMBOLS : preset === 'forty' ? COMMANDS.map(([symbol]) => symbol) : preset === 'core' ? BASIC_SYMBOLS : []);
        for (const [symbol, row] of rows)
            row.enabled.checked = enabled.has(symbol);
        updateCount();
    };
    const aliasesFrom = (index) => {
        for (const command of COMMANDS) {
            const input = rows.get(command[0]).aliases;
            input.value = [...new Set([...input.value.split(',').map(word => word.trim()).filter(Boolean), command[index]])].join(', ');
        }
    };
    element('aliases-english').onclick = () => aliasesFrom(1);
    element('aliases-korean').onclick = () => aliasesFrom(2);
    element('aliases-clear').onclick = () => { for (const row of rows.values())
        row.aliases.value = ''; };
    const previewTheme = () => applyTheme({ theme: element('skin-theme').value, accent: element('skin-accent').value });
    element('skin-theme').onchange = previewTheme;
    element('skin-accent').oninput = previewTheme;
    element('sound-enabled').onchange = () => { if (!element('sound-enabled').checked)
        preview.setEnabled(false); };
    element('sound-volume').oninput = () => {
        const volume = Number(element('sound-volume').value);
        element('sound-volume-value').textContent = `${volume}%`;
        preview.setVolume(volume / 100);
    };
    element('sound-preview').onclick = () => {
        preview.setVolume(Number(element('sound-volume').value) / 100);
        preview.setEnabled(element('sound-enabled').checked);
        preview.play('done');
    };
    form.onsubmit = event => {
        event.preventDefault();
        try {
            const next = readDraft();
            apply(next);
            draft = copySettings(next);
            dialog.close();
        }
        catch (error) {
            element('settings-error').textContent = error instanceof Error ? error.message : String(error);
        }
    };
    return { open() { draft = copySettings(read()); render(); dialog.showModal(); dialog.scrollTop = 0; element('settings-close').focus(); } };
}
//# sourceMappingURL=settings-panel.js.map