import { spawnSync } from 'node:child_process';
import { mkdir, copyFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const compiler = path.join(root, 'node_modules/typescript/bin/tsc');
const result = spawnSync(process.execPath, [compiler, '-p', root], { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);
const site = path.join(root, 'site');
await mkdir(path.join(site, 'dist'), { recursive: true });
for (const name of await readdir(path.join(root, 'public'))) {
  await copyFile(path.join(root, 'public', name), path.join(site, name));
}
for (const name of await readdir(path.join(root, 'dist'))) {
  if (name.endsWith('.js') && !name.startsWith('cli.') && !name.startsWith('node-host.')) {
    await copyFile(path.join(root, 'dist', name), path.join(site, 'dist', name));
  }
}
await writeFile(path.join(site, '.nojekyll'), '');
console.log('TypeScript 검사·컴파일 및 site/ 정적 배포본 생성 완료');
