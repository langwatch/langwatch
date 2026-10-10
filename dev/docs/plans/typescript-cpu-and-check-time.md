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
| nx-sync commit (`build(typescript): adopt nx sync`) | last recorded 1,160 errors, 616 of them TS6305 |

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
7. **Trial `assumeChangesOnlyAffectDirectDependencies`** for local incremental
   runs only; keep CI exact.

Not doing: `isolatedDeclarations` (ruled out, `typescript-tidy-projects.md`
§10.6); more `--builders` (§13 lever 5, no win on a chain).

## Decisions needed

- Step 1: 2 cores per check, or 4 (faster, louder)?
- Step 5: delete internal declaration emit, or keep it with `noCheck`?
