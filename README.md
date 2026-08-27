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

Everything is static; there is no build. What there is, is one file that pins
every tool and one file that holds every command.

```
mise install   # node, python, just and the linters, at the pinned versions
just setup     # the above, plus the test dependencies and the browsers
just           # list the recipes
```

```
just run       # http://127.0.0.1:8080
just test      # Playwright: Chromium, Firefox, and a mobile viewport
just lint      # modules, workflows, the manifest, the SVGs, the pinned versions
just security  # gitleaks over the history, npm audit over the dependencies
just build     # assemble dist/, which is exactly what gets published
just ci        # all of the above, in the order CI runs them
```

Tool versions live in `mise.toml` and nowhere else. `.github/workflows/ci.yml`
installs that same file with `jdx/mise-action` and then runs `just ci` — one
step, no inline shell — so a workflow can never carry a command you cannot run
yourself. The justfile puts mise's shims on `PATH`, so the recipes work whether
or not your shell has activated mise.

`.devcontainer/` builds on Playwright's official image, which is also the
container CI runs the suite in, so the browsers and the system libraries behind
them are identical in both places. Open the folder in a container and
`postCreateCommand` runs `just setup` for you. It is built for rootless podman:
root inside the container maps to your own user outside it, and the workspace
mount carries `,Z` so SELinux relabels it rather than being switched off.

The image tag must equal the `@playwright/test` version in `package.json` —
Playwright cannot find its browsers otherwise, and Dependabot bumps the package
without knowing about the tag. `just lint-versions` compares them and is part
of `just lint`.

217 tests across eight files: the rules, undo and redo, resuming a hand across
a reload, the deal number and the daily streak, the hint ranking and dead-hand
detection against constructed boards, drag-and-drop with both a mouse and
synthetic touch, arrow-key navigation, offline play behind a stopped network,
the responsive layout at each viewport, and one complete game played from the
deal to the win screen.

Without `just`, `python3 -m http.server 8080` and `npm test` do the same thing.
`npm install` is only needed for the tests — the game itself has no
dependencies.

## Deployment

`.github/workflows/pages.yml` runs the full suite first, then publishes on
every push to `main`. It uploads `dist/` rather than the repository, so the test
suite, the tooling and the lockfile stay off the web server; `just build` is
what assembles it, and there is still no build step to go wrong.

Deploying used to be a separate workflow that raced CI and knew nothing about
it, which is how a commit with a red suite once reached the live site. Now
nothing ships until `just ci` is green.

## Licence

MIT. See [LICENSE](LICENSE).
