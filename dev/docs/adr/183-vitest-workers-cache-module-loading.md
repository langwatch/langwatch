# ADR-183: Vitest workers cache how they load installed packages

**Date:** 2026-10-21

**Status:** Proposed

## Context

Vitest transforms project source itself and keeps the result between runs (`fsModuleCache`). Everything
it does not transform (its own runtime, jsdom, React, most of `node_modules`) goes to Node's own loader
in the worker. With isolation on, every test file gets a new worker, so Node resolves and reads the same
few thousand installed files again for each file: stat, lstat, realpath and `package.json` reads to
resolve, then an open and read per module. A CPU profile of trace UI workers put resolution at about 19%
of worker time and file reads at about 12%.

`defineModuleVitestConfig` isolates only the files that mock modules, but the trace UI, identity and
other suites still have many of those, and each one pays the whole loading cost.

## Decision

**In fast mode, every Vitest worker loads `packages/vitest-config/src/module-loading-cache/register.ts`
with `--import`** (`test.execArgv`). It registers Node's synchronous `resolve` and `load` hooks
(`module.registerHooks`), which cover `import` and `require` alike, and answers from two files under the
worktree's `node_modules/.cache/vitest-module-loading/`: one of resolutions, one of sources. Each is a
hash table looked up where it lies in the buffer, with no parse step, read once per worker.

**What it caches, and why that is safe:**

- A resolution, only when its answer is a file inside an installed package and no project file can
  change the answer: the specifier is a package name, or the importing module is itself inside
  `node_modules`. Relative imports and `#` subpath imports from project code are left to Node. These
  answers change only when an install changes `node_modules`, and the file is named after the lockfile,
  pnpm's `node_modules/.modules.yaml` (which pnpm rewrites on every install) and the Node version, so an
  install starts a fresh file.
- A source, only for a file inside an installed package, kept with the file's size, modification time
  (in nanoseconds) and inode. A worker stats the file before serving it, and reads it from disk again if
  any of the three differ, so an edited file is never served stale. A file that changes while Node reads
  it is not kept.
- Dot directories under `node_modules` (`.vite`, `.vitest-cache`, `.cache`) hold generated files and are
  left to Node.

**Writing.** A worker that added entries merges them, when it exits, with whatever is on disk and swaps
the result in by rename. Workers that exit together can lose each other's additions until the next run,
never correctness. A file that is cut short or damaged reads as empty.

**Worktrees.** The files live in each worktree's own `node_modules`, and every key is an absolute URL in
that worktree, so nothing is shared between worktrees.

**Switches.** On for local runs. Off when `CI` is set, because a fresh runner starts with an empty cache
and only pays to fill it (the cold runs below cost the same or a little more CPU than no cache).
`LANGWATCH_VITEST_MODULE_CACHE=0` turns it off and `=1` turns it on in CI. `LANGWATCH_VITEST_FAST=0`
drops it with the rest of fast mode.

## Rationale / Trade-offs

A per-file stat on every cached source is the price of never serving a stale file. Trusting the
lockfile alone would save that stat, but would miss a hand edit or a `pnpm patch` inside
`node_modules`. One stat is still cheaper than the open, read and close it replaces.

Resolutions are not checked per lookup. Checking would put back most of the stats the cache removes.
A hand edit to an installed package's `package.json` `exports`, without an install, is the case it
does not notice; deleting the cache directory fixes it.

Node's own compile cache, Vite's dependency optimiser and jsdom window reuse go after other parts of a
worker's time, and are separate decisions.

## Consequences

Measured on 2026-10-21, M1 Max, Node 24.22.0, Vitest 5.0.1, `VITEST_MAX_WORKERS=3`, on a shared machine
(load average 23 to 45). CPU time is user plus system for the whole process tree from `/usr/bin/time -l`,
off and on interleaved, three warm runs each. Every run passed the same set of tests.

| Suite                                                    | Tests | CPU off (mean) | CPU on (mean) | Change |
| -------------------------------------------------------- | ----- | -------------- | ------------- | ------ |
| `modules/trace/browser`, 91 unit files (jsdom, isolated) | 945   | 31.7 s         | 24.7 s        | -22%   |
| `modules/identity/process`, unit lane (node, isolated)   | 1,376 | 26.5 s         | 24.6 s        | -7%    |
| `apps/api` (node, isolation off, one worker per run)     | 77    | 59.6 s         | 57.1 s        | noise  |

System time on the trace UI halved (8.7 s to 4.7 s). The saving follows how many workers a run starts:
a suite with isolation off loads `node_modules` once per worker and gains little.

The cache costs about 50 MB per worktree (7.7 MB of resolutions and 43.5 MB of sources after these
three suites). A worker reads both whole when it starts, from the page cache in practice.

## References

- `dev/docs/best_practices/testing-speed.md`, "The module loading cache in the workers"
- `specs/ci/vitest-module-loading-cache.feature`
