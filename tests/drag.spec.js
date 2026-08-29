import { test, expect } from '@playwright/test';

const DEAL = '/?deal=7';
const centre = async (loc) => {
  const b = await loc.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

// Card positions are only meaningful once the deal has landed; measuring a
// card still in flight gives coordinates that are stale by the time we click.
const dealt = (page) => page.waitForFunction(() => !document.querySelector('.card.is-dealing'));

// A card part-covered by the one above it is only grabbable by its top strip,
// which is exactly where a player would take hold of it.
const strip = async (loc) => {
  const b = await loc.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + 6 };
};

// Drag with enough intermediate steps that the pointermove threshold is crossed.
async function dragTo(page, from, to) {
  const a = await centre(from);
  const b = await centre(to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(a.x + ((b.x - a.x) * i) / 8, a.y + ((b.y - a.y) * i) / 8);
  }
  await page.mouse.up();
}

test('a card can be dragged onto a legal pile', async ({ page }) => {
  await page.goto(DEAL);
  await dealt(page);

  const two = page.locator('[data-pile="t6"] .card').last();
  const three = page.locator('[data-pile="t5"] .card').last();
  await expect(two).toHaveAttribute('aria-label', '2 of spades');

  await dragTo(page, two, three);

  await expect(page.locator('[data-pile="t5"] .card')).toHaveCount(7);
  await expect(page.locator('[data-pile="t5"] .card').last()).toHaveAttribute(
    'aria-label',
    '2 of spades',
  );
  await expect(page.locator('[data-pile="t6"] .card')).toHaveCount(6);
  await expect(page.locator('#stat-moves')).toHaveText('1');
  await expect(page.locator('.card.is-dragging')).toHaveCount(0);
});

test('a card dropped somewhere illegal goes back', async ({ page }) => {
  await page.goto(DEAL);
  await dealt(page);

  const two = page.locator('[data-pile="t6"] .card').last();
  await dragTo(page, two, page.locator('[data-pile="t0"] .card').last());

  await expect(page.locator('[data-pile="t6"] .card')).toHaveCount(7);
  await expect(page.locator('[data-pile="t0"] .card')).toHaveCount(1);
  await expect(page.locator('#stat-moves')).toHaveText('0');
  await expect(page.locator('.card.is-picked')).toHaveCount(0);
});

test('dragging lights up the legal targets while the card is up', async ({ page }) => {
  await page.goto(DEAL);
  await dealt(page);

  const two = page.locator('[data-pile="t6"] .card').last();
  const a = await centre(two);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 40, a.y + 20);
  await page.mouse.move(a.x + 80, a.y + 40);

  await expect(two).toHaveClass(/is-dragging/);
  await expect(page.locator('[data-pile="t5"]')).toHaveClass(/is-target/);
  await expect(page.locator('.pile.is-target')).toHaveCount(1);

  await page.mouse.up();
});

test('a whole run drags together', async ({ page }) => {
  await page.goto(DEAL);
  await dealt(page);

  // Build 2-spades onto 3-diamonds, then move the pair as one.
  await page.locator('[data-pile="t6"] .card').last().click();
  await page.click('[data-pile="t5"]');
  await expect(page.locator('[data-pile="t5"] .card')).toHaveCount(7);

  const cards = page.locator('[data-pile="t5"] .card');
  const three = cards.nth(5);
  await expect(three).toHaveAttribute('aria-label', '3 of diamonds');

  // Grab the three by its exposed strip; the two on top must travel with it.
  const a = await strip(three);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 30, a.y + 30);
  await page.mouse.move(a.x + 60, a.y + 60);
  await expect(page.locator('.card.is-dragging')).toHaveCount(2);
  await page.mouse.up();
});

test('a press that never moves is still a click', async ({ page }) => {
  await page.goto(DEAL);
  await dealt(page);

  const two = page.locator('[data-pile="t6"] .card').last();
  const a = await centre(two);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 2, a.y + 1); // inside the slop threshold
  await page.mouse.up();

  await expect(two).toHaveClass(/is-picked/);
  await expect(page.locator('#stat-moves')).toHaveText('0');
});

test('touch drags the same way a mouse does', async ({ page }) => {
  await page.goto(DEAL);
  await dealt(page);
  const two = page.locator('[data-pile="t6"] .card').last();

  const a = await centre(two);
  const b = await centre(page.locator('[data-pile="t5"] .card').last());

  await page.evaluate(
    async ([from, to]) => {
      const at = document.elementFromPoint(from.x, from.y);
      const send = (type, x, y, target) =>
        target.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId: 1,
            pointerType: 'touch',
            isPrimary: true,
            clientX: x,
            clientY: y,
            button: 0,
          }),
        );
      send('pointerdown', from.x, from.y, at);
      for (let i = 1; i <= 8; i++) {
        send(
          'pointermove',
          from.x + ((to.x - from.x) * i) / 8,
          from.y + ((to.y - from.y) * i) / 8,
          window,
        );
      }
      send('pointerup', to.x, to.y, window);
    },
    [a, b],
  );

  await expect(page.locator('[data-pile="t5"] .card')).toHaveCount(7);
  await expect(page.locator('#stat-moves')).toHaveText('1');
});

/* --- landing and sound --------------------------------------------------- */

test('a dropped card lands rather than teleports', async ({ page }) => {
  await page.goto(DEAL);
  await dealt(page);

  const two = page.locator('[data-pile="t6"] .card').last();
  const three = page.locator('[data-pile="t5"] .card').last();

  // Catch the snap in flight: the card is already in its new pile, but is
  // still carrying the offset that puts it back under the pointer.
  const snapping = page.waitForFunction(
    () => {
      const card = document.querySelector('.card.is-snapping');
      return !!card && card.closest('[data-pile]').dataset.pile === 't5';
    },
    null,
    { timeout: 2000 },
  );

  await dragTo(page, two, three);
  await snapping;

  // And it cleans up after itself rather than leaving a transform behind.
  await expect(page.locator('.card.is-snapping')).toHaveCount(0, { timeout: 2000 });
  const left = await page
    .locator('[data-pile="t5"] .card')
    .last()
    .evaluate((c) => c.style.getPropertyValue('--dx'));
  expect(left).toBe('');
});

test('a rejected drop is carried back instead of vanishing', async ({ page }) => {
  await page.goto(DEAL);
  await dealt(page);

  const two = page.locator('[data-pile="t6"] .card').last();
  const snapping = page.waitForFunction(
    () => {
      const card = document.querySelector('.card.is-snapping');
      return !!card && card.closest('[data-pile]').dataset.pile === 't6';
    },
    null,
    { timeout: 2000 },
  );

  await dragTo(page, two, page.locator('[data-pile="t0"] .card').last());
  await snapping;
  await expect(page.locator('.card.is-snapping')).toHaveCount(0, { timeout: 2000 });
  await expect(page.locator('[data-pile="t6"] .card')).toHaveCount(7);
});

test('reduced motion drops the card straight home', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(DEAL);
  await dealt(page);

  let sawSnap = false;
  const watch = setInterval(async () => {
    sawSnap = sawSnap || (await page.locator('.card.is-snapping').count()) > 0;
  }, 10);

  await dragTo(
    page,
    page.locator('[data-pile="t6"] .card').last(),
    page.locator('[data-pile="t5"] .card').last(),
  );
  clearInterval(watch);

  expect(sawSnap, 'nothing is animated when animation is switched off').toBe(false);
  await expect(page.locator('[data-pile="t5"] .card')).toHaveCount(7);
});

test('a dragged run rides above the finger on a touchscreen', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'the lift only applies to a coarse pointer');
  await page.goto(DEAL);
  await dealt(page);

  const card = page.locator('[data-pile="t6"] .card').last();
  const box = await card.boundingBox();
  // --lift computes to an unresolved calc(), so measure where the card lands.
  const lifted = await card.evaluate((c) => {
    c.classList.add('is-dragging');
    const y = c.getBoundingClientRect().top;
    c.classList.remove('is-dragging');
    return y;
  });
  expect(box.y - lifted, 'the run sits clear of the touch point').toBeGreaterThan(10);
});

test('sound is off until asked for, and then remembered', async ({ page }) => {
  await page.addInitScript(() => {
    // Record whether anything ever tried to open an audio context.
    const Real = window.AudioContext;
    window.__audioBuilt = 0;
    window.AudioContext = class extends Real {
      constructor(...args) {
        super(...args);
        window.__audioBuilt++;
      }
    };
  });
  await page.goto(DEAL);

  await page.click('#btn-more');
  await expect(page.locator('[data-sound="off"]')).toHaveAttribute('aria-pressed', 'true');
  await page.click('#btn-sheet-done');

  await page.click('#stock');
  expect(
    await page.evaluate(() => window.__audioBuilt),
    'a silent game never opens an audio context',
  ).toBe(0);

  await page.click('#btn-more');
  await page.click('[data-sound="on"]');
  await expect(page.locator('[data-sound="on"]')).toHaveAttribute('aria-pressed', 'true');
  await page.click('#btn-sheet-done');
  await page.click('#stock');
  expect(
    await page.evaluate(() => window.__audioBuilt),
    'the click that switches it on is the gesture that starts it',
  ).toBeGreaterThan(0);

  await page.reload();
  await page.click('#btn-more');
  await expect(page.locator('[data-sound="on"]')).toHaveAttribute('aria-pressed', 'true');
});
