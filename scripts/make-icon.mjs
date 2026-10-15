// Renders build/icon.svg with Chromium into build/icon.png (512 px) and a multi-size build/icon.ico
// for the Windows executable, installer, and shortcuts. Run with `npm run icon` after editing the SVG.
import { chromium } from 'playwright';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const svg = readFileSync(resolve('build/icon.svg'), 'utf8');
const icoSizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const browserPath = process.env.FIELDMARK_BROWSER || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser = await chromium.launch({ headless: true, ...(browserPath ? { executablePath: browserPath } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
  async function render(size) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<!doctype html><html><head><style>html,body{margin:0;width:${size}px;height:${size}px;overflow:hidden;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style></head><body>${svg}</body></html>`);
    return page.screenshot({ type: 'png', omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  }
  writeFileSync(resolve('build/icon.png'), await render(512));
  const images = [];
  for (const size of icoSizes) images.push({ size, data: await render(size) });
  // ICO container with PNG-compressed entries (supported by Windows Vista and later).
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
  let offset = header.length + 16 * images.length;
  const directory = images.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size === 256 ? 0 : size, 0); entry.writeUInt8(size === 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2); entry.writeUInt8(0, 3); entry.writeUInt16LE(1, 4); entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8); entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });
  writeFileSync(resolve('build/icon.ico'), Buffer.concat([header, ...directory, ...images.map(image => image.data)]));
  console.log(`Wrote build/icon.png (512 px) and build/icon.ico (${icoSizes.join(', ')} px).`);
} finally { await browser.close(); }
