import { test, expect } from '@playwright/test';

const DEAL = '/?deal=7';

test.beforeEach(async ({ page }) => {
  const problems = [];
  page.on('pageerror', (e) => problems.push(String(e)));
  page.problems = problems;
});

test.afterEach(async ({ page }) => {
  expect(page.problems, 'the page logged no errors').toEqual([]);
});

const claimed = (page) =>
  page.waitForFunction(
    () => navigator.serviceWorker && navigator.serviceWorker.controller !== null,
    null,
    { timeout: 10000 },
  );

test('the worker takes over the page it was registered from', async ({ page }) => {
  await page.goto(DEAL);
  await claimed(page);

  const cached = await page.evaluate(async () => {
    const cache = await caches.open('lbg-solitaire');
    const keys = await cache.keys();
    return keys.map((r) => new URL(r.url).pathname.replace(/^.*\//, '')).sort();
  });
  // The shell is there: the page, the stylesheet, and every module it imports.
  expect(cached).toEqual(
    expect.arrayContaining([
      'solitaire.js',
      'store.js',
      'hint.js',
      'sfx.js',
      'keys.js',
      'solitaire.css',
    ]),
  );
});

test('an installed copy still deals with nothing behind it', async ({ page, context }) => {
  await page.goto(DEAL);
  await claimed(page);

  await context.setOffline(true);
  await page.reload();

  await expect(page.locator('.card')).toHaveCount(52);
  await expect(page.locator('[data-pile="stock"] .card')).toHaveCount(24);

  // And it is a game, not just a picture of one.
  await page.click('#stock');
  await expect(page.locator('[data-pile="waste"] .card')).toHaveCount(1);
  await page.locator('[data-pile="t4"] .card').last().dblclick();
  await expect(page.locator('[data-pile="f1"] .card')).toHaveCount(1);

  await context.setOffline(false);
});

test('every navigation is answered from the one shell', async ({ page, context }) => {
  await page.goto(DEAL);
  await claimed(page);

  await context.setOffline(true);
  // A deal number chosen offline was never fetched, and still opens.
  await page.goto('/?deal=1234');
  await expect(page.locator('.card')).toHaveCount(52);

  const entries = await page.evaluate(async () => {
    const cache = await caches.open('lbg-solitaire');
    return (await cache.keys()).filter((r) => r.url.includes('deal=')).length;
  });
  expect(entries, 'the cache does not grow a copy per deal number').toBe(0);

  await context.setOffline(false);
});
