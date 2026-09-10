# Testing speed

Every `vitest.config.ts` in the workspace goes through one helper,
`packages/test-harness/src/vitest-config.ts`. A package's own config says only
what is different about that package; the speed options are declared once.

```ts
import { defineModuleVitestConfig } from "../../../packages/test-harness/src/vitest-config.ts";

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

| key | value | why |
| --- | --- | --- |
| `test.pool` | `"forks"` | vitest 5's own default, declared so a package never drifts onto `vmThreads`, which cannot disable isolation |
| `test.isolate` | `false` for `kind: "node"`, `true` for `kind: "jsdom"` | a fresh worker per test file re-evaluates the whole module graph per file; off, the graph is evaluated once per worker |
| `test.fsModuleCache` | `true` | persists transformed modules to `node_modules/.vitest-cache` between runs, so a rerun skips the transform share |
| `test.fileParallelism` | `true` | the default, declared because `fileParallelism: false` silently pins `maxWorkers` to 1 |
| `test.watch` | `false` | a run in CI or from an agent never watches |
| `test.experimental.importDurations` | `{ print: "on-warn" }` | prints the per-import breakdown when an import crosses the warn threshold, which is how you find the module that costs the suite its time |
| `test.environment` | `"node"` or `"jsdom"` | per-file `@vitest-environment` docblocks still win |
| `test.exclude` | `["**/node_modules/**", "**/dist/**"]` | the default a package overrides when it has a second lane |

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
   nothing on a cold first run; it is a rerun and a second-process win.
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
  not clean up is visible to the next file. jsdom packages therefore default to
  `isolate: true` even when they are mock-free.

A package that fails only with isolation off has either a leak worth fixing or
a legitimate reason to keep it on. Record the reason in the config, next to
`isolate: true`.

## Reading `vitest doctor`

`pnpm --filter <package> exec vitest doctor` runs the suite under alternative
configurations and reports the measured difference rather than an estimate. It
names the files that would break with `isolate: false`, which is the list to
work through before flipping a mock-heavy package. Run it on one package at a
time: it runs the suite more than once.

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

One place is better than 126: setting `NODE_COMPILE_CACHE` once in
`dev/scripts/check-queue.mjs`'s environment, or in the root `package.json`'s
`test` fanout, covers every package without touching a manifest. Do not set it
in a `test:coverage` script.

## Sharding

`--shard=<index>/<total>` splits **test files**, not test cases. A shard writes
`--reporter=blob` and the shards are combined with `--merge-reports`. This is a
CI lever; it does nothing for a local run.
