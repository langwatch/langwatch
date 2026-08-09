# Releases

Releases are cut by [release-please](https://github.com/googleapis/release-please) from
conventional commits on `main`. Config lives in `.github/release-please-config.json`,
current versions in `.github/.release-please-manifest.json`.

This repo publishes nine independently versioned components:

| component | path | shim |
| --- | --- | --- |
| `langwatch` (the product, charts and app) | `.` | `.release-please-shim` |
| `typescript-sdk` | `sdks/typescript` | `sdks/typescript/.release-please-shim` |
| `python-sdk` | `sdks/python` | `sdks/python/.release-please-shim` |
| `sdk-go` | `sdks/go` | `sdks/go/.release-please-shim` |
| `mcp-server` | `mcp/typescript` | `mcp/typescript/.release-please-shim` |
| `langevals` | `services/langevals` | `services/langevals/.release-please-shim` |
| `clickhouse-serverless` | `charts/clickhouse-serverless` | `charts/clickhouse-serverless/.release-please-shim` |
| `skills` | `skills` | `skills/.release-please-shim` |
| `agent-plugin` | `plugins/langwatch` | `plugins/langwatch/.release-please-shim` |

Each gets its own release PR, its own tag and its own changelog.

## A breaking change belongs to one component

release-please decides which components a commit affects **by path**, then applies
the **whole commit message** to every one of them. It has no way to say "this break
is only about the SDK". So a single commit that carries a `!` marker or a
`BREAKING CHANGE:` footer and touches three components proposes three majors.

That has happened repeatedly:

- #6600 removed the legacy Ragas evaluators. Breaking for the product, correctly.
  It also touched two files under `sdks/typescript`, a doc comment and a unit test,
  and 57 under `services/langevals`. All three were proposed as majors.
- #6641 changed MCP server auth. It touched fifteen files under `mcp/typescript`
  and one at the root, `SECURITY.md`. That one root file pulled the break into the
  product changelog.

**So: keep a breaking change inside one component.** If the same work has to touch
another component, land the incidental part in a separate non-breaking PR, or pin
the components that should not go major, below.

`release-scope-guard` enforces this on every PR. It fails when the PR title or any
of its commits carries a breaking marker and the changed files span more than one
component, unless the extra components are pinned. It reads the pins described
below and passes once at most one bumped component is left unpinned. If the break
really does apply to all of them, add the **`multi-component-major`** label and the
check passes. Reach for that label only when every one of those majors is wanted:
it asserts intent, while a pin is what says a component is not going major.

It reads the title and the commits because a squash merge builds the commit from
exactly those two. It deliberately does not read the PR description, which never
reaches `main` on its own and which a release PR fills with a changelog restating
every break it ships.

## Pinning a version release-please got wrong

`Release-As:` beats every other signal. release-please reads it per commit, so the
same path splitting that spreads a breaking marker also routes the override. A
commit that touches exactly one component's paths reaches exactly that component.

That is what the `.release-please-shim` files are for. They exist only to give each
component a file to touch.

1. Branch from latest `main`.
2. Edit **one** shim, the one belonging to the component you are pinning. Bump its
   marker number and record the version you are aiming at.
3. Commit that one file. Put `Release-As: <x.y.z>` as the last line of the message,
   and put **exactly one** such footer in it.
4. Open the PR, then **squash and merge it keeping the commit message body**. The
   footer has to reach `main` inside the commit message. A single-commit PR already
   squashes to the right body. Replacing that body with the PR description drops
   the footer and the override silently does nothing.
5. Confirm the release PR regenerated to the version you asked for. Do not assume it.

To pin several components, use one commit per component, each touching only its own
shim and carrying only its own footer. A commit with two footers, or one that
touches two shims, is what caused the problem in the first place.

`release-scope-guard` reads pins done this way, so a breaking PR that pins its
extra components passes without the label. It requires both halves and binds them
by version: the component's shim has to be among the changed files, and some
commit has to carry a `Release-As:` footer naming the version that shim records
after `next:`. A shim edit alone moves nothing, since release-please takes the
version from the footer, and a footer alone reaches every component the PR
touched, since only paths route it. The guard sees one file list per PR rather
than one per commit, so the recorded version is what attributes a footer to a
component. A changed shim with no footer naming its version fails the check by
name, which catches a pin that would have done nothing before merge rather than
after the release PR regenerates.

Worked examples: #6704 pinned the root package to 3.10.0, #6734 pinned the
typescript SDK to 1.3.0, and #3627 pinned six components at once.

## Why not just configure it away

`exclude-paths` cannot express this. release-please matches it by directory prefix
only, with no globs, and drops a commit from a component only when *every* touched
file of that component is excluded. Excluding "tests" or "internal CLI code" is not
expressible, and would not have helped #6600 anyway: the file that dragged the SDK
to a major was ordinary SDK source.

Per-package `versioning: always-bump-minor` would cap majors, including deliberate
ones, so a genuine break would ship silently mis-versioned. Worse than the problem.
