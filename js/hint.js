/* Which move to point at, and whether there is any move left at all.
 *
 * Nothing in here touches the DOM or moves a card. It reads the board and ranks
 * what is legal; the rule helpers it is handed read that same board, so the two
 * cannot drift apart about what is on the table.
 */

/* Every suffix of a tableau pile that lifts as one run, plus the top of the
 * waste. A card can legally be pulled back off a foundation, but a hint has no
 * business suggesting you undo your own progress, so foundations are not
 * sources. */
function sources(s, r) {
  const out = [];
  const w = r.top('waste');
  if (w !== undefined) out.push({ from: 'waste', at: s.waste.length - 1 });
  for (const k of r.TABLEAU) {
    for (let at = 0; at < s[k].length; at++) {
      if (r.liftable(k, at)) out.push({ from: k, at });
    }
  }
  return out;
}

// Everything the board can legally do right now, useful or not.
export function legal(s, r) {
  const out = [];
  for (const { from, at } of sources(s, r)) {
    const id = s[from][at];
    const run = s[from].length - at;
    for (const to of [...r.FOUNDS, ...r.TABLEAU]) {
      if (to === from) continue;
      // A foundation takes one card at a time; a run has to go to a column.
      if (run > 1 && r.FOUNDS.includes(to)) continue;
      if (r.fits(id, to)) out.push({ from, at, to });
    }
  }
  return out;
}

/* A tableau-to-tableau move earns its place by turning a card over or by
 * clearing a column. Anything else is a shuffle, and a shuffle the same ranking
 * would undo next turn is exactly how a hint ends up pointing in a circle. */
function useful(s, r, m) {
  if (r.FOUNDS.includes(m.to)) return true;
  if (m.from === 'waste') return true;
  if (m.at > 0) return !s.up[s[m.from][m.at - 1]];
  // The whole column is lifting, so it clears — unless it lands on another
  // empty column, which only changes which one is empty.
  return s[m.to].length > 0;
}

// Lower is better.
function score(s, r, m) {
  const id = s[m.from][m.at];
  const rank = r.rankOf(id);
  const home = r.FOUNDS.includes(m.to);

  // Turning a card over is the only move that reveals anything new.
  if (m.from !== 'waste' && m.at > 0 && !s.up[s[m.from][m.at - 1]]) return 0;
  // Low cards home early cost nothing and unblock the foundations.
  if (home && rank <= 2) return 1;
  // Emptying the waste keeps the stock moving.
  if (m.from === 'waste') return 2;
  // A king into a clear column is the only thing a clear column is for.
  if (rank === 13 && s[m.to].length === 0) return 3;
  // Any other card home may yet be wanted back, so it ranks below board work.
  if (home) return 4;
  return 5;
}

export function moves(s, r) {
  const list = legal(s, r)
    .filter((m) => useful(s, r, m))
    .map((m) => ({ ...m, score: score(s, r, m) }))
    .sort((a, b) => a.score - b.score);

  // Turning the stock is always available and always last: it is what you do
  // when the board itself has nothing better to offer.
  if (s.stock.length || s.waste.length) list.push({ deal: true, to: 'stock', score: 6 });
  return list;
}

/* A hand is over when nothing on the board can move and nothing in the stock or
 * the waste can be placed either. That second half is sound: dealing only
 * changes which waste card is on top, and every one of them has just been
 * tested against every pile.
 *
 * Pulling a card back off a foundation is deliberately not counted as an out.
 * With any ace home and its matching two exposed one always exists, so counting
 * it would make this answer "keep going" on virtually every dead board there
 * is. The panel this raises can be dismissed, so a board it calls wrongly costs
 * a tap and nothing else. */
export function dead(s, r) {
  if (legal(s, r).length) return false;
  for (const id of [...s.stock, ...s.waste]) {
    for (const to of [...r.FOUNDS, ...r.TABLEAU]) {
      if (r.fits(id, to)) return false;
    }
  }
  return true;
}
