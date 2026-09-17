# TypeScript setup redo: plan + pilot findings

Status: plan drafted, pilot proven on a substitute subgraph (the requested
`ksuid`/`handled-error` pair was dirty in the shared checkout at pilot time —
see "Pilot subgraph" below). No repo-wide sweep has happened; this document is
what the sweep lane should execute from.

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
5. Per-package tsconfigs become generated from one base + package facts. A
   successor design is sketched below; not implemented.
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

## 7. Generator successor — design sketch (not implemented)

Today `dev/scripts/sync-tsconfig-references.mjs` (via
`packages/architecture-enforcer/src/workspace/tsconfig-references.ts`)
generates only the `references` array of each tsconfig, reading workspace
manifests for dependency edges. The ask is to generate the **whole**
`tsconfig.json`/`tsconfig.build.json` body from one base plus per-package
facts, leaving only genuinely local options hand-written.

Proposed shape (extends the existing tool rather than replacing it):

- A package states its facts either inline (a small `langwatchTsFacts` block
  in `package.json`, sibling to the existing `langwatchExtraReferences`) or
  left to be inferred from what's already true of the package:
  - `kind`: `contract` | `server` | `web` | `web-kit` | `tooling` |
    `published` — most of this is already inferable from the path
    (`modules/*/web` vs `modules/*/server`) or from `publishConfig` presence.
  - `jsx`: inferred from "does `src/**/*.tsx` exist" rather than declared.
  - `lib`/`types` additions: the few real local needs seen in the packages
    read for this pilot are `dom` (browser code), `node` (server code, tests
    that read the filesystem), and framework globals (`vitest/globals`,
    `react`, `react-dom`) — all mechanically derivable from `dependencies` /
    `devDependencies` rather than hand-typed.
  - Anything a package needs that the generator cannot derive stays an
    explicit, narrow override next to the existing
    `langwatchExtraReferences` escape hatch, so the generator never has to be
    exhaustive on day one.
- `renderReferences` in `tsconfig-references.ts` already does "parse the
  existing file, replace exactly one property, leave everything else byte for
  byte" for `references`; the same technique extends to replacing
  `compilerOptions` wholesale once the facts are read, without a full
  file-format rewrite each time (preserves comments elsewhere in the file,
  which this codebase's tsconfigs use heavily and rely on for the "why", per
  the many `//` explanations read during this pilot).
- `--check`/`--write` stay the same two modes `sync-tsconfig-references.mjs`
  already has.

This is a design, not code — the codemod lane should treat it as a starting
point, not a spec to implement unchanged.

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
