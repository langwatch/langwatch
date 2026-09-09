# @langwatch/architecture-lint

Executable package-boundary policies for the LangWatch monorepo. `pnpm --filter
@langwatch/architecture-lint lint` checks the workspace; the report is described
in `specs/lint-report.feature`.

## The policy registry

Every policy is one `definePolicy({ id, spec, baseline?, run(snapshot) })` entry
in `src/policies/index.ts`. `lintSnapshot` (and the CLI's check mode) fold that
registry and nothing else, so a library caller of `lintWorkspace()`/
`lintSnapshot()` and `pnpm lint` run the same set of policies. `--list-policies`
prints the registry: each id, the spec its scenarios live in, and its baseline
file, if it has one.

Source lives under `src/policies/`, one file per policy (`feature-app.ts` and
`api-transport.ts` are the two exceptions: each folds a small family of
functions that share one concept into one file, still one registered entry
per function). Shared tree-reading lives in `src/workspace/` (the snapshot,
the module graph, the repository layout); one-shot migration tools that are
not policies live in `src/tools/`.

A `false` CLI/library option that used to skip a policy's own call still
does: `enabledPolicies()` drops the whole registry entry for `declarations`
and `legacy-feature-fragments` before running (declarations alone compiles a
TypeScript program per package — running it just to discard the result costs
minutes, not milliseconds). `application-boundaries` mixes findings the
legacy-migration option can turn off with ones it cannot, and the legacy
checks are cheap, so it always runs; `excludedPolicyIds()` drops only the
findings its own `policy` field names.

## Baselines

A baseline is a policy's inventory of what already offended when the policy
landed. It ratchets: rows leave as the debt is paid and none may be added. Every
ratchet uses the same file shape, read and written by `src/baseline.ts`, and
described in `specs/lint-baselines.feature`.

```json
{
  "version": 1,
  "policy": "feature-shape",
  "entries": [{ "key": "agent|contract-service", "measured": "2026-09-08" }]
}
```

- `key` — the row's identity, in the owning policy's own grammar (below).
- `measured` — the date the row was measured, `YYYY-MM-DD`.
- `expires` — optional review date. Two policies refuse a row past it; the rest
  only let the file shrink. Which is which is decision D2 in
  `dev/docs/plans/architecture-lint-review-2026-09-08.md`, and it is one field
  (`enforceExpiry`) per policy registration.
- `count` — optional magnitude the merge-base shrink check compares.

Rows are sorted by `key` in code-unit order and each key appears once. A file
that is out of order, duplicated, on the wrong version, or naming another
policy is refused before any of its rows exempts anything.

A row that no live finding matches is **stale**: the allowance outlived what it
allowed. Stale rows are reported as findings under `<policy>-baseline` and carry
a `stale` field, which is what the report counts in its summary. Deleting a
baseline's last row deletes the file: an empty ratchet is an exception surface
with nothing left to except, and the policy becomes a plain refusal.

### The live baselines and what a key is

| file | policy | key |
| --- | --- | --- |
| `src/feature-shape-baseline.json` | `feature-shape` | `<feature>\|<kind>` |
| `src/source-folder-shape-baseline.json` | `source-folder-shape` | `<kind>\|<path>` |
| `src/oxlint-baseline.json` | `oxlint` | `<rule>\|<file>` |
| `src/boundary-edge-baseline.json` | `boundary-edge` | `<kind>\|<from>\|<to>` |
| `src/composed-exports-baseline.json` | `composed-exports` | `<package directory>\|<exported name>` |
| `src/comment-block-roots.json` | `comment-block-root` | the repository-relative root directory, with `count` its over-limit blocks |

`src/declaration-budget.json` is not one of these: it carries per-package file
counts rather than keyed rows, and nothing about it ratchets by key.

### Reading and writing one

```ts
import { FEATURE_SHAPE_BASELINE, baselinePath, readBaseline, staleRows } from "./baseline.ts";

const file = baselinePath({ root, policy: FEATURE_SHAPE_BASELINE });
const baseline = readBaseline({ policy: FEATURE_SHAPE_BASELINE, file });
```

`formatBaseline({ policy, entries })` is the only writer, and
`collectBaseline({ policy, found, previous })` is how a fresh measurement keeps
the date each existing row already carries.
