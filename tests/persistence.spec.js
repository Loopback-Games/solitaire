import { test, expect } from '@playwright/test';

// ?deal=7 is a fixed shuffle, so every assertion below is about a known hand.
const DEAL = '/?deal=7';
const STORE = 'lbg.solitaire.v2';

const pile = (page, key) => page.locator(`[data-pile="${key}"] .card`);
const topOf = (page, key) => pile(page, key).last();

// Every card, in the pile it sits in, and whether it is face up. Two boards
// that agree on this are the same board.
const board = (page) => page.evaluate(() => {
  const keys = ['stock', 'waste', 'f0', 'f1', 'f2', 'f3', 't0', 't1', 't2', 't3', 't4', 't5', 't6'];
  return keys.map((k) => [...document.querySelectorAll(`[data-pile="${k}"] .card`)]
    .map((c) => c.dataset.id + (c.classList.contains('is-up') ? '^' : 'v')).join(','));
});

const stored = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), STORE);

// The board reaches the disk on a 250ms debounce, so a reload has to wait for
// the write rather than race it.
const settled = (page) => expect.poll(async () => !!(await stored(page))?.game).toBe(true);

test.beforeEach(async ({ page }) => {
  const problems = [];
  page.on('pageerror', (e) => problems.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
  page.problems = problems;
});

test.afterEach(async ({ page }) => {
  expect(page.problems, 'the page logged no errors').toEqual([]);
});

test('the hand you left is the hand you come back to', async ({ page }) => {
  await page.goto(DEAL);

  await page.click('#stock');
  await topOf(page, 't4').dblclick();
  await topOf(page, 't6').click();
  await page.click('[data-pile="t5"]');
  await expect(page.locator('#stat-moves')).toHaveText('3');

  const before = await board(page);
  await settled(page);
  await page.reload();

  await expect(page.locator('#stat-moves')).toHaveText('3');
  expect(await board(page)).toEqual(before);
  // A resumed hand is not dealt again, so nothing animates in.
  await expect(page.locator('.card.is-dealing')).toHaveCount(0);
});

test('undo and redo survive a reload together', async ({ page }) => {
  await page.goto(DEAL);

  await page.click('#stock');
  await topOf(page, 't4').dblclick();
  const played = await board(page);

  await page.click('#btn-undo');
  await expect(page.locator('#btn-redo')).toBeEnabled();
  const walked = await board(page);
  expect(walked).not.toEqual(played);

  await settled(page);
  await page.reload();

  await expect(page.locator('#btn-redo')).toBeEnabled();
  expect(await board(page)).toEqual(walked);

  await page.click('#btn-redo');
  expect(await board(page)).toEqual(played);
  await expect(page.locator('#stat-moves')).toHaveText('2');
});

test('playing on abandons the branch you walked back from', async ({ page }) => {
  await page.goto(DEAL);

  await page.click('#stock');
  await page.click('#btn-undo');
  await expect(page.locator('#btn-redo')).toBeEnabled();

  // A different move from the same position throws the old branch away.
  await topOf(page, 't4').dblclick();
  await expect(page.locator('#btn-redo')).toBeDisabled();
});

test('redo is keyboard reachable and stops at the end of the stack', async ({ page }) => {
  await page.goto(DEAL);

  await page.click('#stock');
  await page.keyboard.press('u');
  await expect(page.locator('#stat-moves')).toHaveText('0');

  await page.keyboard.press('r');
  await expect(page.locator('#stat-moves')).toHaveText('1');
  // Nothing left to walk forward into.
  await page.keyboard.press('r');
  await expect(page.locator('#stat-moves')).toHaveText('1');
  await expect(page.locator('#btn-redo')).toBeDisabled();

  await page.keyboard.press('Control+z');
  await expect(page.locator('#stat-moves')).toHaveText('0');
  await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('#stat-moves')).toHaveText('1');
});

test('a deal named in the URL beats the saved hand', async ({ page }) => {
  await page.goto(DEAL);
  await page.click('#stock');
  await settled(page);
  const seven = await board(page);

  // Following a link to another deal should deal that link's hand, not resume.
  await page.goto('/?deal=99');
  expect(await board(page)).not.toEqual(seven);
  await expect(page.locator('#stat-moves')).toHaveText('0');
  await expect(pile(page, 'waste')).toHaveCount(0);

  await settled(page);
  await page.goto(DEAL);
  await expect(page.locator('#stat-moves')).toHaveText('0');
});

test('a v1 record is carried across', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('lbg.solitaire.v1', JSON.stringify({ drawN: 3, wins: 5, best: 240 }));
  });
  await page.goto(DEAL);

  await expect(page.locator('#stat-wins')).toHaveText('5');
  await page.click('#btn-more');
  await expect(page.locator('[data-draw="3"]')).toHaveAttribute('aria-pressed', 'true');
  await page.click('#btn-sheet-done');

  const saved = await stored(page);
  expect(saved.v).toBe(2);
  expect(saved.stats.won).toBe(5);
  expect(saved.stats.bestTime).toBe(240);
  expect(saved.prefs.drawN).toBe(3);
  // The old key is consumed, not left to be migrated twice.
  expect(await page.evaluate(() => localStorage.getItem('lbg.solitaire.v1'))).toBeNull();
});

test('a damaged saved hand is thrown away rather than dealt', async ({ page }) => {
  await page.addInitScript((key) => {
    localStorage.setItem(key, JSON.stringify({
      v: 2,
      prefs: { drawN: 1, sound: false },
      stats: { played: 0, won: 0, streak: 0, bestStreak: 0, bestTime: 0, bestMoves: 0 },
      daily: null,
      // Three cards short of a deck: the write was cut off part way.
      game: { seed: 7, drawN: 1, counted: true, elapsed: 9, current: { up: new Array(52).fill(false), moves: 4, piles: [[0, 1, 2], [], [], [], [], [], [3], [4], [5], [6], [7], [8], [9]] } },
    }));
  }, STORE);
  await page.goto(DEAL);

  await expect(page.locator('.card')).toHaveCount(52);
  await expect(pile(page, 'stock')).toHaveCount(24);
  await expect(page.locator('#stat-moves')).toHaveText('0');
});

test('a finished hand is not offered again', async ({ page }) => {
  await page.addInitScript((key) => {
    const piles = [[], [], [], [], [], [], [], [], [], [], [], [], []];
    // Every card home on its foundation — the hand is over.
    for (let id = 0; id < 52; id++) piles[2 + ((id / 13) | 0)].push(id);
    localStorage.setItem(key, JSON.stringify({
      v: 2,
      prefs: { drawN: 1, sound: false },
      stats: { played: 1, won: 1, streak: 1, bestStreak: 1, bestTime: 90, bestMoves: 120 },
      daily: null,
      game: { seed: 7, drawN: 1, counted: true, elapsed: 90, current: { up: new Array(52).fill(true), moves: 120, piles } },
    }));
  }, STORE);
  await page.goto(DEAL);

  await expect(pile(page, 'stock')).toHaveCount(24);
  await expect(page.locator('#curtain')).toBeHidden();
});

test('the record counts a hand from its first move, not from the deal', async ({ page }) => {
  await page.goto(DEAL);
  expect((await stored(page))?.stats?.played ?? 0).toBe(0);

  await page.click('#stock');
  await expect.poll(async () => (await stored(page)).stats.played).toBe(1);

  // Walking away from a started hand breaks the streak but is not a new game.
  await page.keyboard.press('n');
  await expect.poll(async () => (await stored(page)).stats.streak).toBe(0);
  expect((await stored(page)).stats.played).toBe(1);

  await page.click('#stock');
  await expect.poll(async () => (await stored(page)).stats.played).toBe(2);
});

test('a new deal resets the clock on screen', async ({ page }) => {
  await page.goto(DEAL);
  await page.click('#stock');
  await expect(page.locator('#stat-time')).not.toHaveText('0:00', { timeout: 3000 });

  await page.click('#btn-new');
  await expect(page.locator('#stat-time')).toHaveText('0:00');
});
