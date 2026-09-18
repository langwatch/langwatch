# Supply deletion worklist

Read-only measurement for the lanes in
`dev/docs/plans/handover-2026-09-17-compiler-checked-supply.md`. Every count
names the command that produced it, so it can be re-run. Measured against the
working tree (not the index), `feat/strict-feature-layout-v0`, 2026-09-17.
Two cited files (`apps/api/.../api-production.composition.ts`,
`apps/worker/.../worker-production.composition.ts`) are dirty from another
session; diffs checked, both net zero lines, so counts below still hold.

## Headline numbers

| Claim | Handover | Found | Verdict |
| --- | --- | --- | --- |
| live `.withProvided(` call sites | 89 | 89 (consumers) / 100 (repo-wide) | confirmed |
| worker absence classes / body lines | 15 / 279 | 15 / 279 | confirmed exactly |
| files teaching the old shape | 16 | 16 | confirmed exactly |
| installation tests broken today | 6, of which 4 unfixable | **4**, not 6 | **disagreement** |

## 1. Deleted supply spellings

Method: `grep -rn "<pattern>" --include='*.ts' . | grep -v node_modules`, split
production vs `__tests__`/`.test.ts`, and the defining package
(`packages/runtime-composition`) split from its consumers.

**`withInfrastructure`** - already deleted from `packages/runtime-composition/src`
and already in `BANNED_METHODS`
(`packages/oxlint-rules/src/rules/banned-legacy-names.rule.mjs:35`). 0 working
call sites, 4 broken callers, all throwing `TypeError:
createApp(...).withInfrastructure is not a function` (ran 3, confirmed; 4th
needs Postgres, confirmed by source absence instead):
`modules/presence/process/src/app/__tests__/presence-installation.unit.test.ts:23`,
`modules/evaluation/process/src/app/__tests__/evaluation-installation.unit.test.ts:20`,
`modules/stored-object/process/src/app/__tests__/stored-object-installation.unit.test.ts:14`,
`apps/worker/src/__tests__/codex-coding-defaults.integration.test.ts:121`.

**`withPersistence`** - also already in `BANNED_METHODS` (rule line 37). 0
working call sites, 1 real broken caller:
`apps/worker/src/__tests__/codex-coding-defaults.integration.test.ts:120`
(same file, chained before `.withInfrastructure({})`). Two more textual hits
are not calls: a stale comment
(`enterprise/modules/governance/process/.../governance-repositories.registry.unit.test.ts:4`)
and the pattern string inside a lint error message
(`packages/architecture-enforcer/src/policies/feature-shape.ts:83`).

Note for L7: only `stored-object` matches "cannot be fixed under the present
design" - its config is `z.enum(["s3", "azure"]).optional()`
(`modules/stored-object/contract/src/stored-object.config.ts:15`), no memory
option exists. `presence` and `evaluation` inject plain objects and look
portable **today** via `members: membersFrom({...})` passed straight to
`createApp(...)`, which already exists and is untouched by this drive - worth
checking before assuming all four wait for L1.

**`withTransports`** (process-side, `ApplicationBuilder.withTransports` at
`packages/runtime-composition/src/application.ts:239`) - 2 production call
sites: `apps/api/src/app/api-production.composition.ts:470`,
`apps/worker/src/app/worker-production.composition.ts:790`. Distinct from the
**module-side** `withTransports` on the `FeatureApp` builder
(`feature-installer.ts:1048,1224,1318`), used by every
`modules/*/server/src/*.server.ts` - not in scope, do not touch those.

**`membersFrom`** - 11 call sites, all still working (function not deleted).
Defined `module-members.ts:36`. One production use inside the defining
package itself (`process-supply.ts:125`). Ten more across 8 test files:
`apps/worker/.../worker-tenancy-ownership.composition.unit.test.ts`,
`entitlement-installation.unit.test.ts` (x3), `entitlement-request-bound.unit.test.ts`,
`elevenlabs-webhook.integration.test.ts`, `secret-installation.unit.test.ts`,
`topic-installation.unit.test.ts`, `user-installation.unit.test.ts`,
`workflow-installation.unit.test.ts`.

**`withMemoryRepositories`** - 35 call sites, all still working (function not
deleted, despite being listed in ADR-147's Consequences). Defined
`feature-installer.ts:303`. 3 production sites (`enterprise/packages/composition/{api,worker}/src/*.composition.ts`),
32 across 27 test files (2 of them the defining package's own tests).

**`withProvided`** - raw repo count **100** (minus 1 string false-positive in
`feature-shape.ts:83`). Subtracting the 11 sites inside the defining package
itself (`process-supply.ts:135` + its own tests `module-members.unit.test.ts`
x8, `feature-api.unit.test.ts` x2 - both import `createApp` from `../src/`,
i.e. test the builder, not a consumer) gives **89 consumer call sites**,
matching the handover exactly. None are dead. By package, fewest first:
apps/api 1; monitor 1; metric 1; presence 2; share/role/feature-flag/evaluation/dashboard
3 each; apps/worker 4; workflow/user/suite/dataset/data-retention 4 each;
annotation 6; ops 5; entitlement (2 files) 7; gateway 8; data-privacy (2
files) 8; enterprise (sso.composition.ts + 2 tests) 9.

## 2. Worker absence scaffolding - confirmed exactly

`wc -l worker-production.composition.ts` = **2646** (matches). Class count via
brace-matched boundaries (not "next class minus one", which overcounts
non-class code between declarations): **21 classes**, of which **15 are
absence scaffolding** (`LoggedWorker*Absence`, `Absent*`, plus 3
`Worker*AbsenceReport` abstract bases that exist only to be extended by the
`Logged*` set), spanning **279 lines of class body exactly** - matches.

"116 lines of mentions" not exactly reproduced: literal class-name mentions
outside the 279 body lines = 15 (one per class); case-insensitive
`Absen(t|ce)` substring (catches the lowercase `absence` field and factory
method names like `traceAbsence`) outside bodies = 110; case-sensitive = 83.
Same shape, no exact match on 116 - not worth further chase.

All 15 have a live call site (none dead), cheapest/shortest body first, all
line refs into `worker-production.composition.ts`:

| Class | Lines | Declared | Live call site |
| --- | --- | --- | --- |
| `WorkerGithubAbsenceReport` | 3 | :337 | factory `githubAbsence()` :1973, invoked :846 |
| `WorkerIdentityAbsenceReport` | 3 | :2492 | factory `identityAbsence()` :1937, invoked :1702 |
| `WorkerTraceAbsenceReport` | 4 | :295 | factory `traceAbsence()` :1850, invoked :1036, used :1070 |
| `AbsentTraceTriggerMatches` | 5 | :2628 | `new AbsentTraceTriggerMatches()` :1845 |
| `AbsentEvaluationGraphActivity` | 13 | :2593 | `new AbsentEvaluationGraphActivity()` :1445 |
| `LoggedWorkerScenarioAbsence` | 15 | :2362 | `.create()` :1872, factory invoked :1147, used :1187 |
| `LoggedWorkerGithubAbsence` | 16 | :2470 | `.create()` :1977, factory invoked :846 |
| `LoggedWorkerIdentityAbsence` | 16 | :2497 | `.create()` :1941, factory invoked :1702 |
| `LoggedWorkerTopicAbsence` | 16 | :2515 | `.create()` :1959, factory `topicAbsence()` invoked :1594 |
| `LoggedWorkerTraceAbsence` | 16 | :2608 | `.create()` :1854, factory invoked :1036 |
| `LoggedWorkerEvaluationAbsence` | 23 | :2564 | `.create()` :1968, factory invoked :1490 |
| `LoggedWorkerLangyAbsence` | 27 | :2441 | `.create()` :1917, factory invoked :1062, used :1125 |
| `LoggedWorkerModelProviderAbsence` | 30 | :2532 | `.create()` :1950, factory invoked :1093 |
| `LoggedWorkerGatewaySpendAbsence` | 36 | :2324 | `.create()` :1863, factory invoked :911, used :946 |
| `LoggedWorkerAutomationSettlementAbsence` | 56 | :2383 | `.create()` :1908, factory invoked :1288, used :1324/:1425 |

## 3. Files teaching the old shape - 16, confirmed exactly

12 skills + 2 ADRs + 2 lint files. Historical `dev/docs/plans/handover-*.md`
and `.claude/handoffs/`/`.claude/manifests/` files also match but are dated
lane records, not current teaching docs - excluded, per L8's own rule.

| File | Stale spelling(s) |
| --- | --- |
| `.claude/skills/architecture-guide/references/contract.md` | `withProvided` |
| `.claude/skills/module/references/extend.md` | `withProvided` |
| `.claude/skills/module-review/references/review-checklist.md` | `withTransports` (module-side, see caution) |
| `.claude/skills/architecture-guide/references/config-composition.md` | `withTransports` (process-side, line 150 - genuinely stale) |
| `.claude/skills/module/references/transport.md` | `withTransports` (module-side, see caution) |
| `.claude/skills/architecture-guide/references/testing.md` | `withMemoryRepositories`, `withProvided` |
| `.claude/skills/module/references/new.md` | `withPersistence`, `withProvided`, `withTransports` |
| `.claude/skills/module/references/wire.md` | `withInfrastructure`, `withPersistence`, `withProvided` |
| `.claude/skills/architecture-guide/SKILL.md` | `withInfrastructure`, `withTransports` |
| `.claude/skills/architecture-guide/references/server.md` | `withTransports`, `withMemoryRepositories`, `withProvided` |
| `.claude/skills/module/references/convert.md` | `withInfrastructure`, `withTransports`, `withPersistence`, `withProvided` |
| `.claude/skills/architecture-guide/references/composition-by-size.md` | all 6 (rewrite, don't edit, per L8) |
| `packages/oxlint-rules/src/rules/banned-legacy-names.rule.mjs` | `withInfrastructure`, `withPersistence` (already banned; L9 adds the other 4) |
| `packages/oxlint-rules/tests/rules/banned-legacy-names.unit.test.mjs` | `withPersistence`, `withInfrastructure` |
| `dev/docs/adr/133-composition-spec.md` | `withPersistence`, `withTransports`, `withInfrastructure` |
| `dev/docs/adr/144-declarative-process-composition.md` | `withTransports`, `withProvided` |

Caution: `review-checklist.md` and `transport.md`'s only match is the
module-side `<f>.server.ts`'s `.withTransports(...)`, which this drive does
**not** delete - re-read before editing, may need no change.
`dev/docs/adr/147-...md` itself also contains all 6 spellings but is the
decision record describing the deletion, correctly excluded from the 16.

## 4. Tests broken on removed seams - 4 files, not 6

Exactly 4 files reference `withInfrastructure`/`withPersistence` anywhere in
the tree (section 1, checked with both a dotted-call grep and a bare-word
grep - no indirection through a shared helper exists). Running 3 of the 4
confirms the exact error the handover names:

```
TypeError: createApp(...).withInfrastructure is not a function
```

- `stored-object-installation.unit.test.ts` - ran, 4 tests fail. Genuinely
  blocked until this design lands (backend config has no memory option).
- `presence-installation.unit.test.ts` - ran, fails this way.
- `evaluation-installation.unit.test.ts` - ran, fails this way.
- `codex-coding-defaults.integration.test.ts` - not run (needs Postgres);
  calls both `.withPersistence` and `.withInfrastructure` in one chain.

All 4 are clean in `git status --porcelain` - current ground truth, not a
stale grep.

**Disagreement:** handover claims 6 broken, 4 unfixable. Only 4 exist today;
either the handover over-counted or two were already migrated by a
concurrent lane before this measurement. Of the 4, only `stored-object`
clearly matches "cannot be fixed without this design" (the `s3 | azure`
enum). `presence` and `evaluation` inject plain member objects and look
fixable today via `members: membersFrom({...})`, no need to wait for L1 -
worth five minutes before scoping L7's "unfixable" bucket at its old size.

`*-installation.*.test.ts` file count: **27**, not "~40" - the larger figure
likely also counts non-installation-named composition tests exercising the
same builder; not separately recounted here since it wasn't the ask.
