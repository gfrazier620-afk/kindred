// Renders public/icons/icon.svg into the PNG sizes phones need. Run: npm run icons
import sharp from 'sharp';

const src = new URL('../public/icons/icon.svg', import.meta.url);
const out = (name) => new URL(`../public/icons/${name}`, import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const svg = await (await import('node:fs/promises')).readFile(src);

for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  await sharp(svg).resize(size, size).png().toFile(out(name));
}

// Maskable icon: same art on a full-bleed background with safe-zone padding.
const inner = await sharp(svg).resize(400, 400).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: '#14111c' } })
  .composite([{ input: inner, gravity: 'center' }])
  .png()
  .toFile(out('icon-maskable-512.png'));

console.log('Icons written to public/icons/');
