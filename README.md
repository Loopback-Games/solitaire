# Solitaire

Klondike solitaire that runs in a browser tab. No install, no account, no ads,
no tracking. A [Loopback Games](https://github.com/Loopback-Games) project.

**Play it: https://loopback-games.github.io/solitaire/**

## How much JavaScript

The brief was "as little JS as possible", so the split is deliberate:

- **CSS owns every pixel.** Card faces down to the pip positions, the card back,
  the fan spacing in a tableau column, the flip, the deal, the winning cascade,
  and the entire responsive layout are stylesheet rules. Card size is derived
  from the viewport in `calc()`, so the board reflows without JavaScript
  measuring anything.
- **JavaScript owns only the state.** Which card is in which pile, whether a move
  is legal, and whether you have won. Moving a card is `pile.appendChild(el)` plus
  one custom property.

Even the cascade at the end works this way: the whole bouncing arc is one
`@keyframes` rule, and JavaScript hands each card three numbers — how far it is
above the table, which way it is heading, and when to go.

That is about 1,700 lines of vanilla JavaScript across six native ES modules —
the game, what it remembers, what it suggests, what it sounds like, how the
arrow keys move about it, and the service worker — with no framework, no build
step, and no runtime dependencies. Klondike needs a shuffle, move validation and
win detection, so zero was never on the table, and neither was one file: nothing
in here does a job CSS could do instead, but the parts that are genuinely
JavaScript are worth being able to read separately.

The card sounds are synthesised rather than sampled, so they cost no bytes: a
card landing is a very short burst of band-passed noise, which is what a card
landing is.

The only external request is the Google Fonts stylesheet, and every typeface
falls back to a system face, so the game reads fine without it.

## Playing

Drag a card where you want it, or tap it and tap the destination — both work,
on a mouse and on a touchscreen. Tap-and-tap is easier one-handed on a phone;
dragging feels better with a mouse. Picking a card up highlights every pile it
can legally go to: mint is the card in your hand, ochre is where it can land.

| | |
| --- | --- |
| Move a card | Drag it, or click it and click the destination |
| Move a run | Grab the lowest card of the run; the rest come with it |
| Send it to a foundation | Double-click it |
| Deal | Click the stock; click again when empty to fold the waste back in |
| Put it back down | Click it again, or press `Esc` |
| Change your mind | **Undo** and **Redo** walk the hand back and forward |
| Get unstuck | **Hint** rings one move it would make; press again for the next |
| Everything else | **More** opens the draw count, sound, the deal, and your record |
| Finish a solved game | **Finish it** appears once no cards are face down |

Win and all fifty-two pour off the foundations, bounce off the table and sail
out over the edge. Click to skip to the score.

The hint only ever points; it never plays for you. It also declines to suggest
a move it would want to undo next turn, which is how hints in solitaire usually
end up going in circles. When a hand really is over — nothing on the table can
move and nothing left in the stock fits anywhere — the game says so instead of
letting you grind.

Keyboard: `Tab` into the board, then the arrows move a cursor. Left and right
run along a row; up and down cross between the stock and foundations above and
the columns below, except inside a column, where they walk the fan so you choose
how deep into a run you take hold. `Enter` picks up and drops, `Esc` puts down.
`U` undo, `R` redo, `N` new deal, `D` draw count, and `Ctrl`/`Cmd`+`Z` works
too, shifted for redo.

Close the tab mid-hand and the hand is still there when you come back, walk-back
stacks and all. Every deal has a number: add `?deal=42` to the URL to play a
specific shuffle, or copy the link from **More**. Same number, same hand, every
time — useful for sharing a deal or reporting a bug.

`?daily` is today's hand, the same one for everybody, seeded from the date at
your midnight. One shuffle a day and you may undo as far as you like within it;
restarting counts as walking every move back, but starting a different deal
spends the day. It keeps its own streak, separate from the freeplay record.

Add it to your home screen and it plays with no network at all.

## Rules

Standard Klondike. Tableau piles build down in alternating colours, foundations
build up by suit from the ace, empty columns take a king. Draw one or draw three,
with unlimited redeals. Undo goes back 200 moves.

Cards carry the traditional pip layouts, so a seven reads as a seven at a
glance. Below roughly 680px the pips would be smaller than a grain of rice, so
a card that size drops them for a large index and a single suit mark instead —
legibility beats fidelity on a phone.

Nothing large enough to look broken is ever allowed to sit where the card above
it would slice it: card art starts below the deepest fan, so a fanned column
shows clean indices all the way down.

## Developing

Everything is static; there is no build.

```
just serve     # http://127.0.0.1:8080
just test      # Playwright: Chromium, Firefox, and a mobile viewport
just check     # syntax and manifest validation
just icons     # re-rasterise the PNG icons from assets/favicon.svg
```

216 tests across eight files: the rules, undo and redo, resuming a hand across
a reload, the deal number and the daily streak, the hint ranking and dead-hand
detection against constructed boards, drag-and-drop with both a mouse and
synthetic touch, arrow-key navigation, offline play behind a stopped network,
the responsive layout at each viewport, and one complete game played from the
deal to the win screen.

Note that `node --check` silently accepts any file containing ESM syntax, so
`just check` uses `node --input-type=module --check` instead. The obvious form
of that recipe checks nothing at all.

Without `just`, `python3 -m http.server 8080` and `npm test` do the same thing.
`npm install` is only needed for the tests — the game itself has no dependencies.

## Deployment

`.github/workflows/pages.yml` uploads the repository as-is to GitHub Pages on
every push to `main`. There is no build step to go wrong. `ci.yml` runs the
Playwright suite on Chromium and Firefox for every push and pull request.

## Licence

MIT. See [LICENSE](LICENSE).
