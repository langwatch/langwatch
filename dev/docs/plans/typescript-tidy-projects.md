# TypeScript setup redo: plan, pilot findings, modernization blueprint

Status: **Part I** (§1-§8) is the source-first manifest plan and its proven
pilot — unchanged, still what the sweep lane executes from. **Part II**
(§9-§15, added 2026-09-17) is the full modernization blueprint: measured
compiler-settings verdicts, the static per-package layout, flat builds, and the
ordered build-speed levers. Nothing in Part II has landed; §10.2 is a patch to
a file that was dirty in the shared checkout and is carried in
`.claude/handoffs/ts-modernization.md` instead.

Read Part I for *what moves* (manifests, the kill list). Read Part II for *what
the configs and the builds should look like when it has moved*.

Part I's pilot: proven on a substitute subgraph (the requested
`ksuid`/`handled-error` pair was dirty in the shared checkout at pilot time —
see "Pilot subgraph" below). No repo-wide sweep has happened.

## Fixed decisions (restated, not reopened)

1. Keep split projects + project references. Bounded per-project memory is the
   point.
2. Manifests go source-first: every internal workspace package's `types` AND
   `exports["."].default` (and every subpath) point at `./src/...`. Published
   packages (`langwatch`, `@langwatch/ksuid`, `@langwatch/mcp-server`) add a
   `publishConfig` block overriding to `dist` for the npm artifact.
   `tsc -b`'s own composite-build reference redirect is unaffected — this
   change is about what editors and non-`-b` tools (`tsc --noEmit <file>`,
   vite, vitest, Node's own resolver) see.
3. Kill `dev/scripts/ensure-built.mjs` and its consumers, the declaration-cache
   machinery, and any `build` script that exists only to emit declarations for
   internal consumption. `pnpm build` ends at ~7 real artifacts.
4. `packages/mail`: keep its build; tsc-emit is recommended over tsup (see
   below), not yet swapped.
5. ~~Per-package tsconfigs become generated from one base + package facts.~~
   **Superseded by the user, 2026-09-17: no generators.** Per-package tsconfigs
   stay static, hand-written and short, because the base carries what is shared
   (§7, §11).
6. This document is the plan. The repo-wide manifest codemod is a later drive.

## 1. What "source-first" changes, precisely

Today almost every internal package.json carries this split (verified on
`packages/config`, `packages/ksuid`, `packages/handled-error`, `packages/eventing`,
`modules/*/web`, `modules/*/web-kit`, and more — this is the workspace norm, not
an exception):

```json
"types": "./dist/index.d.ts",
"exports": { ".": { "types": "./dist/index.d.ts", "default": "./src/index.ts" } }
```

`default` (what Node/vite/vitest load) already points at source almost
everywhere. `types` (what a type-aware resolver — editor, plain `tsc`, `tsgo`,
a Vitest typecheck — reads) points at a `dist/*.d.ts` that:

- is `.gitignore`d, so a fresh clone has none until something builds it;
- for the ~200 non-published packages, is written by nothing except each
  package's own `tsc -b tsconfig.build.json` — a step nothing outside
  `pnpm build:types`/`pnpm typecheck` (which build it as a *dependency* of the
  requesting project, not standing infrastructure) ever runs on its own.

The fix: flip `types` (top-level and every `exports` condition) to the same
target `default` already names. `packages/mail` is the one package that keeps
its runtime condition (`import`/`default`) pointing at `dist/index.js` — Node
cannot load `.tsx` — while its `types` condition still moves to `src/index.ts`
for editors and file-targeted `tsc`. This is the only "types goes to src but a
runtime condition doesn't" case found in the pilot's reading.

## 2. Verified: `tsc -b` itself is unaffected

`pnpm exec tsc --version` on this workspace is **`Version 7.0.2`** — there is no
separate `tsgo` binary; TypeScript 7 (the Go port) is what `tsc` already is.
Every `pnpm --filter <pkg> typecheck` run in the pilot (composite builds via
`tsc -b`) passed identically before and after the manifest flip, including with
the flipped packages' `dist/` directories moved aside entirely — `tsc -b` just
rebuilds a referenced project's declarations from source when its output is
missing or stale, exactly as it does today. No TS 7.0.2-specific surprise was
found for a composite project whose manifest points `types` at source.

What *did* change, and is the actual payoff: a bare, editor-shaped check —
`pnpm exec tsc --noEmit --ignoreConfig <file that imports the flipped
package>` — resolved the import straight into the package's `.ts`/`.tsx`
source (confirmed by seeing the source file's own internal errors under a
config-less compile, e.g. a `--jsx` complaint from a `.tsx` it had to open) with
**no `dist` present at all**. Before the flip this same command reads (or fails
to read, on a clean clone) the prebuilt declaration.

## 3. Pilot subgraph (substituted — see why)

The manifest's suggested pilot (`@langwatch/ksuid` or `@langwatch/handled-error`
+ one consumer + one web package) was dirty in this shared checkout at pilot
time (`packages/ksuid`, `packages/handled-error`, `packages/eventing`,
`modules/user/web/tsconfig.json`, and — not incidentally — `dev/scripts/ensure-built.mjs`
and `packages/architecture-enforcer/src/workspace/tsconfig-references.ts`
themselves were all mid-edit by another session). Per the shared-checkout rule,
none of those were touched. A clean, equally representative substitute was used
instead:

| Role | Package | Why |
|---|---|---|
| Internal package, plain `.ts`, multiple subpath exports | `@langwatch/config` | Clean; `private: true`; 4 export subpaths, exactly the shape ksuid/handled-error have |
| Consumer (typecheck only, no edit) | `@langwatch/ui-kernel` | Clean; depends on `@langwatch/config` |
| Internal package, jsx, one subpath, **already carrying the `langwatch-declaration-source` workaround** | `@langwatch/authz-web-kit` | Clean; its `./scope-picker` export already has the custom condition this plan expects to retire — a direct test of that theory |
| Consumer (typecheck + test, no edit) | `@langwatch/api-key-web` | Clean config files; imports `@langwatch/authz-web-kit/scope-picker` |

### What was proven

- `pnpm --filter @langwatch/config typecheck` and `@langwatch/ui-kernel
  typecheck`: green before and after the flip, warm ~1-2s each (no measurable
  regression; these are `tsc -b` incremental builds, dominated by the
  `tsbuildinfo` cache, not by the manifest).
- `pnpm --filter @langwatch/authz-web-kit typecheck` and `@langwatch/api-key-web
  typecheck`: green before and after, in both the original state and the
  flipped state (`types`→src, `langwatch-declaration-source` condition
  removed).
- `pnpm --filter @langwatch/authz-web-kit test` (41 tests) and
  `@langwatch/ui-kernel test` (9 tests): green after the flip — vite/vitest
  resolution unaffected, as expected (`default` never changed).
- Moving `packages/config/dist` and `modules/authz/web-kit/dist` aside
  entirely and re-running the consumers' `tsc -b`: green (rebuilds the
  dependency from source, same as always).
- File-targeted, config-less `tsc --noEmit --ignoreConfig` on a consumer file:
  now genuinely opens the dependency's `.ts` source (see §2).
- `pnpm typecheck` (root, whole-tree `tsc -b`) was run once, with both pilot
  packages flipped: it fails, but the failure is pre-existing and unrelated —
  see §4. It is **not** a clean before/after pair; see "What wasn't measured."

### What wasn't measured

Root `pnpm typecheck` before/after timing was **not** captured as a clean pair.
The tree currently carries ~2,600 dirty files from other concurrent sessions,
and a first run surfaced 808 `TS6305` errors and many unrelated failures
spanning packages this pilot never touched (`scenario`, `suite`, `webhook`,
`sdks/typescript`, …) — noise from concurrent edits, not from this pilot.
Running it twice to get a real timing delta would have doubled the shared
check-queue cost for a number that the scoped, `tsbuildinfo`-cached, per-package
runs above already show is not moving (seconds, dominated by cache state, not
by which file a manifest names). The codemod lane should capture this pair
itself, on a quiet tree, immediately before and after the repo-wide flip.

## 4. A real, but pre-existing, breakage found and exonerated

`pnpm typecheck` (and the narrower `pnpm exec tsc -b
enterprise/modules/governance/web/tsconfig.build.json`) reports:

```
enterprise/modules/governance/web/src/features/ai-tools/ui/sections/ai-tool-entry-drawer.tsx
  error TS6305: Output file '.../dev/.cache/web-declarations/modules/authz/web-kit/src/scope-picker/index.d.ts'
  has not been built from source file '.../modules/authz/web-kit/src/scope-picker/index.ts'.
```

(3 occurrences, all in `enterprise/modules/governance/web`, all naming
`authz-web-kit/scope-picker`.) This looked at first like a regression from the
pilot's own flip. It is not: reverting **both** pilot packages to their
original, on-disk (already-dirty) state reproduces the identical 3 errors.
This is pre-existing breakage in the shared checkout — most likely a stale or
concurrently-mutated `dev/.cache/web-declarations` build-info cache, unrelated
to this plan. Flagged here so the codemod lane doesn't mistake it for its own
regression, and doesn't waste a cycle chasing it as this plan's fault; it is
also a live example of exactly the fragility in §6.

## 5. The kill list — verified against this branch, with reference counts

**Two of the names given in this task's brief do not exist on this branch.**
`dev/scripts/typecheck-declarations.mjs`, `dev/scripts/declaration-cache-inputs.mjs`
and `dev/scripts/declaration-cache-artifacts.mjs` exist only under
`.claude/worktrees/apidiff-branch/` (a stale worktree checked into the tree,
not part of the live source layout). Do not search for them under
`dev/scripts/` on `feat/strict-feature-layout-v0` — they aren't there. What the
live tree actually has is described below.

### `dev/scripts/ensure-built.mjs` — kill, with these exact call sites

| File | Line(s) |
|---|---|
| `package.json` (root) | `"ensure:built": "node dev/scripts/ensure-built.mjs"` |
| `apps/api/package.json` | `predev`, `pretest`, `pretest:unit` |
| `apps/worker/package.json` | `predev`, `prebuild` (with `@langwatch/mail` arg), `pretest`, `pretest:unit`, `pretest:integration` |
| `apps/ui/package.json` | `predev` |
| `.github/workflows/langwatch-chart.yml:248` | `pnpm start:prepare:files && pnpm ensure:built` |
| `.github/workflows/e2e-ci.yml:270` | same |
| `.github/workflows/sdk-javascript-ci.yml:291` | same |
| `.github/actions/prepare-generated-files/action.yml:72` | same, plus an explanatory comment at line 8 |
| `apps/server/src/services/node-deps.ts:128-131` | names `"ensure:built"` as one of the scripts a workspace closure runs |
| `apps/server/test/workspace-invariants.test.ts:422,443` | asserts the script exists and its command matches |

Its own header names exactly 4 targets: `langwatch` (sdks/typescript),
`@langwatch/mcp-server`, `@langwatch/ksuid`, `@langwatch/mail`. Once
`langwatch` and `@langwatch/mcp-server` have `publishConfig` overrides and
`@langwatch/ksuid` does too, and once `@langwatch/mail`'s own `predev`/`pretest`
hooks call `pnpm --filter @langwatch/mail build` directly (or an equivalent
freshness check scoped to mail alone — mail is the one package that still needs
a real prebuilt artifact, since Node cannot import its `.tsx` source), nothing
needs this script's cross-package "is dist fresh" logic. Its `predev` hook fires
for **every** dev boot regardless of whether `@langwatch/mail` changed; a
mail-only freshness check is strictly narrower.

### Declaration-group / `langwatch-declaration-source` machinery — inventory, do not delete without deciding §6

| Artifact | Path | What it is |
|---|---|---|
| Generated group solution | `dev/tsconfig.web-declarations.json` | One merged composite project over ~15 named web packages (`langwatchDeclarationGroup.members` — agent, scenario, coding-agent, annotation, trace, langy, project, onboarding, prompt, model-provider, workflow, dataset, experiment, evaluator, analytics), `customConditions: ["langwatch-declaration-source"]` |
| Generator support | `packages/architecture-enforcer/src/workspace/tsconfig-references.ts` | `GROUP_SOLUTION` const, `groupMemberDirectories()`, every `isGroupMember` branch (≈8 sites) |
| Lint policy | `packages/architecture-enforcer/src/policies/quality/declaration-project-references.ts` | Reads `langwatchDeclarationGroup`, walks the declaration-producer graph including grouped packages |
| Tests | `packages/architecture-enforcer/tests/tsconfig-references.unit.test.ts`, `packages/architecture-enforcer/tests/declaration-project-references.test.ts` | Exercise the group solution and the policy above |
| Manifest condition | `langwatch-declaration-source` in **36** `package.json` files (`grep -rl` count on this branch) | Per-subpath override so the group's merged compile reads live source instead of a sibling's possibly-stale `dist` |
| Doc | `dev/docs/best_practices/typescript.md:40-78` | Names and explains all of the above; needs a rewrite alongside whichever way §6 resolves |
| Fallback readers (harmless either way) | `dev/scripts/generate-modules.mjs:26`, `packages/oxlint-rules/src/rules/design-system-export-collision.rule.mjs:34` | Both already do `descriptor?.["langwatch-declaration-source"] ?? descriptor?.default` — removing the condition falls through to `default` cleanly, no rule change needed |

**The pilot proved removing the condition on one non-member dependency
(`authz-web-kit`) is safe in isolation** (§4 — the TS6305 error it looked like
it caused was already there). It did **not** prove the whole mechanism is dead
weight — see §6, which is a real open question, not a pilot finding.

### Declaration-only `build` scripts — full repo inventory

Every `package.json` `build` script on the workspace (checked to depth 4,
covering `packages/*`, `modules/*/*`, `enterprise/modules/*/*`, `apps/*`,
`sdks/*`, `mcp/*`):

| Package | Script | Real artifact? |
|---|---|---|
| `packages/mail` | `tsc -p tsconfig.build.json` | Yes — Node loads the emitted `dist/*.js`; `.tsx` isn't loadable as-is |
| `packages/ksuid` | `tsup && tsc -p tsconfig.publish.json` | Yes — npm publish |
| `sdks/typescript` | `rm -rf dist && tsup` | Yes — npm publish (`langwatch`) |
| `mcp/typescript` | `tsup && node build.js` | Yes — npm publish |
| `apps/ui` | `vite build` | Yes — the deployed SPA |
| `apps/server` | `node --experimental-transform-types scripts/build.ts` | Yes — the `npx @langwatch/server` CLI |
| `apps/worker` | `node scripts/build-server.mjs` | Yes — the worker bundle |
| `services/langyworker` | (bun compile, `build:binary`) | Yes — the sandboxed-tier binary |

No `modules/*` or `enterprise/modules/*` package carries its own `build`
script at all (all 0 hits) — confirming the ~7-artifact target is already the
shape everywhere except the generic `pnpm build:types` (`tsc -b --builders 16
tsconfig.build.json`, the repo-wide declaration solution) and per-package
`tsconfig.build.json` composite builds, which stay (they back `tsc -b`'s own
incremental caching, §2) but stop being anything a human or a CI job runs for
its own sake once nothing downstream needs the emitted `.d.ts` files.

## 6. Open question for the codemod lane (not decided here)

`dev/tsconfig.web-declarations.json` exists because "the packages that would
otherwise form a reference cycle, which TypeScript project references cannot
do, are folded into one shared composite project" (`typescript.md:44-46`) — a
constraint about the **shape of the dependency graph** among those ~15 web
packages, independent of whether any package's manifest points `types` at
`src` or `dist`. Flipping every manifest to source-first makes the
`langwatch-declaration-source` *condition* redundant (it and `default` become
the same target everywhere), but it does **not** obviously remove the need for
the *merged composite project* itself, if those packages still cyclically
import each other's types.

Two live possibilities, and the codemod lane (or the coordinator) should pick,
not guess:

1. The cycle is real and independent of this plan → keep the merged group
   project (rename it, drop only the now-dead `customConditions` list from it,
   drop the condition from all 36 manifests), and the group is not on the kill
   list after all.
2. The "cycle" was itself a symptom of the same dist-first split (e.g. two
   packages each importing the other's *type-only* re-export because neither
   trusted the other's manifest to resolve to fresh source) → re-derive the
   actual dependency edges after the flip and the group may shrink or
   disappear on its own.

Deciding this needs the architecture-enforcer's cycle detector
(`firstCycle`/`droppedEdges` in `tsconfig-references.ts`) run over the 15
members' real import graph, both before and after a full flip — a repo-wide
exercise, out of this pilot's budget.

### Coordinator ruling (2026-09-17)

Two-wave codemod. Wave one flips every package OUTSIDE the web-declarations
group as soon as the tree quiets — the group constraint is web-only and blocks
nothing else. Wave two handles the 15 group members after the web-kit drive
completes: the kits exist precisely to break the nine mutually-cyclic web
pairs that forced the merged composite, so re-run the cycle detector then and
expect possibility 2 (the group shrinks or dissolves); keep a renamed rump
group only for cycles that measurably survive the kits.

## 7. Generator successor — designed, then rejected by the user (2026-09-17)

A generator that wrote each package's whole tsconfig family from package facts
was designed here and **cancelled before implementation**. The user's ruling:
configs are *dead simple and static* — a human reads and edits the file in
front of them, and it is short because the base carries everything shared, not
because a script rewrites it. A generated config is a file nobody can reason
about at the point of failure, and it makes every local exception an argument
with a tool.

What replaces it is §11: one hand-written config per project, extending a base
that states every option 170-odd packages currently restate by hand, so the
local file states only what is genuinely local (`include`, `jsx`, `lib`,
`tsBuildInfoFile`).

The one piece of generation still on the table is the `references` array, which
is derived today by `pnpm sync:references`. That is an open question, not a
decision — §11.4 states it with the evidence.

## 8. Sequencing recommendation for the codemod lane

1. Resolve §6 first (it changes whether ~36 manifests get a smaller or larger
   edit).
2. Flip every internal package's manifest (`types` + every `exports`
   condition) to source-first, `packages/mail`'s runtime condition excepted.
   Add `publishConfig` to `langwatch`, `@langwatch/ksuid`, `@langwatch/mcp-server`.
3. Re-run the cycle detector; shrink or retire the group solution per §6's
   answer.
4. Delete `dev/scripts/ensure-built.mjs` and its 10 call sites (§5 table);
   replace `apps/api`/`apps/worker`'s `pretest*` mail hooks with a direct
   `pnpm --filter @langwatch/mail build` (or drop them if mail's own build is
   fast enough to run unconditionally — measure, don't assume).
5. Build the generator successor (§7) once the manifest shape it reads is
   stable, not before.
6. Capture root `pnpm typecheck` timing before/after on a quiet tree — this
   pilot could not (§3).

## Appendix: exact commands used to verify this document

```bash
pnpm --filter @langwatch/config typecheck
pnpm --filter @langwatch/ui-kernel typecheck
pnpm --filter @langwatch/authz-web-kit typecheck
pnpm --filter @langwatch/authz-web-kit test
pnpm --filter @langwatch/api-key-web typecheck
pnpm --filter @langwatch/ui-kernel test
pnpm exec tsc --noEmit --ignoreConfig modules/api-key/web/src/ui/elements/scope-picker.tsx
pnpm exec tsc -b enterprise/modules/governance/web/tsconfig.build.json
```

---

# Part II — Modernization blueprint (2026-09-17)

Everything below was measured on this branch, on this machine, with the tree in
its current shared state (~2,600 dirty files from concurrent sessions). Every
number names the command that produced it. Nothing below has been applied: the
one file it would change now, `tsconfig.base.json`, was dirty, so §10.2 is a
patch carried in `.claude/handoffs/ts-modernization.md`.

## 9. Measured baseline

| Measurement | Wall | CPU | Command |
|---|---|---|---|
| `pnpm typecheck`, tree as found (partially stale) | **56.6s** | 144s user, 267% cpu | `time pnpm run typecheck` |
| `pnpm typecheck`, immediately re-run (warm) | **12.2s** | 40s user, 368% cpu | same, second run |
| `pnpm build:types`, nothing to do | **0.59s** | 0.70s user | `time pnpm run build:types` |

Three things that table says out loud:

1. **Warm is 12s, not 1s, and the reason is failure, not size.** The run ends
   with 664 error lines. `tsc -b` writes no `.tsbuildinfo` for a project that
   failed, so every failing project — and every project downstream of it — is
   re-checked in full on every subsequent run. The error histogram is
   `TS6305` 808, `TS2339` 790, `TS7006` 466, `TS2307` 105, `TS18046` 64,
   `TS7031` 57, `TS2741` 55, `TS2322` 51, `TS2882` 49, `TS2550` 39. These are
   foreign (concurrent sessions' in-flight edits plus the pre-existing
   `dev/.cache/web-declarations` staleness of §4), and they are listed, not
   chased. **A green tree is itself a build-speed lever**, worth more than any
   compiler flag below.
2. `build:types` at 0.59s is a no-op measurement, not a build. Its real cold
   cost is in `dev/docs/plans/contract-graph-flattening.md`: 18.9s at 4
   builders, 14.5s at 32. `--builders` is not a lever (§13).
3. The two solutions are different sizes: root `tsconfig.json` names **210**
   check roots, root `tsconfig.build.json` names **45** (the module contracts
   only). `build:types` is therefore not "the typecheck without checking" — it
   is the contract declaration graph alone.

**Cold was deliberately not measured.** A cold number needs every
`.tsbuildinfo` in the tree deleted, and several sessions are typechecking this
same checkout; the measurement would have cost each of them a full cold rebuild.
CLAUDE.md's "seconds warm, a minute cold" and the flattening plan's cold pair
above are the numbers to quote until a quiet tree exists.

## 10. Compiler settings: audit, verdicts, and the base patch

### 10.1 What the tree actually states today

431 tsconfig files (215 `tsconfig.json`, 190 `tsconfig.build.json`, 15
`tsconfig.test.json`, 4 `tsconfig.type-tests.json`, 2 `tsconfig.declarations.json`,
plus the base, the two root solutions and three one-offs) across 215 workspace
manifests. Counting how many of them state each option is the whole audit,
because an option restated identically in 170+ files is a base option that
never got promoted:

| Option | Files stating it | Values seen | Reading |
|---|---|---|---|
| `tsBuildInfoFile` | 403 | all under `dist/` | correct and must stay local |
| `rootDir` / `outDir` | 377 / 376 | `.`/`src` and `dist` | local, but mechanical |
| `verbatimModuleSyntax` | 178 | `true` ×178, `false` ×0 | **unanimous — belongs in the base** |
| `noUncheckedIndexedAccess` | 176 | `true` ×176, `false` ×0 | **unanimous — belongs in the base** |
| `rewriteRelativeImportExtensions` | 190 | `false` ×188, `true` ×2 | base states the minority value |
| `noEmitOnError` / `composite` | 174 / 174 | `true` | build-config facts, stay local |
| `declaration` / `declarationMap` / `emitDeclarationOnly` | 193 / 180 | `true` | build-config facts — and mostly deletable, §12 |
| `noEmit` | 381 | `true` ×203, `false` ×178 | `true` is already in the base: 203 restatements are dead |
| `target` | 23 | `es2023` ×13 (= base), `ES2022` ×8, `es2017` ×1 | 13 dead restatements, 9 real exceptions |
| `lib` | 193 | mostly `["es2023","dom","dom.iterable"]` | genuinely local (browser vs node) |
| `jsx` | 60 | `react-jsx` ×58, `preserve` ×2 | genuinely local |
| `module` / `moduleResolution` | 25 / 12 | see §10.4 | genuinely local, and mostly wrong |
| `strict`, `skipLibCheck`, `incremental`, `forceConsistentCasingInFileNames` | 10 / 9 / 9 / 7 | `true` | already in the base: all dead restatements |

Reproduce any row with:

```bash
find . -name 'tsconfig*.json' -not -path '*/node_modules/*' -not -path './.claude/worktrees/*' \
  | xargs grep -h '"<option>"' | sed 's/.*: *//' | tr -d ',' | sort | uniq -c
```

Roughly **530 lines of restatement** (verbatim + noUnchecked + the dead
`noEmit`/`target`/`strict`/`skipLibCheck` copies) are deletable the moment the
base states them. That, not a generator, is what makes a package tsconfig short
enough to read (§11).

### 10.2 The base patch — land this first

Three additions, each measured on packages that do **not** already state it, by
running that package's own project with the flag forced:

```bash
pnpm exec tsc -p <pkg>/tsconfig.json --<flag> --tsBuildInfoFile /tmp/probe.tsbuildinfo
```

| Flag | Packages probed | New errors |
|---|---|---|
| `verbatimModuleSyntax` | config, observability, apps/server, scenario/server, sdks/typescript | **1, 0, 0, 1, 0** (`TS1484`) |
| `noUncheckedIndexedAccess` | observability, apps/server, secrets, monitor/server | **0, 0, 0, 0** |
| `isolatedModules` | config, annotation/server, design-system | **0, 0, 0** (`TS1205`) |

Plus two static confirmations: `git grep -cE '^[[:space:]]*(export|import)[[:space:]]+[A-Za-z_$]+[[:space:]]*=[[:space:]]*require\('`
and `git grep -c '^export = '` are both **0**, so `verbatimModuleSyntax` has no
syntactic blocker anywhere in the tree.

The patch (apply to `tsconfig.base.json`'s `compilerOptions`, after
`forceConsistentCasingInFileNames`):

```jsonc
    // Stated identically by 178 and 176 package configs respectively; here so
    // they can stop being. `isolatedModules` states what is already true --
    // every loader in this repo transpiles file by file (Node's type
    // stripping, vite, esbuild, tsup) and none of them sees the type graph.
    "verbatimModuleSyntax": true,
    "noUncheckedIndexedAccess": true,
    "isolatedModules": true,
```

Cost to land: the two `TS1484`s found (in `packages/config` and
`modules/scenario/server`) plus whatever the ~35 unprobed non-stating packages
carry at the same rate — single digits, each a one-word `type` keyword.

**And what the three flags cost the compiler, measured** — because "three more
strict flags" reads like more work, more time and more memory, and the
assumption deserved a number rather than an assurance
(`tsc -p <pkg>/tsconfig.json [--flags] --extendedDiagnostics`, on packages that
state none of the three today):

| Package | | Types | Instantiations | Memory | Total |
|---|---|---|---|---|---|
| `packages/observability` | base | 20,362 | 47,246 | 119,218K | 0.163s |
| | +3 flags | 20,387 | 47,274 | 119,108K | 0.169s |
| `modules/monitor/server` | base | 168,225 | 629,812 | 720,491K | 2.267s |
| | +3 flags | 168,241 | 629,812 | 717,992K | 2.464s |

Types move by 0.01-0.12%, instantiations on the larger package do not move at
all, and **memory goes down slightly in both**. The apparent 8% on
`monitor/server`'s single run is machine noise: three repeat pairs on a loaded
machine gave 2.442 / 3.445 / 3.304s for the base against 2.229 / 4.568 / 2.882s
for the flags — a band several times wider than the effect, straddling zero.

That result is not luck, it is what the flags are.
`verbatimModuleSyntax` and `isolatedModules` are **syntactic** rules: they
forbid constructs whose meaning depends on the type graph, which is work the
checker then does not do. `noUncheckedIndexedAccess` adds `| undefined` to
index reads — real checker work, and the numbers say it is under a tenth of a
percent of the types in a 800k-line project.

The rest of this blueprint moves in the same direction: split projects and
references **stay** (fixed decision 1, bounded per-project memory is the
point), and §12 deletes 190 declaration-emit projects and takes `build:types`
off every critical path. Nothing here merges projects, widens a compile, or
adds a step.

**Not in the patch, deliberately:**

- `rewriteRelativeImportExtensions`. The base says `true` and 188 configs
  override it to `false`; the majority value looks like the obvious fix, and it
  is a trap. Only two configs emit anything a consumer resolves
  (`packages/mail/tsconfig.build.json`, `packages/ksuid/tsconfig.publish.json`)
  and both state `true` — but `sdks/typescript/tsconfig.json` states nothing and
  inherits `true`, and tsup's `dts` emit reads that config to produce the
  published SDK's declarations. Flipping the base would silently ship `.ts`
  specifiers in a published `.d.ts`. Wave-one work, with the verification named
  in §14.
- `allowImportingTsExtensions`. Load-bearing, not legacy: **30,508 of 34,364
  relative imports name a `.ts`/`.tsx` extension** and **zero** name `.js`
  (`git grep -hoE 'from "\.\.?/[^"]*"' -- '*.ts' '*.tsx'`). "Name the file on
  disk" is the house style and Node's type stripping loads exactly that.

### 10.3 `target` / `lib`

`target: es2023` in the base is current and correct (`engines.node >= 24`).
The 13 configs restating `es2023` are dead lines. The 9 real exceptions
(`ES2022` ×8, `es2017` ×1) are published-artifact configs choosing a lower
downlevel floor for consumers — legitimate, and they should carry a one-line
reason each after wave one.

`lib` cannot move to the base: 193 configs state it because the split that
matters is browser (`dom`, `dom.iterable`) versus node, and it is the same
split the frontend-boundary rule enforces. It stays one of the four local facts
in §11.

One live bug this audit surfaced, for whoever fixes the tree's foreign errors:
`plugins/langwatch/__tests__/manifests.unit.test.ts:135` fails with `TS2550`
(`toSorted` needs `lib: es2023`) because that package states a `lib` that is
behind the base's `target`. A package that states `lib` at all opts out of the
`target`-derived default — which is exactly why `lib` restatements are a
liability worth auditing after wave one.

### 10.4 `module` / `moduleResolution`, per package class

The base is `module: preserve` + `moduleResolution: bundler`. Three classes,
one recommendation:

| Class | Who | What loads it | Verdict |
|---|---|---|---|
| Node-executed | `apps/api`, `apps/worker`, `apps/tasks`, `apps/server`, worker/tasks tooling | `node --experimental-transform-types src/*.entrypoint.ts`, with `"type": "module"` (213 of 215 manifests set it) | **keep `preserve`/`bundler`** |
| Bundler-consumed | `apps/ui`, every `*-web`, `*-web-kit`, `packages/design-system` | vite / vitest / esbuild | **keep `preserve`/`bundler`** |
| Published dual | `langwatch`, `@langwatch/ksuid`, `@langwatch/mcp-server` | tsup, then a stranger's resolver | **`nodenext` on the publish config only** (5 configs already state `node16`/`nodenext`) |

The case for not churning the first class to `nodenext`: the repo already
writes every relative import with its on-disk extension (§10.2), which is the
one thing `nodenext` would enforce that `bundler` does not. `nodenext` would
additionally demand `.js` specifiers that rewrite on emit — the exact scheme
this repo abandoned. `preserve`+`bundler` is not a bundler-only setting here;
it is "the specifier means the file", which is what Node's stripping loader
does too.

The 25 `module` and 12 `moduleResolution` overrides are concentrated in the
published packages and their example projects; after wave one every remaining
override should name its reason or go.

### 10.5 `erasableSyntaxOnly` — **not adoptable. Verdict: never.**

| Construct | Count | Source |
|---|---|---|
| `enum` declarations | **13**, in 9 files | `git grep -nE '^[[:space:]]*(export[[:space:]]+)?(const[[:space:]]+)?enum[[:space:]]'` |
| `namespace` declarations | **0** | same grep for `namespace` |
| Parameter properties | **~1,848 files** (3,172 matching lines) | `git grep -A3 -nE 'constructor[[:space:]]*\('` filtered to `private|public|protected|readonly` parameters |

The enums are nine files away from gone and should go anyway (`as const` +
a union is the house style already). Parameter properties are a different
matter: 1,325 of those files are under `modules/`, and
`constructor(private readonly deps: X)` is the shape every service, repository
and adapter in the service-repository-adapter-port layout is written in.
`erasableSyntaxOnly` would forbid the repo's primary class idiom to buy a
transform this repo does not perform — Node, vite and esbuild already strip
these correctly. Flag support is present (`TS1294` fires on TS 7.0.2); the
answer is still no.

### 10.6 `isolatedDeclarations` — **not adoptable. Verdict: never for internal packages.**

Forced onto real build configs (`tsc -p <pkg>/tsconfig.build.json
--isolatedDeclarations --outDir /tmp/...`):

| Package | src files | Errors |
|---|---|---|
| `modules/trace/contract` | 118 | **1,855** |
| `packages/design-system` | 139 | 238 |
| `packages/eventing` | 255 | 126 |
| `packages/config` | 30 | 123 |
| `modules/annotation/server` | 43 | 54 |
| `packages/ksuid` (published, tiny) | 16 | **4** |

The distribution in `trace/contract` is the whole story: `TS9013` 1,546,
`TS9010` 275, `TS9039` 33. `TS9013` is "expression type cannot be inferred with
isolatedDeclarations" — every `export const x = z.object({...})`. A contract
package in this repo *is* a pile of Zod schemas, and annotating them by hand
means writing out inferred Zod generics that are precisely what nobody should
hand-write. Extrapolating the measured rate across ~16,000 source files puts
the annotation cost in the tens of thousands.

And the payoff evaporates on its own: `isolatedDeclarations` buys parallel
`.d.ts` emit for the reference graph, and §12 removes internal declaration emit
altogether. There is nothing left to parallelise. The one place it stays
arguable is a published package (`ksuid`: 4 errors) — and only if that package's
own publish build ever becomes slow enough to notice, which at 16 files it will
not.

### 10.7 `skipLibCheck` and incremental hygiene

`skipLibCheck: true` stays. The tradeoff is real and worth stating once: it
suppresses errors *inside* `node_modules` `.d.ts` files, so a dependency
shipping broken types is discovered at use rather than at check. With
`node_modules` holding hundreds of packages' declarations and the repo's own
declarations about to stop being inputs at all (§12), turning it off buys
error messages about other people's code at a cost measured in whole seconds of
every run. Keep it, and keep it in the base where it already is (9 packages
restate it — dead lines).

`incremental: true` is in the base; `composite`, `noEmitOnError` and
`tsBuildInfoFile` are per-project facts that must stay local. The one rule that
must never be relaxed: **no two projects may name the same `tsBuildInfoFile`**,
and it lives beside what the project produces (`dist/tsconfig.<stem>.tsbuildinfo`),
never under `node_modules` — an install wipes a cache there, and clearing
`dist/` leaves a stale one behind. 403 configs already comply.

## Coordinator rulings on Part II (2026-09-17 evening)

**References stay derived, and that is not a generator.** `pnpm
sync:references` survives — alone. A `references` array is not configuration
a person authors; it is the dependency graph projected into JSON so `tsc -b`
can order 210 projects, and a drifted one reports `TS6305` instead of an
honest error. Reframe it as a VERIFIER: `--check` in CI fails on drift,
`--write` fixes it locally. Everything else in a package tsconfig is
hand-written and hand-readable. Nothing else in the TypeScript setup may be
generated.

**The base-flag patch waits for a calm tree.** The three flags are
deduplication (178 and 176 packages already state them), so the risk is only
in the ~30 packages that do not — but their new errors must be attributable,
and today the tree carries 664 foreign error lines from four writing lanes.
Apply the §10 patch, plus the one scenario type-only import it surfaces, as
a single slice when the tree quiets, then compare the histogram against §9.

**`build:types` is a prerequisite of nothing — act on it.** The audit's
central finding: every bundler already reads workspace TypeScript source, so
the only real build edge in the repo is `build-worker → build-mail` (Node
cannot import `.tsx`). That makes the flat Makefile design §12 describes the
plan of record, and the 190 declaration-emit projects deletable.

## 11. The static per-package layout

The target, declarative, so a lane can execute it mechanically. Four facts are
local; everything else comes from the base.

### 11.1 Which files exist

| File | Who has it | Why |
|---|---|---|
| `tsconfig.json` | every package | the check root. `pnpm --filter <pkg> typecheck` is `tsc -b` against it |
| `tsconfig.test.json` | only a package whose tests need types its source must not have (node types in a browser package, `vitest/globals`) — 15 today | widens the check root; `exclude: []`, extra `types` |
| `tsconfig.build.json` | only a package that **emits an artifact** — after §12, that is `packages/mail`, `packages/ksuid` (publish), `sdks/typescript`, `mcp/typescript` | emit settings; nothing else needs one |

That is the whole family. The 190 `tsconfig.build.json` files that exist today
are declaration emitters for internal consumption, and §12 deletes them along
with the emit. `tsconfig.declarations.json` (2), `tsconfig.web-declarations.json`,
`tsconfig.tests.json` and `tsconfig.eslint.json` are all one-offs to retire.

### 11.2 What a package tsconfig looks like afterwards

A plain node/contract package — four lines of options, all of them local facts:

```jsonc
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "tsBuildInfoFile": "dist/tsconfig.typecheck.tsbuildinfo",
    "types": ["vitest/globals"]
  },
  "include": ["src/**/*.ts"],
  "references": [{ "path": "../plans/tsconfig.json" }]
}
```

A browser package adds exactly two more:

```jsonc
    "jsx": "react-jsx",
    "lib": ["es2023", "dom", "dom.iterable"]
```

The four hand-declared local facts are therefore **`include`, `tsBuildInfoFile`,
`jsx`, `lib`/`types`** — and `jsx`/`lib` only for browser code. Everything a
package states beyond those four is either a base option restated (delete it) or
an exception that owes the reader a `//` line saying why.

### 11.3 `dist/`, and who reads it

After Part I's manifest flip and §12's emit removal, `dist/` in an internal
package holds exactly one kind of thing: **`.tsbuildinfo` files**. No
declarations, no JavaScript, nothing any consumer resolves. It stays gitignored,
stays per-worktree, and a lane that deletes it loses nothing but warm cache.

Four packages keep a real `dist/`: `packages/mail` (Node cannot load `.tsx`),
`packages/ksuid`, `sdks/typescript`, `mcp/typescript` (npm tarballs).

### 11.4 Exports map, and the one open question

Internal package, source-first (Part I §1):

```jsonc
"types": "./src/index.ts",
"exports": { ".": { "types": "./src/index.ts", "default": "./src/index.ts" } }
```

Published package: the same, plus `publishConfig` overriding both to `dist` for
the tarball. Only `packages/ksuid` has a `publishConfig` block today; `langwatch`
and `@langwatch/mcp-server` need one written. 187 manifests still point `types`
at `dist`; 13 point at `src`; 36 still carry the `langwatch-declaration-source`
condition Part I retires.

**Open question the coordinator must rule on: are `references` arrays
hand-written too?** The user's ruling is "no generators", and a `references`
array is the one part of a static config a human genuinely cannot maintain: the
root solution names 210 projects, and an array that drifts from
`package.json` dependencies produces `TS6305` (808 of them in the run above)
rather than an honest error. Three options, none chosen here:

1. Keep `pnpm sync:references` for the `references` array alone — it already
   works this way (it replaces exactly one property and leaves the file byte for
   byte otherwise). Configs stay hand-readable; one array is derived.
2. Hand-write references and let `declaration-project-references` lint report
   drift. Honest, and it makes adding a dependency a two-file edit forever.
3. Delete references entirely and check the whole tree as one project. Kills
   the bounded per-project memory that fixed decision 1 exists to preserve.

Option 1 is the recommendation, stated as an open question because it is the
one place the "no generators" ruling and correctness pull in opposite
directions.

### 11.5 Test config shape

A test config exists only when the tests need something the source must not
have. It is a widening, never a second world:

```jsonc
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "tsBuildInfoFile": "dist/tsconfig.test.tsbuildinfo",
    "types": ["vitest/globals", "node"]
  },
  "exclude": [],
  "include": ["src/**/*.ts", "src/**/*.tsx"]
}
```

Its `tsBuildInfoFile` differs from the source config's. A package whose tests
need nothing extra does not get one, and its `tsconfig.json` includes the tests.

## 12. Flat builds: the Makefile, and the end of build chains

### 12.1 Where dependency-ordered build chains exist today

| Chain | Where | What it forces |
|---|---|---|
| `pnpm run build` = `build:types && pnpm -r --filter "!@langwatch/server" build` | root `package.json` | 45 contract declaration projects compile in dependency order **before any artifact starts**; then `pnpm -r` walks the artifact packages topologically |
| `ensure-built.mjs` | `apps/api` (`predev`, `pretest`, `pretest:unit`), `apps/worker` (`predev`, `prebuild`, 3 × `pretest*`), `apps/ui` (`predev`), 4 CI workflows/actions, `apps/server/src/services/node-deps.ts`, its invariant test | every dev boot and every test run pays a cross-package freshness check |
| `prepublish` / `prepublishOnly` | `sdks/typescript`, `mcp/typescript`, `packages/ksuid` | fine — these are the real tarballs |
| `prebuild`/`pretest` = `pnpm run generate` | `sdks/typescript` | codegen, not a build chain; keep |

Nothing else cascades: no `modules/*` or `enterprise/modules/*` package has a
`build` script at all (Part I §5), and `apps/worker`'s esbuild bundler already
states in its own header that workspace packages "ship raw TypeScript, so only
bundling resolves them and they are always inlined". The premise of the flat
build is already half-true in the code; it is the scripts that pretend
otherwise.

### 12.2 What each artifact actually needs

| Artifact | Command | Needs another package built first? |
|---|---|---|
| `apps/ui` SPA | `vite build` | **no** — vite reads workspace TS source |
| `apps/worker` bundle | `node scripts/build-server.mjs` (esbuild) | **no** — inlines workspace source; only `@langwatch/mail`'s JS is a real prerequisite |
| `apps/server` CLI | `node --experimental-transform-types scripts/build.ts` | no |
| `langwatch` (SDK) | `rm -rf dist && tsup` (`dts: true`) | **no** — tsup emits its own declarations from source |
| `@langwatch/mcp-server` | `tsup && node build.js` (`dts: true`) | no |
| `@langwatch/ksuid` | `tsup && tsc -p tsconfig.publish.json` | no |
| `@langwatch/mail` | `tsc -p tsconfig.build.json` | no — and it is the one thing others need |
| `services/langyworker` binary | `bun run scripts/build-binary.ts` | no |

So `pnpm build:types` is a prerequisite of **nothing**. It is a typecheck
artifact that the root `build` script runs out of habit. Once internal packages
stop emitting declarations, `build:types` and the 190 `tsconfig.build.json`
files go with it, and the `declaration`/`declarationMap`/`emitDeclarationOnly`/
`noEmitOnError`/`composite` restatements (~900 lines) go with those.

### 12.3 The flat replacement

The root `Makefile` has no build target at all today (`grep -nE '^[a-z-]+:'
Makefile`). It gets one flat entry per artifact, each a single command with no
ordering:

```make
build-ui:        ; pnpm --filter @langwatch/ui build
build-worker:    build-mail ; pnpm --filter @langwatch/worker build
build-mail:      ; pnpm --filter @langwatch/mail build
build-cli:       ; pnpm --filter @langwatch/server build
build-sdk:       ; pnpm --filter langwatch build
build-mcp:       ; pnpm --filter @langwatch/mcp-server build
build-ksuid:     ; pnpm --filter @langwatch/ksuid build
build: build-ui build-worker build-cli build-sdk build-mcp build-ksuid
```

One dependency edge survives, `build-worker: build-mail`, and it is a real one:
Node cannot import `.tsx`. It is declared in the Makefile where a reader sees
it, rather than inferred from the pnpm graph.

The root `build` script becomes `make build` (or the same list inline). What
must be gone first: `build:types` off the front of it, and `ensure-built.mjs`'s
ten call sites replaced by nothing (`predev`, `pretest`) or by a direct
`pnpm --filter @langwatch/mail build` (worker's `prebuild`).

## 13. Build speed: the levers, in order

| # | Lever | Expected win | Cost / risk |
|---|---|---|---|
| 1 | **Get the tree green.** A failing project writes no `.tsbuildinfo` and is re-checked whole every run, with everything downstream of it | the gap between the 56.6s and 12.2s runs above is mostly this | none technically; it is other lanes' in-flight work |
| 2 | **Delete internal declaration emit** (§12): 190 build projects, the `build:types` step, the web-declarations group | takes `build:types` (14.5-18.9s cold) off every build path entirely and removes 190 projects from the graph | needs Part I's manifest flip first |
| 3 | **Flatten the contract graph** (`dev/docs/plans/contract-graph-flattening.md`) | depth 16 → 13 so far, 49 edges left; the build's floor is ~17 sequential compiles, and only the graph shortens it | slow, per-edge, architectural |
| 4 | **Dead config elimination** (§10.1) | ~530 restatement lines now, ~1,400 after lever 2; no measurable compile win, a large readability one | mechanical |
| 5 | `--builders` tuning | **none** — measured 18.9s at 4 builders vs 14.5s at 32. A chain cannot be parallelised | — |
| 6 | `isolatedDeclarations` | would have been lever 2's alternative; lever 2 deletes the work instead of parallelising it | rejected, §10.6 |

The order matters: 2 makes 6 pointless and makes 3 cheaper to measure.

## 14. Waves

**Wave 0 — now, one file.** The §10.2 base patch (`verbatimModuleSyntax`,
`noUncheckedIndexedAccess`, `isolatedModules`) plus the handful of `TS1484`
fixes it surfaces. Check: `pnpm typecheck` once, comparing the error histogram
to §9's, not to zero.

**Wave 1 — the manifest flip** (Part I §8 steps 2-4, outside the
web-declarations group per the coordinator's ruling). Adds: `publishConfig` for
`langwatch` and `@langwatch/mcp-server`; the
`rewriteRelativeImportExtensions` base flip **verified by building the SDK and
grepping the emitted `.d.ts` for `.ts` specifiers**.

**Wave 2 — delete the emit** (§12): `build:types`, the 190
`tsconfig.build.json` files, `ensure-built.mjs`'s ten call sites, the
declaration-group machinery per Part I §6's re-run of the cycle detector.
Makefile build targets land here.

**Wave 3 — config minimisation** (§11): every package tsconfig reduced to the
four local facts. Purely mechanical, one package class at a time, and only
after waves 0 and 2 have made the deletions safe.

Then, and only then, capture the cold/warm pair on a quiet tree that §9 could
not.

## 15. Where the conventions are written down

`dev/docs/best_practices/typescript.md` is the doc a person lands on, and its
project-references and declaration-group sections were rewritten alongside this
blueprint (2026-09-17) to match §9-§14. This plan carries the evidence and the
waves; that doc carries the rule as it stands today. When a wave lands, the rule
moves there and the wave is struck from here.
