/* Klondike solitaire — Loopback Games
 *
 * No framework, no build step, no dependencies. This module owns game state
 * and decides which pile each card belongs to; the stylesheet owns every pixel.
 * Moving a card is `pile.appendChild(el)` plus one custom property, so layout,
 * fan spacing, flips and animation stay in CSS where they can respond to the
 * viewport without asking JavaScript.
 */
import { read, write, saveGame, clearGame } from './store.js';
import { moves, dead } from './hint.js';

/* ------------------------------------------------------------- deck --- */

// U+FE0E keeps hearts and diamonds as text on phones that would otherwise
// swap in a colour emoji.
const SUITS = ['♠︎', '♥︎', '♦︎', '♣︎'];
const RANKS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const COURT = { 11: 'J', 12: 'Q', 13: 'K' };

const suitOf = (id) => (id / 13) | 0;
const rankOf = (id) => (id % 13) + 1;
const isRed  = (id) => suitOf(id) === 1 || suitOf(id) === 2;

const TABLEAU = ['t0', 't1', 't2', 't3', 't4', 't5', 't6'];
const FOUNDS  = ['f0', 'f1', 'f2', 'f3'];
const KEYS    = ['stock', 'waste', ...FOUNDS, ...TABLEAU];

/* ---------------------------------------------------------------- dom --- */

const $ = (sel) => document.querySelector(sel);

const piles = {};
KEYS.forEach((k) => { piles[k] = document.querySelector(`[data-pile="${k}"]`); });

const el = {
  board:     $('#board'),
  time:      $('#stat-time'),
  moves:     $('#stat-moves'),
  wins:      $('#stat-wins'),
  count:     $('#stock-count'),
  undo:      $('#btn-undo'),
  redo:      $('#btn-redo'),
  hint:      $('#btn-hint'),
  auto:      $('#btn-auto'),
  stuck:     $('#stuck'),
  more:      $('#btn-more'),
  sheet:     $('#sheet'),
  veil:      $('#sheet-veil'),
  done:      $('#btn-sheet-done'),
  copy:      $('#btn-copy'),
  replay:    $('#btn-replay'),
  daily:     $('#btn-daily'),
  dealNum:   $('#deal-num'),
  bestLabel: $('#won-best-label'),
  curtain:   $('#curtain'),
  wonTime:   $('#won-time'),
  wonMoves:  $('#won-moves'),
  wonBest:   $('#won-best'),
  announce:  $('#announce'),
};

const segs = [...document.querySelectorAll('[data-draw]')];
const dailyView = {
  state:  $('#daily-state'),
  streak: $('#daily-streak'),
  best:   $('#daily-best'),
};

const record = {
  played:     $('#rec-played'),
  won:        $('#rec-won'),
  rate:       $('#rec-rate'),
  streak:     $('#rec-streak'),
  bestStreak: $('#rec-best-streak'),
  bestTime:   $('#rec-best-time'),
  bestMoves:  $('#rec-best-moves'),
};

// One element per card, built once and re-parented forever after.
const cards = Array.from({ length: 52 }, (_, id) => build(id));

function build(id) {
  const rank = rankOf(id), suit = suitOf(id);
  const node = document.createElement('button');
  node.type = 'button';
  node.className = 'card';
  node.dataset.id = id;
  node.dataset.color = isRed(id) ? 'r' : 'b';

  // Three kinds of face: an ace, a court card, or a pipped number. Numbers
  // carry both a pip layout and a large rank; the stylesheet picks whichever
  // suits the card's size, because pips turn to mush on a phone.
  let art;
  if (rank === 1) {
    art = `<span class="art-ace">${SUITS[suit]}</span>`;
  } else if (rank > 10) {
    art = `<span class="art-court"><b>${COURT[rank]}</b><i>${SUITS[suit]}</i></span>`;
  } else {
    art = `<span class="art-pips" data-rank="${rank}">` +
          `<span>${SUITS[suit]}</span>`.repeat(rank) + `</span>` +
          `<span class="art-big"><b>${RANKS[rank]}</b><i>${SUITS[suit]}</i></span>`;
  }

  const index = `<span class="idx"><span class="rank">${RANKS[rank]}</span>` +
                `<span class="pip">${SUITS[suit]}</span></span>`;

  node.innerHTML =
    `<span class="face">${index}<span class="art">${art}</span>` +
    `${index.replace('class="idx"', 'class="idx idx-b"')}</span>` +
    `<span class="back"></span>`;
  return node;
}

const name = (id) => `${RANKS[rankOf(id)]} of ${['spades','hearts','diamonds','clubs'][suitOf(id)]}`;

/* -------------------------------------------------------------- state --- */

let s, history, redo, sel, timer, autoTimer, startedAt, elapsed;
let drag = null, swallowClick = false, curtainTimer = null;

// The number that produced the hand on the table, and whether that hand has
// been counted as played — a resumed game must not be counted a second time.
let dealSeed = 0, counted = false, isDaily = false;
// The move currently being pointed at, how far down the ranked list the player
// has pressed, and whether this hand has already been called dead.
let hint = null, hintAt = 0, hintTimer = null, stuckShown = false;

let drawN = read().prefs.drawN === 3 ? 3 : 1;

function fresh(seed = newSeed(), daily = false) {
  // Restarting today's puzzle is the same as walking every move back, so it
  // does not spend the day. Anything else retires the hand on the table.
  const sameDaily = daily && isDaily && (seed >>> 0) === dealSeed;
  if (!sameDaily) abandon();
  isDaily = daily;
  dealSeed = seed >>> 0;
  const deck = [...Array(52).keys()];
  const roll = mulberry32(dealSeed);
  for (let i = 51; i > 0; i--) {
    const j = roll(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  s = { up: new Array(52).fill(false), moves: 0 };
  KEYS.forEach((k) => { s[k] = []; });

  for (let col = 0; col < 7; col++) {
    for (let row = 0; row <= col; row++) {
      const id = deck.pop();
      s[TABLEAU[col]].push(id);
      if (row === col) s.up[id] = true;
    }
  }
  s.stock = deck;

  history = [];
  redo = [];
  sel = null;
  drag = null;
  elapsed = 0;
  startedAt = null;
  counted = false;
  dropHint();
  stuckShown = false;
  el.stuck.hidden = true;
  el.time.textContent = clock(0);
  stopTimer();
  stopAuto();
  clearTimeout(curtainTimer);
  cards.forEach((c) => {
    c.classList.remove('is-falling', 'is-dealing', 'is-dragging');
    c.removeAttribute('style');
  });
  document.body.classList.remove('is-won');
  el.curtain.hidden = true;
  render({ deal: true });
}

/* Every hand has a number, so every hand can be replayed, shared or resumed.
 * ?deal=<n> asks for one by name; without it the number comes from the system
 * random source and is kept alongside the board.
 *
 * The trade: seeding a 32-bit generator puts about four billion hands within
 * reach rather than all 52!, which is no constraint whatsoever on a card table
 * and is the price of a deal you can name.
 *
 * mulberry32 — small, fast, and good enough to shuffle a deck with. */
function mulberry32(n) {
  let a = (n >>> 0) + 0x6D2B79F5;
  return (max) => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296 * max) | 0;
  };
}

function newSeed() {
  if (window.crypto && crypto.getRandomValues) {
    return crypto.getRandomValues(new Uint32Array(1))[0];
  }
  return Math.floor(Math.random() * 0x100000000);
}

const snapshot = () => ({
  up: [...s.up],
  moves: s.moves,
  piles: KEYS.map((k) => [...s[k]]),
});

function push() {
  history.push(snapshot());
  if (history.length > 200) history.shift();
  // Playing on abandons whatever branch you had walked back from.
  redo.length = 0;
  dropHint();
}

// Restoring a snapshot is not itself a move, so neither stack is disturbed
// beyond the one that moves between them.
function apply(shot) {
  dropHint();
  stuckShown = false;
  s.up = shot.up;
  s.moves = shot.moves;
  KEYS.forEach((k, i) => { s[k] = shot.piles[i]; });
  sel = null;
  render();
}

function undo() {
  // Once the cards are in the air the hand is over; there is nothing to walk back.
  if (document.body.classList.contains('is-won')) return;
  const prev = history.pop();
  if (!prev) return;
  stopAuto();
  redo.push(snapshot());
  apply(prev);
  say('Move undone.');
}

function redoMove() {
  if (document.body.classList.contains('is-won')) return;
  const next = redo.pop();
  if (!next) return;
  stopAuto();
  history.push(snapshot());
  apply(next);
  say('Move redone.');
}

/* --------------------------------------------------------- continuity --- */

const liveSecs = () => (startedAt ? Math.floor((Date.now() - startedAt) / 1000) : elapsed);

// Both walk-back stacks are capped before they reach the disk. Fifty snapshots
// is far more than anyone walks back, and keeps the payload near 25KB.
const CAP = 50;

function persist() {
  if (!s || document.body.classList.contains('is-won')) return;
  saveGame({
    seed: dealSeed,
    isDaily,
    drawN,
    counted,
    elapsed: liveSecs(),
    current: snapshot(),
    history: history.slice(-CAP),
    redo: redo.slice(-CAP),
  });
}

function restore(g) {
  drawN = g.drawN === 3 ? 3 : 1;
  dealSeed = g.seed >>> 0;
  isDaily = !!g.isDaily;

  s = { up: g.current.up, moves: g.current.moves };
  KEYS.forEach((k, i) => { s[k] = g.current.piles[i]; });
  history = Array.isArray(g.history) ? g.history : [];
  redo = Array.isArray(g.redo) ? g.redo : [];
  elapsed = Number(g.elapsed) || 0;
  counted = !!g.counted;

  sel = null;
  drag = null;
  startedAt = null;
  stopTimer();
  stopAuto();
  clearTimeout(curtainTimer);
  cards.forEach((c) => {
    c.classList.remove('is-falling', 'is-dealing', 'is-dragging');
    c.removeAttribute('style');
  });
  document.body.classList.remove('is-won');
  el.curtain.hidden = true;

  paintDraw();
  el.time.textContent = clock(elapsed);
  render();
  // The clock picks up again only for a hand that had already started.
  if (counted) startTimer();
}

/* The payload is our own, but it can still be truncated, hand-edited, or left
 * behind by a build that wrote a different shape. Anything short of a complete
 * fifty-two card board is discarded in favour of a fresh deal. */
function intact(g) {
  if (!g || !g.current || !Number.isFinite(g.seed)) return false;
  if (!Array.isArray(g.current.piles) || g.current.piles.length !== KEYS.length) return false;
  if (!Array.isArray(g.current.up) || g.current.up.length !== 52) return false;

  const seen = new Set();
  for (const pile of g.current.piles) {
    if (!Array.isArray(pile)) return false;
    for (const id of pile) {
      if (!Number.isInteger(id) || id < 0 || id > 51 || seen.has(id)) return false;
      seen.add(id);
    }
  }
  if (seen.size !== 52) return false;

  // A finished hand is not worth coming back to.
  return FOUNDS.reduce((n, k) => n + g.current.piles[KEYS.indexOf(k)].length, 0) < 52;
}

/* -------------------------------------------------------------- daily --- */

/* Today's puzzle is one hand, fixed by the date, that everyone gets. You may
 * walk it back as far as you like, but you get one shuffle: a streak you can
 * retry into is not a streak. */

const stamp = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Local midnight, not UTC — the puzzle should turn over on the player's day.
const today = () => stamp(new Date());

function dayBefore(day) {
  const t = new Date(`${day}T00:00:00`);
  t.setDate(t.getDate() - 1);
  return stamp(t);
}

const dailySeed = (day) => Number(day.replaceAll('-', ''));

/* Rolling onto a new day carries the streak only from a day that was actually
 * won, and only from the day immediately before — a day skipped and a day lost
 * both end the run. */
function rollDaily() {
  const day = today();
  const prev = read().daily;
  if (prev && prev.day === day) return prev;

  const carried = !!prev && prev.result === 'won' && prev.day === dayBefore(day);
  const next = {
    day,
    result: 'playing',
    streak: carried ? prev.streak : 0,
    bestStreak: prev ? prev.bestStreak : 0,
  };
  write({ daily: next });
  return next;
}

// Only a day still in play can be settled; replaying a finished day changes
// nothing either way.
function settleDaily(result) {
  const d = read().daily;
  if (!d || d.day !== today() || d.result !== 'playing') return;

  if (result === 'won') {
    const streak = d.streak + 1;
    write({ daily: { ...d, result: 'won', streak, bestStreak: Math.max(streak, d.bestStreak) } });
  } else {
    write({ daily: { ...d, result: 'lost', streak: 0 } });
  }
}

/* ------------------------------------------------------------- record --- */

/* A hand counts as played the moment the first card moves, not when it is
 * dealt — idly opening the tab never dents the record. */
function begin() {
  if (!startedAt) startTimer();
  if (counted) return;
  counted = true;
  // The daily keeps its own record and never touches the freeplay one.
  if (isDaily) return;
  const stats = read().stats;
  write({ stats: { ...stats, played: stats.played + 1 } });
}

/* Walking away from a started hand breaks the streak. It was already counted
 * as played, so a loss needs no column of its own: it is played minus won. */
function abandon() {
  if (!counted || won()) return;
  if (isDaily) { settleDaily('lost'); return; }
  write({ stats: { ...read().stats, streak: 0 } });
}

/* -------------------------------------------------------------- rules --- */

const top = (k) => s[k][s[k].length - 1];

function fitsFoundation(id, k) {
  const i = FOUNDS.indexOf(k);
  return suitOf(id) === i && rankOf(id) === s[k].length + 1;
}

function fitsTableau(id, k) {
  const t = top(k);
  if (t === undefined) return rankOf(id) === 13;
  return s.up[t] && rankOf(id) === rankOf(t) - 1 && isRed(id) !== isRed(t);
}

const fits = (id, k) => (FOUNDS.includes(k) ? fitsFoundation(id, k) : TABLEAU.includes(k) && fitsTableau(id, k));

// A tableau card can be lifted only with every card resting on it, and only
// if that whole run already descends in alternating colours.
function liftable(k, from) {
  const pile = s[k];
  if (!s.up[pile[from]]) return false;
  for (let i = from; i < pile.length - 1; i++) {
    const a = pile[i], b = pile[i + 1];
    if (!s.up[b] || rankOf(b) !== rankOf(a) - 1 || isRed(a) === isRed(b)) return false;
  }
  return true;
}

function canDrop(target) {
  if (!sel || sel.from === target) return false;
  const run = s[sel.from].slice(sel.at);
  if (run.length > 1 && FOUNDS.includes(target)) return false;
  return fits(run[0], target);
}

function move(from, at, to) {
  push();
  const run = s[from].splice(at);
  s[to].push(...run);
  reveal(from);
  s.moves++;
  begin();
  return run;
}

// Klondike turns the newly exposed tableau card face up for you.
function reveal(k) {
  if (!TABLEAU.includes(k)) return;
  const t = top(k);
  if (t !== undefined && !s.up[t]) s.up[t] = true;
}

function deal() {
  begin();
  push();
  if (s.stock.length) {
    for (let i = 0; i < drawN && s.stock.length; i++) {
      const id = s.stock.pop();
      s.up[id] = true;
      s.waste.push(id);
    }
    say(`Dealt ${Math.min(drawN, s.waste.length)}.`);
  } else if (s.waste.length) {
    s.stock = s.waste.reverse();
    s.waste = [];
    s.stock.forEach((id) => { s.up[id] = false; });
    say('Stock refilled.');
  } else {
    history.pop();
    return;
  }
  s.moves++;
  sel = null;
  render();
  checkStuck();
}

/* ---------------------------------------------------------- selection --- */

function pick(key, id) {
  const pile = s[key];
  const at = pile.indexOf(id);
  if (at < 0) return false;

  if (TABLEAU.includes(key)) {
    if (!liftable(key, at)) return false;
  } else if (at !== pile.length - 1 || !s.up[id]) {
    return false;
  }

  sel = { from: key, at };
  render();
  say(`${name(id)} selected.`);
  return true;
}

function place(target) {
  if (!canDrop(target)) return false;
  const run = move(sel.from, sel.at, target);
  sel = null;
  render({ home: FOUNDS.includes(target) ? target : null });
  say(`${name(run[0])} moved.`);
  finish();
  checkStuck();
  return true;
}

// Double click / double tap: shortcut the card straight to its foundation.
function sendHome(key, id) {
  if (id !== top(key)) return false;
  const target = FOUNDS[suitOf(id)];
  if (!fitsFoundation(id, target)) return false;
  move(key, s[key].length - 1, target);
  sel = null;
  render({ home: target });
  say(`${name(id)} home.`);
  finish();
  checkStuck();
  return true;
}

/* ------------------------------------------------------------ finish --- */

const won = () => FOUNDS.every((k) => s[k].length === 13);

// Offer the shortcut once nothing is hidden — from there the game is solved.
const solved = () => TABLEAU.every((k) => s[k].every((id) => s.up[id]));

function autoStep() {
  for (const k of [...TABLEAU, 'waste']) {
    const id = top(k);
    if (id === undefined) continue;
    const target = FOUNDS[suitOf(id)];
    if (s.up[id] && fitsFoundation(id, target)) {
      move(k, s[k].length - 1, target);
      render({ home: target });
      return true;
    }
  }
  if (s.stock.length || s.waste.length) { deal(); return true; }
  return false;
}

function startAuto() {
  if (autoTimer) return;
  sel = null;
  let idle = 0;
  autoTimer = setInterval(() => {
    if (won()) { stopAuto(); finish(); return; }
    // Dealing alone is not progress; if a full pass round the stock moves
    // nothing to a foundation, there is nothing left to do automatically.
    const before = FOUNDS.reduce((n, k) => n + s[k].length, 0);
    if (!autoStep()) { stopAuto(); return; }
    const after = FOUNDS.reduce((n, k) => n + s[k].length, 0);
    idle = after > before ? 0 : idle + 1;
    if (idle > s.stock.length + s.waste.length + 2) stopAuto();
  }, 110);
}

function stopAuto() {
  clearInterval(autoTimer);
  autoTimer = null;
}

function finish() {
  if (!won()) return;
  if (startedAt) elapsed = Math.floor((Date.now() - startedAt) / 1000);
  stopTimer();
  stopAuto();
  sel = null;
  const secs = elapsed;

  // The hand is over; there is nothing left to come back to.
  clearGame();

  if (isDaily) {
    settleDaily('won');
    // A daily win is measured in days, not in seconds against other hands.
    el.bestLabel.textContent = 'Streak';
    el.wonBest.textContent = read().daily.streak;
    say('You won today\u2019s deal.');
  } else {
    const st = { ...read().stats };
    st.won++;
    st.streak++;
    if (st.streak > st.bestStreak) st.bestStreak = st.streak;
    if (!st.bestTime || secs < st.bestTime) st.bestTime = secs;
    if (!st.bestMoves || s.moves < st.bestMoves) st.bestMoves = s.moves;
    write({ stats: st });
    el.bestLabel.textContent = 'Best';
    el.wins.textContent = st.won;
    el.wonBest.textContent = clock(st.bestTime);
    say('You won.');
  }

  el.wonTime.textContent = clock(secs);
  el.wonMoves.textContent = s.moves;
  document.body.classList.add('is-won');
  cascade();
}

/* Every card pours off the foundations, bounces across the table and leaves
 * over the edge. The arc, the bounces and the spin are keyframes; this only
 * hands each card its distance to the floor, its heading and its cue. */
function cascade() {
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (!still) {
    const flight = [];
    FOUNDS.forEach((k, col) => s[k].forEach((id, depth) => flight.push({ id, col, depth })));
    // Kings leave first, then the card each was sitting on.
    flight.sort((a, b) => b.depth - a.depth || a.col - b.col);

    // Cards bounce off the table, not off the window, so the floor is the
    // top edge of the control bar.
    const floor = document.querySelector('.rail-bottom').getBoundingClientRect().top;

    flight.forEach((c, n) => {
      const node = cards[c.id];
      const box = node.getBoundingClientRect();
      const left = c.col % 2 === 0;
      node.style.setProperty('--fh', `${Math.round(floor - box.bottom)}px`);
      node.style.setProperty('--fx', `${Math.round(left ? -(box.right + 160) : innerWidth - box.left + 160)}px`);
      node.style.setProperty('--fr', `${(left ? -1 : 1) * (200 + (c.depth % 4) * 130)}deg`);
      node.style.setProperty('--fd', `${(n * 0.045).toFixed(2)}s`);
      node.classList.add('is-falling');
    });
  }

  showWon(still ? 0 : 3400);
}

function showWon(after) {
  clearTimeout(curtainTimer);
  curtainTimer = setTimeout(() => {
    el.curtain.hidden = false;
    $('#btn-again').focus();
  }, after);
}

/* ------------------------------------------------------------- timer --- */

const clock = (n) => `${(n / 60) | 0}:${String(n % 60).padStart(2, '0')}`;

function startTimer() {
  startedAt = Date.now() - elapsed * 1000;
  clearInterval(timer);
  timer = setInterval(() => {
    elapsed = Math.floor((Date.now() - startedAt) / 1000);
    el.time.textContent = clock(elapsed);
  }, 500);
}

function stopTimer() {
  clearInterval(timer);
  timer = null;
}

const say = (msg) => { el.announce.textContent = msg; };

/* ------------------------------------------------------------ render --- */

function render(opts = {}) {
  for (const k of KEYS) {
    const host = piles[k];
    const pile = s[k];
    const isTab = TABLEAU.includes(k);
    let offset = 0;

    pile.forEach((id, i) => {
      const node = cards[id];
      if (host.children[i] !== node) host.insertBefore(node, host.children[i] || null);

      const up = s.up[id];
      node.classList.toggle('is-up', up);
      node.hidden = false;
      node.style.left = '';

      // Face-down cards sit tighter than face-up ones, the way a real fan does.
      if (isTab) {
        node.style.setProperty('--i', offset);
        offset += up ? 1 : 0.42;
      } else if (k === 'waste') {
        // Only the last three are worth showing, fanned so you can read them.
        const back = pile.length - 1 - i;
        node.hidden = back > 2;
        node.style.setProperty('--i', 0);
        node.style.left = `calc(${Math.max(0, 2 - back)} * var(--card-w) * .22)`;
      } else {
        node.style.setProperty('--i', 0);
      }

      // Flat stacks only ever need their top two cards drawn.
      node.classList.toggle('is-buried', !isTab && k !== 'waste' && i < pile.length - 2);

      const live = movable(k, i);
      node.classList.toggle('is-dead', !live);
      node.tabIndex = live ? 0 : -1;
      node.setAttribute('aria-label', up ? name(id) : 'Face-down card');
      node.classList.toggle('is-picked', !!sel && sel.from === k && i >= sel.at);
      node.classList.toggle('is-hint', !!hint && !hint.deal && hint.from === k && i >= hint.at);

      if (opts.deal) {
        node.classList.add('is-dealing');
        node.style.setProperty('--d', `${i * 0.012 + KEYS.indexOf(k) * 0.018}s`);
      }
    });

    // Anything left over belongs to another pile now.
    while (host.children.length > pile.length) host.lastElementChild.remove();

    host.style.setProperty('--n', isTab ? Math.max(offset, 1) : 1);
    host.classList.toggle('is-hint-to', !!hint && hint.to === k);
    const target = !!sel && canDrop(k);
    host.classList.toggle('is-target', target);
    if (target) { host.tabIndex = 0; host.setAttribute('role', 'button'); }
    else { host.removeAttribute('tabindex'); host.removeAttribute('role'); }
  }

  if (opts.deal) {
    setTimeout(() => cards.forEach((c) => c.classList.remove('is-dealing')), 700);
  }
  if (opts.home) {
    const host = piles[opts.home];
    host.classList.remove('is-home');
    void host.offsetWidth;
    host.classList.add('is-home');
  }

  el.count.textContent = s.stock.length;
  el.count.hidden = s.stock.length === 0;
  piles.stock.classList.toggle('can-recycle', !s.stock.length && s.waste.length > 0);
  el.moves.textContent = s.moves;
  el.undo.disabled = history.length === 0;
  el.redo.disabled = redo.length === 0;
  el.auto.hidden = !(solved() && !won());

  persist();
}

// Which cards respond to a click at all — the rest let the pile take it.
function movable(k, i) {
  const pile = s[k];
  if (k === 'stock') return false;
  if (TABLEAU.includes(k)) return liftable(k, i);
  return i === pile.length - 1 && s.up[pile[i]];
}

/* --------------------------------------------------------------- hint --- */

/* hint.js reasons about the board as it stands; these helpers read that same
 * board, so the two cannot disagree about what is on the table. */
const RULES = { TABLEAU, FOUNDS, top, fits, liftable, rankOf };

function dropHint() {
  clearTimeout(hintTimer);
  hintTimer = null;
  hint = null;
  hintAt = 0;
}

/* Pressing again walks down the ranked list rather than repeating the best
 * move, so a player who has already discounted the obvious one is not told it
 * twice. The ring clears itself; a hint left standing would read as a state. */
function showHint() {
  const list = moves(s, RULES);
  if (!list.length) {
    dropHint();
    render();
    say('No moves left.');
    checkStuck();
    return;
  }

  const step = hintAt;
  clearTimeout(hintTimer);
  hint = list[step % list.length];
  hintAt = step + 1;
  render();
  hintTimer = setTimeout(() => { hint = null; hintTimer = null; render(); }, 3600);

  say(hint.deal ? 'Turn the stock.' : `Try the ${name(s[hint.from][hint.at])}.`);
}

/* Raised once per hand, and dismissible: the test behind it does not count
 * pulling a card back off a foundation as an out, so it can be wrong, and being
 * wrong should cost a tap rather than a game. */
function checkStuck() {
  if (stuckShown || autoTimer || won()) return;
  if (!dead(s, RULES)) return;
  stuckShown = true;
  el.stuck.hidden = false;
  $('#btn-stuck-new').focus();
  say('No moves left.');
}

el.hint.addEventListener('click', () => { stopAuto(); showHint(); });
$('#btn-stuck-new').addEventListener('click', () => { el.stuck.hidden = true; fresh(); say('New deal.'); });
$('#btn-stuck-replay').addEventListener('click', () => { el.stuck.hidden = true; fresh(dealSeed, isDaily); say('Same hand again.'); });
$('#btn-stuck-stay').addEventListener('click', () => { el.stuck.hidden = true; });

/* -------------------------------------------------------------- sheet --- */

const sheetOpen = () => !el.sheet.hidden;
const stuckOpen = () => !el.stuck.hidden;

function showSheet() {
  if (sheetOpen()) return;
  paintDeal();
  paintDaily();
  paintRecord();
  el.veil.hidden = false;
  el.sheet.hidden = false;
  el.more.setAttribute('aria-expanded', 'true');
  el.sheet.querySelector('button').focus();
}

function hideSheet() {
  if (!sheetOpen()) return;
  el.sheet.hidden = true;
  el.veil.hidden = true;
  el.more.setAttribute('aria-expanded', 'false');
  el.more.focus();
}

// A win rate needs a game to divide by, and a best needs one to have happened;
// an em dash says "not yet" rather than claiming a nought.
function paintRecord() {
  const st = read().stats;
  record.played.textContent = st.played;
  record.won.textContent = st.won;
  record.rate.textContent = st.played ? `${Math.round((st.won / st.played) * 100)}%` : '—';
  record.streak.textContent = st.streak;
  record.bestStreak.textContent = st.bestStreak;
  record.bestTime.textContent = st.bestTime ? clock(st.bestTime) : '—';
  record.bestMoves.textContent = st.bestMoves || '—';
}

function paintDeal() {
  el.dealNum.textContent = dealSeed;
  el.copy.textContent = 'Copy link';
}

const DAILY_STATE = { playing: 'Open', won: 'Won', lost: 'Lost' };

function paintDaily() {
  const d = rollDaily();
  dailyView.state.textContent = DAILY_STATE[d.result] || 'Open';
  dailyView.streak.textContent = d.streak;
  dailyView.best.textContent = d.bestStreak;
  el.daily.textContent = d.result === 'playing' ? 'Play today\u2019s deal' : 'Replay today\u2019s deal';
}

const shareLink = () => `${location.origin}${location.pathname}?deal=${dealSeed}`;

/* The async clipboard needs a secure context and a permission that can be
 * refused. The hidden-field trick needs neither, which is the whole reason it
 * is still worth carrying despite execCommand being deprecated. */
function oldCopy(text) {
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
  document.body.append(field);
  field.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  field.remove();
  return ok;
}

async function copyLink() {
  const url = shareLink();
  let ok = false;
  try {
    await navigator.clipboard.writeText(url);
    ok = true;
  } catch {
    ok = oldCopy(url);
  }
  el.copy.textContent = ok ? 'Copied' : 'Copy failed';
  say(ok ? 'Link copied.' : 'Could not reach the clipboard.');
  setTimeout(() => { el.copy.textContent = 'Copy link'; }, 1600);
}

function paintDraw() {
  segs.forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.draw) === drawN)));
}

function setDraw(n) {
  const next = n === 3 ? 3 : 1;
  if (next === drawN) return;
  drawN = next;
  paintDraw();
  write({ prefs: { ...read().prefs, drawN } });
  persist();
  say(`Drawing ${drawN} at a time.`);
}

el.more.addEventListener('click', showSheet);
el.done.addEventListener('click', hideSheet);
el.veil.addEventListener('click', hideSheet);
el.copy.addEventListener('click', copyLink);
el.replay.addEventListener('click', () => { hideSheet(); fresh(dealSeed, isDaily); say('Same hand again.'); });
el.daily.addEventListener('click', () => { hideSheet(); fresh(dailySeed(today()), true); say('Today\u2019s deal.'); });
segs.forEach((b) => b.addEventListener('click', () => setDraw(Number(b.dataset.draw))));

// The sheet is modal, so focus stays inside it until it is dismissed.
el.sheet.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') { hideSheet(); return; }
  if (ev.key !== 'Tab') return;
  const stops = [...el.sheet.querySelectorAll('button')];
  const edge = ev.shiftKey ? stops[0] : stops[stops.length - 1];
  if (document.activeElement !== edge) return;
  (ev.shiftKey ? stops[stops.length - 1] : stops[0]).focus();
  ev.preventDefault();
});

/* -------------------------------------------------------------- drag --- */

// Below this, a press is a tap and the click handler takes it instead.
const SLOP = 5;

el.board.addEventListener('pointerdown', (ev) => {
  if (ev.button > 0 || document.body.classList.contains('is-won')) return;
  swallowClick = false;
  const node = ev.target.closest('.card');
  const host = ev.target.closest('.pile');
  if (!node || !host || host.dataset.pile === 'stock') return;

  const key = host.dataset.pile;
  const id = Number(node.dataset.id);
  const at = s[key].indexOf(id);
  if (at < 0 || !movable(key, at)) return;

  drag = {
    key, at, id, x: ev.clientX, y: ev.clientY, live: false,
    run: s[key].slice(at).map((n) => cards[n]),
  };
});

addEventListener('pointermove', (ev) => {
  if (!drag) return;
  const dx = ev.clientX - drag.x;
  const dy = ev.clientY - drag.y;

  if (!drag.live) {
    if (Math.hypot(dx, dy) < SLOP) return;
    drag.live = true;
    stopAuto();
    // Lifting a card is the same as selecting it, so the same piles light up.
    sel = { from: drag.key, at: drag.at };
    render();
    drag.run.forEach((n) => n.classList.add('is-dragging'));
  }
  drag.run.forEach((n) => {
    n.style.setProperty('--dx', `${dx}px`);
    n.style.setProperty('--dy', `${dy}px`);
  });
});

const endDrag = (dropped) => {
  if (!drag) return;
  const d = drag;
  drag = null;

  // Read where the card actually is before putting it back down — clearing
  // the transform first would hit-test the place it started from.
  const target = d.live && dropped ? landing(d.run[0]) : null;

  d.run.forEach((n) => {
    n.classList.remove('is-dragging');
    n.style.removeProperty('--dx');
    n.style.removeProperty('--dy');
  });

  if (!d.live) return;
  // A click follows this pointerup, and the drop has already been handled.
  swallowClick = true;
  if (target) place(target);
  else { sel = null; render(); }
};

addEventListener('pointerup', () => endDrag(true));
addEventListener('pointercancel', () => endDrag(false));

// Drop onto whichever legal pile the card covers most, which is far kinder
// than asking the player to hit an exact point.
function landing(node) {
  const card = node.getBoundingClientRect();
  const tall = piles.waste.getBoundingClientRect().height;
  let best = null, most = 0;

  for (const k of KEYS) {
    if (!canDrop(k)) continue;
    const stack = s[k];
    const box = stack.length
      ? cards[stack[stack.length - 1]].getBoundingClientRect()
      : (() => { const p = piles[k].getBoundingClientRect();
                 return { left: p.left, right: p.right, top: p.top, bottom: p.top + tall }; })();

    const w = Math.min(card.right, box.right) - Math.max(card.left, box.left);
    const h = Math.min(card.bottom, box.bottom) - Math.max(card.top, box.top);
    if (w > 0 && h > 0 && w * h > most) { most = w * h; best = k; }
  }
  return best;
}

/* ------------------------------------------------------------- input --- */

el.board.addEventListener('click', (ev) => {
  if (swallowClick) { swallowClick = false; return; }
  const host = ev.target.closest('.pile');
  if (!host) return;
  const key = host.dataset.pile;
  const node = ev.target.closest('.card');
  const id = node ? Number(node.dataset.id) : null;

  if (key === 'stock') { stopAuto(); deal(); return; }
  stopAuto();

  // A second click on the same card puts it back down.
  if (sel && id !== null && sel.from === key && s[key].indexOf(id) === sel.at) {
    sel = null; render(); return;
  }
  if (sel && place(key)) return;
  if (id !== null && pick(key, id)) return;
  if (sel) { sel = null; render(); }
});

el.board.addEventListener('dblclick', (ev) => {
  const host = ev.target.closest('.pile');
  const node = ev.target.closest('.card');
  if (!host || !node) return;
  stopAuto();
  sendHome(host.dataset.pile, Number(node.dataset.id));
});

// Piles become buttons only while they can receive the selection.
el.board.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Enter' && ev.key !== ' ') return;
  const host = ev.target.closest('.pile');
  if (!host || host.getAttribute('role') !== 'button') return;
  ev.preventDefault();
  host.click();
});

document.addEventListener('click', (ev) => {
  if (sel && !ev.target.closest('.pile')) { sel = null; render(); }
});

document.addEventListener('pointerdown', () => {
  if (document.body.classList.contains('is-won') && el.curtain.hidden) showWon(0);
});

$('#btn-new').addEventListener('click', () => { fresh(); say('New deal.'); });
$('#btn-again').addEventListener('click', () => { fresh(); say('New deal.'); });
$('#btn-won-replay').addEventListener('click', () => { fresh(dealSeed, isDaily); say('Same hand again.'); });
el.undo.addEventListener('click', undo);
el.redo.addEventListener('click', redoMove);
el.auto.addEventListener('click', startAuto);

document.addEventListener('keydown', (ev) => {
  // While a panel is up it owns the keyboard; the sheet handles Escape and Tab
  // itself, and the stuck panel only ever needs a way out.
  if (sheetOpen()) return;
  if (stuckOpen()) {
    if (ev.key === 'Escape') { el.stuck.hidden = true; ev.preventDefault(); }
    return;
  }
  const k = ev.key.toLowerCase();

  // Ctrl/Cmd+Z is what a player's hands already know; its shifted form is redo
  // most places, and Windows also expects Ctrl+Y.
  if (ev.metaKey || ev.ctrlKey) {
    if (k === 'z') (ev.shiftKey ? redoMove : undo)();
    else if (k === 'y') redoMove();
    else return;
    ev.preventDefault();
    return;
  }
  if (ev.altKey) return;

  if (k === 'escape' && sel) { sel = null; render(); }
  else if (k === 'u') undo();
  else if (k === 'r') redoMove();
  else if (k === 'n') fresh();
  else if (k === 'd') setDraw(drawN === 1 ? 3 : 1);
  else return;
  ev.preventDefault();
});

// Keep the clock honest when the tab is backgrounded.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopTimer();
  else if (startedAt && !won()) startTimer();
});

/* -------------------------------------------------------------- boot --- */

paintDraw();
el.wins.textContent = read().stats.won;

const query = new URLSearchParams(location.search);
const asked = Number.parseInt(query.get('deal'), 10);
const wanted = Number.isFinite(asked) ? asked >>> 0 : null;
const saved = read().game;

// Settle the calendar before anything reads it, so a day skipped entirely ends
// the run whether or not the player opens the sheet.
rollDaily();

// The hand you left is the hand you come back to, unless the URL names a
// different deal — following a shared link should deal that link's hand.
if (query.has('daily')) {
  const seed = dailySeed(today());
  if (saved && intact(saved) && saved.isDaily && saved.seed === seed) restore(saved);
  else fresh(seed, true);
} else if (saved && intact(saved) && (wanted === null || saved.seed === wanted)) {
  restore(saved);
} else {
  fresh(wanted === null ? newSeed() : wanted);
}
