import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const source = join(process.cwd(), 'cdn');
const target = join(process.cwd(), 'out', 'cdn');

if (!existsSync(source)) {
  throw new Error(`Missing CDN source directory: ${source}`);
}

mkdirSync(join(process.cwd(), 'out'), { recursive: true });
cpSync(source, target, { recursive: true });
console.log(`Copied ${source} to ${target}`);
