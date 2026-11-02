# ADR-186: `test:changed` runs the tests an edit reaches, from a kept import graph

**Date:** 2026-10-21

**Status:** Proposed

## Context

There were two ways to run "the tests for this edit". `pnpm test:affected`
(ADR-150) works per package: Nx runs every test in every package that depends
on the edited one, so an edit to one identity service file runs the whole API,
worker and tasks app suites. `vitest related` works per file, but only inside
the one package it runs in. It also rebuilds its import graph on every call, and
on one identity service file it spends 3.5 to 3.7 s working that out before
the first test starts.

The same identity edit reaches 76 test files by imports, across the identity
module, the API, worker and tasks apps and the insight module.

## Decision

**`pnpm test:changed [files...]` runs exactly the Vitest test files a change
reaches by imports, in every package.** With no files named, the change is what
differs from the merge base with origin/main, uncommitted and untracked files
included. `dev/nx/import-graph.mjs` builds the graph and
`dev/nx/test-changed.mjs` plans the run and starts it.

- The graph covers every tracked and untracked file. Imports resolve the way
  Vitest resolves them here: relative paths, workspace packages through their
  package.json `exports`, `#` subpath imports through `imports`, and tsconfig
  `paths`. `vi.mock`, `require`, dynamic imports, `new URL(…, import.meta.url)`
  and `import.meta.glob` count. A vitest config's relative strings count too,
  so its `setupFiles` are in the graph. Type-only imports are dropped, as Vitest
  drops them. npm packages are not followed.
- Each reached test file runs in the nearest package whose `test` script is
  `vitest run …`, through that script with the files appended, so the
  package's config, include and exclude still decide. A package runs its whole
  suite when its vitest config, or a file the config names, is reached.
  Packages with reached files run first, whole suites after. A reached test
  file no Vitest package owns is listed, not run.
- A package whose row in the test reads table (`dev/nx/test-reads-plugin.mjs`,
  ADR-150) matches a changed file is listed, with the file. `--reads` runs its
  whole suite as well.
- The graph stays warm in a cache file,
  `node_modules/.cache/test-changed/import-graph.json`. Each file's imports are
  kept with its mtime and size, so a run reads again only the files that
  changed. Resolved imports are kept too, and are reused while the file list
  and the package.json and tsconfig.json files are unchanged.

`test:affected` stays as it is: it is cached, it is what CI and haven's gate
know, and it also catches what imports can't see.

## Rationale / Trade-offs

A cache file rather than a long-running service: once the graph is cached, the
remaining cost is listing and stat'ing about 38,000 files, under a second, and
a service would need starting, stopping and watching for a few hundred
milliseconds more. The walk itself takes under a millisecond.

Imports are not everything a test depends on. A test that reads a file from
disk outside the test reads table, or a change to a dependency's version, is
not seen. `test:changed` is the edit loop's command; `test:affected` and CI
remain the check before merge.

## Consequences

- An edit's tests start sooner and fewer of them run. Measurements are in the
  pull request that adds the command.
- Suites in the test reads table are listed rather than run by default.
  `@langwatch/architecture-enforcer` reads most of the tree from disk, so it
  matches almost any source edit, and its whole suite didn't finish in 30
  minutes on the shared machine. Running it on every edit would undo the point
  of the command. `--reads`, `test:affected` and CI still run it.

## References

- Related ADRs: [ADR-150](150-nx-task-runner.md)
- Spec: `specs/tooling/test-changed.feature`
