# Architecture lint review, 2026-09-08

**Scope:** `packages/architecture-lint` (src, tests, specs, baselines, adrs) and the gates it documents in
`.claude/skills/architecture-guide/references/gates.md`. Read-only review. Evidence is `file:line` against
HEAD `7d62e58ca3`. Numbers come from one `pnpm --filter @langwatch/architecture-lint lint` run
(26.6 s wall, exit 1), `pnpm typecheck:one packages/architecture-lint` (clean) and
`pnpm --filter @langwatch/architecture-lint test` (10 files red, 29 of 1054 tests failing).

## Verdict

The policies are mostly right and the specs that describe them are fully bound (91 of 91 scenarios
across six feature files). The package around them is not. `src/` is 55 files flat, 24,000 lines, with six
files over 700 lines and one over 2,000; it fails its own `source-folder-shape` rule four times over and
sits in its own baseline. Fourteen baseline files use eight different shapes, six of them are empty
ratchets still carrying loaders and CLI flags, and only eleven policies report a stale row. One run prints
30,645 lines to stderr, and the first 18,500 are a comment-block "review attention" inventory that never
changes the exit code, so an agent reading the output sees no violation until line 18,523. Nine policies
walk the tree themselves, two import parsers disagree on what an import is, and the policy set is
registered in three places with no registry. The fix is not more policies. It is the same discipline
`packages/api` got tonight: one snapshot of the workspace, one baseline shape, one report, one door, and
a folder of policy files a reader can hold.

## Findings, ranked

| id | where | what is wrong | why it matters | fix |
| --- | --- | --- | --- | --- |
| A1 | `src/cli-run.ts:139-147`, `src/comment-blocks.ts:363-391` | The 4-5 line comment "review attention" tier prints on every run, first, to stderr: 6,173 entries, 18,522 lines, exit code unchanged. | An agent reads 60% noise before the first violation; the signal is buried at line 18,523. | Print the review tier only under `--review-comment-blocks`; violations first, a per-policy count line before them. |
| A2 | `src/` (55 files, 24,032 lines); `frontend-ui-boundaries.ts` 2,199 lines / 51 functions / 35 policy ids; `check-feature-parity.ts` 1,936; `feature-app-contract.ts` 1,431; `api-transport-boundaries.ts` 1,159 | The package that enforces "12 files per folder, one concept per file" is one flat folder of 55 files with six God files, baselined against itself (`source-folder-shape-baseline.json` rows for `packages/architecture-lint/src`). | Nobody can find a policy; the lint cannot be trusted to say what it will not do itself. | Target layout below: `policies/` with one file per policy family, ≤12 per folder. |
| A3 | `src/*-baseline.json` (14 files) with top-level keys `entries` (two spellings), `edges`, `roots`, `files` (×2), `sites`, `ports`, `services`, `budgets`; 22 `read*/format*/compare*Baseline` functions in 12 files | Eight baseline shapes, each with its own loader, sorter and formatter; sort rules differ (`composed-exports.ts:59` code-unit `<`, `index.ts:203` `localeCompare`); stale rows are reported by 11 policies and not by the rest. | Every ratchet is a separate mechanism to learn, and a stale row in one of the silent baselines silently allows what it once permitted. | One `baseline.ts`: `{ version, policy, entries: [{ key, measured, expires? }] }`, code-unit sorted, validated on load, stale rows always reported, one formatter. |
| A4 | `api-transport-credential-context-baseline.json`, `api-transport-framework-allowlist.json`, `overengineering-baseline.json`, `port-module-baseline.json`, `service-ceilings-baseline.json`, `typed-prisma-seam-baseline.json` (all empty); `cli-run.ts:32-58` six `--*-baseline-reference` flags and `--shrinking-baseline-only` | Six ratchets have reached zero and still carry their loaders, formatters, comparison mode and CLI flags. | Dead mechanism that every reader has to rule out; `cli-run.ts` is 208 lines of flag plumbing for them. | Delete the six files and their read/format/compare code; the policies become plain refusals. |
| A5 | `src/feature-layout.ts:274` `SOURCE_FILE_EXTENSIONS = [".ts", ".tsx"]`, `:308` `target.endsWith(extension)`, `:305-315 packageEntrypoints` | `dist/index.d.ts` ends with `.ts`, so every `types` export target becomes a public entrypoint and `private-runtime-export` fires on declaration files: 58 of the run's 124 hits name `dist/`. | Half the policy's output is a build artefact; a fresh clone without `dist/` reports different findings from a developer's tree. | Skip `.d.ts` and anything under `dist/`; take entrypoints from source conditions only. |
| A6 | `src/feature-shape.ts:69` (`nested-web-entry` wants flat entries) versus `src/frontend-ui-boundaries.ts:289` (`screens/\|surfaces/` recognised by regex for any package), `:297-330` (a flat entry recognised only through the catalogue), `:898-918` (`ui-web-package-governance` refuses a catalogue row for an ungoverned package), `:715-835, 1977-2126` (governing a package applies the whole layout grammar) | Two policies contradict for an ungoverned web package: feature-shape demands the flat entry, frontend-ui-boundaries refuses to recognise it until the package is governed, and governing suite-web produced 110 new findings for 43 root files. | A conversion lane cannot close `nested-web-entry` without a second, unbriefed layout migration. | One grammar: every `*-web` package discovered by `workspace.ts` is governed; flat entries are the only spelling; layout findings ratchet in the same baseline as everything else; the catalogue declares `uses` only. |
| A7 | `src/source-folder-shape.ts:89-106` (`RELATIVE_IMPORT` regex), `check-feature-parity.ts:852-1440` (hand-rolled TS/Go/Python/Bats/shell scanners), versus `module-graph.ts:155-231` (`parseSource` through the TypeScript AST) | Two import parsers. The regex one counts `import type` as a reader: fixture `shape.ts` (one type export) read by one `import type` neighbour is reported `fragment-file`. ADR-099 says static scans go through the compiler API. | Findings differ by parser; the type-only case is a real false positive tonight (a types file read only by types is not a paragraph of its reader). | `source-folder-shape` uses `valueImports` from module-graph; parity's scanners move with parity (A11). |
| A8 | `readdirSync` in 9 files (`composed-exports`, `architecture-records`, `feature-configuration`, `feature-shape`, `check-feature-parity`, `files`, `frontend-ui-boundaries`, `module-graph`, `workspace`); `sourceFiles` defined 5 times, `scriptKind` 3, `isWithin` 2, `exportTarget` 2 | Every policy walks the tree and parses files for itself; the run is 26.6 s wall, 26.6 s user. | Cost scales with policies × files, and helpers drift (five `sourceFiles` with five ignore lists). | One workspace snapshot (files, manifests, catalogue, import graph) built once in `workspace/`, passed to every policy. |
| A9 | `src/index.ts:154-193` (25 policies in `lintWorkspace`), `cli-run.ts:104-130` (`lintComposedExports`, `lintOxlintBaseline`, `lintCommentBlocks` run only in the CLI), `feature-layout.ts` (calls `lintFeatureAppContracts` and `lintFeatureSetupInfrastructure`), `prisma-table-ownership.ts` (calls `lintPrismaMigrationAccess`), `feature-setup-infrastructure.ts:597,673` (emits `feature-app-factory`) | 99 policy ids, registered in three places and by nesting; a library caller of `lintWorkspace()` gets fewer policies than `pnpm lint`; nothing lists what runs. | Nobody can answer "which policies exist and which ran"; new policies get bolted on wherever. | `policies/index.ts` registry: `definePolicy({ id, spec, baseline?, run(snapshot) })`; `lintWorkspace` iterates it; the CLI adds nothing. |
| A10 | `tests/` (71 files); 37 have no `src/` twin (`dev-supervisor`, `kill-dev-tree`, `check-queue`, `check-shims`, `die-with-parent`, `clickhouse-*`, `redis-ownership`, `langyagent-shell-tools`, `resolve-nlp-service`, `plan-langy-lane`, `tsconfig-shared-base`, `env-example-sentinels`, ...); 29 failures in 9 of them today; 17 policy ids appear in no test (`boundary-edge-baseline`, `composed-exports`, `feature-app-factory`, `feature-configuration`, `package-cycle`, `ui-web-private-layout`, `ui-web-global-feature-leakage`, `ui-web-capability-owner`, ...) | The package is the repository's test dumping ground; `pnpm --filter @langwatch/architecture-lint test` is red for reasons unrelated to lint, and a fifth of the policies have no test. | A red suite nobody owns is a suite nobody runs; untested policies are untested code paths in the thing that gates every PR. | Move repo guards to the package or tool they guard (`dev/scripts`, `tools/thuishaven`, the ClickHouse package); one test file per policy file; delete or test the 17. |
| A11 | `src/check-feature-parity.ts` (1,936 lines, 46 functions): spec discovery, five language binding scanners, report printing, `LEGACY_INERT` (a hard-coded list of spec files, `:262-290`), `main()` | Spec-parity is a separate tool living inside the boundary linter, in one file, with an allowlist in code. | It is the biggest file in the package and the one every lane reads; the inert list changes on every conversion and is a source edit each time. | Its own tool (Go CLI under `tools/`, per the tooling rule, or at least its own package); inert becomes a tag in the spec file with a reason and a date. |
| A12 | 289 `message:` sites, 158 with `allowed:`; sample of 34: `api-transport-boundaries.ts:1008` "API transport dispatches through string path", `service-ceilings.ts:107` "services must be sorted by file", `test-quality.ts:507` "Test callback has no recognised assertion.", `manifests.ts:60` "Package must declare an explicit exports map.", `declarations.ts:102` "Public declaration leaks X." | About 40% of messages are labels, not instructions; capitalisation, punctuation and quoting styles vary; 131 findings carry no `allowed` line. | Alex's rule tonight: errors are prompts that guide the agent that made the mistake. A label sends the agent to read the linter source. | One message contract in `report.ts` (what happened, why, what to do), a test that every policy's finding has `allowed`, and one pass over the 289 sites. |
| A13 | `src/cli-run.ts:177-205` | On failure the CLI prints every violation, alphabetically by file, and nothing else: no counts, no grouping, no cap. | An agent has to grep its own gate output to learn what kind of thing failed. | Summary first (policy → count), findings grouped by policy, a per-policy cap with `--all`. |
| A14 | `src/cycles.ts`, run output `[package-cycle]` ×26 | 26 dependency cycles among `*-web` packages (`analytics-web -> evaluator-web -> analytics-web`, ...) with no baseline and no `allowed`. | Permanent red hides a new cycle; the policy has been noise since the web packages were split. | Either the packages get fixed or the edges get a baseline row with an owner; the finding gains an `allowed` line saying which import to move. |
| A15 | `src/index.ts:31-152` (90 names exported), `package.json` `exports` one door | The public door re-exports most of the package so tests and the CLI can reach helpers. | The package cannot tell its API from its internals; tests test the barrel. | Index exports `lintWorkspace`, `formatViolation` and the types; tests import the module they test. |
| A16 | `src/lint-queue.ts` (loopback ports 47381/47382) versus `dev/scripts/check-queue.mjs` and `haven slot run` | A second machine-wide lint slot mechanism beside the one every other check uses. | Two queues on one machine do not coordinate; the CLI waits on ports while the shim waits on a flock. | Go through the check-queue slot; delete `lint-queue.ts`. |
| A17 | `boundary-edge-baseline.ts:155-163`, `comment-blocks.ts:200-204` enforce `expires`; every other baseline has `measured` only | Two ratchets expire, the rest only shrink; no stated rule for which a baseline gets. | Nobody knows whether a row is a debt with a date or a permanent allowance. | Decision (below): one rule for all baselines. |
| A18 | `src/cli-run.ts:26-58` | Twelve argv flags parsed by `indexOf`, six of them per-baseline reference paths for the merge-base comparison mode. | Flag plumbing is half the file; the mode is a mystery to anyone who did not write it. | `--mode=check\|shrink\|review`, `--baseline-dir`, nothing else. |
| A19 | `check-feature-parity.ts:64 SPECS_ROOTS`, `feature-shape.ts:72 BOOT_SCAN_ROOTS`, `feature-configuration.ts:15 APPLICATION_CONFIG_DIRECTORIES`, `frontend-ui-boundaries.ts:25 UI_SOURCE_DIRECTORIES`, `comment-blocks.ts:21`, `files.ts:4`, `source-folder-shape.ts SCANNED_ROOTS` | The repository tree is spelled out in seven constants across seven files. | The `features → modules` rename will touch all seven; today the ignore lists already disagree. | One `workspace/layout.ts` naming the roots and the ignore set. |
| A20 | `src/comment-blocks.ts` + `comment-block-roots.json` (`apps/api` 1,281 blocks, expires 2026-09-17) versus the oxlint `comment-block-size` rules in `@langwatch/lint-core` | Two systems govern comment length: an oxlint rule per block and an architecture ratchet per root. | Same rule, two reports, two baselines. | Keep the oxlint rule; let the roots ratchet expire and delete it. |
| A21 | `src/oxlint-baseline-check.ts`, `src/generate-native-baseline-overrides.mjs`, `src/lint-rules-doc.mjs` | Validation of another tool's baseline and its docs generator live here. | They are oxlint plumbing, not boundary policy. | Move to `@langwatch/lint-core`. |
| A22 | `src/*.cli.ts` (rename-workspace-package, rename-feature-sources, colocate-tests, declaration-budget) and their non-policy modules | One-shot migration tools share the folder with policies. | They inflate the folder and the door; none is a lint. | `tools/` or delete once their migration is done. |

## Target layout

Mirrors the nine-file discipline `packages/api` got: one concept per folder, one readable part per file,
one door.

```
packages/architecture-lint/
  package.json            exports "." only; scripts: lint, test, typecheck
  src/
    index.ts              the door: lintWorkspace(snapshot options), formatReport, types
    cli.ts                argv → { mode, baselineDir }; runs; prints summary then findings; exit code
    report.ts             Finding type, message contract (what, why, do), grouping, summary, formatter
    baseline.ts           one shape for every policy: read, validate (sorted, dated), stale rows, shrink compare, format
    workspace/
      snapshot.ts         files, manifests, catalogue, classified packages, built once per run
      module-graph.ts     imports/exports through the TypeScript AST, resolver, value-import walker
      layout.ts           the repository roots and ignore set, spelled once
    policies/
      index.ts            the registry: definePolicy({ id, spec, baseline?, run(snapshot) }) for every policy
      feature-shape.ts    the annotation shape ratchet (13 kinds)
      source-folder-shape.ts  folder budget and fragment floor
      feature-layout.ts   contract / server / web roles, private server exports (the .d.ts fix here)
      feature-app.ts      app contract, factory, setup infrastructure (three files folded, one concept)
      api-transport.ts    handler boundary, through-framework, construction, string locators
      boundaries.ts       application, enterprise direction, package cycles, manifests, records
      persistence.ts      prisma table ownership, migration access, typed seam
      eventing-roles.ts
      quality.ts          test quality (comment blocks go to lint-core, A20)
      frontend/
        catalogue.ts      catalogue schema, governed packages = discovered web packages, declared uses
        entries.ts        flat entries, public exports, declared capabilities
        closures.ts       screen and surface closures
        layers.ts         apps/ui roots, global structure, feature layers, private layout
    baselines/            one JSON per policy that ratchets, one schema
  tests/                  one test per policy file, plus cli, report, baseline, snapshot
  specs/                  one feature file per policy family, every scenario bound
  adrs/
```

Leaves the package: `check-feature-parity.ts` (own tool), the four `*.cli.ts` migration tools, the oxlint
baseline check and docs generator (lint-core), the 37 repo-guard tests (to the code they guard),
`lint-queue.ts` (check-queue slot).

## Lanes

Each is one Opus lane, reviewed by Fable, committed by pathspec. Order matters: L1 makes the output
readable so every later lane can see what it changed; L2 and L3 give the policies one substrate; L5 moves
them onto it.

| # | lane | allowed paths | exit checks |
| --- | --- | --- | --- |
| L1 | **Report and CLI.** `report.ts` with the message contract; summary first, findings grouped by policy, per-policy cap with `--all`; review tier only under `--review-comment-blocks`; `--mode`, `--baseline-dir`; delete `lint-queue.ts` in favour of the check-queue slot. | `packages/architecture-lint/src/{cli*.ts,index.ts,types.ts,lint-queue.ts}`, new `report.ts`, `tests/cli-*.ts`, `dev/scripts/check-queue.mjs` only if the slot needs a name | package test green for touched files; a lint run prints the summary in its first 40 lines and no comment review; exit codes pinned by test |
| L2 | **One baseline.** `baseline.ts`; migrate the eight live baselines to `{ version, policy, entries[{key, measured, expires?}] }` with a one-off script; stale rows reported for every policy; delete the six empty baselines and their read/format/compare code and flags. | `packages/architecture-lint/src/**` baseline code and JSON, `tests/*baseline*` | every policy's stale-row test; `git diff --stat` shows the six JSON files and ~1,500 lines gone; lint findings identical to before on the live policies (diff the two runs' finding sets) |
| L3 | **Snapshot.** `workspace/{snapshot,module-graph,layout}.ts`; every policy takes the snapshot; `source-folder-shape` reads value imports from the graph; `.d.ts` and `dist/` excluded from entrypoints. | `packages/architecture-lint/src/**`, `tests/**` | run time under 10 s; `private-runtime-export` reports zero `dist/` paths; the type-only fixture reports no fragment; finding sets otherwise identical |
| L4 | **Frontend grammar.** Governed = discovered; flat entries the only spelling; layout findings ratchet in the shared baseline; split `frontend-ui-boundaries.ts` into `frontend/{catalogue,entries,closures,layers}.ts`; retire the `screens/\|surfaces/` regex once the last nested entry converts. | `packages/architecture-lint/src/frontend/**`, `specs/frontend-feature-boundaries.feature`, `tests/frontend-*`, `apps/ui/src/features/catalogue.json` (drop the governed list) | suite-web's 110 findings become baseline rows, not refusals; 20/20 scenarios still bound; no file over 400 lines |
| L5 | **Registry and folders.** `policies/index.ts` with `definePolicy`; move each policy file under `policies/`; fold `feature-app-*` into one, `api-transport-*` into one; index exports the door only; tests import modules directly. | `packages/architecture-lint/src/**`, `tests/**` | `lintWorkspace` and the CLI run the same policy list (test); `source-folder-shape` reports nothing under `packages/architecture-lint/src`; package rows leave the baseline |
| L6 | **Parity out.** `check-feature-parity.ts` becomes its own tool (decision D1 says Go or TS); `@inert` tag with reason and date replaces `LEGACY_INERT`; scripts and CI step re-pointed. | new tool path, `packages/architecture-lint/{package.json,src/check-feature-parity.ts}`, `.github/workflows/*` parity step, `tests/check-feature-parity.test.ts` | same report on the same tree; the four inert spec files carry the tag; architecture-lint no longer holds the file |
| L7 | **Repo guards home.** Move the 37 tests to the package or tool they guard; fix or delete the 29 failing ones with their owners named. | `packages/architecture-lint/tests/**`, destination packages' `tests/` | `pnpm --filter @langwatch/architecture-lint test` green and only about policies; each moved test green where it landed |
| L8 | **Messages.** One pass over the 289 sites against the contract; `allowed` on every finding; test that enforces it. | `packages/architecture-lint/src/policies/**`, `tests/**` | the enforcement test; a sample of 30 read as instructions |

## Decisions for Alex

- **D1** Parity tool: Go CLI under `tools/` (the tooling rule) or a TypeScript package. Go means the
  five language scanners are rewritten; TypeScript means they move as they are.
- **D2** Baselines: every row carries `expires` and the lint refuses an expired row, or rows only
  `measured` and the ratchet only shrinks. Today two policies do the first and twelve the second.
- **D3** The 26 web-package dependency cycles: fix the packages (evaluator-web ↔ analytics-web and the
  eight-package ring through model-provider-web) or baseline the edges with owners.
- **D4** Comment length: keep only the oxlint rule and let `comment-block-roots.json` expire on
  2026-09-17, or keep the per-root ratchet too.
- **D5** The 17 untested policies: write the tests, or delete the policies (candidates:
  `overengineering-baseline`, `service-ceilings-baseline-growth`, `typed-prisma-seam-baseline`, all
  three sitting on empty baselines).
- **D6** Where the oxlint baseline check and the native-override generator live: here or in
  `@langwatch/lint-core`.
- **D7** Whether the `screens/*` and `surfaces/*` spellings keep working during the conversion drive
  or are refused now for the packages already converted.
