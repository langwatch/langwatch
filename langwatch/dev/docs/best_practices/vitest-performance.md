# Vitest performance & memory

Why the unit config (`langwatch/vitest.config.ts`) is shaped the way it is, and
what we tried from <https://vitest.dev/guide/improving-performance> that did NOT
pay off. Numbers are from a controlled benchmark (2026-07-21) on
`src/features/traces-v2` (68 files, 705 tests) unless noted, `maxWorkers: 50%`.

## The pool: `vmForks`, not `vmThreads`

| pool | peak RSS | wall | notes |
|---|---|---|---|
| `vmThreads` (old) | **2.56 GB** | 8.2s | VM context leaks into the shared process heap |
| `vmForks` (now) | **573 MB** | 9.5s | child process reclaims everything on exit |

A VM pool (`vm*`) reuses a Node `vm` context, which is fast but leaks by design —
that's why `vmMemoryLimit` exists (recycle a worker before it grows unbounded).
Under `vmThreads` the leak lands in ONE shared process heap, so peak RSS climbs
with the number of concurrent workers. Under `vmForks` each worker is its own
process; when `vmMemoryLimit` recycles it, the OS reclaims 100% of it. ~4.5x less
peak RSS for ~15% more wall-clock — the right trade on laptops juggling several
worktrees. (Integration stays `pool: forks` — non-VM — for an unrelated reason:
`@prisma/client` panics constructing inside a worker thread. See that config.)

## `isolate: false`

Reuses one VM context across the files in a worker instead of a fresh module
registry per file. Verified correct across 172 sampled files (traces-v2 + a broad
`src/server` slice, 0 failures) because the suite already resets shared state
between tests. Small marginal RAM win on top of `vmForks` (~40 MB on the subset).
The full-suite CI `test-unit` shards are the real scale check; **if a shard ever
flakes, drop `isolate: false` first** — it is the only setting here that trades
isolation for speed.

## What we rejected

- **`deps.optimizer` (esbuild pre-bundle of deps).** Measured a **~2x wall-clock
  regression** (9.3s → 16.8s) with negligible RAM benefit, and it did NOT
  amortize on a warm second run. The blanket form bundles everything, adding
  transform overhead this ESM-first, 686-`vi.mock` suite doesn't recover. A
  narrowly-scoped `optimizer.*.include` list of specific CJS-heavy deps might
  help, but that's a per-dep investigation, not a blanket win — do not enable it
  blanket.
- **`isolate: false` on integration.** Integration runs `fileParallelism: false`
  with heavy per-file container state; reusing a context there is high-risk and
  low-reward. Left isolated.

## Rules that still stand

- Never hand-roll a throwaway config or run bare `npx vitest` — you drop
  `maxWorkers`/`vmMemoryLimit` and spawn a fork per core. Go through
  `pnpm test:unit run <path>` / `pnpm test:integration run <path>`.
- Scope the run to a path instead of reaching for `--maxWorkers=1` (which
  serialises and keeps memory resident far longer).
