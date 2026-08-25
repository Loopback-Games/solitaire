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

That is roughly 640 lines of vanilla JavaScript in one file, with no framework,
no build step, and no runtime dependencies. Klondike needs a shuffle, move
validation and win detection, so zero was never on the table — but nothing in
here does a job CSS could do instead.

The only external request is the Google Fonts stylesheet.

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
| Finish a solved game | **Finish it** appears once no cards are face down |

Win and all fifty-two pour off the foundations, bounce off the table and sail
out over the edge. Click to skip to the score.

Keyboard: `Tab` to a card, `Enter` to pick it up, `Tab` to a highlighted pile,
`Enter` to drop. `U` undo, `N` new deal, `D` toggle draw count, `Esc` deselect.

Add `?deal=42` to the URL to replay a specific shuffle. Same number, same hand,
every time — useful for sharing a deal or reporting a bug.

## Rules

Standard Klondike. Tableau piles build down in alternating colours, foundations
build up by suit from the ace, empty columns take a king. Draw one or draw three,
with unlimited redeals. Undo goes back 200 moves.

Cards carry the traditional pip layouts, so a seven reads as a seven at a
glance, and the court cards are two-way — the same figure upright at the top and
inverted at the bottom, the way a real deck prints them.

## Developing

Everything is static; there is no build.

```
just serve     # http://127.0.0.1:8080
just test      # Playwright: Chromium, Firefox, and a mobile viewport
just check     # syntax and manifest validation
```

The suite covers the rules, undo, the keyboard path, drag-and-drop with both a
mouse and synthetic touch, the responsive layout at each viewport, and one
complete game played from the deal to the win screen.

Without `just`, `python3 -m http.server 8080` and `npm test` do the same thing.
`npm install` is only needed for the tests — the game itself has no dependencies.

## Deployment

`.github/workflows/pages.yml` uploads the repository as-is to GitHub Pages on
every push to `main`. There is no build step to go wrong. `ci.yml` runs the
Playwright suite on Chromium and Firefox for every push and pull request.

## Licence

MIT. See [LICENSE](LICENSE).
