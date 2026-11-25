# TypeScript: bounded CPU and RAM, then less work per check

Status: plan, 2026-10-10. Builds on `typescript-tidy-projects.md` §13 (its levers
are the source of truth; this plan orders them after the nx-sync layout landed).

## Facts (measured 2026-10-10 unless dated)

| Fact                                                                                                                | Number                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Root check with `--builders 1 --checkers 1`                                                                         | still ~400% CPU: Go GC and parse threads ignore both flags                                                                            |
| Haven queue on a 10-core, 64 GB Mac                                                                                 | 2 concurrent checks; `GOMAXPROCS` set only under memory pressure                                                                      |
| Projects in `tsc -b`                                                                                                | ~520: 244 build, 247 test, 32 app                                                                                                     |
| Test configs that re-include all of `src/**` beside a build config                                                  | 236 of 247 (source checked twice)                                                                                                     |
| api app program                                                                                                     | 4,314 files, 929k lines, almost all emitted `.d.ts`; own check 0.8s                                                                   |
| Emitted `*.server.d.ts` / `*.trpc.d.ts` (2026-09)                                                                   | 20-540x their source                                                                                                                  |
| Cold root build (2026-09-23, quiet host)                                                                            | 183s wall, ~1,100 CPU-s, ~5.9 GB peak                                                                                                 |
| nx-sync commit (`build(typescript): adopt nx sync`)                                                                 | last recorded 1,160 errors; full capped run on HEAD: 43 (39 one Card variant type)                                                    |
| Capped root check (`GOMAXPROCS=2`)                                                                                  | 110-150% CPU, 3.5 GB peak (was ~400%)                                                                                                 |
| Longest reference chain                                                                                             | 27 configs (~25 sequential compiles); 2026-09 figure was 17                                                                           |
| Same, without the 142 build-config refs to test-only `vitest-config` and 190 declared-but-unimported workspace deps | 21                                                                                                                                    |
| What remains                                                                                                        | 8 contracts in a row, real imports: organization → project → data-privacy → evaluation → evaluator → trace → instant-eval → analytics |

### Cold profile after the reshape (2026-10-10 18:18, load ~25, `GOMAXPROCS=2`)

Wall time is void at that load (939s); per-phase sums and shares are what to read.
479 projects built, 0 errors, 3.5 GB peak.

| Phase           | Seconds |     | Group                | Share of parse+check+emit |
| --------------- | ------- | --- | -------------------- | ------------------------- |
| Check           | 270     |     | browser build (45)   | 27% (35s of it emit)      |
| Emit            | 101     |     | process test (65)    | 24%                       |
| Config          | 88      |     | process build (65)   | 16% (35s of it emit)      |
| Parse           | 43      |     | contracts build (64) | 5%                        |
| Changes compute | 22      |     | apps (18)            | 5%                        |

- The 8-contract spine costs 3.8s in total (trace's 1.4s the largest): not worth an ownership move.
- Biggest single programs: `apps/ui` app (11s check, 22M instantiations), trace/experiment/scenario browser builds (7-11s), `packages/api` test and type-tests (3.3-3.6M instantiations).
- Declaration emit is ~100s of ~415s compile work (24%), most of it in browser and process builds: step 5's target.

## Steps

| #   | Step                                                                                           | Status                                                          | Result                                         |
| --- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------- |
| 1   | Cap the compiler: `GOMAXPROCS=2 GOMEMLIMIT=2GiB` on every pnpm typecheck script and Nx command | done (686b70fa72)                                               | 110-150% CPU, 2-3.5 GB                         |
| 2   | Green on the nx-sync layout                                                                    | done                                                            | 43 → 0 errors                                  |
| 3   | Per-project profile                                                                            | done under load (table above); quiet-host wall times still owed | contracts 5%, emit 24%                         |
| 4   | Check source once: test configs hold only tests (+ ambient `.d.ts`)                            | done (1feceedf52)                                               | 242 configs                                    |
| 5   | Internal declaration emit                                                                      | **open, ruling needed**                                         | target ~100s emit + downstream `.d.ts` loading |
| 6   | Smaller declarations (named schemas)                                                           | another session                                                 |                                                |
| 7   | Shorter chains: unused workspace deps, `vitest-config` out of build refs, enforcer check       | done (1feceedf52, enforcer commit)                              | 27 → 17                                        |
| 8   | Hotspots: `apps/ui` (22M instantiations), `packages/api` test programs (3.5M each)             | next                                                            |                                                |
| 9   | Trial `assumeChangesOnlyAffectDirectDependencies`, local runs only                             | after 8                                                         |                                                |

The contract spine (organization → … → analytics) stays: 3.8s in total.

### Step 5 options

- **A. Delete internal emit.** Packages stop writing `.d.ts`; consumers read
  dependency source directly. Removes ~100s of emit and the `.d.ts` loading, and
  most of the 244 build projects. Cost: without declarations `tsc -b` cannot use
  references between them, so each app and test program type-checks its whole
  dependency closure from source; measured in 2026-09 at 4.5-8.3 GB for one
  program, which breaks the 2 GiB ceiling. Faster per edit of an export, heavier.
- **B. Emit with `noCheck`.** Build configs write `.d.ts` unchecked; source
  checking moves back into test configs. Net CPU about zero; only shortens the
  wait chain when several builders run, which the 2-core cap prevents. Not worth it.
- **C. Keep emit, shrink it.** Step 6 (named schemas) plus step 8 hotspots. No
  layout change; RAM stays bounded.

### Trial: compile units per module (2026-10-11, not adopted)

Worktree branch `feat/ts-compile-units` (a485d9f69c, codemod `dev/scripts/compile-unit-codemod.mjs`): trace, gateway, experiment, organization went from 30 programs to 12. Cold CPU +2% (693 → 706 CPU-s), root peak RSS 3.2 → 4.0 GB, export edit +8% CPU, leaf edit about 2.4x CPU (the unit rechecks all its tests). Contract and process cannot share a unit where other modules' contracts sit between them (trace, gateway, organization), and `pnpm sync:references` strips the unit wiring. Step 4 had already taken the duplicate-checking gain. Not worth rolling out.

### Trial: Nx per-project cached typecheck (2026-10-11, rejected)

Branch `feat/nx-ts-typecheck` (113f29cc76, wrapper `dev/nx/ts-typecheck-plugin.mjs`). `@nx/js/typescript` needs a wrapper here: TS 6 for its compiler API, a real `tsc --build` for the 236 `noEmit` test configs, solution-only projects so `nx sync:check` stays clean, and `dist/`-only outputs (28 projects without `outDir` made it claim hand-written `.mjs` as outputs; a restore would overwrite source). Inputs hash dependants' `.tsbuildinfo`, so a body edit likely reruns every dependant. Cold run stopped at 104 of 276 tasks at load 35-177; only the warm cache-hit case looked good (22/22 hits). Rejected (Alex, 2026-10-11): 276 cold `tsc --build` starts repeat what ADR-150 removed, near every agent edit misses the cache, and the reuse it promised comes from incremental build info plus haven's machine-wide queue already.

Not doing: `isolatedDeclarations` (ruled out, `typescript-tidy-projects.md`
§10.6); more `--builders` (§13 lever 5, no win on a chain).

## Decisions needed

- Step 5: C chosen (Alex, 2026-10-10).

Lesson from step 8: an exported builder method or hook without an explicit return type has its inferred type spelled out in its `.d.ts`, so every consumer recomputes it. Candidate lint rule.
