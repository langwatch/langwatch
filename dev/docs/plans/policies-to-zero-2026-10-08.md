# Architecture policies to zero: sizing sweep

Date: 2026-10-08. Ruling: round 29, CI-2/CI-3 (`.claude/coordinator/rulings-2026-10-07.md`): all 17 non-zero
architecture policies reach zero before merge, each joining the CI list in
`.github/workflows/langwatch-app-ci.yml` (the `--policies` list, about lines 1104-1112) as it reaches zero.
`peer-cycles` (145) is handled by other lanes and is not sized here.

This is a read-only sweep. Nothing was edited, no git writes were made, and no `tsc -b` was run. The tree is
shared and moving (270 changed paths when the sweep ran), so counts drift by a few between runs; the figures
below are from one `--all` run at the end of the sweep.

## 1. Counts

Run as `node ... packages/architecture-enforcer/src/cli.ts --root . --all` from the repository root, which is
what `pnpm lint:architecture` runs, minus the path artefact in section 2.

| Finding id                        | Count | Registry id for `--policies` / CI list | Nature                                                |
| --------------------------------- | ----: | -------------------------------------- | ----------------------------------------------------- |
| deleted-spellings-in-code         |   616 | deleted-spellings-in-code              | shrink-only baseline; real, see section 2             |
| public-declarations               |   375 | `declarations`                         | reads `dist/*.d.ts`; unreliable until `tsc -b`        |
| source-folder-shape               |   197 | source-folder-shape                    | 71 barrel-only, 70 single-reader, 56 oversize folders |
| unused-module-export              |   111 | unused-module-export                   | all `src`, none in tests                              |
| eventing-table-access             |    37 | eventing-table-access                  | 36 ops, 1 data-retention; baselined                   |
| service-ceilings                  |    33 | service-ceilings                       | 33 service files over a ceiling                       |
| feature-shape                     |    22 | feature-shape                          | legacy shapes                                         |
| migration-owners                  |    21 | migration-owners                       | historic migrations; baselined; cannot be edited      |
| feature-layout                    |    10 | feature-layout                         | shares a registry id with private-runtime-export      |
| framework-module-contracts        |    10 | framework-module-contracts             | 9 browser-host, 1 prisma-client; baselined            |
| clickhouse-table-ownership        |     3 | clickhouse-table-ownership             |                                                       |
| service-projection-write-boundary |     3 | `service-projection-boundaries`        | already on the CI list; see section 7                 |
| architecture-record               |     2 | `architecture-records`                 | tools/dev-runtime has no ADR                          |
| browser-package-exports           |     2 | browser-package-exports                | navigation browser side doors                         |
| private-runtime-export            |     2 | `feature-layout`                       | gateway and trace `__tests__/testing.ts`              |
| browser-node-leak                 |     1 | browser-node-leak                      | packages/redaction                                    |
| retired-package-runtime           |     1 | `manifests`                            | navigation-contract has no zod range                  |
| peer-cycles (excluded)            |   145 | peer-cycles                            | other lanes; one named exception                      |

Seventeen policies are non-zero once `peer-cycles` is set aside, which matches round 29. `cycles` is already on
the CI list and reads zero. Without `declarations` the whole tree reads 1216 findings across 17 policies;
with `peer-cycles` removed that is 1071, plus 375 for `declarations`.

Five finding ids do not match the registry id that `--policies` accepts. `--policies public-declarations`,
`architecture-record`, `service-projection-write-boundary`, `private-runtime-export` and
`retired-package-runtime` exit 2 (unknown policy). Use the registry ids in the table. Two registry ids carry more
than one finding id: `feature-layout` (also `private-runtime-export`) and `manifests` (many rules, one
firing today), so those join the CI list only when every finding id under them is zero.

## 2. The two suspect counts

### deleted-spellings-in-code (616): real count, wrong paths

The count is real. It equals the shrink-only baseline `packages/architecture-enforcer/tests/baselines/deleted-spellings.json`
(617 entries, two spellings differ, section 7), and every finding I opened points at a real line (for example
`apps/api/src/__tests__/share-link-engine.integration.test.ts:29` really contains `storesBackedMembers`).

The path rendering is an artefact. Through `pnpm lint:architecture` the cwd is `packages/architecture-enforcer`,
and this policy returns paths already relative to the root (`deleted-spellings.ts:114`), which
`cli.ts:134` (`relative(options.root, violation.file)`) then resolves against the cwd. Every finding therefore
prints as `packages/architecture-enforcer/apps/...` or `packages/architecture-enforcer/modules/...`, files that
do not exist. Run from the repository root with `--root .` the paths are correct. Other policies return absolute
paths and are unaffected. Fix: one line, either have the policy return absolute paths or have `cli.ts` resolve
against `options.root`; it belongs in lane L01.

### public-declarations (375, earlier reports 374 and 381): not a stable count

The id is `declarations` and the policy (`src/policies/quality/declarations.ts`) never reads source. It resolves
each process package's `tsconfig.build.json`, finds the `.d.ts` the build would write, and scans the ones
reachable from the package's exports for the patterns `@prisma/client`, `generated/prisma`, `platform/app` and
`~/`, and `repositories/prisma` or `repositories.ts`. So:

- It needs `tsc -b` output. Run `pnpm typecheck` (or `pnpm --filter <pkg> typecheck` per package), through the
  haven gate, before it can be trusted. I did not run it.
- The count depends on `dist` freshness. 62 of 63 process packages have a `dist`, and 37 of the 62 have source
  files newer than their newest `.d.ts` (mtime check). 374, 381 and 375 are three readings of a moving `dist`.
- Four packages are unread, and an unbuilt package reports a single refusal rather than its leaks, so 375 is a
  floor: `enterprise/modules/billing/process`, `enterprise/modules/digest/process`,
  `modules/user/process` (partial build) and `modules/onboarding/browser`.
- The 371 leak findings are real signal but a handful of root causes: 260 "leaks private repositories" and 111
  "leaks generated Prisma", over 57 packages. The shape is the same everywhere: the public entry declares the
  module class, which names `XRepositories` in `app/<x>.app.d.ts`, which pulls in `repositories/prisma/*.d.ts`
  (107 + 98 findings in `repositories/`, 46 in `app/`, 32 in `eventing/`, 12 in `services/`, 71 in module
  and index files). Example: `enterprise/modules/governance/process/dist/app/governance.app.d.ts:25`.
  One pattern fixes a package; applying it is mechanical.

## 3. Findings by policy

"Mechanical" means a rename, move, deletion or test placement with no new decision. "Ruling" points at section 6.

### deleted-spellings-in-code (616)

By spelling (largest first), with the owning area:

| Spelling                                                                                                                                                                                                                                                             | Count | Where                                                                                                  | Kind                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----: | ------------------------------------------------------------------------------------------------------ | ------------------------------ |
| ops "backoffice"                                                                                                                                                                                                                                                     |   308 | ops 161, sso 43, identity 37, apps/ui 19, billing 19, licensing 11, packages/browser 9                 | mechanical + ruling DS-A       |
| ProcessMembers, MemberSource/Name, MEMBER_NAMES, MembersRead, noMembers, membersFrom, setup.members, storesBackedMembers, `reads(...)`, createProcess, withProvided, SupplyToken, MissingSupply, with{Relational,Keyvalue,Analytical,Persistence,MemoryRepositories} |  ~290 | packages/process 109, process-stores 47, module 10, then evaluation 16, github 14, auth 16, scenario 9 | design (DS-C), then mechanical |
| UiDrawerMap, UiDeclared*, DrawerPropsMapOf, DrawersDifferingFromMap, `declared("<name>")`, `*-drawers.ts`                                                                                                                                                            |   ~55 | browser-host 36, packages/browser 13, workflow 4, organization 3, evaluator 2                          | design                         |
| computeNextRunAt                                                                                                                                                                                                                                                     |    15 | packages/time 10, governance 4, automation 1                                                           | ruling DS-B                    |
| `refusing*` twins, RestErrorHandler, absence classes, `use-feature-flag.ts` copies, public-app-config.projection, `*-composition.build.ts`                                                                                                                           |    21 | apps/ui 5, webhook 2, api 2, ops 2, scenario 2, langy 1, onboarding 1, secrets 1, config 1, auth 1     | mechanical                     |

By kind: 416 findings are in `src`, 200 in tests. By area, the ops "backoffice" family splits across halves:
ops browser 97, ops process 48, ops contract 16, identity process 31, sso process 23 and contract 20, apps/ui 19.

Examples:

- `modules/ops/browser/src/features/admin/ui/blocks/backoffice-table.tsx:129`: file and identifier rename.
- `modules/identity/contract/src/identity.api.ts:117`: `SsoConnectionBackofficeApi` and the `ssoBackoffice()`
  accessor; a contract rename that sso and ops call (rename once, repoint callers in the same wave).
- `apps/ui/src/shell/ui-route-table.ts:955`: `/ops/backoffice` kept as a retired-URL redirect, plus its tests
  (`retired-page-redirects.integration.test.tsx:232`, `ui-prefix-redirect.integration.test.tsx`). This is
  ruling DS-A: a deleted spelling used on purpose.
- `packages/process-stores/src/create-members.ts:152`: framework code that defines `ProcessMembers`; 109 hits in
  packages/process and 47 in process-stores are definitions and tests of the deleted surface itself (DS-C).
- `enterprise/modules/governance/process/src/rules/ingestion-pull-schedule.rules.ts:3`: `computeNextRunAt`
  imported from `@langwatch/time` (`packages/time/src/cron.ts:10`).

### public-declarations (375)

Section 2. Needs `tsc -b`. Roughly 57 root causes, one pattern (ruling PD-1), then mechanical across
63 process packages. Biggest: governance 21, gateway 20, automation 18, identity 13, instant-eval-judge 11.

### source-folder-shape (197)

Three kinds:

- 71 barrel-only: a 5-19 line file that exists only to be re-exported by the folder's index (57 are contract
  files, 13 are package files, 1 browser). Example: `enterprise/modules/demo-data/contract/src/demo-data.config.ts`
  (10 lines), `modules/agent/contract/src/agent.config.ts` (12 lines). Mechanical, subject to ruling SF-2 for
  contract artifact files.
- 70 single-reader: a small file only a sibling reads; inline it and delete it. Example:
  `apps/api/src/api-health-route.ts` (12 lines, only `main.ts` reads it), `apps/server/src/services/env.ts`.
  Mechanical (22 process, 20 browser, 19 package, 9 contract).
- 56 oversize folders (more than 30 source files): design. Sizes run from 31 to 146:
  `packages/design-system/src/components` 146, `modules/trace/contract/src` 105,
  `enterprise/modules/governance/process/src/services` 97, `modules/trace/process/src/rules` 85,
  `modules/identity/process/src/services` 84, `modules/langy/process/src/services` 79,
  `modules/automation/process/src/services` 72. The grammar allows one `features/<concern>/` level for process
  and contract (`feature-layout-policy.mjs`); the finding says "split the folder, not the file". Ruling SF-1.

Spread: 60 locations. Biggest: ops 15, identity 12, trace 12, licensing 10, gateway 10, organization 10,
automation 9, analytics 8, auth 8.

### unused-module-export (111)

All in `src`, no test files. Delete the export or drop the `export` keyword (or export from `index.ts` if it is
surface). Mechanical. By module: trace 33, annotation 10, evaluation 8, gateway 8, workflow 6, billing 5,
governance 5, agent 5, stored-object 5, experiment 4, identity 4, then singles. Examples:
`modules/annotation/process/src/eventing/annotation-lifecycle.commands.ts`,
`modules/evaluation/process/src/rules/instant-eval-judge-question.rules.ts` (`InstantEvalJudgeRequest`),
`modules/trace/process/src/repositories/trace-annotation-scores.repository.ts`. Run it last in a wave plan:
every other lane can create or remove unused exports (110, 111 and 115 across my three runs).

### eventing-table-access (37)

All baselined. 36 in ops, 1 in data-retention. By file: `prisma.process-ops.repository.ts` 24 (Prisma delegates
and raw SQL over `ProcessManagerInstance`/`Outbox`/`OutboxAttempt`, for example :343 and :86),
`prisma.process-manager-purge.repository.ts` 8 (:22), `clickhouse.event-explorer.repository.ts` 3 (raw SQL over
`event_log`, :130 and :174), `storage-stats-collection.service.ts` 1, and
`modules/data-retention/contract/src/retention-tables.ts:4` (names `event_log` in a category map). Design:
the rule says only `packages/eventing` touches event tables, and the whole ops process-manager and event-explorer
surface does. Rulings ET-1 and ET-2.

### service-ceilings (33)

33 service files over a ceiling: 20 on lines only, 5 on longest method only, 3 on lines and method, 3 on line length,
2 mixed (`canonical-log.service.ts` 833 lines, 152-line method, 30 statements). Largest:
`modules/auth/process/src/services/cli-device-flow.service.ts` (1515 lines), `sso-connection-guards.service.ts`
(1125), `http-model-provider-credential-probe.service.ts` (1045), `ops/.../checkup.service.ts` (929).
Cheap: `langwatch-ql-access-model.service.ts` and `langwatch-ql-diagnostics.service.ts` (line length only).
Fix is "split coherent private collaborators"; mechanical refactor, no ruling. By module: analytics 3, auth 3, ops 3,
organization 3, dataset 2, gateway 2, langy 2, model-provider 2, then singles.

### feature-shape (22)

Legacy shapes the reference shape rejects:

- 10 `unregistered-channels`: automation, instant-eval, langy (2), slack, stored-object, webhook, workflow (2),
  for example `modules/slack/process/src/channels`. Waits for the framework `.withChannels`/`defineChannels`
  lane (round 33, ST-1); already ruled.
- 7 `memory-twin-untested`: enterprise-gateway, governance, licensing, saas, instant-eval, log, metric (a
  `repositories/memory` folder with no test). Write the twin tests. Mechanical.
- 4 `contract-service`: `modules/analytics/contract/src/analytics.service.ts`, authz, scim, organization (an
  abstract `XService` in the contract beside the `*Api`). Delete, or fold into `*.api.ts`; callers repoint.
  Mechanical.
- 2 digest `no-app` and `no-installer`: `enterprise/modules/digest/process/src` has no module class. Design
  (build the module shape); also clears the digest feature-layout finding.

### migration-owners (21)

Historic migrations that touch more than one owner's tables: 10 ClickHouse (`00002_create_schema.sql` 7 owners,
`00015`, `00022`, `00032`, `00034`, `00049`, `00050`, `00056`, `00057`, `00088`) and 11 Prisma. The policy's own
record says these are "never edited, so a key leaves only when its file does". Zero is unreachable by a normal
lane without editing shipped migrations. Ruling BL-1.

### feature-layout (10) and private-runtime-export (2)

- 5 "strict contract package must declare its callable feature API": demo-data, nurturing, audit-log,
  hosted-mcp, navigation. Ruling FL-1.
- 2 "portable feature API binds `uiTokens` / `defineTrpcContract`":
  `enterprise/modules/billing/contract/src/billing.api.ts`, `modules/instant-eval/contract/src/instant-eval.api.ts`.
  Move the binding to a transport file. Mechanical.
- 2 "rules module cannot import eventing": `modules/analytics/process/src/rules/lwql-catalogue.rules.ts`,
  `modules/topic/process/src/rules/topic-clustering-events.rules.ts`. Move to a service or eventing file.
  Mechanical.
- 1 digest "needs a subject-named service class" (cleared by the digest lane).
- private-runtime-export (2): `modules/gateway/process/src/__tests__/testing.ts:8` and
  `modules/trace/process/src/__tests__/testing.ts:2` re-export a repository and a rule. Already ruled (round 4,
  Q208, ARCHITECTURE.md section 3): both `./testing` exports go and the two consumers
  (`enterprise/modules/governance/process/src/services/__tests__/genie-trace-mapper.unit.test.ts`,
  `.../__tests__/pulled-usage-ledger.integration.test.ts`) own their fixtures. Mechanical.

### framework-module-contracts (10)

`packages/browser-host/package.json` depends on nine feature contracts (annotation, automation, dataset,
enterprise-licensing, evaluator, experiment, feature-flag, prompt, workflow) for drawer prop types, declarations
and the upgrade-modal and feature-flag stores (`src/drawer/model/prompt-drawers.ts:1`, `src/declarations.ts:7`,
`src/feature-flag.ts:7`). The same drawer-map machinery is the `UiDrawerMap` family in deleted spellings, so it is
one piece of work (DS-3a). The tenth, `packages/prisma-client/src/organization-guard.ts:5`, imports
`@langwatch/api-key-contract`; move the guard to its owner. Baselined.

### The small ones

- clickhouse-table-ownership (3): `modules/trace/process/src/repositories/clickhouse/log-record-storage.repository.ts:76`
  writes `stored_log_records` (legacy-owned, "only a release still rolling out writes it");
  `trace-legacy-read.repository.ts:2097` reads `evaluation_runs` (cleared by the PC-3 trace peer-fold, or a
  central reader entry); `packages/clickhouse-migrations/migrations/00084_create_lwql_api_key_tenant_map.sql` has
  no owner (analytics owns it: central-list entry, CT-7). Rulings CH-1, CH-2.
- service-projection-write-boundary (3): `modules/data-retention/process/src/services/data-retention-snapshot.service.ts:38`,
  `data-retention.service.ts:54`, `modules/suite/process/src/services/suite-run-replay.service.ts:32`. Narrow each
  options type to an explicit read-only port. Mechanical.
- architecture-record (2): `tools/dev-runtime/adrs` and `adrs/README.md` missing. Write the boundary ADR and
  index (ADR-168 is Proposed). Mechanical.
- browser-package-exports (2): `modules/navigation/browser/package.json` `./chrome` and `./navigation`. Already
  ruled to go (round 4, Q208); nothing outside the module imports them. Mechanical.
- browser-node-leak (1): `packages/redaction/src/bitcoinAddress.ts:1` imports `node:crypto`; redaction is reached
  from browser packages (trace, data-privacy). Ruling BN-1.
- retired-package-runtime (1): `modules/navigation/contract/package.json` declares no `zod` range. Add the
  repository Zod 4 range. Mechanical.

## 4. Lane plan

Waves: modules are disjoint inside each wave (a script checked the module sets below); a wave is as wide as the
machine allows, nine at most. Calls are estimates for one lane; "Opus" lanes are the ones that decide structure.
Total: 46 lanes (SF 14, DS 9, PD 5, SC 5, FS 4, L 3, U 2, ET 2, FL 1, MO 1). DS-2a, SF-F2 and PD-1 are the three
most likely to overrun 90 calls and split, which would make 49.

| Lane   | Policy and scope                                                                                                                                                             | Calls | Model / effort | Wave | Needs                                 |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----: | -------------- | ---: | ------------------------------------- |
| L01    | architecture-record, retired-package-runtime, browser-package-exports, private-runtime-export, browser-node-leak, deleted-spellings path artefact (enforcer `cli.ts`/policy) |    50 | Sonnet medium  |    1 | BN-1 for the last item                |
| L02    | service-projection-write-boundary (data-retention, suite), prisma-client organization-guard move (api-key)                                                                   |    35 | Sonnet medium  |    1 | none; restores a red CI list          |
| L03    | clickhouse-table-ownership (trace, analytics owner entry)                                                                                                                    |    30 | Sonnet medium  |    3 | CH-1, CH-2, PC-3 trace lane           |
| MO-1   | migration-owners (policy or baseline change only)                                                                                                                            |    25 | Sonnet medium  |    2 | BL-1                                  |
| SC-1   | service-ceilings: auth (3), authz, identity (5 large files)                                                                                                                  |    85 | Opus medium    |    1 | none                                  |
| SC-2   | service-ceilings: organization (3), slack, stored-object, platform-health, nurturing                                                                                         |    70 | Sonnet medium  |    1 | none                                  |
| SC-3   | service-ceilings: ops (3), model-provider (2), log, analytics (3)                                                                                                            |    75 | Sonnet medium  |    1 | none                                  |
| SC-4   | service-ceilings: dataset (2), experiment, instant-eval, suite, workflow, trace, scenario                                                                                    |    80 | Sonnet medium  |    4 | none                                  |
| SC-5   | service-ceilings: gateway (2), langy (2)                                                                                                                                     |    45 | Sonnet medium  |    2 | none                                  |
| ET-1   | eventing-table-access: eventing admin surface in `packages/eventing`                                                                                                         |    85 | Opus high      |    1 | ET-1 ruling                           |
| ET-2   | eventing-table-access: repoint ops (36) and data-retention (1)                                                                                                               |    60 | Sonnet medium  |    2 | ET-1 lane, ET-2 ruling                |
| FS-1   | feature-shape: 7 memory-twin tests (enterprise-gateway, governance, licensing, saas, instant-eval, log, metric)                                                              |    70 | Sonnet medium  |    2 | none                                  |
| FS-2   | feature-shape: 4 contract-service files (analytics, authz, scim, organization)                                                                                               |    40 | Sonnet medium  |    4 | none                                  |
| FS-3   | feature-shape: 10 unregistered-channels (7 modules)                                                                                                                          |    85 | Sonnet medium  |    3 | framework `.withChannels` lane (ST-1) |
| FS-4   | feature-shape: digest app and installer; feature-layout digest finding                                                                                                       |    60 | Opus medium    |    1 | none                                  |
| FL-1   | feature-layout: 5 contract APIs, 2 moved bindings, 2 rules imports                                                                                                           |    60 | Sonnet medium  |    6 | FL-1 ruling                           |
| DS-1a  | backoffice rename: ops browser, apps/ui, packages/browser, billing/licensing browser, internal-slack                                                                         |    70 | Sonnet medium  |    3 | DS-A                                  |
| DS-1b  | backoffice rename: identity (contract and process), sso, scim, enterprise-ops                                                                                                |    75 | Sonnet medium  |    2 | DS-A                                  |
| DS-1c  | backoffice rename: ops process and contract, billing and licensing process                                                                                                   |    70 | Sonnet medium  |    4 | DS-1b (identity accessor)             |
| DS-2a  | members family: delete from packages/process, process-stores, module                                                                                                         |    90 | Opus high      |    1 | DS-C, ST-1 `.withChannels` lane       |
| DS-2b  | members family in modules: evaluation, github, auth, scenario, prompt, governance                                                                                            |    70 | Sonnet medium  |    3 | DS-2a                                 |
| DS-3a  | browser-host drawers and `UiDeclared*` out; 9 feature-contract dependencies removed (framework-module-contracts)                                                             |    90 | Opus high      |    2 | none (already ruled, section 15)      |
| DS-3b  | `declared("<name>")` callers: workflow, organization, evaluator, billing, automation, ops, oxlint-rules                                                                      |    45 | Sonnet medium  |    5 | DS-3a                                 |
| DS-4   | computeNextRunAt: time, governance, automation                                                                                                                               |    60 | Opus medium    |    4 | DS-B                                  |
| DS-5   | remaining small spellings (RestErrorHandler, absence classes, `refusing*`, `use-feature-flag`, others)                                                                       |    55 | Sonnet medium  |    9 | after most others                     |
| SF-T-A | tiny-file folds: identity, organization, auth, authz, user, api-key, project (~34)                                                                                           |    70 | Sonnet low     |    6 | SF-2                                  |
| SF-T-B | tiny-file folds: ops, gateway, trace, analytics (~28)                                                                                                                        |    65 | Sonnet low     |    7 | SF-2                                  |
| SF-T-C | tiny-file folds: licensing, scim, automation, demo-data, managed-provider, nurturing, saas, governance, billing (~30)                                                        |    70 | Sonnet low     |    7 | SF-2                                  |
| SF-T-D | tiny-file folds: 25 smaller modules (~30)                                                                                                                                    |    75 | Sonnet low     |    7 | SF-2                                  |
| SF-T-E | tiny-file folds: design-system, span-normalisation, upgrade, api, browser-host, browser, apps, handled-error, mail, time (~23)                                               |    60 | Sonnet low     |    1 | none                                  |
| SF-F1  | oversize folders: governance (4), billing, licensing                                                                                                                         |    90 | Opus medium    |    8 | SF-1                                  |
| SF-F2  | oversize folders: trace process (eventing, repositories x2, rules, services)                                                                                                 |    90 | Opus medium    |    2 | SF-1                                  |
| SF-F3  | oversize folders: trace contract and browser (3)                                                                                                                             |    75 | Opus medium    |    5 | SF-F2                                 |
| SF-F4  | oversize folders: identity (6)                                                                                                                                               |    85 | Opus medium    |    3 | SF-1                                  |
| SF-F5  | oversize folders: analytics (5), organization (3)                                                                                                                            |    85 | Opus medium    |    2 | SF-1                                  |
| SF-F6  | oversize folders: automation, coding-agent, evaluation, experiment, model-provider, gateway (7)                                                                              |    85 | Opus medium    |    6 | SF-1                                  |
| SF-F7  | oversize folders: langy (4), navigation (2), auth, prompt                                                                                                                    |    80 | Opus medium    |    4 | SF-1                                  |
| SF-F8  | oversize folders: ops (2), scenario (6)                                                                                                                                      |    85 | Opus medium    |    6 | SF-1                                  |
| SF-F9  | oversize folders: browser-host, browser, design-system, process, span-normalisation                                                                                          |    80 | Opus medium    |    4 | SF-1, design-system exemption         |
| U-1    | unused-module-export: trace 33, annotation, evaluation, workflow, agent, experiment (66)                                                                                     |    60 | Sonnet low     |    8 | last, after folder moves              |
| U-2    | unused-module-export: remaining 17 modules (45)                                                                                                                              |    55 | Sonnet low     |   10 | last, after folder moves              |
| PD-1   | declarations: recount after `tsc -b`, design the leak pattern on gateway and governance                                                                                      |    80 | Opus high      |    5 | coordinator `tsc -b`, PD-1 ruling     |
| PD-2   | declarations: apply the pattern, packages A-D (about 14)                                                                                                                     |    70 | Sonnet medium  |   11 | PD-1, U lanes                         |
| PD-3   | declarations: packages E-I                                                                                                                                                   |    70 | Sonnet medium  |   11 | PD-1                                  |
| PD-4   | declarations: packages J-O                                                                                                                                                   |    70 | Sonnet medium  |   11 | PD-1                                  |
| PD-5   | declarations: packages P-Z and enterprise                                                                                                                                    |    70 | Sonnet medium  |   11 | PD-1                                  |

Wave numbers assume the rulings in section 6 land first and the framework `.withChannels` lane (ST-1) is done
before DS-2a and FS-3. Wave 11 lanes touch disjoint packages. Note that the waves are a lower bound on elapsed time: ten sequential
waves precede the final recount. The long poles are DS-2a/DS-2b (members framework) and the SF-F series.

### Which policies join the CI list after one lane

- After L01 alone: `architecture-records`, `browser-package-exports`, `manifests` (retired-package-runtime), and
  `browser-node-leak` once BN-1 is ruled.
- After L02 alone: `service-projection-boundaries` is already on the list; L02 makes it green again.
- After MO-1 alone: `migration-owners`, once BL-1 is ruled.
- After L03 alone: `clickhouse-table-ownership`, once CH-1 and CH-2 are ruled and the PC-3 trace lane lands.
- Two lanes: `eventing-table-access` (ET-1, ET-2), `framework-module-contracts` (DS-3a and L02),
  `unused-module-export` (U-1, U-2).
- Three: `feature-layout` (L01, FL-1, FS-4; it carries `private-runtime-export`).
- More: `feature-shape` 4, `service-ceilings` 5, `deleted-spellings-in-code` 9 plus the L01 path fix,
  `source-folder-shape` 14, `declarations` 5.

## 5. Order of work

1. Unblock CI now: L02 (the CI list is red on this tree, section 7).
2. Put the rulings in section 6 in front of Alex before wave 1; DS-C, BL-1, ET-1, SF-1 and PD-1 gate the most lanes.
3. Coordinator runs `pnpm typecheck` through the gate once, then re-reads `--policies declarations --all`; do this
   before PD-1 and again before PD-2 to PD-5.
4. Run U-1 and U-2 after everything that moves files, since a move creates and removes unused exports.

## 6. Rulings needed

| Id   | Finding category                                                                                                                            | Question                                                                                              | Options                                                                                                                                                                                                                                                                                                                                                                       | Recommendation                                                      |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| BL-1 | migration-owners (21); also what "zero" means for baselined policies (deleted-spellings, eventing-table-access, framework-module-contracts) | The 21 historic migrations are never edited; how does the policy reach zero?                          | (a) the policy treats migrations numbered below a named cutoff as historic and exempt, a frozen list; (b) squash to per-owner baselines at the 3.20.1 LTS floor (post-merge); (c) edit shipped migrations (breaks goose checksums and the ledger). Also confirm "zero" means raw findings, not findings beyond the baseline                                                   | (a) now, (b) after merge; raw zero for the other baselined policies |
| ET-1 | eventing-table-access, ops (36)                                                                                                             | How does ops read and purge process-manager tables and the event log?                                 | (a) `packages/eventing` exposes an admin and inspection surface and ops calls it; (b) a named, linted exception for ops as instance admin; (c) move the process-manager explorer and event-explorer repositories into packages/eventing                                                                                                                                       | (a); (b) only if Alex prefers a smaller change                      |
| ET-2 | eventing-table-access, data-retention (1)                                                                                                   | `retention-tables.ts:4` keys a category map by `event_log`                                            | (a) the policy allows a table name as a map key in a contract constant; (b) eventing exports the event-table list and the map is built from it; (c) eventing purges by category                                                                                                                                                                                               | (b)                                                                 |
| PD-1 | declarations (375, ~57 root causes)                                                                                                         | How does a module hide `XRepositories` and Prisma types from its public `.d.ts`?                      | (a) the installer and module export are annotated with an opaque framework type so the class never appears; (b) the app constructor takes an opaque setup type and repository types stay in non-exported positions; (c) narrow the policy to ignore `import type` in positions the public type does not expose; (d) hand-written declaration facades                          | (a), confirmed on gateway and governance first                      |
| DS-A | deleted-spellings, ops "backoffice" (308)                                                                                                   | Retired `/ops/backoffice` URL redirects and their tests, a Slack link, and the replacement vocabulary | (a) keep redirects, exempt the three redirect files (route table and two redirect tests) by path in `dev/docs/deleted-spellings.json`; (b) delete the redirects and rename the URLs; (c) rename strings so the regex misses (rejected, gaming). Vocabulary: `Admin`, `InstanceAdmin` or `CloudAdmin` for identity's `ssoBackoffice()` accessor and the sso connection schemas | (a); `Admin` unless the surface differs between Cloud and instance  |
| DS-B | deleted-spellings, computeNextRunAt (15)                                                                                                    | `@langwatch/time` cron helper shares a name with the deleted eventing scheduler                       | (a) rename the helper (`nextCronFireAt`) and convert governance and automation schedules to keyed process managers; (b) narrow the deleted-spelling pattern to the eventing scheduler by path; (c) delete the helper and move cron maths into `.schedule()`                                                                                                                   | (a)                                                                 |
| DS-C | deleted-spellings, members family (~290; 166 in packages/process, process-stores, module)                                                   | Delete the framework definitions of the deleted surface now, before merge?                            | (a) delete them all, depending on the `.withChannels` lane and the no-members migration; (b) exempt files that only define the deleted spelling and keep them until the container fully lands (policy change, then zero is a lie); (c) split: delete what is unused today, keep the rest until its caller converts                                                            | (a), sequenced after ST-1; it is the long pole of the plan          |
| SF-1 | source-folder-shape, oversize folders (56)                                                                                                  | How are folders over 30 files split?                                                                  | (a) `features/<concern>/` for process and contract (grammar allows one level), and the same for browser `model/behavior/ui`; (b) raise the limit per layer (policy change); (c) fold files by noun. Sub-question: `packages/design-system/src/components` (146 files) and other framework packages: exempt or split by component family                                       | (a) for modules, a per-package exemption for the design system      |
| SF-2 | source-folder-shape, tiny contract files (57)                                                                                               | Do the grammar-named contract artifact files (`.errors.ts`, `.config.ts`) fold or stay?               | (a) fold each into the feature's canonical `<feature>.<artifact>.ts` or `*.api.ts`; (b) exempt grammar-named artifact files from the tiny-file rule                                                                                                                                                                                                                           | (a)                                                                 |
| FL-1 | feature-layout, contract with no callable API (5)                                                                                           | demo-data, nurturing, audit-log, hosted-mcp, navigation declare config, errors or tRPC only           | (a) declare an empty `*Api` interface and token (then `unused-module-export` may flag it); (b) a recorded `callable: false` marker the policy honours; (c) fold these contracts away                                                                                                                                                                                          | (b)                                                                 |
| CH-1 | clickhouse-table-ownership, trace writes `stored_log_records`                                                                               | Delete the legacy writer now or keep it for one more release?                                         | (a) delete the writer and its tests now, readers keep the fallback; (b) keep with a contract note and a policy-level allowed writer                                                                                                                                                                                                                                           | (a) if the previous release no longer reads the rows it wrote       |
| CH-2 | clickhouse-table-ownership, trace reads `evaluation_runs` (:2097)                                                                           | Clear it through the PC-3 peer-fold or a central reader entry?                                        | (a) wait for the PC-3 trace lane (already ruled round 30); (b) add a reader entry now with a sunset                                                                                                                                                                                                                                                                           | (a)                                                                 |
| BN-1 | browser-node-leak, redaction bitcoin checksum                                                                                               | SHA-256 for the checksum without `node:crypto`                                                        | (a) a small pure-JS SHA-256 in packages/redaction; (b) add `@noble/hashes`; (c) Node-only subpath and the browser skips the bitcoin check (behaviour change)                                                                                                                                                                                                                  | (a)                                                                 |

Items I treated as coordinator defaults, not rulings: deleting the four legacy contract `XService` classes
(FS-2), the digest module shape (FS-4), the `lwql_api_key_tenant_map` owner entry (analytics, per CT-7), and the
service-ceilings splits.

## 7. Sweep findings the plan depends on

- The CI list is red today. `service-projection-boundaries` is on the list and reads 3 findings (data-retention
  twice, suite once), so the "Architecture lint (blocking)" step would fail on this tree. L02 fixes it, or the
  step needs the policy removed until it does.
- The deleted-spellings baseline is out of step with the tree in two places: `ProcessMembers` is 60 found against
  59 in `tests/baselines/deleted-spellings.json` (a rise the ratchet should refuse), and `declared("<name>")` is
  17 found against 19 (the baseline can be lowered by two). Lower and investigate in DS-2b and DS-3b respectively.
- `cycles` is on the CI list and reads zero, so it needs no lane.
- Counts move by a few between runs because other lanes are editing (unused-module-export 110, 111, 115;
  feature-layout 10 and 12 with `private-runtime-export`). Re-run before each wave and trust the wave's own
  `--policies <id> --all`, not these totals.
