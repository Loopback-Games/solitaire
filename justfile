# Solitaire — Loopback Games

default:
    @just --list

# Install the test dependencies. The game itself needs nothing.
setup:
    npm install
    npx playwright install --with-deps chromium firefox

# Serve the site locally.
serve:
    @echo "http://127.0.0.1:8080"
    python3 -m http.server 8080

# Static checks that need no browser.
check:
    node --check js/solitaire.js
    python3 -c "import json; json.load(open('manifest.webmanifest'))"
    python3 -c "import xml.dom.minidom as m; [m.parse(f) for f in ['assets/favicon.svg','assets/social.svg']]"
    python3 -c "import yaml,glob; [yaml.safe_load(open(f)) for f in glob.glob('.github/**/*.yml', recursive=True)]"

# Full browser suite across desktop and mobile viewports.
test:
    npm test

# Run one project only, e.g. `just test-only mobile`.
test-only project:
    npx playwright test --project={{project}}

lint:
    @command -v actionlint >/dev/null && actionlint || echo "actionlint not installed, skipping"
    @command -v zizmor >/dev/null && zizmor .github/workflows/ || echo "zizmor not installed, skipping"

clean:
    rm -rf test-results playwright-report
