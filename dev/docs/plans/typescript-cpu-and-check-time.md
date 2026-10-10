# TypeScript: bounded CPU and RAM, then less work per check

Status: plan, 2026-10-10. Builds on `typescript-tidy-projects.md` §13 (its levers
are the source of truth; this plan orders them after the nx-sync layout landed).

## Facts (measured 2026-10-10 unless dated)

| Fact | Number |
| --- | --- |
| Root check with `--builders 1 --checkers 1` | still ~400% CPU: Go GC and parse threads ignore both flags |
| Haven queue on a 10-core, 64 GB Mac | 2 concurrent checks; `GOMAXPROCS` set only under memory pressure |
| Projects in `tsc -b` | ~520: 244 build, 247 test, 32 app |
| Test configs that re-include all of `src/**` beside a build config | 236 of 247 (source checked twice) |
| api app program | 4,314 files, 929k lines, almost all emitted `.d.ts`; own check 0.8s |
| Emitted `*.server.d.ts` / `*.trpc.d.ts` (2026-09) | 20-540x their source |
| Cold root build (2026-09-23, quiet host) | 183s wall, ~1,100 CPU-s, ~5.9 GB peak |
| nx-sync commit (`build(typescript): adopt nx sync`) | last recorded 1,160 errors; full capped run on HEAD: 43 (39 one Card variant type) |
| Capped root check (`GOMAXPROCS=2`) | 110-150% CPU, 3.5 GB peak (was ~400%) |
| Longest reference chain | 27 configs (~25 sequential compiles); 2026-09 figure was 17 |
| Same, without the 142 build-config refs to test-only `vitest-config` and 190 declared-but-unimported workspace deps | 21 |
| What remains | 8 contracts in a row, real imports: organization → project → data-privacy → evaluation → evaluator → trace → instant-eval → analytics |

### Cold profile after the reshape (2026-10-10 18:18, load ~25, `GOMAXPROCS=2`)

Wall time is void at that load (939s); per-phase sums and shares are what to read.
479 projects built, 0 errors, 3.5 GB peak.

| Phase | Seconds | | Group | Share of parse+check+emit |
| --- | --- | --- | --- | --- |
| Check | 270 | | browser build (45) | 27% (35s of it emit) |
| Emit | 101 | | process test (65) | 24% |
| Config | 88 | | process build (65) | 16% (35s of it emit) |
| Parse | 43 | | contracts build (64) | 5% |
| Changes compute | 22 | | apps (18) | 5% |

- The 8-contract spine costs 3.8s in total (trace's 1.4s the largest): not worth an ownership move.
- Biggest single programs: `apps/ui` app (11s check, 22M instantiations), trace/experiment/scenario browser builds (7-11s), `packages/api` test and type-tests (3.3-3.6M instantiations).
- Declaration emit is ~100s of ~415s compile work (24%), most of it in browser and process builds: step 5's target.

## Steps

1. **Cap the compiler (small, now).** `CheckGoMaxProcs` returns 2 on a green
   machine as well as under pressure; `dev/nx/workspace-plugin.mjs` adds
   `GOMAXPROCS=2` beside `GOMEMLIMIT=2GiB`. Update the `check-slots.feature`
   scenario and its Go test. Result: a check uses at most 2 cores and ~2 GiB;
   two queued checks at most 4 cores.
2. **Get the tree green on the nx-sync layout** (§13 lever 1). A failing project
   writes no buildinfo and is rechecked whole every run, with its dependants.
3. **Measure once on a quiet host** (load under 10): cold and warm, per project,
   APFS clone. Baseline for steps 4-6.
4. **Check source once.** Test configs include only test files and reference
   their build config (236 configs, by `dev/scripts/nx-sync-codemod.mjs`).
   Expected: close to half the check work. Confirm `nx sync:check` stays clean.
5. **Stop paying for internal declarations.** Either delete internal emit
   (§13 lever 2, the plan of record) or emit with `noCheck` so declarations are
   printed but not checked twice. Needs a ruling (below).
6. **Smaller declarations.** Named schemas and interfaces instead of inlined Zod
   types (in flight in another session; `perf(contracts)` commits).
7. **Shorter chains.** Drop workspace deps no source imports (190, list from
   `git grep` per package) and keep `vitest-config` out of build references:
   27 → 21. The contract run that remains is `contract-graph-flattening.md`.
8. **Trial `assumeChangesOnlyAffectDirectDependencies`** for local incremental
   runs only; keep CI exact.

Not doing: `isolatedDeclarations` (ruled out, `typescript-tidy-projects.md`
§10.6); more `--builders` (§13 lever 5, no win on a chain).

## Decisions needed

- Step 1: 2 cores per check, or 4 (faster, louder)?
- Step 5: delete internal declaration emit, or keep it with `noCheck`?
