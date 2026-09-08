# Rename "features" to "modules"

**Date:** 2026-09-08 · **Ruling:** Alex ("features is just kind of an annoying name, it's modules of the
code") · **Runs after:** the `@langwatch/api` fold (landed `a0e6374877`) · **Owner lane:** one agent,
TS-LSP for the import rewrites, reviewed by Fable

## Target tree (assumed reading of Alex's words, confirm before the lane starts)

```
packages/                 shared packages, unchanged
modules/<name>/{contract,server,web}          was packages/features/<name>/...
modules/catalogue.json                        was packages/features/catalogue.json
enterprise/                                   was packages/enterprise
  LICENSE.md README.md adrs specs src tests package.json tsconfig*.json vitest.config.ts
  packages/composition/{api,worker}           was enterprise/composition/*
  packages/plan-gate                          was enterprise/plan-gate
  modules/<name>/{contract,server,web}        was enterprise/features/<name>/...
```

Alternative reading, if Alex meant inside `packages/`: `packages/modules/*`, `packages/enterprise/modules/*`,
`packages/enterprise/packages/*`. Same census, smaller depth change.

Package names (`@langwatch/<feature>-server` etc.) do not change. Only directories move.

## Census (2026-09-08, before the fold lane)

| Surface | Count |
| --- | --- |
| Files whose text names `packages/features` (excluding lockfile, node_modules, dist) | 737 |
| Files whose text names `packages/enterprise` | 169 |
| `tsconfig*.json` with a relative reference into a feature package | 55 |
| Literals in `packages/architecture-lint/src` + `packages/lint-core/src` | 89 |
| Feature roots in `packages/features/catalogue.json` | 49 core + 8 enterprise |
| Skills and `.claude/skills` files naming the paths | 22 |

Machinery that hardcodes the layout:

- `pnpm-workspace.yaml`: `packages/features/*/*`, `packages/enterprise`, `packages/enterprise/composition/*`,
  `packages/enterprise/plan-gate`, `packages/enterprise/features/*/*`.
- root `package.json` scripts `test`, `lint:oxlint`, `lint:fix`, `start:prepare:files` (the evaluator
  generated-file copy path).
- `packages/architecture-lint/src/workspace.ts` lines ~194–195 (`discoverFeatures`), ~271–436
  (enterprise root checks, the "aggregate outside packages/enterprise" rule, fixed roots).
- `packages/architecture-lint/src/comment-block-roots.json`, `feature-shape-baseline.json`,
  `boundary-edge-baseline.json`, `composed-exports-baseline.json`, `oxlint-baseline.json` (keys carry
  paths; **Fable rewrites these**, sorted code-unit order).
- `packages/features/catalogue.json` `root` fields.
- `dev/tsconfig.declarations.json`, `dev/tsconfig.web-declarations.json` reference lists.
- `dev/lint/ast-grep` rules naming `packages/enterprise`.
- `patches/` (pnpm patches) — check none names a path.
- Every feature package's own `tsconfig.json` / `tsconfig.build.json` / `vitest.config.ts`: the
  depth changes (`packages/features/x/server` is four deep, `modules/x/server` three), so every
  `../../../..` that reaches the repo root loses one segment, and `extends` paths to
  `packages/config` change. Enterprise packages move one deeper for `packages/` and stay level for
  `modules/`. This is the trap; do not pattern-replace, open each file.
- `CLAUDE.md` (2 lines), `dev/docs/**` (plans, ADRs, best practices, research: about 90 files),
  `.claude/skills/**` and `skills/**` (22 files).
- CI: `.github/workflows` did not match the census grep; confirm with `grep -rn features .github`
  anyway, and check `charts/`, `infra/`, `apps/*/Dockerfile`, `dev/compose*.yml` for copy paths.

## Vocabulary (Alex, 2026-09-08 17:1x: "featureApi is now module, no?")

Rename the names a module author types, in the same commit as the directory move, with TS-LSP
rename-symbol (not grep):

| Today | New | Files |
| --- | --- | --- |
| `featureApi`, `FeatureApiToken`, `FeatureName` (runtime-composition) | `moduleApi`, `ModuleApiToken`, `ModuleName` | 62, 9, 8 |
| `defineFeature`, `withFeature`, `runtime.feature()` | `defineModule`, `withModule`, `runtime.module()` | 55, 24, 15 |
| `createFeatureApi`, `FeatureApi`, `FeatureApiMap`, `FeatureApiClient` (`@langwatch/api/web`) | `createModuleApi`, `ModuleApi`, `ModuleApiMap`, `ModuleApiClient` | 43, 3 |

Source files named after the old word move with it: `feature-api-token.ts` → `module-api-token.ts`,
`feature-namespace.ts` → `module-namespace.ts`, `feature-api.ts` → `module-api.ts`.

Leave alone: runtime-composition's internal types (`ServerFeatureBuilder`, `InstalledFeature`,
`FeatureTransportDescriptor`, ~20 names), lint policy ids (`feature-source-layout`,
`feature-catalogue`, `feature-shape`; they are baseline keys), the seven `feature-*` skills, and
every "feature" that means a feature flag or a `.feature` spec file.

## Method

1. `git mv` the directories (this lane may run `git mv` and nothing else in git; Fable commits).
   Order: `packages/enterprise` → `enterprise`, then `enterprise/features` → `enterprise/modules`,
   `enterprise/composition` → `enterprise/packages/composition`, `enterprise/plan-gate` →
   `enterprise/packages/plan-gate`, then `packages/features` → `modules`.
2. `pnpm-workspace.yaml`, root `package.json`, then `CI=true pnpm install --no-frozen-lockfile` once,
   so `node_modules` links resolve before any typecheck.
3. TS-LSP for import specifiers that are relative paths crossing a moved boundary (rare: packages
   import each other by name). Open each of the 55 tsconfigs and every `vitest.config.ts` by hand.
4. Text rewrites in the 737 + 169 files: `packages/features/` → `modules/`,
   `packages/enterprise/features/` → `enterprise/modules/`, `packages/enterprise/composition/` →
   `enterprise/packages/composition/`, `packages/enterprise/plan-gate` → `enterprise/packages/plan-gate`,
   remaining `packages/enterprise` → `enterprise`. Order matters: longest prefix first. Read each
   file's hit before editing; prose sometimes says "features" meaning the product concept.
5. Lint sources: `workspace.ts` discovery roots and messages, `feature-layout.ts`, `feature-shape.ts`,
   `feature-app-contract.ts`, `api-transport-boundaries.ts`, lint-core rules and their fixture
   workspaces (`createFixtureWorkspace` may build `packages/features/<x>` paths; move the fixture
   builder, not each test).
6. Report the baseline key list to Fable rather than editing baselines.

## Exit checks

```
grep -rn "packages/features\|packages/enterprise" --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git --exclude=pnpm-lock.yaml . | grep -v baseline.json | grep -v "dev/docs/plans/modules-rename.md"
pnpm typecheck:one modules/annotation/server && pnpm typecheck:one modules/annotation/web && pnpm typecheck:one enterprise/modules/audit-log/server && pnpm typecheck:one packages/api
pnpm --filter @langwatch/architecture-lint test
pnpm --filter @langwatch/lint-core test
node dev/scripts/check-feature-parity.ts 2>&1 | tail -3
```

Then Fable: rewrite the five baselines, run `pnpm lint` and `pnpm typecheck` once each, commit in one
slice (moves and edits together; a split commit would leave HEAD unbuildable).

## Rules for the lane

Same as every lane: Opus; Edit/Write for edits (no sed/scripted rewrites over unread files); no root
typecheck/lint/format; `git mv` is the only git write allowed, no add/commit/stash; no baselines; no
`.env*`; no re-exports. Skip nothing else: the tree must be consistent at the end of the lane, because
a half-renamed tree does not install.
