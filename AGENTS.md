# Working in this repository

## The rule

**A workflow must never carry a command a developer cannot run locally.**

Every command lives in the `justfile`, and `.github/workflows/ci.yml` runs
`just ci` — one step, no inline shell. If CI needs to do something new, it gets
a recipe first. The sibling repositories in this organisation each have a
justfile whose comments claim CI runs its recipes, and in each of them CI
re-spells the commands in YAML instead; the two have already drifted apart in
opposite directions. That is the failure this rule exists to prevent.

## Tools

Tool versions live in `mise.toml` and nowhere else — not in a workflow, not in
`package.json`, not in a README. CI installs that same file with
`jdx/mise-action`, so a version bump happens in one place.

`just setup` installs everything. The justfile puts mise's shims on `PATH`, so
recipes work whether or not your shell has activated mise.

Dependabot has no mise ecosystem, so those pins are bumped by hand with
`mise upgrade`.

## The container

`.devcontainer/Containerfile` builds on Playwright's official image, and
`ci.yml` runs its job in the same image. The tag must equal the
`@playwright/test` version in `package.json`: Playwright cannot locate its
browsers otherwise, and the failure is total rather than a warning.
`just lint-versions` compares the two and is part of `just lint`.

Bump the image tag, its digest and the npm package in one commit.

## Actions

Pinned by commit SHA with the version in a trailing comment. Resolve a SHA with
`gh api repos/<owner>/<repo>/git/ref/tags/<tag>` — never copy one from memory.
`actionlint` and `zizmor` run in `just lint-config`.

## Before you push

`just ci`. Read the Playwright result off a grep of the summary line, never off
`tail`: the trailing list of test names is the *failure* list, and it reads as a
pass list once the glyphs are truncated.
