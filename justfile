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

# There is no `fmt` recipe on purpose. The only formatter that would apply here
# is prettier, and reaching for `npx --yes prettier@3` would put an unpinned
# tool back in a repository whose whole tooling story is that versions are
# pinned in one file.

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

# Static analysis of everything. Changes nothing, and fails rather than skips.
lint: lint-js lint-config lint-versions

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

# Secrets in the history, and advisories against the dependencies.
security:
    gitleaks detect --no-banner --redact
    npm audit --audit-level=moderate

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

# Remove build output and test artefacts.
clean:
    rm -rf dist test-results playwright-report
