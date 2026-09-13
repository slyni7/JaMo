import { readFile, writeFile } from 'node:fs/promises';
import iconv from 'iconv-lite';

export type Encoding = 'utf-8-sig' | 'utf-8' | 'cp949';
export function decode(bytes: Uint8Array, encoding: Encoding = 'utf-8-sig'): string {
  if (encoding === 'cp949') {
    // Some ICU euc-kr decoders pass UHC extension lead bytes through as controls.
    for (let index = 0; index < bytes.length; index++) {
      const lead = bytes[index];
      if (lead <= 0x7f) continue;
      const trail = bytes[++index];
      if (lead < 0x81 || lead > 0xfe || trail === undefined ||
        !((trail >= 0x41 && trail <= 0x5a) || (trail >= 0x61 && trail <= 0x7a) || (trail >= 0x81 && trail <= 0xfe)))
        throw new Error('잘못된 CP949 바이트열입니다.');
    }
    const text = iconv.decode(Buffer.from(bytes), 'cp949');
    if (text.includes('\ufffd')) throw new Error('잘못된 CP949 바이트열입니다.');
    return text;
  }
  return new TextDecoder('utf-8', {
    fatal: true, ignoreBOM: encoding === 'utf-8'
  }).decode(bytes);
}
export function encode(text: string, encoding: Encoding): Uint8Array {
  if (encoding === 'cp949') {
    const bytes = iconv.encode(text, 'cp949');
    if (decode(bytes, 'cp949') !== text) throw new Error('CP949로 표현할 수 없는 문자가 있습니다.');
    return bytes;
  }
  return Buffer.from((encoding === 'utf-8-sig' ? '\ufeff' : '') + text, 'utf8');
}
export function fileHost(encoding: Encoding = 'utf-8-sig') {
  return {
    readFile: async (path: string) => decode(await readFile(path), encoding),
    writeFile: async (path: string, text: string) => { await writeFile(path, encode(text, encoding)); }
  };
}
export async function* inputLines(): AsyncGenerator<string> {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '';
  for await (const chunk of process.stdin) {
    buffer += decoder.decode(chunk as Uint8Array, { stream: true });
    let index: number;
    while ((index = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
      yield line.endsWith('\r') ? line.slice(0, -1) : line;
    }
  }
  buffer += decoder.decode();
  if (buffer.length) yield buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer;
}
