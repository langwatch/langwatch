# Tooling

Why the repo has the tools it has, and how they fit together.

The short version: one workspace, about 240 packages, and several agents
working on one laptop at once. Every tool here exists to answer one of three
questions:

1. **Is it right?** Lint, typecheck, test.
2. **Did we only redo what changed?** Nx and its cache.
3. **Will the laptop survive it?** haven's slots.

```
   you / an agent edits a file
               |
               v
   +-----------------------+     is it right?
   |  oxfmt  oxlint  tsc   |     format, lint, types, tests
   |  vitest  enforcer     |
   +-----------------------+
               |
               v
   +-----------------------+     did we only redo what changed?
   |          Nx           |     hash the inputs, replay the answer
   |   ~/.nx cache (shared |     if we've seen them before
   |   by every worktree)  |
   +-----------------------+
               |
               v
   +-----------------------+     will the laptop survive it?
   |      haven slot       |     heavy runs queue for a machine-wide
   |  (tsc/oxlint/vitest   |     slot instead of all starting at once
   |   shims, tsgo caps)   |
   +-----------------------+
```

## The tools

| Tool                  | What it's for                                                                              | Where                                                   |
| --------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| pnpm 12               | One lockfile. The store is global, so a new worktree hardlinks instead of downloading      | `pnpm-workspace.yaml`                                   |
| Nx 23                 | Runs the `package.json` scripts, works out what a change affected, caches results          | `nx.json`, [ADR-150](adr/150-nx-task-runner.md)         |
| TypeScript 7          | `tsc` is native (Go) now. Fast, but it will happily eat all your RAM, hence `GOMEMLIMIT`   | root `typecheck` script                                 |
| oxlint                | Fast lint, plus our own rules in the `langwatch` plugin                                    | `.oxlintrc.jsonc`, `packages/oxlint-rules`              |
| oxfmt                 | Formatting. Nothing to decide, which is the point                                          | root `format` script                                    |
| architecture-enforcer | Whole-tree policies a single-file linter can't see (module boundaries, references, layout) | `packages/architecture-enforcer`                        |
| Go dev scripts        | Code generation and build checks that walk the whole tree                                  | `tools/devscripts`, run via `dev/scripts/devscripts.sh` |
| haven                 | Local stack per worktree, plus the machine-wide gate for heavy commands                    | `tools/thuishaven`, [LOCAL_STACK.md](LOCAL_STACK.md)    |

## Lint comes in three layers

Each layer is slower and sees more than the one before, so the cheap ones run
first.

```
  pnpm lint                 per project, no type info,     the fast rules, cached
     |                      + files outside projects     per project
  pnpm lint:changed         only what you changed and      seconds after the first
     |                      its dependents

  nx affected -t lint:types type-aware, per project,       cached per project
     |                      only what the change reached
  pnpm lint:architecture    the enforcer's whole-tree      CI blocks on it; run it
                            policies                       on demand
```

`lint` and `lint:types` aren't written in any `package.json`. A small plugin,
`dev/nx/lint-plugin.mjs`, adds them to every workspace package, so the targets
can't drift or go missing on a new package. `pnpm lint` (`dev/nx/lint.mjs`) runs
`lint` for every project, then oxlint once over the files no project owns.
`pnpm lint:changed` runs both for the uncommitted working copy plus the branch
since its merge base, with dependents of every changed project. It can miss a
finding that appears in an untouched file when the cause is something no Nx input
names, and it never runs the enforcer, so `pnpm lint:architecture` stays the
check before push. `pnpm lint:oxlint` is the plain whole-tree run, uncached.

## How the Nx cache knows it's stale

Nx hashes a task's inputs: the package's own files, the `production` files of
everything it depends on, and a few global configs (`sharedGlobals`,
`lintGlobals` in `nx.json`). Same hash, same answer, replayed from
`~/.nx/<workspace-id>/cache`.

```
  @langwatch/foo:typecheck
     inputs = foo/**  +  deps' production files  +  tsconfig.shared.json ...
                |
                v
           hash 9f2f...  ----- seen before? ----> yes: replay output, done
                |
                no
                v
           run it, store the result under 9f2f...
```

That only works if "everything it depends on" is true. A package that imports
`@langwatch/bar` without declaring it would never be rebuilt when `bar` changes,
and the cache would hand back a stale green. So `langwatch/package-boundaries`
refuses any `@langwatch/*` import the `package.json` doesn't declare. That rule
is what makes the cache trustworthy.

The cache lives per user, not per checkout, so every worktree shares it. Don't
set `NX_CACHE_DIRECTORY` locally: it turns the sharing off. The one exception is
haven's: a fork under `haven pr` or a `haven play` sandbox gets a private cache
and no daemon, because Nx runs that checkout's own plugins and trusted worktrees
replay whatever lands in the shared cache.

## Why some things are in Go

The dev scripts (`generate-modules`, `sync-references`, `ensure-built`) walk
the whole tree on every start, so they need to be quick. `devscripts.sh` runs them with `go run` when Go is
installed, or a prebuilt binary in Docker.

## Builds

Every build is an Nx `build` target, JS and Go alike, cached and
affected-aware:

```bash
pnpm exec nx run @langwatch/ui:build        # one package, deps first
pnpm exec nx run haven:build                # .bin/haven/haven, consoles first
pnpm exec nx run-many -t build -p tag:go    # every Go binary
pnpm build:affected                         # only what your change reached
```

`dev/nx/go-plugin.mjs` makes one project per `cmd/<name>`, writing
`.bin/<name>/<name>`, and a `go` project for the module (`test:go`,
`lint:go`). A Go input change reruns every binary; the rerun is an incremental
`go build`, so that costs little. The hot paths (`devscripts.sh`,
`make service`) stay on `go run`: Go's own cache is faster there than an Nx
cache hit. [ADR-150](adr/150-nx-task-runner.md) has the numbers.

Charts, generators and the repo-wide steps are targets too:

```bash
pnpm exec nx run-many -t helm:deps helm:lint helm:template -p tag:helm
pnpm exec nx run workspace:build:types      # tsc -b; `pnpm build:types` calls it
make herrgen lint-rules test-scripts        # each calls its cached Nx target
```

## What "prepare" does

`pnpm start:prepare:files` runs before the stack starts:

```
  generate-modules  ->  modules/catalogue.json becomes the generated module lists
  nx run-many       ->  prisma:generate, generate:langy-skills, generate:feature-map,
                        generate:setup-skill-bodies, generate:evaluators (all cached)
  ensure-built      ->  rebuild the few packages that ship built output,
                        only if stale, through Nx so it's usually a cache hit
```

## Everyday commands

```bash
pnpm typecheck:affected      # typecheck only what your change reached
pnpm test:affected           # same for tests
pnpm lint:types:affected     # same for type-aware lint
pnpm lint                    # fast lint, cached per project
pnpm lint:changed            # the same for what you changed and its dependents
pnpm lint:architecture       # whole-tree policies
pnpm typecheck               # the whole lot, cold. Slow, and queues for a slot
```

If a heavy command sits there saying it's queued, haven is waiting for a slot.
It hasn't hung.
