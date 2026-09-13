export declare const COMMANDS: readonly [readonly ['ㄱ', 'then', '그러면'], readonly ['ㄲ', 'goto', '이동'], readonly ['ㄴ', 'not', '아님'], readonly ['ㄷ', 'return', '반환'], readonly ['ㄸ', 'while', '동안'], readonly ['ㄹ', 'continue', '다음반복'], readonly ['ㅁ', 'if', '만약'], readonly ['ㅂ', 'print', '출력'], readonly ['ㅃ', 'for', '순회'], readonly ['ㅅ', 'int', '정수'], readonly ['ㅆ', 'float', '실수'], readonly ['ㅇ', 'else', '아니면'], readonly ['ㅈ', 'char', '문자'], readonly ['ㅉ', 'string', '문자열'], readonly ['ㅊ', 'custom', '새기능'], readonly ['ㅋ', 'end', '끝'], readonly ['ㅌ', 'list', '목록'], readonly ['ㅍ', 'pass', '빈동작'], readonly ['ㅎ', 'function', '함수'], readonly ['ㅏ', 'except', '예외처리'], readonly ['ㅑ', 'try', '시도'], readonly ['ㅓ', 'ref', '어디'], readonly ['ㅕ', 'value', '여기'], readonly ['ㅗ', 'false', '거짓'], readonly ['ㅛ', 'label', '라벨'], readonly ['ㅜ', 'nil', '없음'], readonly ['ㅠ', 'throw', '던지기'], readonly ['ㅡ', 'break', '탈출'], readonly ['ㅣ', 'or', '또는'], readonly ['ㅐ', 'len', '길이'], readonly ['ㅒ', 'new', '선언'], readonly ['ㅔ', 'in', '포함'], readonly ['ㅖ', 'true', '참'], readonly ['ㅘ', 'and', '그리고'], readonly ['ㅙ', 'check', '점검'], readonly ['ㅚ', 'import', '가져오기'], readonly ['ㅝ', 'typeof', '자료형'], readonly ['ㅞ', 'where', '걸러내기'], readonly ['ㅟ', 'address', '엄격참조'], readonly ['ㅢ', 'deref', '역참조']];
export declare const CLUSTER_DEFAULTS: Readonly<Record<string, string>>;
export declare const SYMBOLS: readonly string[];
export declare const BASIC_SYMBOLS: string[];
export type Theme = 'paper' | 'night' | 'contrast';
export interface Settings {
    version: 1;
    assist: {
        enabled: boolean;
        timeoutMs: number;
    };
    theme: Theme;
    accent: string;
    sound: {
        enabled: boolean;
        volume: number;
    };
    disabledSymbols: string[];
    aliases: Record<string, string[]>;
}
export declare function defaultSettings(): Settings;
export declare function copySettings(settings: Settings): Settings;
export declare function validateSettings(input: unknown): Settings;
export declare function wordAliases(settings: Settings): [string, string][];
export declare function applyTheme(settings: Pick<Settings, 'theme' | 'accent'>): void;
