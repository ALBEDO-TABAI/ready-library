import { cpSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const dest = join(root, 'public', 'pdfjs');
mkdirSync(dest, { recursive: true });
for (const name of ['cmaps', 'standard_fonts', 'wasm']) {
  cpSync(join(root, 'node_modules', 'pdfjs-dist', name), join(dest, name), { recursive: true });
}
