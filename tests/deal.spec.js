import { test, expect } from '@playwright/test';

const DEAL = '/?deal=7';
const STORE = 'lbg.solitaire.v2';

const pile = (page, key) => page.locator(`[data-pile="${key}"] .card`);

const board = (page) => page.evaluate(() => {
  const keys = ['stock', 'waste', 'f0', 'f1', 'f2', 'f3', 't0', 't1', 't2', 't3', 't4', 't5', 't6'];
  return keys.map((k) => [...document.querySelectorAll(`[data-pile="${k}"] .card`)]
    .map((c) => c.dataset.id + (c.classList.contains('is-up') ? '^' : 'v')).join(','));
});

const stored = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), STORE);

// The same calendar arithmetic the game uses, so a test never disagrees with
// the player's clock about which day it is.
const dayStamp = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const seedFor = (day) => Number(day.replaceAll('-', ''));

const seedDaily = (page, daily) => page.addInitScript(([k, d]) => {
  localStorage.setItem(k, JSON.stringify({
    v: 2,
    prefs: { drawN: 1, sound: false },
    stats: { played: 0, won: 0, streak: 0, bestStreak: 0, bestTime: 0, bestMoves: 0 },
    daily: d,
    game: null,
  }));
}, [STORE, daily]);

test.beforeEach(async ({ page }) => {
  const problems = [];
  page.on('pageerror', (e) => problems.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
  page.problems = problems;
});

test.afterEach(async ({ page }) => {
  expect(page.problems, 'the page logged no errors').toEqual([]);
});

test('every hand carries the number that produced it', async ({ page }) => {
  await page.goto(DEAL);
  await page.click('#btn-more');
  await expect(page.locator('#deal-num')).toHaveText('7');
  await page.click('#btn-sheet-done');

  // A hand nobody named still gets a number, and that number is the hand.
  await page.goto('/');
  await page.click('#btn-more');
  const num = await page.locator('#deal-num').textContent();
  expect(Number(num)).toBeGreaterThan(0);
  await page.click('#btn-sheet-done');
  const dealt = await board(page);

  await page.goto(`/?deal=${num}`);
  expect(await board(page)).toEqual(dealt);
});

test('replay deals the same hand again from the start', async ({ page }) => {
  await page.goto(DEAL);
  const opening = await board(page);

  await page.click('#stock');
  await page.locator('[data-pile="t4"] .card').last().dblclick();
  expect(await board(page)).not.toEqual(opening);

  await page.click('#btn-more');
  await page.click('#btn-replay');
  await expect(page.locator('#sheet')).toBeHidden();
  expect(await board(page)).toEqual(opening);
  await expect(page.locator('#stat-moves')).toHaveText('0');
});

test('the copy link carries the hand to another tab', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'clipboard permissions are Chromium-only in Playwright');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(DEAL);

  await page.click('#btn-more');
  await page.click('#btn-copy');
  await expect(page.locator('#btn-copy')).toHaveText('Copied');

  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toContain('?deal=7');

  // The label goes back to an instruction rather than staying a report.
  await expect(page.locator('#btn-copy')).toHaveText('Copy link', { timeout: 3000 });
});

test('today’s deal is the same hand all day', async ({ page }) => {
  await page.goto('/?daily');
  const first = await board(page);
  expect(await page.locator('#stat-moves').textContent()).toBe('0');

  await page.click('#btn-more');
  await expect(page.locator('#daily-state')).toHaveText('Open');
  await page.click('#btn-sheet-done');

  // A named deal of the same number is the same shuffle.
  await page.goto(`/?deal=${seedFor(dayStamp())}`);
  expect(await board(page)).toEqual(first);
});

test('winning the daily advances its streak and leaves freeplay alone', async ({ page }) => {
  // One card short of home, so the win is a single double-click away.
  await page.addInitScript(([k, day]) => {
    const piles = [[], [], [], [], [], [], [], [], [], [], [], [], []];
    for (let id = 0; id < 51; id++) piles[2 + ((id / 13) | 0)].push(id);
    piles[6].push(51); // the king of clubs, still on t0
    localStorage.setItem(k, JSON.stringify({
      v: 2,
      prefs: { drawN: 1, sound: false },
      stats: { played: 0, won: 0, streak: 0, bestStreak: 0, bestTime: 0, bestMoves: 0 },
      daily: { day, result: 'playing', streak: 2, bestStreak: 4 },
      game: {
        seed: Number(day.replaceAll('-', '')), isDaily: true, drawN: 1, counted: true, elapsed: 30,
        current: { up: new Array(52).fill(true), moves: 100, piles },
      },
    }));
  }, [STORE, dayStamp()]);

  await page.goto('/?daily');
  await expect(pile(page, 'f3')).toHaveCount(12);

  await page.locator('[data-pile="t0"] .card').last().dblclick();

  await expect.poll(async () => (await stored(page)).daily.result).toBe('won');
  const saved = await stored(page);
  expect(saved.daily.streak, 'the run grows by a day').toBe(3);
  expect(saved.daily.bestStreak, 'and the best run keeps up').toBe(4);
  expect(saved.stats.won, 'the daily never touches the freeplay record').toBe(0);
  expect(saved.stats.played).toBe(0);
  expect(saved.game, 'a finished hand is not kept').toBeNull();

  // The win screen counts a daily in days, not in seconds.
  await expect(page.locator('#won-best-label')).toHaveText('Streak');
  await expect(page.locator('#won-best')).toHaveText('3');
});

test('walking away from the daily spends the day', async ({ page }) => {
  await seedDaily(page, { day: dayStamp(), result: 'playing', streak: 6, bestStreak: 9 });
  await page.goto('/?daily');

  await page.click('#stock');
  await page.click('#btn-new');

  await expect.poll(async () => (await stored(page)).daily.result).toBe('lost');
  const saved = await stored(page);
  expect(saved.daily.streak).toBe(0);
  expect(saved.daily.bestStreak, 'a lost day does not erase the best run').toBe(9);
});

test('restarting the daily is not the same as giving up on it', async ({ page }) => {
  await seedDaily(page, { day: dayStamp(), result: 'playing', streak: 6, bestStreak: 9 });
  await page.goto('/?daily');

  await page.click('#stock');
  await page.click('#btn-more');
  await page.click('#btn-replay');

  // Restarting is the same as walking every move back, so the day is still on.
  const saved = await stored(page);
  expect(saved.daily.result).toBe('playing');
  expect(saved.daily.streak).toBe(6);
  await expect(page.locator('#stat-moves')).toHaveText('0');
});

test('a run carries over one day and no further', async ({ page }) => {
  await seedDaily(page, { day: dayStamp(-1), result: 'won', streak: 4, bestStreak: 7 });
  await page.goto('/');
  await page.click('#btn-more');
  await expect(page.locator('#daily-streak'), 'yesterday was won, so the run stands').toHaveText('4');
  await expect(page.locator('#daily-state')).toHaveText('Open');
  await expect(page.locator('#daily-best')).toHaveText('7');
});

test('a day skipped ends the run', async ({ page }) => {
  await seedDaily(page, { day: dayStamp(-3), result: 'won', streak: 4, bestStreak: 7 });
  await page.goto('/');
  await page.click('#btn-more');
  await expect(page.locator('#daily-streak'), 'three days ago is not yesterday').toHaveText('0');
  await expect(page.locator('#daily-best')).toHaveText('7');
});

test('a day lost ends the run even if it was yesterday', async ({ page }) => {
  await seedDaily(page, { day: dayStamp(-1), result: 'lost', streak: 0, bestStreak: 7 });
  await page.goto('/');
  await page.click('#btn-more');
  await expect(page.locator('#daily-streak')).toHaveText('0');
  await expect(page.locator('#btn-daily')).toHaveText(/Play today/);
});
