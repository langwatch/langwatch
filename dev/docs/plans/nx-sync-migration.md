# Nx typescript-sync instead of syncreferences.go: phase 1 findings and plan

Status: **done** (phase 2 landed on `chore/nx-sync`, 2026-10-10). The outcome, and
where it departs from the plan below, is in "Outcome" at the end; ADR-150's
2026-10-10 amendment is the record. The phase 1 text below is kept as written.

Ruling being implemented (Alex, 2026-10-10): adopt `nx sync` with the
`@nx/js:typescript-sync` generator, reshape tsconfigs to Nx's layout if needed,
keep ONE root `tsc -b` (`workspace:typecheck`, uncached), infer no per-project
targets, stay on TypeScript 7.0.2, and do not get slower.

## Summary

| #   | Question                       | Answer                                                                                                                           |
| --- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Cycle-edge dropping still used | No. Zero edges dropped, with the group, without it, and with devDependencies added.                                              |
| 2   | Declaration group              | Vestigial: 11 members, none depends on another, only `apps/ui` depends on them. Dissolve it. Timing with/without: not yet run.   |
| 3   | `packages/mail/preview`        | Yes, but it does not need a package.json: make it an internal reference of mail's container `tsconfig.json`.                     |
| 4   | Layout mapping                 | Container `tsconfig.json` + `tsconfig.build.json` (keep the name) + `tsconfig.test.json`; non-producers get `tsconfig.app.json`. |
| 5   | Other readers                  | 14 places; listed with the change each needs.                                                                                    |
| 6   | Prototype                      | Not run (paused). Codemod written; Nx generator source read line by line instead.                                                |

Key facts that shape the plan:

- Nx's sync is **all or nothing**. It rewrites every project's `tsconfig.json`
  and runtime config and filters the root solution to composite `tsconfig.json`
  files. It cannot be phased package by package: the codemod and the first
  `nx sync` land in one slice.
- The generator calls `require("typescript")` and uses `ts.sys`,
  `ts.readConfigFile` and `ts.parseJsonConfigFileContent`. TypeScript 7's root
  export has none of them. It needs TypeScript 6 resolvable **from @nx/js only**.
- No per-project targets are needed: the generator does not check that the
  `@nx/js/typescript` plugin is registered. Register it as a task sync generator
  on `workspace:typecheck` (global generators run only on `nx sync`/`sync:check`).

## 1. syncreferences.go cycle dropping (`droppedEdges`, :338)

Evidence, in an APFS clone of the checkout at 10:46:

- `bash dev/scripts/devscripts.sh sync-references` (check mode): `0 of 541 tsconfig
files differ; 0 undeducible entries`, exit 0.
- A throwaway Go test calling `droppedEdges(d.buildEdges())`: 276 members, 244
  producers, 2,254 producer edges, **0 dropped**. Same with the group removed
  (every member its own producer): 0 dropped, no cycle.
- Package graph over `dependencies` + `devDependencies` (what Nx's graph uses,
  plus peer/optional, of which no workspace package declares any): 276 members,
  0 dropped; producers only: 243, 0 dropped.

So `droppedEdges`/`edgeToDrop`/`firstCycle` (and their TS twins in
`packages/architecture-enforcer/src/workspace/tsconfig-references.ts`) are dead
code today. Nx has no automatic equivalent; its escape hatch is a per-tsconfig
`nx.sync.ignoredDependencies` list, and `tsc -b` reports a cycle as TS6202.
With §17 refusing every peer cycle, that is enough.

## 2. The declaration group (`dev/tsconfig.web-declarations.json`)

What it is: one composite project compiling 11 browser packages (scenario, trace,
langy, project, prompt, model-provider, workflow, dataset, experiment, evaluator,
analytics) with `rootDir: ".."`, `customConditions: ["langwatch-declaration-source"]`,
output and build info under `dev/.cache/web-declarations`. Each member's
`tsconfig.build.json` is `{ "files": [], "references": [group] }`.

Why it existed (best_practices/typescript.md, ADR-099): members cyclically
imported each other, and project references cannot form cycles.

Why it is now vestigial:

- Every member exports only `./declaration` (record, browser export ruling of 2026-09-18).
- The only workspace package depending on any member is `apps/ui`. No member
  depends on another (kits deleted in 96aca0a231).
- The producer graph without the group has no cycle (item 1).

Cost of removing it (the edits, all mechanical):

- 11 member `tsconfig.build.json` become ordinary producers, copied from
  `modules/agent/browser/tsconfig.build.json` (`extends: ["./tsconfig.json",
"../../../tsconfig.emit.json"]`, `rootDir: src`, `outDir: dist`,
  `files: ["./src/<name>.web.ts"]`, the standard test excludes). Written and
  applied in the clone; `sync-references --write` then reported 0 drift.
- `customConditions` is then read by no tsconfig. The manifest condition stays:
  the record's browser export shape names it, and `generatemodules.go:125`,
  `dev/scripts/generate-modules.mjs` and `design-system-export-collision` read it
  as a source locator. Retiring it is a record change, not part of this plan.
- Readers to update: `syncreferences.go` (`groupSolution`), enforcer
  `declaration-project-references.ts` and `declarations.ts` (group fallback in
  `emittingProject`), `infra/docker/Dockerfile:116`, `publish-docker-ecr.yml:196`,
  `apps/server/distribution-files.json:19`, docs (typescript.md, ADR-099).
- CI bonus: `dev/.cache` is not in the CI dist cache, so today the group is
  rebuilt cold on every CI run; per-member `dist/` outputs are cached.

**Must it stay? No.** Nx sync also coexists badly with it: the members'
`files: []` build configs are not composite, so the generator skips them as
dependencies (`continue` in `updateTsConfigReferences`) and `apps/ui` would lose
every reference into the group. Keeping it would need about 23
`nx.sync.ignoredReferences` entries (apps/ui's check config, each member's
container and build) to pin the group reference by hand. Dissolving is smaller.

Measurements (APFS clone, `GOMEMLIMIT=2GiB tsc -b --builders 1 --checkers 1`,
`/usr/bin/time -l`, 15-minute watchdog):

| Run                                   | Wall  | CPU (user+sys) | Peak RSS | Errors | Load (1-min) at start, during                  | Verdict                                              |
| ------------------------------------- | ----- | -------------- | -------- | ------ | ---------------------------------------------- | ---------------------------------------------------- |
| baseline, first run after clone       | 394 s | not captured   | 3.32 GiB | 0      | 6.3, then rising past 15                       | INVALID (load; and `cp -cR` reset mtimes, semi-cold) |
| baseline warm (nothing changed)       | 7 s   | not captured   | 1.07 GiB | 0      | 28                                             | INVALID (load)                                       |
| baseline cold (all .tsbuildinfo gone) | 866 s | 2,468 + 65 s   | 3.52 GiB | 0      | 29.5 at start, 70-86 during (another `tsc -b`) | INVALID (load)                                       |
| no group, cold                        | -     | -              | -        | -      | 69                                             | not taken: killed after 27 s by the coordinator      |

Every timing above is INVALID: all were taken at a load well above 15 on 10
cores. Only two facts survive: the tree was green (0 errors) in every completed
run, and peak RSS was about 3.5 GiB cold and 1.1 GiB warm (RSS depends little on
load, but re-measure it with the timings). Redo baseline cold, no-group cold and
the post-codemod cold back to back on a quiet host (load under 10).

## 3. `langwatchExtraReferences` (`packages/mail/preview`)

Preview is a Vite studio inside `@langwatch/mail` with its own `tsconfig.json`
(rootDir `..`, build info in `../dist`). It imports only `@langwatch/mail` and
`@langwatch/design-system-internal`, both already mail's (dev)dependencies; its
hand-written references to egress/observability/time are stale (nothing imports them).

- It **can** become a workspace package (`packages/mail/preview/package.json`),
  but that needs a `pnpm-workspace.yaml` glob, an install, and moving the `dev`
  and `build:studio` scripts plus mail's `preview/dist` Nx output.
- **Recommended instead:** mail's container `tsconfig.json` references
  `./preview/tsconfig.json`. Nx keeps a reference that resolves inside the
  project and not inside a nested project root (`isProjectReferenceWithinNxProject`),
  so it is never rewritten. Preview references only `../tsconfig.build.json`
  (mail's declarations; see the mail swap below), which reaches everything else
  transitively. Root `langwatchExtraReferences` disappears.

## 4. Mapping our layout onto Nx's

### What the generator does (read from @nx/js 23.2.1 `typescript-sync.js`)

1. Root `tsconfig.json`: adds `./<projectRoot>` for every Nx project that has a
   `tsconfig.json`; on any change, keeps only references whose
   `<dir>/tsconfig.json` parses with `composite: true`. Extra file-form root
   references (today `…/tsconfig.test.json`) would be dropped or break it.
2. Per project, dependencies are the Nx graph's static edges: package.json
   `dependencies` + `devDependencies` + `peerDependencies` + `optionalDependencies`
   (`explicit-package-json-dependencies.js`), direct only.
3. Each runtime config (`runtimeTsConfigFileNames`, default list includes
   `tsconfig.build.json` and `tsconfig.app.json`) gets one reference per
   dependency: the dependency's same-named config if it exists and is composite
   (if it exists and is not composite the dependency is **skipped**), else the
   first other runtime config that is composite, else the dependency's directory.
4. The project's `tsconfig.json`: if it compiles files, gets the dependencies'
   `tsconfig.json` (composite only); if it is a container (`files: []`), keeps
   only references inside the project. References outside the project not
   derived are removed as stale. Edits are minimal (`jsonc-parser` modify), then
   `formatFiles`, which detects `.oxfmtrc.json` and formats with oxfmt.

Consequence: our check roots cannot stay as they are. A `tsconfig.json` that
compiles files would reference its dependencies' `tsconfig.json`; those are
`noEmit` check roots, which is TS6310 ("Referenced project may not disable emit")
for any program with inputs. So `tsconfig.json` becomes a container.

### Target shape

| File                  | Who                                   | Role                                                                                                        | References (who writes them)                          |
| --------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `tsconfig.json`       | every package with a typecheck script | container: `files: []`, `include: []`, keeps its `compilerOptions`, adds `composite: true`, `noEmit: false` | its own inner configs (codemod, Nx keeps)             |
| `tsconfig.build.json` | 244 producers (unchanged name)        | composite declaration emit to `dist/`, as today                                                             | dependencies' `tsconfig.build.json` (Nx)              |
| `tsconfig.test.json`  | every producer                        | src + tests check, non-composite, `noEmit`                                                                  | `./tsconfig.build.json` only (codemod, never changes) |
| `tsconfig.app.json`   | 30 non-producers (apps, tools, sdk)   | the package's check, non-composite, `noEmit`                                                                | dependencies' `tsconfig.build.json` (Nx)              |

Why this shape:

- Keeping the name `tsconfig.build.json` keeps every other reader working (§5):
  the enforcer's contract-build-config and public-declarations, the Docker and
  CI steps, the nx.json outputs, the docs. Nx already lists it as a runtime name.
- The container keeps `compilerOptions`, so the build (`extends: ["./tsconfig.json",
emit]`) and the check configs (`extends: "./tsconfig.json"`) are unchanged in
  what they inherit, and tools that read the nearest `tsconfig.json`
  (vite/vitest's transformer, `find-residue.mjs` `paths`) still see the same options.
- `composite: true` on the container satisfies the root filter. `noEmit: false`
  makes it harmless to reference: Nx falls back to the directory for the three
  dependencies that have no build config (`langwatch` SDK <- 13 producers,
  `@langwatch/mcp-server` <- 1, `@langwatch/skills` <- 1). A container emits
  nothing (`tsc -b` marks it ContainerOnly) and a container parent may reference
  non-composite, noEmit children (TypeScript's "container only" exemption).
- Non-producers need a synced check config that producers do not have, or the
  same-name lookup skips them; `tsconfig.app.json` is Nx's own name for it.
- Behavioural change: a producer's build now also references its
  **devDependencies'** builds (Nx uses every dependency kind). No cycle results
  (item 1). Test configs still see the same closure as today's check roots
  (own build plus every dependency's build, transitively).
- Per-package `pnpm --filter <pkg> typecheck` becomes `tsc -b` everywhere (the
  container builds build + test). The root solution checks each project once, as now.

### Codemod rules (per package with a `typecheck` script and a `tsconfig.json`)

1. `tsconfig.build.json` (producer): unchanged, except it receives any of
   `files`/`include`/`exclude` it used to inherit from `tsconfig.json` (only when
   it extends `./tsconfig.json`; all 233 non-empty build configs do).
2. Check config: producers get `tsconfig.test.json`; non-producers get
   `tsconfig.app.json` (the four that have a `tsconfig.test.json`, api, tasks,
   ui and worker, rename it: their typecheck script already checks only that).
   An existing test config keeps its own content; a new one is
   `{ "extends": "./tsconfig.json" }` plus the old root's `files`/`include`/`exclude`.
   Both set `composite: false`, `noEmit: true`, their own
   `tsBuildInfoFile: dist/tsconfig.<stem>.tsbuildinfo`, and
   `references: [{ "path": "./tsconfig.build.json" }]` (producer) or `[]`
   (non-producer; Nx fills it).
3. `tsconfig.type-tests.json` (4) and `tsconfig.tests.json` (1): same treatment
   as the test config; referenced from the container.
4. `tsconfig.json` becomes the container: drop `files`/`include`/`exclude`, write
   `"files": []`, `"include": []`, add `composite: true`, `noEmit: false`, keep
   `tsBuildInfoFile` (the shared-base test requires one on any config that has
   `compilerOptions`; it is never written), `references` = its inner configs
   plus any internal extra (mail's `./preview/tsconfig.json`).
5. `package.json` `typecheck`: `tsc -b …`/`tsc --noEmit` -> `tsc -b` (the
   `pnpm -w exec tsc -b <dir>` scripts of the TS 6 packages already target the directory).
6. Root `tsconfig.json`: references become `./<dir>` for every converted
   package; drop `langwatchExtraReferences` and the long comment about
   `pnpm sync:references`.
7. Group: dissolve first (item 2), in the same slice or the one before.
8. `packages/mail`: swap names, so "tsconfig.build.json = the declaration
   producer" holds everywhere. `tsconfig.declarations.json` -> `tsconfig.build.json`;
   today's JS-emitting `tsconfig.build.json` -> a non-runtime name (proposed
   `tsconfig.js.json`), with `build: tsc -p tsconfig.js.json`. Without the swap
   the generator skips mail (non-composite same-name config) and its consumers
   lose the reference.
9. `sdks/typescript`: its `tsup` dts build reads `tsconfig.json`; a composite
   container with `include: []` will likely fail TS6307 there. Point tsup's
   `tsconfig` at `tsconfig.app.json`, or keep the SDK out of the conversion and
   accept it leaving the root solution (decision below).
10. Out of scope, unchanged: `sdks/typescript/examples/*`, `dev/dogfood/*`
    (no typecheck script, not composite, so Nx leaves them out of the root as today).

What does not change: `customConditions` (none left once the group goes),
`composite`/`declaration`/`emitDeclarationOnly` (still from `tsconfig.emit.json`),
`outDir: dist`, build info at `dist/tsconfig.<stem>.tsbuildinfo`, `files`-limited
public entry points in build configs (the generator never touches `files`), the
self-`paths` in build configs.

A prototype script for rules 1-6 is at
`/Users/lw/.config/agtop/tmp/langwatch-74bd14fb/86fbbe72/scripts/codemod.mjs`
(session scratch, may not survive; unvalidated, never run), beside
`nogroup.sh` (rule 7, applied once in the clone, then 0 drift) and `measure.sh`.
Rules 8-9 are by hand.

### Nx wiring

- Root `package.json`: `@nx/js` 23.2.1 (devDependency, catalog entry).
- `pnpm-workspace.yaml`: `packageExtensions: { "@nx/js": { dependencies: { typescript: "6.0.3" } } }`
  so the generator's `require("typescript")` gets 6.0.3 (already in the lockfile
  through the `sdk-toolchain` catalog, so no new download). Not Nx's documented
  route (root `typescript` -> TS 6 alias and TS 7 under `@typescript/native`):
  that would turn the root `tsc` bin into TS 6. `typescript` is not hoisted to
  `node_modules/.pnpm/node_modules` today, so without the extension @nx/js falls
  through to the root TS 7 and crashes. Unverified until the install runs.
- `nx.json`: `"sync": { "applyChanges": true, "generatorOptions": { "@nx/js:typescript-sync":
{ "runtimeTsConfigFileNames": ["tsconfig.build.json", "tsconfig.app.json"] } } }`.
  No `plugins` entry for `@nx/js/typescript`: nothing is inferred.
- `dev/nx/workspace-plugin.mjs`: `syncGenerators: ["@nx/js:typescript-sync"]` on
  `typecheck`, so `nx typecheck` syncs first. `pnpm sync:references` -> `nx sync`;
  CI drift check -> `nx sync:check`.
- Delete: `tools/devscripts/syncreferences.go` and its golden tests, the
  `sync-references` subcommand, the enforcer's `declaration-project-references`
  policy (its sync half is `nx sync:check`; its reachability half holds by
  construction; tsc reports TS6202/TS6306/TS6310), `tsconfig-references.ts`'s
  derive half (keep `readWorkspaceMembers`/`expandGlob`, used by three other
  policies), `dev/tsconfig.declarations.json` (that policy's anchor, read by nothing else).

## 5. What reads the current shapes besides tsc

| Reader                                                                                                   | Reads                                                                                                                                                                                  | Change needed                                                                                  |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `dev/nx/workspace-plugin.mjs`                                                                            | `createNodes` keyed on the root `tsconfig.build.json` (the `workspace` project owns `typecheck`, `build:types`, `lint:rules`, `test:scripts`); walks its references for inputs/outputs | that file is generated by the Go tool; decide its replacement (below) before deleting the tool |
| `infra/docker/Dockerfile:104,116,150`                                                                    | copies root tsconfigs and the group; `tsc -b --builders 16 tsconfig.build.json`                                                                                                        | drop the group copy; follow the build-solution decision                                        |
| `.github/workflows/publish-docker-ecr.yml:196,201,205`                                                   | path filter: group file, `cmd/devscripts`, `tools/devscripts`                                                                                                                          | drop the group; devscripts stays (generate-modules)                                            |
| `.github/workflows/langwatch-app-ci.yml:487-545`                                                         | caches `*/dist`, keys on root `tsconfig.*.json`, drops changed packages' `dist`                                                                                                        | none: outputs stay in `dist/`; group outputs (never cached) become cached                      |
| `.github/scripts/generated-attributes.test.ts:22`                                                        | `pnpm sync:references` as generator of root `tsconfig.build.json`                                                                                                                      | follows the build-solution decision                                                            |
| `apps/server/distribution-files.json:19,31` + `workspace-invariants.test.ts`                             | ships the group and root tsconfigs; checks `extends` targets are shipped                                                                                                               | drop the group; new configs extend `./tsconfig.json`, inside the package                       |
| `package.json` `build:types`, `build`, `build:server`; nx `lint:types` dependsOn `workspace:build:types` | the root build solution                                                                                                                                                                | follows the build-solution decision                                                            |
| `ensure:built` (nx `build` of langwatch, mcp-server, ksuid, mail)                                        | mail's `build` = `tsc -p tsconfig.build.json`                                                                                                                                          | mail swap: `tsc -p tsconfig.js.json`                                                           |
| nx.json `build` outputs                                                                                  | excludes `dist/tsconfig.{typecheck,test,preview}.tsbuildinfo`                                                                                                                          | add `app`                                                                                      |
| enforcer `declaration-project-references`, `tsconfig-references.ts`                                      | group, `dev/tsconfig.declarations.json`, derived references                                                                                                                            | delete (see Nx wiring)                                                                         |
| enforcer `public-declarations` (`declarations.ts`)                                                       | `tsconfig.build.json`, group fallback                                                                                                                                                  | none; fallback becomes dead                                                                    |
| enforcer `contract-build-config`                                                                         | contract `tsconfig.build.json` include/exclude/rootDir                                                                                                                                 | none                                                                                           |
| enforcer test `tsconfig-shared-base.unit.test.ts`                                                        | every tsconfig with `compilerOptions`: extends base, `incremental`, unique `tsBuildInfoFile` inside the package                                                                        | satisfied by codemod rules 2-4                                                                 |
| `tools/lintrun`, `dev/nx/lint-plugin.mjs`; `oxlint --type-aware`                                         | existence of `tsconfig.json`; tsgolint picks a project per file                                                                                                                        | existence holds; **tsgolint against a container `tsconfig.json` is unverified** (risk 2)       |

Not readers: vitest configs (only `apps/tasks` names an inline oxc tsconfig
option), haven (`gate.go` classifies command words, never reads a tsconfig),
oxlint-rules (one comment), `dev/scripts/pack-npm.sh` (extends guard holds).

Build-solution decision (needed before the Go tool can go): the root
`tsconfig.build.json` (references to every `modules/*/contract/tsconfig.build.json`)
is the one file Nx will not generate. Options: (a) `build:types` and the
Dockerfile run `tsc -b modules/*/contract/tsconfig.build.json` by glob, the file
is deleted, and `workspace-plugin.mjs` rekeys `createNodes` on `nx.json`;
(b) keep the file hand-written (drifts when a module is added); (c) keep a
twenty-line generator for just this file. (a) is the recommendation.

## 6. Prototype

Not run: paused before `pnpm add @nx/js` in the clone. What it must show, in
this order, on a quiet host:

1. Clone (`cp -cR`, excluding `.worktrees`, `.env*`); `pnpm add -w -D @nx/js@23.2.1`
   plus the `packageExtensions` entry; confirm `node -p "require.resolve('typescript',
{paths:[require.resolve('@nx/js')]})"` lands on 6.0.3.
2. Codemod on three packages only (`modules/agent/contract`, `modules/agent/process`,
   `modules/agent/browser`), `nx sync`, and record the diff: expected to rewrite
   references across the whole tree and empty the root solution of every
   unconverted package (this is the all-or-nothing evidence).
3. Codemod `--all` + rules 7-9, `nx sync`, then `nx sync:check` (must be clean),
   `tsc -b` cold and warm with `/usr/bin/time -l`, against the baseline above.
4. `oxlint --type-aware` on one converted package; one `vitest run` in a browser
   package; `tsup` in `sdks/typescript`.

## Risks

1. **TypeScript 6 for @nx/js.** The `packageExtensions` route is unproven here;
   if pnpm's catalog strict mode refuses a plain version in it, use
   `catalog:sdk-toolchain`. If Nx later reads `typescript` from another package
   (devkit's version floor reads the declared and installed root version, 7.0.2,
   which passes), the same extension is needed there.
2. **Type-aware lint.** tsgolint must find the right project for a file under a
   container `tsconfig.json`. If it does not follow references, `lint:types`
   breaks for every package. Prototype step 4 decides it.
3. **Editors.** The TS 7 language server must follow solution-style references
   to open a file in `tsconfig.build.json`/`tsconfig.test.json`. Same check.
4. **Speed.** Builds gain devDependency references (ordering only, no extra
   checking in the root run); the group's 11 members become 11 programs instead
   of one, which may cost or save time. Unmeasured; cold before/after on a quiet host.
5. **One slice.** The codemod, the mail swap, the group, the sync wiring and the
   build-solution change must land together, on a tree no other lane is editing
   in `tsconfig*.json`; a half-landed state empties the root solution.
6. **Decisions for Alex** (none taken here): the `tsconfig.app.json` name for
   non-producer checks; `tsconfig.js.json` for mail's JS emit; the SDK's tsup
   (`tsconfig.app.json`, or leave the SDK out of the root solution); the
   build-solution option (a/b/c).

## Outcome (phase 2, 2026-10-10)

Landed as planned: the container layout (codemod rules 1-6, by
`dev/scripts/nx-sync-codemod.mjs`), the group dissolved, the mail swap, preview as
an internal reference, the root solution written by `nx sync`, `build:types` by
glob with `dev/nx/workspace-plugin.mjs` keyed on `nx.json`, TypeScript 6 for
`@nx/js` through `packageExtensions` (confirmed: it resolves 6.0.3 and `nx sync`
runs), the generator on `workspace:typecheck`, and `nx sync:check` in CI where the
policy ran. Where it departs from the plan:

1. `services/langyworker` also emitted JavaScript from `tsconfig.build.json`; it
   moved to `tsconfig.js.json` like mail's, and `Dockerfile.langyagent` copies it.
2. `@langwatch/skills` had no `typecheck` script, but `modules/langy/browser`
   depends on it, and the generator references a build-less dependency by its
   directory, which must be a composite container. Skills became one (with
   `tsconfig.app.json` and `typecheck: tsc -b`) and joins the root check, clean.
   langy-browser opts out of the edge (`nx.sync.ignoredDependencies`): the
   reference made the skills sources its generator script imports an unbuilt
   project's output (TS6305).
3. The same directory fallback means producers that depend on the `langwatch`
   SDK reference its container, so `build:types`, the Docker build and those
   producers' own `tsc -b` now also check the SDK's `tsconfig.app.json`.
4. The applications' production-only check config is gone: `tsconfig.app.json`
   is their one check (it was `tsconfig.test.json`). The `typescript-7.feature`
   scenario that bound the two-config shape is rewritten to the one-config shape.
5. The `declaration-project-references` scenario went with its policy; the
   real-build tests bound to "A package's adopted dependencies are checked before
   its own source" moved to `tests/project-reference-build.unit.test.ts`.
   `tools/internal/jsonc` went too (only the sync used it), and the enforcer's
   remaining workspace-member reader is `workspace/workspace-members.ts`.
6. `tools/upgradelab/cell/stack.go` still builds the deleted root
   `tsconfig.build.json`; its owner needs to switch it to the contract glob.
