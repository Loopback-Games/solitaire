import { test, expect } from '@playwright/test';

// ?deal=7 is a fixed shuffle, so every assertion below is about a known hand.
const DEAL = '/?deal=7';

const pile = (page, key) => page.locator(`[data-pile="${key}"] .card`);
const topOf = (page, key) => pile(page, key).last();

test.beforeEach(async ({ page }) => {
  const problems = [];
  page.on('pageerror', (e) => problems.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
  page.problems = problems;
});

test.afterEach(async ({ page }) => {
  expect(page.problems, 'the page logged no errors').toEqual([]);
});

test('deals a legal Klondike layout', async ({ page }) => {
  await page.goto(DEAL);

  await expect(page.locator('.card')).toHaveCount(52);
  await expect(pile(page, 'stock')).toHaveCount(24);
  await expect(pile(page, 'waste')).toHaveCount(0);

  for (let i = 0; i < 7; i++) {
    await expect(pile(page, `t${i}`), `column ${i} holds ${i + 1} cards`).toHaveCount(i + 1);
    await expect(topOf(page, `t${i}`), `column ${i} shows its top card`).toHaveClass(/is-up/);
  }
  for (let i = 0; i < 4; i++) await expect(pile(page, `f${i}`)).toHaveCount(0);

  // Exactly one card per column starts face up.
  await expect(page.locator('.card.is-up')).toHaveCount(7);
  await expect(page.locator('#stock-count')).toHaveText('24');
});

test('the stock deals, empties, and folds the waste back in', async ({ page }) => {
  await page.goto(DEAL);

  await page.click('#stock');
  await expect(pile(page, 'waste')).toHaveCount(1);
  await expect(pile(page, 'stock')).toHaveCount(23);
  await expect(topOf(page, 'waste')).toHaveClass(/is-up/);

  for (let i = 0; i < 23; i++) await page.click('#stock');
  await expect(pile(page, 'stock')).toHaveCount(0);
  await expect(pile(page, 'waste')).toHaveCount(24);
  await expect(page.locator('#stock')).toHaveClass(/can-recycle/);
  await expect(page.locator('#stock-count')).toBeHidden();

  await page.click('#stock');
  await expect(pile(page, 'stock')).toHaveCount(24);
  await expect(pile(page, 'waste')).toHaveCount(0);
  await expect(page.locator('.card.is-up')).toHaveCount(7);
});

test('draw three deals three at a time and is remembered', async ({ page }) => {
  await page.goto(DEAL);

  await page.click('#btn-draw');
  await expect(page.locator('#btn-draw')).toHaveAttribute('aria-pressed', 'true');
  await page.click('#stock');
  await expect(pile(page, 'waste')).toHaveCount(3);
  // Only the last three are drawn; the rest of the waste stays hidden.
  await page.click('#stock');
  await expect(pile(page, 'waste')).toHaveCount(6);
  await expect(page.locator('[data-pile="waste"] .card:not([hidden])')).toHaveCount(3);

  await page.reload();
  await expect(page.locator('#draw-n')).toHaveText('3');
});

test('a card moves onto a legal tableau target and not onto an illegal one', async ({ page }) => {
  await page.goto(DEAL);

  // This hand opens with the two of spades on t6 and the three of diamonds on t5.
  const two = topOf(page, 't6');
  await expect(two).toHaveAttribute('aria-label', '2 of spades');
  await two.click();
  await expect(two).toHaveClass(/is-picked/);

  // t5 is the only column that can take it.
  await expect(page.locator('[data-pile="t5"]')).toHaveClass(/is-target/);
  await expect(page.locator('.pile.is-target')).toHaveCount(1);

  await page.click('[data-pile="t5"]');
  await expect(pile(page, 't5')).toHaveCount(7);
  await expect(pile(page, 't6')).toHaveCount(6);
  await expect(topOf(page, 't5')).toHaveAttribute('aria-label', '2 of spades');
  // Taking the last face-up card off t6 turns the next one over.
  await expect(topOf(page, 't6')).toHaveClass(/is-up/);
  await expect(page.locator('#stat-moves')).toHaveText('1');
});

test('clicking a picked card puts it back down', async ({ page }) => {
  await page.goto(DEAL);
  const two = topOf(page, 't6');
  await two.click();
  await expect(two).toHaveClass(/is-picked/);
  await two.click();
  await expect(two).not.toHaveClass(/is-picked/);
  await expect(page.locator('.pile.is-target')).toHaveCount(0);
  await expect(page.locator('#stat-moves')).toHaveText('0');
});

test('double-clicking sends a card to its foundation', async ({ page }) => {
  await page.goto(DEAL);

  const ace = topOf(page, 't4');
  await expect(ace).toHaveAttribute('aria-label', 'A of hearts');
  await ace.dblclick();

  await expect(pile(page, 'f1')).toHaveCount(1);
  await expect(pile(page, 't4')).toHaveCount(4);
  await expect(topOf(page, 'f1')).toHaveAttribute('aria-label', 'A of hearts');
});

test('undo walks every kind of move back', async ({ page }) => {
  await page.goto(DEAL);

  await expect(page.locator('#btn-undo')).toBeDisabled();

  await page.click('#stock');
  await topOf(page, 't4').dblclick();
  await topOf(page, 't6').click();
  await page.click('[data-pile="t5"]');
  await expect(page.locator('#stat-moves')).toHaveText('3');

  for (let i = 0; i < 3; i++) await page.click('#btn-undo');

  await expect(page.locator('#stat-moves')).toHaveText('0');
  await expect(pile(page, 'stock')).toHaveCount(24);
  await expect(pile(page, 'waste')).toHaveCount(0);
  await expect(pile(page, 'f1')).toHaveCount(0);
  await expect(pile(page, 't6')).toHaveCount(7);
  await expect(page.locator('.card.is-up')).toHaveCount(7);
  await expect(page.locator('#btn-undo')).toBeDisabled();
});

test('the same deal number always gives the same hand', async ({ page }) => {
  await page.goto(DEAL);
  const first = await page.locator('.pile-tableau .card.is-up').evaluateAll(
    (els) => els.map((e) => e.getAttribute('aria-label')));

  await page.goto('/?deal=99');
  const other = await page.locator('.pile-tableau .card.is-up').evaluateAll(
    (els) => els.map((e) => e.getAttribute('aria-label')));
  expect(other).not.toEqual(first);

  await page.goto(DEAL);
  const again = await page.locator('.pile-tableau .card.is-up').evaluateAll(
    (els) => els.map((e) => e.getAttribute('aria-label')));
  expect(again).toEqual(first);
});

test('keyboard shortcuts deal, undo and toggle', async ({ page }) => {
  await page.goto(DEAL);

  await page.click('#stock');
  await expect(page.locator('#stat-moves')).toHaveText('1');
  await page.keyboard.press('u');
  await expect(page.locator('#stat-moves')).toHaveText('0');

  await page.keyboard.press('d');
  await expect(page.locator('#draw-n')).toHaveText('3');

  await page.keyboard.press('n');
  await expect(page.locator('.card')).toHaveCount(52);
  await expect(page.locator('#stat-moves')).toHaveText('0');
});
