/* Klondike solitaire — Loopback Games
 *
 * No framework, no build step, no dependencies. This module owns game state
 * and decides which pile each card belongs to; the stylesheet owns every pixel.
 * Moving a card is `pile.appendChild(el)` plus one custom property, so layout,
 * fan spacing, flips and animation stay in CSS where they can respond to the
 * viewport without asking JavaScript.
 */

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

/* ------------------------------------------------------------- store --- */

const STORE = 'lbg.solitaire.v1';

const load = () => {
  try { return JSON.parse(localStorage.getItem(STORE)) || {}; }
  catch { return {}; }
};
const save = (patch) => {
  try { localStorage.setItem(STORE, JSON.stringify({ ...load(), ...patch })); }
  catch { /* private browsing — the game still plays, it just forgets */ }
};

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
  draw:      $('#btn-draw'),
  drawN:     $('#draw-n'),
  auto:      $('#btn-auto'),
  curtain:   $('#curtain'),
  wonTime:   $('#won-time'),
  wonMoves:  $('#won-moves'),
  wonBest:   $('#won-best'),
  announce:  $('#announce'),
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

let s, history, sel, timer, autoTimer, startedAt, elapsed;
let drag = null, swallowClick = false, curtainTimer = null;

const prefs = load();
let drawN = prefs.drawN === 3 ? 3 : 1;

function fresh() {
  const deck = [...Array(52).keys()];
  const roll = seeded();
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
  sel = null;
  drag = null;
  elapsed = 0;
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
  render({ deal: true });
}

/* Deals are random unless the URL carries ?deal=<number>, which replays the
 * same shuffle every time. Handy for sharing a hand, and it is what the test
 * suite pins itself to. */
function seeded() {
  const asked = new URLSearchParams(location.search).get('deal');
  const n = Number.parseInt(asked, 10);
  if (!Number.isFinite(n)) return draws;

  // mulberry32 — small, fast, and good enough to shuffle a deck with.
  let a = (n >>> 0) + 0x6D2B79F5;
  return (max) => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296 * max) | 0;
  };
}

function draws(n) {
  if (window.crypto && crypto.getRandomValues) {
    // Rejection sampling, so the shuffle stays uniform rather than biased
    // toward the low end of the range.
    const limit = Math.floor(0x100000000 / n) * n;
    const buf = new Uint32Array(1);
    let v;
    do { crypto.getRandomValues(buf); v = buf[0]; } while (v >= limit);
    return v % n;
  }
  return Math.floor(Math.random() * n);
}

const snapshot = () => ({
  up: [...s.up],
  moves: s.moves,
  piles: KEYS.map((k) => [...s[k]]),
});

function push() {
  history.push(snapshot());
  if (history.length > 200) history.shift();
}

function undo() {
  // Once the cards are in the air the hand is over; there is nothing to walk back.
  if (document.body.classList.contains('is-won')) return;
  const prev = history.pop();
  if (!prev) return;
  stopAuto();
  s.up = prev.up;
  s.moves = prev.moves;
  KEYS.forEach((k, i) => { s[k] = prev.piles[i]; });
  sel = null;
  render();
  say('Move undone.');
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
  if (!startedAt) startTimer();
  return run;
}

// Klondike turns the newly exposed tableau card face up for you.
function reveal(k) {
  if (!TABLEAU.includes(k)) return;
  const t = top(k);
  if (t !== undefined && !s.up[t]) s.up[t] = true;
}

function deal() {
  if (!startedAt) startTimer();
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
  const prev = load();
  const wins = (prev.wins || 0) + 1;
  const best = prev.best && prev.best <= secs ? prev.best : secs;
  save({ wins, best });
  el.wins.textContent = wins;
  el.wonTime.textContent = clock(secs);
  el.wonMoves.textContent = s.moves;
  el.wonBest.textContent = clock(best);
  say('You won.');
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

      if (opts.deal) {
        node.classList.add('is-dealing');
        node.style.setProperty('--d', `${i * 0.012 + KEYS.indexOf(k) * 0.018}s`);
      }
    });

    // Anything left over belongs to another pile now.
    while (host.children.length > pile.length) host.lastElementChild.remove();

    host.style.setProperty('--n', isTab ? Math.max(offset, 1) : 1);
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
  el.auto.hidden = !(solved() && !won());
}

// Which cards respond to a click at all — the rest let the pile take it.
function movable(k, i) {
  const pile = s[k];
  if (k === 'stock') return false;
  if (TABLEAU.includes(k)) return liftable(k, i);
  return i === pile.length - 1 && s.up[pile[i]];
}

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
el.undo.addEventListener('click', undo);
el.auto.addEventListener('click', startAuto);

el.draw.addEventListener('click', () => {
  drawN = drawN === 1 ? 3 : 1;
  el.drawN.textContent = drawN;
  el.draw.setAttribute('aria-pressed', String(drawN === 3));
  save({ drawN });
  say(`Drawing ${drawN} at a time.`);
});

document.addEventListener('keydown', (ev) => {
  if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
  const k = ev.key.toLowerCase();
  if (k === 'escape' && sel) { sel = null; render(); }
  else if (k === 'u') undo();
  else if (k === 'n') fresh();
  else if (k === 'd') el.draw.click();
  else return;
  ev.preventDefault();
});

// Keep the clock honest when the tab is backgrounded.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopTimer();
  else if (startedAt && !won()) startTimer();
});

/* -------------------------------------------------------------- boot --- */

el.drawN.textContent = drawN;
el.draw.setAttribute('aria-pressed', String(drawN === 3));
el.wins.textContent = prefs.wins || 0;
fresh();
