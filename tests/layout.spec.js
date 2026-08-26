import { test, expect } from '@playwright/test';

const DEAL = '/?deal=7';

test('the board fits the viewport without scrolling', async ({ page }) => {
  await page.goto(DEAL);
  await page.waitForTimeout(800);

  const fit = await page.evaluate(() => ({
    overflowX: document.documentElement.scrollWidth - window.innerWidth,
    overflowY: document.documentElement.scrollHeight - window.innerHeight,
  }));
  expect(fit.overflowX, 'nothing spills off the side').toBeLessThanOrEqual(0);
  expect(fit.overflowY, 'nothing spills off the bottom').toBeLessThanOrEqual(0);

  // Every pile sits inside the visible board.
  const stray = await page.evaluate(() => {
    const bad = [];
    document.querySelectorAll('[data-pile]').forEach((p) => {
      const r = p.getBoundingClientRect();
      if (r.left < -1 || r.right > window.innerWidth + 1) bad.push(p.dataset.pile);
    });
    return bad;
  });
  expect(stray).toEqual([]);
});

test('the longest possible column still clears the controls', async ({ page }) => {
  await page.goto(DEAL);

  // The worst column Klondike can build is six face-down cards under a full
  // king-to-ace run: 6 x 0.42 + 13 = 15.52 units. Probe past that, at 19.
  const room = await page.evaluate(() => {
    const t = document.querySelector('[data-pile="t0"]');
    t.style.setProperty('--n', 19);
    const probe = document.createElement('div');
    probe.style.height = getComputedStyle(t).getPropertyValue('--fan');
    t.appendChild(probe);
    const fan = probe.getBoundingClientRect().height;
    probe.remove();
    t.style.removeProperty('--n');

    const card = document.querySelector('.pile-tableau .card').getBoundingClientRect().height;
    return {
      fan,
      worst: t.getBoundingClientRect().top + 18 * fan + card,
      rail: document.querySelector('.rail-bottom').getBoundingClientRect().top,
    };
  });

  expect(room.fan, 'the fan never collapses to nothing').toBeGreaterThan(3);
  expect(room.worst, 'a nineteen-unit column stays above the controls').toBeLessThanOrEqual(room.rail);
});

test('cards carry names and face-down cards stay out of the tab order', async ({ page }) => {
  await page.goto(DEAL);

  await expect(page.locator('[data-pile="t6"] .card').last()).toHaveAttribute('aria-label', '2 of spades');
  await expect(page.locator('[data-pile="t6"] .card').first()).toHaveAttribute('aria-label', 'Face-down card');

  const reachable = await page.evaluate(() =>
    [...document.querySelectorAll('.card')].filter((c) => c.tabIndex === 0).length);
  // Only the seven exposed cards can be picked up on the opening deal.
  expect(reachable).toBe(7);

  const buried = await page.evaluate(() =>
    [...document.querySelectorAll('.card:not(.is-up)')].every((c) => c.tabIndex === -1));
  expect(buried, 'no face-down card is focusable').toBe(true);
});

test('a card can be moved with the keyboard alone', async ({ page }) => {
  await page.goto(DEAL);

  const two = page.locator('[data-pile="t6"] .card').last();
  await two.focus();
  await page.keyboard.press('Enter');
  await expect(two).toHaveClass(/is-picked/);

  const target = page.locator('[data-pile="t5"]');
  await expect(target).toHaveAttribute('role', 'button');
  await target.focus();
  await page.keyboard.press('Enter');

  await expect(page.locator('[data-pile="t5"] .card')).toHaveCount(7);
  await expect(page.locator('#stat-moves')).toHaveText('1');

  // Escape drops a selection.
  await page.locator('[data-pile="t5"] .card').last().click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.card.is-picked')).toHaveCount(0);
});

test('the live region reports what happened', async ({ page }) => {
  await page.goto(DEAL);
  await page.locator('[data-pile="t6"] .card').last().click();
  await expect(page.locator('#announce')).toHaveText('2 of spades selected.');
  await page.click('[data-pile="t5"]');
  await expect(page.locator('#announce')).toHaveText('2 of spades moved.');
});

test('the skip link reaches the board', async ({ page }) => {
  await page.goto(DEAL);
  await page.keyboard.press('Tab');
  await expect(page.locator('.skip')).toBeFocused();
  await expect(page.locator('.skip')).toBeInViewport();
});

test('reduced motion turns the animation off', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(DEAL);
  const duration = await page.evaluate(() =>
    getComputedStyle(document.querySelector('.card')).transitionDuration);
  expect(parseFloat(duration)).toBeLessThan(0.01);
});

test('every card face renders a rank and a suit', async ({ page }) => {
  await page.goto(DEAL);
  const faces = await page.evaluate(() =>
    [...document.querySelectorAll('.card')].map((c) => ({
      id: +c.dataset.id,
      idx: c.querySelector('.idx').textContent.trim(),
      art: c.querySelector('.art').textContent.trim(),
      colour: c.dataset.color,
    })));

  expect(faces).toHaveLength(52);
  const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  for (const f of faces) {
    const rank = ranks[f.id % 13];
    const suit = ['♠', '♥', '♦', '♣'][(f.id / 13) | 0];
    expect(f.idx, `card ${f.id} indexes as ${rank}${suit}`).toBe(`${rank}${suit}︎`);
    expect(f.art, `card ${f.id} has centre art`).not.toBe('');
    expect(f.colour).toBe((f.id / 13 | 0) === 1 || (f.id / 13 | 0) === 2 ? 'r' : 'b');
  }
});

test('no face-down card ever shows its face while the hand is dealt', async ({ page }) => {
  await page.goto(DEAL);
  await page.waitForFunction(() => !document.querySelector('.card.is-dealing'));
  await page.click('#btn-new');

  // Sample right through the deal animation rather than after it.
  let caught = [];
  for (let i = 0; i < 14; i++) {
    await page.waitForTimeout(35);
    caught = await page.evaluate(() => {
      const bad = [];
      for (const c of document.querySelectorAll('.card')) {
        if (c.classList.contains('is-up')) continue;
        const cs = getComputedStyle(c);
        // A card with no box cannot be seen; the buried stack is drawn as none.
        if (cs.display === 'none' || !c.getClientRects().length) continue;
        // m11 is cos of the Y-rotation: positive means turned toward the reader.
        if (new DOMMatrix(cs.transform).m11 > 0) bad.push(`${c.dataset.id} turned toward us`);
        // A grouping property forces transform-style to flat, which defeats
        // backface-visibility and shows the face mirrored. getComputedStyle
        // still reports preserve-3d in that state, so test the causes instead.
        const grouping =
          cs.opacity !== '1' || cs.filter !== 'none' || cs.mixBlendMode !== 'normal' ||
          cs.clipPath !== 'none' || cs.maskImage !== 'none' || cs.contain.includes('paint');
        if (grouping) bad.push(`${c.dataset.id} flattened by a grouping property`);
      }
      return bad;
    });
    if (caught.length) break;
  }
  expect(caught, 'the deal never exposes a card').toEqual([]);
});

test('no large card art is sliced by the card fanned over it', async ({ page }) => {
  await page.goto(DEAL);
  await page.waitForFunction(() => !document.querySelector('.card.is-dealing'));

  const intruding = await page.evaluate(() => {
    const t = document.querySelector('[data-pile="t0"]');
    const probe = document.createElement('div');
    probe.style.height = getComputedStyle(t).getPropertyValue('--fan');
    t.appendChild(probe);
    const fan = probe.getBoundingClientRect().height;
    probe.remove();

    const bad = [];
    for (const c of document.querySelectorAll('.card')) {
      c.classList.add('is-up');
      const top = c.getBoundingClientRect().top;
      // Pips are small discrete marks and read as texture when clipped. Rings
      // and letters are single large shapes and must clear the strip whole.
      for (const a of c.querySelectorAll('.art-ace, .art-court b, .art-court i, .art-big b, .art-big i')) {
        if (getComputedStyle(a).display === 'none' || !a.getClientRects().length) continue;
        if (a.getBoundingClientRect().top - top < fan) bad.push(c.getAttribute('aria-label'));
      }
    }
    return bad;
  });
  expect(intruding).toEqual([]);
});

test('the index stays readable on a small card', async ({ page }) => {
  await page.goto(DEAL);
  const px = await page.evaluate(() =>
    parseFloat(getComputedStyle(document.querySelector('.idx')).fontSize));
  expect(px, 'rank is legible at any card size').toBeGreaterThanOrEqual(12);
});

/* --- the sheet ---------------------------------------------------------- */

test('the rail survives a narrow phone, Finish it and all', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto(DEAL);

  // Finish it only appears on a solved board, so force it out to measure the
  // widest the rail ever gets.
  await page.evaluate(() => { document.querySelector('#btn-auto').hidden = false; });

  const rail = await page.evaluate(() => {
    const bar = document.querySelector('.rail-bottom');
    const box = bar.getBoundingClientRect();
    const kids = [...bar.querySelectorAll('button')].filter((b) => !b.hidden);
    return {
      count: kids.length,
      spill: kids.some((b) => {
        const r = b.getBoundingClientRect();
        return r.left < box.left - 1 || r.right > box.right + 1;
      }),
      rows: new Set(kids.map((b) => Math.round(b.getBoundingClientRect().top))).size,
    };
  });

  expect(rail.count, 'New, Undo, Redo, Hint, Finish it and More').toBe(6);
  expect(rail.spill, 'no control hangs off the rail').toBe(false);
  expect(rail.rows, 'the rail stays one row').toBe(1);
});

test('the sheet opens, holds focus, and closes on Esc', async ({ page }) => {
  await page.goto(DEAL);
  await expect(page.locator('#sheet')).toBeHidden();
  await expect(page.locator('#btn-more')).toHaveAttribute('aria-expanded', 'false');

  await page.click('#btn-more');
  await expect(page.locator('#sheet')).toBeVisible();
  await expect(page.locator('#btn-more')).toHaveAttribute('aria-expanded', 'true');

  // The panel is centred by auto margins, not by a transform an animation
  // would overwrite, so it has to sit inside the viewport on every width.
  for (const width of [360, 412, 1280]) {
    await page.setViewportSize({ width, height: 740 });
    const box = await page.locator('#sheet').boundingBox();
    expect(box.x, `left edge at ${width}px`).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, `right edge at ${width}px`).toBeLessThanOrEqual(width + 1);
    expect(Math.abs((box.x + box.width / 2) - width / 2), `centred at ${width}px`).toBeLessThan(2);
  }

  // Tab cycles inside the panel rather than escaping to the board behind it.
  const stops = await page.locator('#sheet button').count();
  for (let i = 0; i < stops + 2; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement.closest('#sheet'))).toBe(true);
  }

  await page.keyboard.press('Escape');
  await expect(page.locator('#sheet')).toBeHidden();
  await expect(page.locator('#btn-more')).toBeFocused();
});

test('the sheet swallows the game shortcuts while it is up', async ({ page }) => {
  await page.goto(DEAL);
  await page.click('#stock');
  await expect(page.locator('#stat-moves')).toHaveText('1');

  await page.click('#btn-more');
  // N would deal a new hand behind the panel; while it is up, nothing happens.
  await page.keyboard.press('n');
  await page.keyboard.press('u');
  await expect(page.locator('#stat-moves')).toHaveText('1');

  await page.click('#sheet-veil', { position: { x: 5, y: 5 } });
  await expect(page.locator('#sheet')).toBeHidden();
  await page.keyboard.press('u');
  await expect(page.locator('#stat-moves')).toHaveText('0');
});

test('the record reports what the player has actually done', async ({ page }) => {
  await page.goto(DEAL);
  await page.click('#btn-more');
  await expect(page.locator('#rec-played')).toHaveText('0');
  await expect(page.locator('#rec-rate'), 'no games means no rate to quote').toHaveText('—');
  await expect(page.locator('#rec-best-time')).toHaveText('—');
  await page.click('#btn-sheet-done');

  await page.click('#stock');
  await page.click('#btn-more');
  await expect(page.locator('#rec-played')).toHaveText('1');
  await expect(page.locator('#rec-won')).toHaveText('0');
  await expect(page.locator('#rec-rate')).toHaveText('0%');
});
