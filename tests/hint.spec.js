import { test, expect } from '@playwright/test';

const DEAL = '/?deal=7';
const STORE = 'lbg.solitaire.v2';

// Card ids run spades 0-12, hearts 13-25, diamonds 26-38, clubs 39-51, each
// suit ascending from the ace. Black cards are the spades and the clubs.
const seed = (page, built) =>
  page.addInitScript(
    ([k, { piles, up }]) => {
      localStorage.setItem(
        k,
        JSON.stringify({
          v: 2,
          prefs: { drawN: 1, sound: false },
          stats: { played: 0, won: 0, streak: 0, bestStreak: 0, bestTime: 0, bestMoves: 0 },
          daily: null,
          game: {
            seed: 7,
            isDaily: false,
            drawN: 1,
            counted: true,
            elapsed: 5,
            current: { up, moves: 20, piles },
          },
        }),
      );
    },
    [STORE, built],
  );

/* Nothing can move and nothing is left to turn: seven columns whose only
 * face-up cards are all black and none an ace, so no card fits another and no
 * card fits a foundation, with the stock and the waste already spent. */
function deadBoard() {
  const tops = [1, 2, 3, 4, 5, 6, 7]; // the two through the eight of spades
  const piles = Array.from({ length: 13 }, () => []);
  [...Array(52).keys()]
    .filter((id) => !tops.includes(id))
    .forEach((id, i) => piles[6 + (i % 7)].push(id));
  tops.forEach((id, i) => piles[6 + i].push(id));
  const up = new Array(52).fill(false);
  tops.forEach((id) => {
    up[id] = true;
  });
  return { piles, up };
}

/* One tableau move exists and it is a pure shuffle: the eight of spades can sit
 * on the nine of hearts, but the card it would uncover is already face up, so
 * the move reveals nothing and clears nothing. */
function shuffleOnlyBoard() {
  const shown = [11, 7, 21, 1, 2, 3, 4, 5]; // Q♠ 8♠ | 9♥ | 2♠ 3♠ 4♠ 5♠ 6♠
  const piles = Array.from({ length: 13 }, () => []);
  piles[6] = [11, 7];
  piles[7] = [21];
  [1, 2, 3, 4, 5].forEach((id, i) => {
    piles[8 + i] = [id];
  });
  piles[0] = [...Array(52).keys()].filter((id) => !shown.includes(id));
  const up = new Array(52).fill(false);
  shown.forEach((id) => {
    up[id] = true;
  });
  return { piles, up };
}

test.beforeEach(async ({ page }) => {
  const problems = [];
  page.on('pageerror', (e) => problems.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
  page.problems = problems;
});

test.afterEach(async ({ page }) => {
  expect(page.problems, 'the page logged no errors').toEqual([]);
});

test('a hint points at a move that can actually be made', async ({ page }) => {
  await page.goto(DEAL);
  await page.click('#btn-hint');

  const to = page.locator('.pile.is-hint-to');
  await expect(to).toHaveCount(1);

  const target = await to.getAttribute('data-pile');
  if (target === 'stock') {
    await page.click('#stock');
  } else {
    await page.locator('.card.is-hint').first().click();
    await page.click(`[data-pile="${target}"]`);
  }
  // The move the hint pointed at was legal, so it happened.
  await expect(page.locator('#stat-moves')).toHaveText('1');
});

test('pressing again walks down the list instead of repeating itself', async ({ page }) => {
  await page.goto(DEAL);

  const signature = () =>
    page.evaluate(() => {
      const to = document.querySelector('.pile.is-hint-to');
      const from = document.querySelector('.card.is-hint');
      return `${from ? from.dataset.id : '-'}>${to ? to.dataset.pile : '-'}`;
    });

  const seen = [];
  for (let i = 0; i < 4; i++) {
    await page.click('#btn-hint');
    seen.push(await signature());
  }
  expect(new Set(seen).size, `four presses gave ${seen.join(', ')}`).toBeGreaterThan(1);
  expect(
    seen.every((s) => s !== '->'),
    'every press pointed somewhere',
  ).toBe(true);
});

test('a hint never suggests a shuffle it would undo next turn', async ({ page }) => {
  await seed(page, shuffleOnlyBoard());
  await page.goto(DEAL);

  // The eight of spades really can go on the nine of hearts.
  await page.locator('[data-pile="t0"] .card').last().click();
  await expect(page.locator('[data-pile="t1"]')).toHaveClass(/is-target/);
  await page.keyboard.press('Escape');

  // And the hint still declines to recommend it, pointing at the stock instead.
  await page.click('#btn-hint');
  await expect(page.locator('.card.is-hint')).toHaveCount(0);
  await expect(page.locator('#stock')).toHaveClass(/is-hint-to/);
  await expect(page.locator('#announce')).toHaveText('Turn the stock.');
});

test('the hint clears itself rather than sitting there as a state', async ({ page }) => {
  await page.goto(DEAL);
  await page.click('#btn-hint');
  await expect(page.locator('.pile.is-hint-to')).toHaveCount(1);
  await expect(page.locator('.pile.is-hint-to')).toHaveCount(0, { timeout: 6000 });
});

test('a dead hand says so, and a live one does not', async ({ page }) => {
  await page.goto(DEAL);
  await page.click('#btn-hint');
  await expect(page.locator('#stuck'), 'an opening hand is not stuck').toBeHidden();

  await seed(page, deadBoard());
  await page.goto(DEAL);
  await page.click('#btn-hint');
  await expect(page.locator('#stuck')).toBeVisible();
  await expect(page.locator('#announce')).toHaveText('No moves left.');
});

test('the stuck panel can be waved away and does not nag', async ({ page }) => {
  await seed(page, deadBoard());
  await page.goto(DEAL);

  await page.click('#btn-hint');
  await expect(page.locator('#stuck')).toBeVisible();
  await page.click('#btn-stuck-stay');
  await expect(page.locator('#stuck')).toBeHidden();

  // Raised once per hand: the test behind it can be wrong, so it does not
  // reappear every time the player touches the board.
  await page.click('#btn-hint');
  await expect(page.locator('#stuck')).toBeHidden();

  // Escape is a way out too.
  await page.click('#btn-new');
  await seed(page, deadBoard());
  await page.goto(DEAL);
  await page.click('#btn-hint');
  await expect(page.locator('#stuck')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#stuck')).toBeHidden();
});

test('the stuck panel offers the same hand again, or a different one', async ({ page }) => {
  await seed(page, deadBoard());
  await page.goto(DEAL);
  await page.click('#btn-hint');

  await page.click('#btn-stuck-replay');
  await expect(page.locator('#stuck')).toBeHidden();
  // Replay deals deal 7 from the top, which is a playable opening.
  await expect(page.locator('[data-pile="stock"] .card')).toHaveCount(24);
  await expect(page.locator('#stat-moves')).toHaveText('0');
});
