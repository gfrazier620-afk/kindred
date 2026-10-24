// Renders public/icons/icon.svg into the PNG sizes phones need. Run: npm run icons
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';

const out = (name) => new URL(`../public/icons/${name}`, import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const source = await readFile(new URL('../public/icons/icon.svg', import.meta.url), 'utf8');

// The PNGs are full-bleed squares: phones apply their own rounded corners, and iPhone fills
// transparent corners with black. The artwork already sits inside the maskable safe zone.
const fullBleed = Buffer.from(source.replace('rx="112"', 'rx="0"'));

for (const [name, size] of [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['icon-maskable-512.png', 512],
  ['apple-touch-icon.png', 180],
]) {
  await sharp(fullBleed).resize(size, size).png().toFile(out(name));
}

console.log('Icons written to public/icons/');
