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

## The dead-code guards

Three policies read the whole tree at once to find code that has quietly
stopped being read. Each is a ratchet, and each answers a question no
per-file rule can:

| policy | fires on | why a per-file rule cannot see it |
| --- | --- | --- |
| `unused-module-export` | a name a module's `server` package exports that no file in the repository imports, the package index included | the answer is the whole import graph; the declaring file looks perfectly well formed |
| `infrastructure-member-unused` | a member of a `<Feature>Infrastructure` interface that no app, service or repository in the owning package reaches | the member is declared in one file and read, or not read, across the package |
| `memory-twin-drift` | a repository whose Prisma implementation and memory twin declare different method sets, in either direction | the two classes are in different folders and only their difference is the defect |

`unused-module-export` is the guard that would have caught the nine adapter
files a codemod orphaned in one week: it moved each file, left the old copy
behind, and every check the repository owns stayed green. It is deliberately
NOT `composed-exports`, which asks whether a name the package PUBLISHES is
constructed by a process; a name that never reached the index is invisible to
that one, and a name that did belongs to it rather than here. Barrels, test
files, testing entries and a configuration module's default export are out of
scope; a namespace import, a `export * from` and a dynamic `import()` each name
the module without naming a member, so each marks the whole target read.

`infrastructure-member-unused` reads a member as used when the package reaches
it through a value: `infrastructure.foo`, `infrastructure["foo"]`, or
`const { foo } = infrastructure`. Filling the field in is not a read, and
neither is a fixture: a member only a test names is dead weight every process
still has to supply.

`memory-twin-drift` is the sharper half of `feature-shape`'s
`postgres-without-memory`, which only asserts a twin exists. It pairs the two
classes by subject - the class name with the word `Prisma` or `Memory` taken
out, whichever end it sits at, plus every interface the class implements - and
reports each method one side declares and the other does not against the side
that is short.

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
| `src/unused-module-export-baseline.json` | `unused-module-export` | `<file>\|<exported name>` |
| `src/infrastructure-member-unused-baseline.json` | `infrastructure-member-unused` | `<package directory>\|<interface>\|<member>` |
| `src/memory-twin-drift-baseline.json` | `memory-twin-drift` | `<package directory>\|<subject>\|<side>\|<method>` |
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
