# Testing speed

Every `vitest.config.ts` in the workspace goes through one helper,
`packages/vitest-config/src/vitest-config.ts`. A package's own config says only
what is different about that package; the speed options are declared once.

```ts
import { defineModuleVitestConfig } from "@langwatch/vitest-config";

export default defineModuleVitestConfig({
  kind: "node",
  isolate: false,
  test: { include: ["src/**/*.test.ts"] },
});
```

A config that also needs a top-level Vite block (`resolve.alias`, `esbuild`)
uses the other export instead, and keeps its own `defineConfig`:

```ts
export default defineConfig({
  resolve: { alias: { ... } },
  test: moduleVitestTestOptions({ kind: "node", isolate: false }),
});
```

The import is a relative path on purpose. 101 of the 126 packages that own a
config do not declare `@langwatch/test-harness` as a dependency, and a config
file is bundled by Vite before it runs, so a relative specifier needs no
manifest change and no install. If the manifests ever gain the dependency, the
specifier can become `@langwatch/test-harness/vitest-config` in one pass.

## What the helper sets, and why

| key                    | value                                                          | why                                                                                                                                                                                                              |
| ---------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test.pool`            | `"forks"`                                                      | vitest 5's own default, declared so a package never drifts onto `vmThreads`, which cannot disable isolation. `isolateIn: "vm-context"` moves only the isolated files onto `vmForks`, see below                   |
| `test.isolate`         | `false` for every kind, `jsdom` included                       | a fresh worker per test file re-evaluates the whole module graph per file; off, the graph is evaluated once per worker. `true` isolates only the files that mock modules, see below                              |
| `test.maxWorkers`      | `1` in fast mode, when isolation is off                        | collapses the run onto one child process instead of one per core, cutting fork/spawn overhead on top of the isolation win. Not set when a package asks for `isolate: true`, where separate workers are the point |
| `test.fsModuleCache`   | `true` in fast mode                                            | persists transformed modules to `node_modules/.vitest-cache` between runs, so a rerun skips the transform share                                                                                                  |
| `test.execArgv`        | `--import` of the module loading cache in fast mode, off in CI | answers Node's resolution and reads of installed packages in each worker from a per-worktree cache, described below. Dropped with fast mode, and with `LANGWATCH_VITEST_MODULE_CACHE=0`                          |
| `test.css`             | `false` in fast mode                                           | skips CSS parse/transform on import; no package under the helper asserts on real computed CSS                                                                                                                    |
| `test.fileParallelism` | `true`                                                         | the default, declared because `fileParallelism: false` silently pins `maxWorkers` to 1                                                                                                                           |
| `test.watch`           | `false`                                                        | a run in CI or from an agent never watches                                                                                                                                                                       |
| `test.environment`     | `"node"` or `"jsdom"`                                          | per-file `@vitest-environment` docblocks still win                                                                                                                                                               |
| `test.exclude`         | `["**/node_modules/**", "**/dist/**"]`                         | the default a package overrides when it has a second lane                                                                                                                                                        |

`kind: "unit"` is `kind: "node"` plus the console-output guard. It does not
change isolation.

## Fast mode, and the one environment variable that outranks it

`LANGWATCH_VITEST_FAST` is on unless it is set to `0`. Off, the helper drops
`maxWorkers`, `fsModuleCache`, `execArgv` and the CSS skip and returns the pre-fast-mode
shape, so a package with a suite that breaks under one of them can opt a single
run out without editing this helper or its own config.

`test.maxWorkers` is a request, not a guarantee. vitest applies
`VITEST_MAX_WORKERS` _after_ it resolves the config, so an exported worker count
wins over the `1` above - which is what CI wants, since it sets the runner's
physical core count. A suite that must be serial for correctness therefore
withdraws the variable rather than trusting the helper; see
`packages/test-harness/src/integration-file-concurrency.ts`.

This replaced `poolOptions.forks.singleFork`. vitest 4's pool rework removed
`test.poolOptions` wholesale and moved every option in it to the top level, so
a config still carrying that block is not slow - it is inert, and vitest only
warns. Anything reintroducing `poolOptions` (including
`poolOptions.vmForks.memoryLimit`, now `vmMemoryLimit`) is reintroducing that
warning. https://v4.vitest.dev/guide/migration#pool-rework

`test.dir` is a parameter, not a default. It limits the directory vitest scans
for test files, and it is only correct when every include pattern sits under
that directory - a package with both `src/` and `tests/` must not set it.

## Why isolation is the lever

Alex's measurement on one suite, before any change:

> Duration 32.83s (import 54%, transform 24%, tests 22%, worker 1%). Import:
> 946 modules were evaluated 2055 times, 28.02s total, 54% of tracked time;
> ~4.19s faster with `isolate: false`, shared modules are evaluated once per
> worker instead of once per file.

946 modules evaluated 2055 times is the whole story: with isolation on, every
test file re-imports the module graph its barrel file drags in. Import is the
majority of a typical run here, tests themselves are a fifth of it. vitest 5
prints that hint itself at the end of a run, so the "Import" line in the
Duration summary is the measurement - capture it before and after any change.

The three levers, in the order they pay:

1. **`isolate: false`** - the only one that changes the 2055 down towards 946.
   It applies to a whole package, and it is safe only where nothing depends on
   a clean module registry.
2. **`fsModuleCache: true`** - attacks the transform share (24% above). It does
   nothing on a cold first run; it is a rerun and a second-process win. In CI
   the package-suites job restores `node_modules/.vitest-cache` per shard, only
   for the same lockfile, manifests and tsconfigs
   (`specs/ci/package-suites-transform-cache.feature`). A package with no
   vitest config passes `--fsModuleCache` on its script instead, which
   `go run ./cmd/ciguard` enforces.
3. **Import cost itself** - `deps.optimizer` and `server.deps.inline` change how
   a heavy dependency is pre-bundled. Not set by the helper: the optimizer is
   per-dependency tuning, and a wrong entry changes what a test resolves. Reach
   for it only after `vitest doctor` says imports still dominate.

## When a package may not turn isolation off

The rule used to pick the current settings: a package keeps `isolate: true`
when any of its test files or setup files names `vi.mock`, `vi.doMock`,
`vi.unmock`, `vi.doUnmock` or `vi.resetModules`. A hoisted `vi.mock` rewrites
the module registry for the file that declares it, and with a shared worker
that registry outlives the file - the next file in that worker gets the mock.
An earlier attempt to turn isolation off on an integration lane broke on
exactly this.

Two further reasons, both worth checking before flipping a package:

- **Module-level state.** A module that memoises a client, a registry or a
  counter at import time keeps it across files.
- **`window` and friends.** A jsdom package shares one document between files
  when isolation is off, so anything a test appends to `document.body` and does
  not clean up is visible to the next file. jsdom packages get no exemption from
  the `isolate: false` default, so a jsdom suite that leaks DOM state between
  files has to clean up after itself or set `isolate: true` explicitly.

A package that fails only with isolation off has either a leak worth fixing or
a legitimate reason to keep it on. Record the reason in the config, next to
`isolate: true`.

## `isolate: true` isolates only the files that need it

`isolate: true` no longer isolates the whole suite. `defineModuleVitestConfig`
reads the suite's test files and splits it into two vitest projects: the files
that name one of the calls above (`vi.mock`, `vi.doMock`, `vi.unmock`,
`vi.doUnmock`, `vi.resetModules`) run in `isolated`, and every other file runs
in `shared-modules`, where each worker loads the module graph once. The scan
follows a test file's relative imports, so a shared harness that calls `vi.mock`
isolates every file importing it. A setup file's mocks apply to every file
alike, so they do not count.

A leak the scan cannot see, typically a module that patches the DOM when it
first loads, goes in `alsoIsolate`: globs, relative to the package, matched
against each test file and everything it imports by relative path.
`packages/design-system` isolates every test that reaches `.storybook/**`,
because Storybook patches `HTMLElement.prototype.focus` on load. On the trace
explorer suite the split took a run from 199s to 132s with every file passing.

So the way to make a suite faster is to make its files stop mocking modules: a
test that renders inside a fake of the host port it needs, rather than
`vi.mock`ing the port, moves to `shared-modules` the moment its last mock goes,
with no list to edit. `isolate: "all"` restores the old whole-suite isolation
for a suite whose files leak state some other way (module-level state, DOM left
behind); say why next to it. The split happens in fast mode only, for every
config built with either helper, whether `isolate` is a top-level option or
set in the `test` block. A suite where no file mocks runs with isolation off.

Two vitest projects mean two labels in the output, `shared-modules` and
`isolated`, and `--project <name>` runs one of them. A project with
`extends: true` concatenates array options with the root config, so the
suite's `include` moves onto `shared-modules` instead of staying on the
root; left there, `isolated` would collect every file as well as its own.

`packages/browser` uses `isolate: "all"`: its files share module-level
singletons (the capability host, the feedback host, the posthog client), which
no mock scan can see. `apps/ui` used to, for the same stated reason, but its
failures with files sharing a worker turned out to be two tests leaving the
jsdom window changed: one left a `navigator.clipboard` stand-in behind, and one
emptied `document.head`, dropping the style tags the design system's style
cache still pointed at. With those two cleaning up after themselves it uses
`isolate: true`. In a jsdom suite, a file that changes `navigator`, `document`
or `window` puts back exactly what it changed, not a blanket reset.

## Isolated jsdom files can share a worker

An isolated file on the forks pool gets a process of its own, and every one of
those processes loads jsdom's code again: about 700ms of CPU, against about
6ms to build another window once jsdom is loaded. `isolateIn: "vm-context"`
runs a suite's isolated files on `vmForks` instead. A worker loads jsdom once,
and each file still gets a fresh module registry and a fresh window, in a `vm`
context of its own. The files that share modules stay on forks. See ADR-184.

```ts
export default defineModuleVitestConfig({
  kind: "jsdom",
  isolate: true,
  isolateIn: "vm-context",
  needsOwnProcess: [
    // Stubs `window.location`, which a vm context's window will not let go.
    "src/__tests__/reload.integration.test.tsx",
  ],
});
```

Two kinds of file can't run in a `vm` context. List them in `needsOwnProcess`
and say why; they run under `own-process`, a process each:

- a file that stubs or spies on `window.location`, which is fixed on a
  context's window (`Cannot redefine property: location`);
- a file that loads a native module checking its arguments against Node's own
  `String` or `RegExp`, such as Vite's bundler (`Value is none of these types`).

A file that asks for `@vitest-environment node` gets a process without being
listed. Each worker restarts once its heap passes 1 GB after a file. The trace
UI suite and `apps/ui` opt in; fast mode off keeps a process per file.

With isolation off, the summary's "environment" share overstates the cost:
vitest sets the environment up once per worker but adds that one setup time to
every file the worker runs.

## Reading `vitest doctor`

`pnpm --filter <package> exec vitest doctor` runs the suite under alternative
configurations and reports the measured difference rather than an estimate. It
names the files that would break with `isolate: false`, which is the list to
work through before flipping a mock-heavy package. Run it on one package at a
time: it runs the suite more than once.

## The module loading cache in the workers

Vitest hands everything it does not transform (Vitest's own runtime, jsdom, React,
most of `node_modules`) to Node's own loader in each worker. Under isolation every
test file gets a new worker, and Node resolves and reads the same few thousand
installed files again in each one. In fast mode the helper adds
`--import packages/vitest-config/src/module-loading-cache/register.ts` to
`test.execArgv`, which answers those lookups and reads from two files under this
worktree's `node_modules/.cache/vitest-module-loading/`.

- **What it caches.** A resolution only when its answer is a file in an installed
  package, and only when no project file can change it (a package name, or any
  specifier from inside `node_modules`). A file's source only for files in installed
  packages, and it is served only while the file's size, modification time and inode
  match what was read, so an edited file is read again, never served stale. Dot
  directories under `node_modules` (`.vite`, `.vitest-cache`) are left to Node.
- **When it starts again.** The file names carry the lockfile, pnpm's
  `node_modules/.modules.yaml` (rewritten on every install) and the Node version, so
  an install or a Node upgrade starts fresh files and the next save removes the old.
- **Worktrees.** The files live in each worktree's own `node_modules`, so nothing is
  shared between worktrees.
- **Switching it off.** On for local runs, off when `CI` is set: a fresh runner only
  pays to fill it. `LANGWATCH_VITEST_MODULE_CACHE=0` turns it off,
  `LANGWATCH_VITEST_MODULE_CACHE=1` turns it on in CI. `LANGWATCH_VITEST_FAST=0` drops
  it with the rest of fast mode. If you suspect it, delete the directory.

The design and the before and after numbers are in
[ADR-183](../adr/183-vitest-workers-cache-module-loading.md).

## `NODE_COMPILE_CACHE`

V8 bytecode caching is an environment variable, not a config key, so it has to
be set on the command that runs vitest. vitest disables it in workers when the
`v8` coverage provider is on, so it belongs on the plain test scripts only.

The scripts are the coordinator's, not this change's. The line to change is the
`"test:unit"` entry in each package's `package.json`, from:

```json
"test:unit": "vitest run --exclude \"**/*.integration.test.ts\""
```

to:

```json
"test:unit": "NODE_COMPILE_CACHE=node_modules/.node-compile-cache vitest run --exclude \"**/*.integration.test.ts\""
```

One place is better than 126: setting `NODE_COMPILE_CACHE` once in the root
`package.json`'s `test` fanout covers every package without touching a
manifest. Do not set it in a `test:coverage` script.

## Sharding

`--shard=<index>/<total>` splits **test files**, not test cases. A shard writes
`--reporter=blob` and the shards are combined with `--merge-reports`. This is a
CI lever; it does nothing for a local run.
