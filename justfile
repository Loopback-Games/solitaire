# Solitaire — Loopback Games
#
# Every command this repository knows how to run lives here, and the workflows
# run these same recipes rather than spelling them out again in YAML. A green
# pipeline therefore means the commands on this page pass. If you change one,
# change it here rather than in .github/workflows.
#
# Tool versions come from mise.toml. `just setup` installs them.

set shell := ["bash", "-euo", "pipefail", "-c"]

# mise's shims, so every recipe works in a shell that has not activated mise.
# A devcontainer runs plenty of non-interactive shells and none of them source
# a profile.
export PATH := env("HOME") / ".local/share/mise/shims" + ":" + env("PATH")

# The files the site is actually made of. Everything else in the repository is
# how it gets built and checked, and has no business on a public web server.
site := "index.html sw.js manifest.webmanifest .nojekyll LICENSE css js assets"

# List the available recipes.
default:
    @just --list

# Install every pinned tool, the test dependencies, and the browsers.
setup:
    #!/usr/bin/env bash
    set -euo pipefail
    mise trust --quiet
    mise install --yes
    npm ci
    # The Playwright image already carries the browsers and says where. Asking
    # for them again there would need root and change nothing.
    if [[ -z "${PLAYWRIGHT_BROWSERS_PATH:-}" ]]; then
        npx playwright install --with-deps chromium firefox
    else
        echo "browsers already in the image at ${PLAYWRIGHT_BROWSERS_PATH}"
    fi

# Prettier was refused here for a long time, on the grounds that reaching for
# `npx --yes prettier@3` would put an unpinned tool back in a repository whose
# whole story is that versions live in one file. That objection no longer holds:
# it is a pinned devDependency in the lockfile, like everything else.

# Format every file in place.
fmt:
    prettier --write .

# Static analysis of everything. Changes nothing, and fails rather than skips.
lint: lint-js lint-config lint-versions
    prettier --check .

# Note the `--input-type=module` below: a bare `node --check` silently accepts
# a file containing ESM syntax, so the obvious form of this recipe checks
# nothing at all. sw.js is a classic script and is checked as one.

# Parse every module.
lint-js:
    @for f in js/*.js tools/*.mjs; do echo "  $f"; node --input-type=module --check < "$f"; done
    @echo "  sw.js"; node --check sw.js

# No "not installed, skipping" guards here. actionlint and zizmor come from
# mise.toml, so they are always present, and a lint that quietly passes when
# the linter is missing is worse than no lint at all.

# Workflows, the manifest, and the SVG assets.
lint-config:
    actionlint
    zizmor --min-severity low .github/workflows
    yamllint --strict .github .yamllint
    python3 -c "import json; json.load(open('manifest.webmanifest'))"
    python3 -c "import xml.dom.minidom as m; [m.parse(f) for f in ['assets/favicon.svg','assets/social.svg']]"

# Dependabot bumps @playwright/test and knows nothing about the container tag.
# A mismatch is not a warning: Playwright cannot find its browsers at all.

# Fail if the Playwright image and the Playwright package have drifted apart.
lint-versions:
    #!/usr/bin/env bash
    set -euo pipefail
    want="$(node -p "require('@playwright/test/package.json').version")"
    ok=1
    for f in .devcontainer/Containerfile .github/workflows/ci.yml; do
        got="$(sed -n 's|.*mcr\.microsoft\.com/playwright:v\([0-9][0-9.]*\)-noble.*|\1|p' "$f" | head -1)"
        if [[ "$got" != "$want" ]]; then
            echo "$f pins Playwright ${got:-<none>}, package.json wants $want" >&2
            ok=0
        fi
    done
    if (( ! ok )); then
        echo "Bump the image tag and its digest together, or pin the package back." >&2
        exit 1
    fi
    echo "  Playwright image and package agree on $want"

# The full browser suite: Chromium, Firefox, and a mobile viewport.
test *args:
    npx playwright test {{ args }}

# Run one project only, e.g. `just test-only mobile`.
test-only project:
    npx playwright test --project={{ project }}

# Two advisory databases rather than one: npm audit reports against its own and
# osv-scanner against OSV's, and they disagree often enough on a dev-only tree
# to be worth the few seconds. Only npm audit gates, at `high` — the game ships
# no runtime dependencies, so a moderate advisory in the build tree is not
# reachable by a player, and a gate that goes red with no fix available is a
# gate somebody eventually weakens. osv-scanner has no severity filter, so
# those findings stay visible without blocking.
#
# gitleaks reads the history rather than the working tree, because a key that
# was committed and then deleted is still a key that was published. That is
# what makes CI need a full clone. `gitleaks git` rather than the older
# `gitleaks detect`, which no longer appears in the command list.

# Secrets in the history, and advisories against the dependencies, twice.
security:
    gitleaks git . --no-banner --redact
    npm audit --audit-level=high
    osv-scanner scan source --lockfile package-lock.json

# Assemble exactly what gets published into dist/.
build:
    #!/usr/bin/env bash
    set -euo pipefail
    rm -rf dist
    mkdir dist
    cp -R {{ site }} dist/
    find dist -type f | sort

# Serve the site locally.
run port="8080":
    @echo "http://127.0.0.1:{{ port }}"
    python3 -m http.server {{ port }} --bind 127.0.0.1

# Everything CI runs, in the order CI runs it.
ci: lint security test build

# Re-rasterise the PNG icons from assets/favicon.svg.
icons:
    node tools/icons.mjs

# The point of this recipe is that it proves the claim: the same `just ci`, on a
# machine that is neither this laptop nor the runner, from the same mise.toml.
# If it passes here and on a laptop, CI is not going to surprise anyone.

# Run the full gate inside the devcontainer.
container:
    devcontainer up --docker-path podman --workspace-folder .
    devcontainer exec --docker-path podman --workspace-folder . just ci

# Remove build output and test artefacts.
clean:
    rm -rf dist test-results playwright-report
