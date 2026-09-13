/** Decompose command spelling only; callers protect names, strings and comments. */
const INITIALS = Array.from('ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ');
const VOWELS = Array.from('ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ');
const FINALS = ['', 'ㄱ', 'ㄲ', 'ㄱㅅ', 'ㄴ', 'ㄴㅈ', 'ㄴㅎ', 'ㄷ', 'ㄹ', 'ㄹㄱ', 'ㄹㅁ',
  'ㄹㅂ', 'ㄹㅅ', 'ㄹㅌ', 'ㄹㅍ', 'ㄹㅎ', 'ㅁ', 'ㅂ', 'ㅂㅅ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const COMPATIBILITY = new Set([...INITIALS, ...VOWELS]);
const CLUSTERS = new Map([
  ['ㄳ', 'ㄱㅅ'], ['ㄵ', 'ㄴㅈ'], ['ㄶ', 'ㄴㅎ'], ['ㄺ', 'ㄹㄱ'], ['ㄻ', 'ㄹㅁ'],
  ['ㄼ', 'ㄹㅂ'], ['ㄽ', 'ㄹㅅ'], ['ㄾ', 'ㄹㅌ'], ['ㄿ', 'ㄹㅍ'], ['ㅀ', 'ㄹㅎ'], ['ㅄ', 'ㅂㅅ'],
]);
export function commandParts(char: string): string | null {
  const point = char.codePointAt(0)!;
  if (point >= 0xac00 && point <= 0xd7a3) {
    const index = point - 0xac00;
    return INITIALS[Math.floor(index / 588)] + VOWELS[Math.floor(index / 28) % 21] + FINALS[index % 28];
  }
  if (point >= 0x1100 && point <= 0x1112) return INITIALS[point - 0x1100];
  if (point >= 0x1161 && point <= 0x1175) return VOWELS[point - 0x1161];
  if (point >= 0x11a8 && point <= 0x11c2) return FINALS[point - 0x11a7];
  if (point === 0x115f || point === 0x1160 || point === 0x3164) return '';
  return COMPATIBILITY.has(char) ? char : CLUSTERS.get(char) ?? null;
}

export function decomposableSpelling(text: string): boolean {
  return text.length > 0 && Array.from(text).every(char => commandParts(char) !== null);
}

/** Preserve a compound-final slot so settings can disable its fixed expansion. */
export function commandSymbols(char: string): string | null {
  const parts = commandParts(char);
  if (parts === null) return null;
  if (CLUSTERS.has(char)) return char;
  const point = char.codePointAt(0)!;
  const prefix = point >= 0xac00 && point <= 0xd7a3 ? parts.slice(0, 2) : '';
  const ending = prefix ? parts.slice(2) : parts;
  if (ending.length === 2 && (prefix || (point >= 0x11a8 && point <= 0x11c2))) {
    for (const [cluster, expansion] of CLUSTERS) if (expansion === ending) return prefix + cluster;
  }
  return parts;
}
