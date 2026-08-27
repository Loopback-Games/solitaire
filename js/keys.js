/* Moving about the board without a pointer.
 *
 * Tabbing through fifty-two cards is reachable in the technical sense and
 * miserable in every other, so exactly one element on the board is in the tab
 * order at a time and the arrows move it.
 *
 * Everything in here works through the DOM the game already renders: a card you
 * may pick up is the one the game did not mark .is-dead, and pressing Enter on
 * a focused element is a click, which the game already knows what to do with.
 * So this file holds no rules and no state beyond where the cursor is.
 */

export function mountKeys({ board, piles, rows }) {
  // Which row, which pile along it, and how far up the fan — counted from the
  // last card back, because the last card is the one you normally want.
  let row = 1, col = 0, depth = 0;
  let held = false;
  // The element currently carrying the board's only 0. Moving the cursor does
  // not re-render, so the one it leaves has to be stood down by hand.
  let marked = null;

  const clampCol = (r, c) => Math.max(0, Math.min(c, rows[r].length - 1));
  const keyAt = (r, c) => rows[r][clampCol(r, c)];

  const grabbable = (k) =>
    [...piles[k].querySelectorAll('.card:not(.is-dead)')].filter((n) => !n.hidden);

  // An empty pile, or one holding nothing you may lift, is addressed as itself.
  function node() {
    const k = keyAt(row, col);
    const cards = grabbable(k);
    if (!cards.length) return piles[k];
    depth = Math.max(0, Math.min(depth, cards.length - 1));
    return cards[cards.length - 1 - depth];
  }

  function reach(k) {
    const cards = grabbable(k);
    return cards.length ? cards.length : 0;
  }

  /* render() clears every tabindex on the board; this hands the single 0 back
   * out. If a render took the focused card out from under the player — moved
   * to another pile, or covered — focus has fallen to the body, and it is
   * caught here rather than left there. */
  function refresh() {
    const target = node();
    if (marked && marked !== target) marked.tabIndex = -1;
    marked = target;
    target.tabIndex = 0;
    if (held && document.activeElement === document.body) target.focus({ preventScroll: true });
    return target;
  }

  const step = () => { held = true; refresh().focus({ preventScroll: true }); };

  function across(by) {
    col = (clampCol(row, col) + by + rows[row].length) % rows[row].length;
    depth = 0;
    step();
  }

  // Up walks the fan first and only changes row once there is no more fan to
  // walk; down does the reverse. Neither wraps, so the board has a top and a
  // bottom you can feel.
  function up() {
    if (row === 1 && depth < reach(keyAt(row, col)) - 1) depth += 1;
    else if (row > 0) { row -= 1; depth = 0; col = clampCol(row, col); }
    step();
  }

  function down() {
    if (row === 1 && depth > 0) depth -= 1;
    else if (row < rows.length - 1) { row += 1; depth = 0; col = clampCol(row, col); }
    step();
  }

  board.addEventListener('keydown', (ev) => {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    switch (ev.key) {
      case 'ArrowLeft':  across(-1); break;
      case 'ArrowRight': across(1); break;
      case 'ArrowUp':    up(); break;
      case 'ArrowDown':  down(); break;
      default: return;
    }
    ev.preventDefault();
  });

  /* The cursor follows the pointer: click a card and the arrows carry on from
   * there rather than from wherever they were left. */
  board.addEventListener('focusin', (ev) => {
    held = true;
    const host = ev.target.closest('[data-pile]');
    if (!host) return;
    for (let r = 0; r < rows.length; r++) {
      const c = rows[r].indexOf(host.dataset.pile);
      if (c < 0) continue;
      row = r;
      col = c;
      const cards = grabbable(host.dataset.pile);
      const at = cards.indexOf(ev.target);
      depth = at < 0 ? 0 : cards.length - 1 - at;
      return;
    }
  });

  board.addEventListener('focusout', (ev) => {
    if (ev.relatedTarget && !board.contains(ev.relatedTarget)) held = false;
  });

  return { refresh };
}
