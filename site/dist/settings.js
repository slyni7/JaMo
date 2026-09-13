import { isIdentifier } from './frontend.js';
export const COMMANDS = [
    ['ㄱ', 'then', '그러면'], ['ㄲ', 'goto', '이동'], ['ㄴ', 'not', '아님'], ['ㄷ', 'return', '반환'],
    ['ㄸ', 'while', '동안'], ['ㄹ', 'continue', '다음반복'], ['ㅁ', 'if', '만약'], ['ㅂ', 'print', '출력'],
    ['ㅃ', 'for', '순회'], ['ㅅ', 'int', '정수'], ['ㅆ', 'float', '실수'], ['ㅇ', 'else', '아니면'],
    ['ㅈ', 'char', '문자'], ['ㅉ', 'string', '문자열'], ['ㅊ', 'custom', '새기능'], ['ㅋ', 'end', '끝'],
    ['ㅌ', 'list', '목록'], ['ㅍ', 'pass', '빈동작'], ['ㅎ', 'function', '함수'], ['ㅏ', 'except', '예외처리'],
    ['ㅑ', 'try', '시도'], ['ㅓ', 'ref', '어디'], ['ㅕ', 'value', '여기'], ['ㅗ', 'false', '거짓'],
    ['ㅛ', 'label', '라벨'], ['ㅜ', 'nil', '없음'], ['ㅠ', 'throw', '던지기'], ['ㅡ', 'break', '탈출'],
    ['ㅣ', 'or', '또는'], ['ㅐ', 'len', '길이'], ['ㅒ', 'new', '선언'], ['ㅔ', 'in', '포함'],
    ['ㅖ', 'true', '참'], ['ㅘ', 'and', '그리고'], ['ㅙ', 'check', '점검'], ['ㅚ', 'import', '가져오기'],
    ['ㅝ', 'typeof', '자료형'], ['ㅞ', 'where', '걸러내기'], ['ㅟ', 'address', '엄격참조'], ['ㅢ', 'deref', '역참조'],
];
export const CLUSTER_DEFAULTS = Object.freeze({
    'ㄳ': 'ㄱㅅ', 'ㄵ': 'ㄴㅈ', 'ㄶ': 'ㄴㅎ', 'ㄺ': 'ㄹㄱ', 'ㄻ': 'ㄹㅁ', 'ㄼ': 'ㄹㅂ',
    'ㄽ': 'ㄹㅅ', 'ㄾ': 'ㄹㅌ', 'ㄿ': 'ㄹㅍ', 'ㅀ': 'ㄹㅎ', 'ㅄ': 'ㅂㅅ',
});
export const SYMBOLS = [...COMMANDS.map(([symbol]) => symbol), ...Object.keys(CLUSTER_DEFAULTS)];
export const BASIC_SYMBOLS = Array.from('ㅒㅖㅗㅜㅂㅅㅆㅉㅌㅐㅁㄱㅇㅋㄴㅘㅣㅔ');
export function defaultSettings() {
    return { version: 1, assist: { enabled: true, timeoutMs: 300 }, theme: 'paper', accent: '#36574d',
        sound: { enabled: false, volume: 0.2 }, disabledSymbols: [],
        aliases: Object.fromEntries(SYMBOLS.map(symbol => [symbol, []])) };
}
export function copySettings(settings) { return structuredClone(settings); }
export function validateSettings(input) {
    if (!input || typeof input !== 'object')
        throw new Error('설정 형식이 올바르지 않습니다.');
    const candidate = input;
    if (candidate.version !== 1)
        throw new Error('지원하지 않는 설정 버전입니다.');
    if (!candidate.assist || typeof candidate.assist.enabled !== 'boolean'
        || !Number.isInteger(candidate.assist.timeoutMs) || candidate.assist.timeoutMs < 0 || candidate.assist.timeoutMs > 2000)
        throw new Error('결합 시간은 0~2000ms의 정수로 입력하세요.');
    if (!['paper', 'night', 'contrast'].includes(candidate.theme) || !/^#[0-9a-f]{6}$/i.test(candidate.accent))
        throw new Error('스킨과 강조색을 확인하세요.');
    if (!candidate.sound || typeof candidate.sound.enabled !== 'boolean' || !Number.isFinite(candidate.sound.volume)
        || candidate.sound.volume < 0 || candidate.sound.volume > 1)
        throw new Error('음량은 0~100%로 설정하세요.');
    if (!Array.isArray(candidate.disabledSymbols) || candidate.disabledSymbols.some(symbol => !SYMBOLS.includes(symbol))
        || new Set(candidate.disabledSymbols).size !== candidate.disabledSymbols.length)
        throw new Error('사용할 자모 목록이 올바르지 않습니다.');
    const used = new Map();
    for (const symbol of SYMBOLS) {
        const aliases = candidate.aliases?.[symbol];
        if (!Array.isArray(aliases) || aliases.length > 50)
            throw new Error(`${symbol}의 별칭은 50개 이하로 입력하세요.`);
        for (const alias of aliases) {
            if (typeof alias !== 'string' || alias.length > 100 || !isIdentifier(alias))
                throw new Error(`${symbol}의 별칭 '${alias}'은 한글·영문 이름 형태여야 합니다. + 같은 연산자는 별칭이 아닙니다.`);
            if (used.has(alias))
                throw new Error(`별칭 '${alias}'이 ${used.get(alias)}와 ${symbol}에 중복되어 있습니다.`);
            used.set(alias, symbol);
        }
    }
    const clean = copySettings(defaultSettings());
    clean.assist = { ...candidate.assist };
    clean.theme = candidate.theme;
    clean.accent = candidate.accent;
    clean.sound = { ...candidate.sound };
    clean.disabledSymbols = [...candidate.disabledSymbols];
    for (const symbol of SYMBOLS) {
        clean.aliases[symbol] = [...candidate.aliases[symbol]];
    }
    return clean;
}
export function wordAliases(settings) {
    return SYMBOLS.flatMap(symbol => settings.aliases[symbol].map(alias => [alias, symbol]));
}
export function applyTheme(settings) {
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.style.setProperty('--accent', settings.accent);
    document.documentElement.style.setProperty('--accent-hover', settings.accent.toLowerCase() === '#36574d'
        ? '#244337' : `color-mix(in srgb, ${settings.accent}, black 20%)`);
    const rgb = [1, 3, 5].map(index => Number.parseInt(settings.accent.slice(index, index + 2), 16) / 255)
        .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    const luminance = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
    document.documentElement.style.setProperty('--on-accent', luminance > 0.179 ? '#000000' : '#ffffff');
}
//# sourceMappingURL=settings.js.map