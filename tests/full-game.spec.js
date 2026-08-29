import { test, expect } from '@playwright/test';

/* Plays deal 7 from the opening to the win screen with a greedy strategy.
 * It is the one test that proves the whole thing is actually completable:
 * legal moves, uncovering, the foundations, Finish it, and the win state. */

const rank = (id) => (id % 13) + 1;
const suit = (id) => (id / 13) | 0;
const red = (id) => suit(id) === 1 || suit(id) === 2;
const T = ['t0', 't1', 't2', 't3', 't4', 't5', 't6'];
const F = ['f0', 'f1', 'f2', 'f3'];

const readBoard = () => {
  const p = {};
  document.querySelectorAll('[data-pile]').forEach((e) => {
    p[e.dataset.pile] = [...e.children]
      .filter((c) => c.classList.contains('card'))
      .map((c) => ({ id: +c.dataset.id, up: c.classList.contains('is-up') }));
  });
  return {
    p,
    won: !document.querySelector('#curtain').hidden,
    canFinish: !document.querySelector('#btn-auto').hidden,
  };
};

function nextMove(st) {
  const top = (k) => (st.p[k].length ? st.p[k][st.p[k].length - 1] : null);
  const home = (i) => st.p[F[i]].length;
  // Only send a card home when the other colour cannot still need it.
  const safe = (id) =>
    rank(id) <= 2 || (red(id) ? [0, 3] : [1, 2]).every((i) => home(i) >= rank(id) - 1);

  for (const k of [...T, 'waste']) {
    const c = top(k);
    if (c?.up && home(suit(c.id)) === rank(c.id) - 1 && safe(c.id))
      return { from: k, id: c.id, to: F[suit(c.id)] };
  }
  for (const k of T) {
    const at = st.p[k].findIndex((c) => c.up);
    if (at <= 0) continue;
    const c = st.p[k][at];
    for (const d of T) {
      const t = d === k ? null : top(d);
      if (t?.up && rank(c.id) === rank(t.id) - 1 && red(c.id) !== red(t.id))
        return { from: k, id: c.id, to: d };
    }
  }
  for (const k of T) {
    if (st.p[k].length) continue;
    for (const src of [...T, 'waste']) {
      if (src === k) continue;
      const at = st.p[src].findIndex((c) => c.up);
      if (at < 0 || (src !== 'waste' && at === 0)) continue;
      const c = src === 'waste' ? top(src) : st.p[src][at];
      if (rank(c.id) === 13) return { from: src, id: c.id, to: k };
    }
    break;
  }
  const w = top('waste');
  if (w) {
    for (const d of T) {
      const t = top(d);
      if (t?.up && rank(w.id) === rank(t.id) - 1 && red(w.id) !== red(t.id))
        return { from: 'waste', id: w.id, to: d };
    }
  }
  // Last resort: send anything that fits home, safe or not.
  for (const k of [...T, 'waste']) {
    const c = top(k);
    if (c?.up && home(suit(c.id)) === rank(c.id) - 1)
      return { from: k, id: c.id, to: F[suit(c.id)] };
  }
  return null;
}

test('deal 7 can be played all the way to a win', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'one full game is enough');
  test.setTimeout(120_000);

  const problems = [];
  page.on('pageerror', (e) => problems.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));

  await page.goto('/?deal=7');
  let st = await page.evaluate(readBoard);
  const seen = new Map();

  for (let step = 0; step < 400 && !st.canFinish && !st.won; step++) {
    const mv = nextMove(st);
    if (mv) {
      // A fanned card only exposes a strip at the top; click there, as a player would.
      await page.click(`[data-pile="${mv.from}"] .card[data-id="${mv.id}"]`, {
        position: { x: 14, y: 6 },
      });
      const dest = page.locator(`[data-pile="${mv.to}"]`);
      const stacked = await dest.locator('.card').count();
      if (stacked)
        await dest
          .locator('.card')
          .last()
          .click({ position: { x: 14, y: 6 } });
      else await dest.click({ position: { x: 14, y: 6 } });
    } else {
      const key = JSON.stringify(Object.entries(st.p).map(([k, v]) => [k, v.map((c) => c.id)]));
      const n = (seen.get(key) || 0) + 1;
      seen.set(key, n);
      expect(n, 'the bot is not stuck in a loop').toBeLessThan(4);
      await page.click('#stock');
    }
    st = await page.evaluate(readBoard);
  }

  // Nothing is face down any more, so the shortcut is on offer.
  expect(st.canFinish, 'Finish it is offered once the hand is open').toBe(true);
  await expect(page.locator('#btn-auto')).toBeVisible();

  await page.click('#btn-auto');

  // Winning pours the foundations off the table before the score appears.
  await page.waitForSelector('.card.is-falling', { timeout: 60_000 });
  const airborne = await page.locator('.card.is-falling').count();
  expect(airborne, 'all fifty-two cards take off').toBe(52);
  await expect(page.locator('#curtain'), 'the score waits for the cascade').toBeHidden();

  await expect(page.locator('#curtain')).toBeVisible({ timeout: 60_000 });

  for (let i = 0; i < 4; i++) {
    await expect(
      page.locator(`[data-pile="f${i}"] .card`),
      `foundation ${i} is complete`,
    ).toHaveCount(13);
  }
  await expect(page.locator('[data-pile="waste"] .card')).toHaveCount(0);
  await expect(page.locator('#stat-wins')).toHaveText('1');
  await expect(page.locator('#won-moves')).not.toHaveText('0');
  await expect(page.locator('#btn-again')).toBeFocused();

  // Undo cannot walk a finished hand back out of its win.
  await page.locator('#btn-undo').click({ force: true });
  expect(await page.evaluate(() => document.body.classList.contains('is-won'))).toBe(true);
  await expect(page.locator('[data-pile="f0"] .card')).toHaveCount(13);

  // The win screen deals a fresh hand and puts every card back on the table.
  await page.click('#btn-again');
  await expect(page.locator('#curtain')).toBeHidden();
  await expect(page.locator('.card')).toHaveCount(52);
  await expect(page.locator('.card.is-falling')).toHaveCount(0);
  await expect(page.locator('[data-pile="stock"] .card')).toHaveCount(24);
  await expect(page.locator('#stat-moves')).toHaveText('0');

  expect(problems).toEqual([]);
});
