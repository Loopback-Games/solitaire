/* Everything the table remembers between visits.
 *
 * One localStorage key holds four independent subtrees — what the player
 * prefers, how they have done, where the daily stands, and the hand in
 * progress. Each is replaced wholesale, so a write never has to merge deeply.
 * Private browsing throws on every call in here; the game plays fine without
 * it, it just forgets.
 */

const STORE = 'lbg.solitaire.v2';
const V1  = 'lbg.solitaire.v1';

// A best time or a best move count of 0 means "never yet", which is why every
// comparison against them tests for truthiness before it tests for smaller.
const base = () => ({
  v: 2,
  prefs: { drawN: 1, sound: false },
  stats: { played: 0, won: 0, streak: 0, bestStreak: 0, bestTime: 0, bestMoves: 0 },
  daily: null,
  game: null,
});

let cache = null;

function raw(key) {
  try { return JSON.parse(localStorage.getItem(key)); }
  catch { return null; }
}

function commit() {
  try { localStorage.setItem(STORE, JSON.stringify(cache)); }
  catch { /* private browsing — the game plays, it just forgets */ }
}

/* Subtrees are merged one level deep, so a payload written by an older build
 * gains any field added since without losing what it already held.
 *
 * Failing that, v1 is carried over: it held three flat values — drawN, wins and
 * best — and never counted losses, which makes the old win count the best
 * available answer for games played too. The old key is dropped only once the
 * new one is safely written, so a refused write cannot destroy the record. */
export function read() {
  if (cache) return cache;

  const found = raw(STORE);
  if (found && found.v === 2) {
    const b = base();
    cache = { ...b, ...found, prefs: { ...b.prefs, ...found.prefs }, stats: { ...b.stats, ...found.stats } };
    return cache;
  }

  cache = base();
  const old = raw(V1);
  if (old) {
    if (old.drawN === 3) cache.prefs.drawN = 3;
    cache.stats.won = Number(old.wins) || 0;
    cache.stats.played = cache.stats.won;
    cache.stats.bestTime = Number(old.best) || 0;
    commit();
    try { localStorage.removeItem(V1); } catch { /* nothing to clean up */ }
  }
  return cache;
}

export function write(patch) {
  cache = { ...read(), ...patch };
  commit();
}

/* The board is written on a debounce: autoplay renders every 110ms and there
 * is no reason for any of those frames but the last to reach the disk. */
let pending = null;
let queued = null;

export function saveGame(game) {
  queued = game;
  clearTimeout(pending);
  pending = setTimeout(flush, 250);
}

export function clearGame() {
  queued = null;
  clearTimeout(pending);
  pending = null;
  write({ game: null });
}

export function flush() {
  clearTimeout(pending);
  pending = null;
  if (queued) { write({ game: queued }); queued = null; }
}

// A tab can be discarded without ever firing unload, so the last board state is
// committed the moment the page is hidden rather than when it is closed.
addEventListener('pagehide', flush);
document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
