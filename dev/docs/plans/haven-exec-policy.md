# haven: one execution policy for heavy dev commands

Status: plan, 2026-10-11. Design only; nothing here is built. Section 8 lists the
decisions that need Alex before phase 2. Builds on ADR-090 (one governor, one
counter), ADR-095 (tsgo caps and watchdog), ADR-100 (memory ceiling), ADR-150
(Nx) and `typescript-cpu-and-check-time.md` step 1.

## 1. Today: three counters that do not see each other

| Mechanism                                 | Reached by                                                        | Counter                                                    | Caps it sets                                                               |
| ----------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------- |
| haven `checks` pool (`slot.go`, `run.go`) | agent shells via the gate hook (pattern match), manual `slot run` | flock on `~/.langwatch/portless/locks/checks/slot-N`       | `GOMEMLIMIT` 3-6 GiB (`CheckGoMemLimit`); `GOMAXPROCS` only under pressure |
| typescript launcher patch (`db2c722bba`)  | every `tsc` start except `--watch/-v/-h/--lsp`                    | mkdir folders in `~/.cache/langwatch/tsc-slots`, default 2 | `GOMAXPROCS=2`, `GOMEMLIMIT=2GiB` (below ADR-100's 3 GiB floor)            |
| Nx (`nx.json` `parallel: 2`, scripts)     | every `pnpm` / `make` / haven path into Nx                        | none machine-wide; 2 tasks per Nx run                      | none                                                                       |

Overlaps found in the code:

- A gated run holds a `checks` slot, then each `tsc` inside takes a `tsc-slots`
  slot too: one run counted in two pools, neither knowing the other.
- `checks` resolves to 1 slot under pressure (red on this machine at
  2026-10-11 00:25, load 40-52); `tsc-slots` stays at 2 whatever the pressure.
- The `haven-nx.feature` scenario now says an agent typecheck is one root
  `tsc -b` under one slot with no `NX_PARALLEL`, superseding `11331ae102`'s "one
  slot per Nx task".
- `~/.langwatch/portless/locks/` holds ~150 stale `up-*` lock folders; only
  `checks` is a slot pool.
- Rush gates agent commands by load. With launchers in place, a rush-admitted
  command queues a second time in haven. Out of scope; whoever owns rush picks
  one admission per command.

## 2. How a launcher takes a haven slot

The slot is an flock (`adapters/semaphore`): the kernel drops it when the holder
dies, and it works with the daemon down. That rules the options:

| Option                                                  | Verdict    | Why                                                                                                                                            |
| ------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Launcher `execve`s `haven machine slot run -- <cmd>` | **chosen** | Same flock and registry as every other run; haven holds the slot and is the parent, so kill -9 anywhere frees it; node leaves the process tree |
| B. Unix socket to the daemon                            | rejected   | Needs the daemon up (the semaphore exists so it need not be); a socket held by node is closed by `execve` (CLOEXEC)                            |
| C. Node reads the registry and takes the lock itself    | rejected   | Node has no `flock(2)`; a native addon in a TypeScript patch is a non-starter, and a second mkdir protocol is two counters again               |

Reading haven's files directly is right for **status** (pressure, limits,
holders): 0.06 ms in node. It is wrong for **acquisition**.

Measured per start (2026-10-11 00:25, load 40-52, so read as upper bounds;
each figure minus the 12 ms spawn floor of the harness):

| Step                                                          | Net cost    |
| ------------------------------------------------------------- | ----------- |
| node start (`node -e 0`)                                      | ~46 ms      |
| today's lock folder take + release, in node                   | 0.44 ms     |
| node reads `pressure.json` + `holders/checks` + `limits.json` | 0.06 ms     |
| haven binary start (`haven --version`)                        | ~14 ms      |
| `haven machine slot run -- true`, as built                    | **~96 ms**  |
| of which: the `vm_stat` + `sysctl` pressure probes (MemStat)  | ~80 ms      |
| `tsc --version` via the patched launcher vs the native binary | 75 vs 17 ms |

Option A costs ~96 ms per start today. ADR-090 already says "the daemon
publishes pressure; the callers read it" (stale after 90 s reads green), yet
`slot run` probes the machine itself. Reading `pressure.json` instead is the
phase 1 fix and projects to ~15 ms per start: haven's own start plus a
microsecond flock. Against a typecheck of seconds that is under 1%.

Nested runs pass through: haven's child gets `CHECK_SLOTS=0` and
`CHECK_QUEUE_HELD=<pid>`, which haven verifies as a live ancestor. The outer
holder wins (ADR-090), so a launcher inside a gated run never takes a second
slot and cannot deadlock on a one-slot red machine.

**Fallback with haven absent:** the launcher looks for haven at `HAVEN_BIN`,
then `PATH` (stat calls, ~0.1 ms). Not found: today's lock folder, unchanged.
Found: haven only, and the lock folder is never touched. On CI haven is absent
and the lock folder applies, as it does today.

## 3. What a haven Nx plugin can and cannot do (Nx 23.2.1)

Read in `node_modules/nx/dist/src`: `NxPlugin` exposes `createNodes`,
`createDependencies`, `createMetadata`, `preTasksExecution`,
`postTasksExecution`. Nothing runs per task.

| Want                                | Possible? | How / why not                                                                                                                                                                                 |
| ----------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Set parallelism from haven's limits | **No**    | `nxArgs.parallel` is resolved by `readParallelFromArgsAndEnv` while parsing args (`command-line-utils.js:128`), before `runPreTasksExecution` (`run-command.js:331`); the context is readonly |
| Set env for every task              | Yes       | `preTasksExecution` returns env that Nx merges into `process.env` before tasks fork (`applyProcessEnvs`), daemon or not                                                                       |
| Report the run to haven             | Yes       | `postTasksExecution` gets `taskResults`, `startTime`, `endTime`: per-task durations for haven's run history (the admission estimates use them)                                                |
| Share the cache                     | Already   | ADR-150's shared cache; haven diverts only untrusted checkouts (`domain/overlay.go:187`). A plugin adds nothing                                                                               |
| Per-task slot acquisition           | **No**    | no per-task plugin hook; per-task lifecycles need a custom tasks runner, which is the wrong layer                                                                                             |

**Launchers already cover Nx-run tasks.** All but one `test` target are `vitest run` (one is Playwright)
and every typecheck is `tsc`, started through `node_modules/.bin` by the
script Nx runs, so each task meets its launcher. Not covered: targets that
start Go tools directly (`golangci-lint`, `go build`, the lint runner `go run ./cmd/lintrun`);
those stay with the gate.

Parallelism therefore comes from the environment before Nx starts
(`NX_PARALLEL` in scripts, Makefile `NX :=` prefix, haven's overlay) or
`nx.json`. With launchers bounding the heavy work, `NX_PARALLEL` can rise to 4
so cache restores and light tasks flow while heavy tasks queue in their
launchers (decision D3).

## 4. Slot classes and defaults (10 cores, 64 GB)

Proposal (decision D1): keep ADR-090's **one counter**, counted in core units.
Each class takes a weight and gets per-run caps. A budget of units replaces
today's run count.

| Budget                 | Green | Amber | Red |
| ---------------------- | ----- | ----- | --- |
| core units (cores - 2) | 8     | 4     | 2   |

| Class       | Started by                              | Weight (units)                     | Per-run caps                                                                                               | Concurrent at green |
| ----------- | --------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------- |
| `typecheck` | tsc launcher, `haven machine typecheck` | 2                                  | `GOMAXPROCS=2`; `GOMEMLIMIT` from `CheckGoMemLimit` (6 GiB green, 3 GiB under pressure)                    | 4                   |
| `test`      | vitest launcher                         | = workers, 2 by default, at most 4 | `VITEST_MAX_WORKERS=2` unless set; integration lanes still withdraw it (`integration-file-concurrency.ts`) | 4                   |
| `lint`      | oxlint launcher (phase 6), gate         | 2                                  | oxlint `--threads 2`; tsgolint `GOMAXPROCS=2`                                                              | 4                   |
| `build`     | vite / `build:types`, gate              | 2                                  | `GOMAXPROCS=2`, `GOMEMLIMIT` as typecheck                                                                  | 4                   |

Worst case at green: 8 cores and about 24 GiB of `GOMEMLIMIT`; colima's 5 cores
and the stacks sit outside the budget, as today. A waiter takes all of its
units in one tick or none; the existing priority yield
(`shouldYieldToHigherPriority`) stops small runs starving a large one at the
head of the queue.

## 5. The Vitest launcher patch

`patches/vitest@5.0.1.patch` on `vitest.mjs` (two lines today: it imports
`dist/cli.js`), the same shape as the typescript patch.

| Invocation                                                                  | Behaviour                                                                                  |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `vitest run`, `--run`, `related`, or no subcommand with no TTY or with `CI` | take a `test` slot: `execve` haven `slot run --class test -- node <vitest>/dist/cli.js …`  |
| `vitest`, `watch`, `dev`, `-w/--watch` in a TTY                             | **no slot**; `VITEST_MAX_WORKERS=2` default; registered as a watcher so status can show it |
| `--version`, `--help`, `list`, `init`                                       | no slot, no defaults                                                                       |
| inside a held run (`CHECK_QUEUE_HELD`)                                      | haven passes through; the outer holder wins                                                |

A watcher holds no slot because it idles between reruns for hours. Taking a
slot per rerun needs a hook inside vitest's watcher, not the launcher; not
worth it while a rerun is one changed file. The extra cost per run is a second
node start (~46 ms) plus haven (~15 ms after phase 1) on a run of seconds.

## 6. Background QoS on macOS

Measured on `modules/auth/process` (2,295 files, ~585 MB, `GOMAXPROCS=2`),
three alternating rounds, load 26-40:

| Mode                         | Wall time     | vs plain      |
| ---------------------------- | ------------- | ------------- |
| plain                        | 1.65 - 2.09 s | -             |
| `taskpolicy -c utility`      | 1.84 - 2.08 s | about +5-15%  |
| `taskpolicy -b` (background) | 13.8 - 65.4 s | **x8 to x30** |
| `taskpolicy` exec itself     | ~28 ms        | -             |

- **Never `-b` on a launcher path.** Every check has someone waiting, an agent
  on a five-minute cache included. Background also throttles disk I/O and
  parks the run on efficiency cores.
- **`-c utility` for agent-originated runs** (`CLAUDECODE` or `HAVEN_AGENT_ID`
  set), applied once by haven when it starts the child. A person at a terminal
  keeps the default band (ADR-090: a human is never tightened).
- **Risk in the existing daemon:** at amber it demotes unfocused stacks with
  `-b`, and anything forked from a demoted group inherits the band. A check
  started from a demoted stack lane would crawl at x8 to x30.
- Re-measure on a quiet host before adopting utility broadly; at this load the
  utility figures sit inside the noise.

## 7. In `haven status`

One block under the shared services, and the same data under `"slots"` in the
JSON form:

```
ok   slots  6/8 units (green)  typecheck 2 · test 1 · watchers 1
     typecheck  pid 4121  feat-x      tsc -b              1m12s
     test       pid 4380  issue123    vitest run (2w)     0m20s
     waiting    2: lint (issue9, 0m40s), typecheck (feat-y, 0m05s)
warn fallback tsc-slots in use by 1 run (a launcher that found no haven)
```

The holders and waiters come from the registry `slot explain` already reads;
the claim gains `class`, `units` and `worktree`. A non-empty
`~/.cache/langwatch/tsc-slots` shows as `warn`: a run outside the one counter.

## 8. Decisions (ruled by Alex, 2026-10-11: D1-D5 as recommended)

| #   | Decision                                                                                 | Recommendation                     | Why                                                                                                         |
| --- | ---------------------------------------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| D1  | Slot classes as weights on ADR-090's one counter, or one flock pool per class            | weights on one counter             | Per-class pools are ADR-090's rejected "many limits": their sum is unbounded unless a ceiling is added back |
| D2  | `GOMAXPROCS` always the class weight, not only under pressure (amends `CheckGoMaxProcs`) | always                             | A green typecheck today may take every core while counted as one run; the weight is a lie without it        |
| D3  | `NX_PARALLEL` 4 once launchers ship (from 2)                                             | 4, in the scripts and overlay      | Queued tasks wait in launchers; light and cached tasks stop waiting behind them                             |
| D4  | The gate stops wrapping `tsc` / `vitest` / Nx typecheck and test once launchers own them | yes, keep red refusal              | A wrapped `pnpm test:unit` holds one slot for an Nx run of many tasks; the launchers count them truly       |
| D5  | `-c utility` for agent-originated runs                                                   | yes, after a quiet-host re-measure | Cheap here; protects the person's UI                                                                        |

## 9. Phases

Each phase ships alone and leaves the machine no worse.

| #   | Phase                                                                                                                                         | Needs  | Proves it                                                                                                                                                                               |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `slot run` / `slot explain` read the published `pressure.json` (stale reads green, ADR-090) instead of probing                                | -      | `go test ./tools/thuishaven/cmd/ -run Slot`; median of 15 `haven machine slot run -- true` under 25 ms (from ~108 ms gross)                                                             |
| 2   | `--class` on `slot run`: weights, unit budget, per-class env, all-or-nothing multi-unit acquire; claims carry class, units, worktree          | D1, D2 | new scenarios in `specs/setup/check-slots.feature` (budget by pressure, weight, no starvation at the head); `go test ./tools/thuishaven/domain/ ./tools/thuishaven/adapters/semaphore/` |
| 3   | typescript patch: with haven found, `execve` `haven machine slot run --class typecheck -- <tsc> …`; lock folder only as fallback              | 2      | `tsc --noEmit --ignoreConfig f.ts` shows as a holder in `slot explain`; inside `slot run` it takes no second slot; kill -9 frees it; with haven off `PATH` the lock folder is used      |
| 4   | vitest patch (section 5)                                                                                                                      | 2      | `vitest run` holds a `test` slot; `vitest` in a TTY holds none; `@langwatch/coding-agent-process test:integration` stays serial                                                         |
| 5   | `haven status` slots block and JSON key                                                                                                       | 2      | `go test ./tools/thuishaven/app/ -run Status`; status during a run of phases 3-4                                                                                                        |
| 6   | Nx plugin `dev/nx/haven-plugin.mjs`: `preTasksExecution` env (run id), `postTasksExecution` task durations to haven's run history via the CLI | 2      | one `pnpm test:affected` leaves per-task rows in `run-history.jsonl`                                                                                                                    |
| 7   | `NX_PARALLEL` (D3), gate unwrapping (D4), utility band (D5)                                                                                   | D3-D5  | gate unit tests in `domain/gate_test.go`; a whole-tree `pnpm typecheck` and `pnpm test:affected` under load with no unit over budget in `slot explain`                                  |
| 8   | oxlint and build launchers (classes `lint`, `build`); retire the gate's oxlint pattern                                                        | 7      | as phase 3, per binary                                                                                                                                                                  |
