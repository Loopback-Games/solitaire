/* Rasterise assets/favicon.svg into the PNG sizes a manifest and iOS need.
 *
 * iOS ignores an SVG apple-touch-icon outright, and some install prompts still
 * want a raster of a known size. Chromium is already here for the test suite,
 * so it does the rendering rather than a new dependency.
 *
 *   node tools/icons.mjs        (or: just icons)
 */
import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';

const SIZES = [
  ['assets/icon-192.png', 192],
  ['assets/icon-512.png', 512],
  ['assets/apple-touch-icon.png', 180],
];

const svg = await readFile('assets/favicon.svg', 'utf8');
const browser = await chromium.launch();

for (const [path, size] of SIZES) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(
    `<style>html,body{margin:0;padding:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  );
  await writeFile(path, await page.locator('svg').screenshot({ omitBackground: false }));
  await page.close();
  console.log(`${path}  ${size}x${size}`);
}

await browser.close();
