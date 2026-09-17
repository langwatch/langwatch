# Handover: the process supply becomes compiler-checked

**For a coordinator to run in lanes.** Rewritten 2026-09-17 afternoon on
`feat/strict-feature-layout-v0`. This is a snapshot: where the drive is now,
which of its original numbers turned out to be wrong, and what to do next.

Read first, in this order:

1. `dev/docs/adr/147-compiler-checked-process-supply.md` — the server decision.
2. `dev/docs/adr/148-declared-browser-supply.md` — the browser decision, added
   this session. ADR-147 scoped `apps/ui` out; 148 is that drive.
3. `specs/server/typed-process-supply.feature` — 16 scenarios. **Nine are now
   bound and have lost `@unimplemented`.**
4. `dev/docs/plans/supply-deletion-worklist.md` — what L6/L9 actually delete,
   measured rather than estimated.

## Corrections to the previous handover, and why they matter

Four of the numbers this document used to carry were wrong. Each was believed,
and one of them sized a whole lane incorrectly.

| claim | truth |
| --- | --- |
| 145 barrel exports imported outside their module, so 2,630 of 2,775 delete freely | **433** on the swept tree, **599** on the corrected count. `barrel-consumers.mjs` matched `grep -rn` output **line by line**, so every multi-line import - which carries the package on its last line and the names above it - was invisible. Fixed and statement-aware now. |
| 6 installation tests broken on removed seams | **4**. Verified by running them. |
| `withMemoryRepositories` is deleted by this drive | **Untouched**, 35 live call sites, not banned. |
| ~40 installation tests | **27** named `*-installation.*.test.ts`. |

`withProvided` at **89** live sites and the worker's **15** absence classes over
**279** lines are confirmed exactly, and every one of the 15 still has a live
call site, so they die with L6 and not before it.

The lesson worth carrying: a codemod's own count is evidence about the codemod,
not about the tree. `barrel-consumers-verify.mjs` now exists precisely to check
the sweep against the consumers, and it would have caught this in seconds.

## Where the drive is

**Committed this session**

| commit | what |
| --- | --- |
| `a07512e4da` | a test's `mkdtemp` scratch directory, committed on 11 September, deleted |
| `b27632935c` | ADR-148, its spec, and the deletion worklist |
| `fef87f301e` | the barrel worklist fixed, plus the verifier and the web coupling measurement |
| `4a58b452b4` | the web export tier measurement and its two scripts |
| `83c8689aef` | 13 server barrels: 1,078 surplus deletions kept, 96 wrongly-deleted exports restored |
| `f3f68873d4`, `4d42e25d16` | the browser sharing decisions |

**Uncommitted and awaiting review**: `packages/runtime-composition`'s supply
chain (L1/L1b/L1c). Typecheck clean, 188/188 tests, mutation probes failing as
expected. An adversarial review is running.

## What L1 taught, and it is the drive's main lesson

The first builder lane reported success with a clean typecheck and 181 passing
tests. An independent review then defeated its type state **four** ways:
assigning an incomplete builder to the default `ProcessSupply`; constructing
`new ProcessSupply({...})` with empty members; `Object.assign(builder, { clock })`;
and satisfying config or peers with an **empty** `Record<string, X>`, since an
index signature was taken as proof every key existed. Two of its own type tests
passed with the entire boot guard removed.

**A green check on a type-level guarantee is not evidence.** Every lane touching
this now has to show its probes failing against a gutted implementation.

One decision came out of it, taken by the user: the outstanding set is encoded
as a **type name** - `MissingSupply<"relational" | "logging" | ...>` - not as a
property intersection, because a wide intersection printed four names and then
"and 6 more", hiding a requirement under default compiler settings.

## The browser drive, decided this session

ADR-148 plus `dev/docs/plans/web-module-shape-sample.md` and
`web-package-coupling.md`. Decisions, all measured:

- **Two tiers.** A web package publishes what any module may import and what
  only `apps/*` may. Derived from the graph today: **73** app-only, **174**
  peer-imported, **29** imported by nothing at all.
- **Sharing is declared, not observed.** Of the 172 peer-imported entries, **125
  have exactly one consumer** and only **14** have three or more. A one-consumer
  entry is a bilateral coupling, not an API.
- **The shared set moves to `modules/<name>/web-kit`**, a sibling of `contract`,
  `server` and `web`. Not a module - a contract is not installed either, and
  the directory groups a domain rather than an installation unit. About **seven**
  kits, only where something has 3+ consumers. **A kit may not import its own
  module's `web` package**: that is what keeps it a leaf and what breaks the
  **nine** mutually cyclic package pairs that exist today.
- Subpath exports were rejected for this, not on taste: a subpath is invisible
  to the dependency graph, so it cannot break a cycle. ESM multi-entry exports
  are otherwise perfectly fine.
- **Question 7 dissolved.** The "one id, two APIs" blocker rested on reading a
  binding's `name` as a module id. It is a package specifier. No name is
  duplicated anywhere in the features tree, and `project-web` appears once, not
  twice. Module id and surface address are two key spaces; conflating them
  invented the problem.

## Live defect found while measuring

`MemberClassificationService` was deleted from source in `a2a3c9670e` and exists
nowhere at HEAD, but `modules/organization/server/src/app/organization-composition.build.ts`
(clean, committed) still imports it and calls `getRoleChangeType` and
`isViewOnlyCustomRole`. Whoever deleted it owed the repointing in the same step.

The compiler does catch this - `pnpm --filter @langwatch/organization-server
typecheck` fails with `TS2305: Module '"@langwatch/entitlement-server"' has no
exported member 'MemberClassificationService'`. It is a real defect with a real
detector, not a silent one, and it wants fixing rather than investigating.

### The stale `dist` hazard beside it, which is a different thing

**148** workspace packages declare `"types": "./dist/index.d.ts"` with
`"default": "./src/index.ts"`, so the compiler and the runtime read different
files; exactly one package has them agree. `dist` is gitignored, so it is built
locally and can be arbitrarily stale.

This does **not** silently break a build: `tsc -b` rebuilds what it must and
reports `TS6305` ("output file has not been built from source file") when a
declaration is behind its source - the organization run above prints several.
The real costs are that the noise teaches people to scroll past a genuine
signal, and that editors and the language server resolve `types` to `dist` and
will happily offer an export `tsc` would reject.

Pointing `types` at `./src/index.ts` for these internal packages makes the two
agree and removes the class of phantom export outright. It is a codemod over 148
manifests, it needs `publishConfig` for anything actually published, and it
should be measured for typecheck cost before it lands, since consumers then read
source rather than declarations.

## Next actions, in order

1. Collect or return `packages/runtime-composition` on the adversarial review's
   verdict. Do not collect on a green check alone.
2. Fix the `MemberClassificationService` import above.
3. The lint set, once `packages/oxlint-rules` is free: a peer may import only
   the published tier; the published set is shrink-only; no export name that
   collides with the design system; barrel strictness. The first of these is in
   flight with the design-system lane.
4. L2 (`moduleapi-curry.mjs`, 147 sites) - still blocked while
   `packages/runtime-composition` is being edited, since 8 of its sites are there.
5. L6 composition roots, using the deletion worklist rather than the estimates.

## Traps in this checkout

Several sessions share this working tree and commit as the same git user.

- **Never `git add -A`, `git add .`, or `git add -- <directory>`.** Use
  `dev/scripts/commit-slice.sh` with an explicit list, and build the untracked
  half from `git ls-files --others --exclude-standard`. `git commit --only` does
  not accept untracked paths.
- **Never `git stash`.** ~429 files are dirty from other sessions.
- `pnpm format` rewrites ~1300 unrelated files - use `pnpm exec oxfmt <files>`.
- **Strip ANSI before grepping** (`| perl -pe 's/\e\[[0-9;]*m//g'`).
- A stale `dist/` can make a deleted export still type-check. See the defect above.
- Comment blocks are capped at 5 lines including the delimiters.
- Codex lanes run through `codex exec --sandbox workspace-write`; the build model
  is `gpt-5.6-sol` and review runs on the default `gpt-6-astra`.
