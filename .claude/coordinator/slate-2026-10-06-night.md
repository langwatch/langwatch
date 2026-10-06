# Slate, 2026-10-06 night

Verified against the code at HEAD `53706b1dba` (clean tree apart from one untracked bind-lane test in `modules/langy/browser`). Each lane has a manifest in `.claude/manifests/<slug>.md`, with its handoff at `.claude/handoffs/<slug>.md`. Every manifest carries the same rules: spec first, no new FK or `@relation`, additive migrations only, never read `.env`, no git writes, never `git stash`, and no questions to Alex (they go in `held-questions.md` as "default taken, held for Alex").

Other lanes running now, so excluded from every slate lane's paths: the three parity bind lanes, which edit feature files under `specs/**` and add colocated tests, and the PR body and ledger refresh lane. In this slate:

- **Existing feature files.** No slate lane owns an existing feature file under `specs/**` or `modules/*/specs/**`. Untags, rewordings and deletions go into handoff §10 as exact lines for the coordinator to apply. A lane may only create a new feature file.
- **Lockfile.** Only process-doors-ready-metrics may touch `pnpm-lock.yaml`, to add `prom-client` to `@langwatch/observability`.
- **Catalogue.** Only rest-owner-map owns `modules/catalogue.json`.

## Slate

| # | slug | objective | model | owned paths (summary; the manifest is exact) | why it is unblocked |
| --- | --- | --- | --- | --- | --- |
| 1 | `t1-d2-span-facts` | Cut `trace -> coding-agent`: the decoder moves to `@langwatch/trace-contract/otlp-decoding`, coding-agent peer-subscribes with `enqueue.filter`, and trace's dispatch subscriber and the `codingAgents` dependency go. Second slice: both tracked-event URLs refuse by name (503) with no recorder (Trace 9). | lane-opus | trace contract `otlp-decoding/**` + `package.json` exports; trace process decoder services, `eventing/`, `trace.app.ts`, `trace.module.ts`; coding-agent contract + process `eventing/`, `app/`; `apps/worker/.../worker-installation.integration.test.ts`; new `modules/coding-agent/specs/coding-agent-span-facts.feature` | D2 is ruled (night, second round). The T1-D2-deps default (a) is taken, and both dependencies landed in 9235671669. D1 and D3 landed. Trace 9 is ruled (`rulings-2026-10-05.md:88`), and `trace.app.ts:3355-3359` still swallows the refusal. B2's six rows wait on this lane. |
| 2 | `ent-merge-mr-m6` | Entitlement merge M-R (rename `lw.usage.*` to `lw.entitlement.*` over the upcaster), M2 (trace-meter seed via `.withMigrations`), M3 (count from its own meter; `countBillableEventsByProjects` goes), M4 (one counter; `entitlement -> trace` goes) and M6 (delete `createDeploymentPlanSources`). | lane-opus | `modules/entitlement/{contract,process}/src/**`; the billing billable-events chain, deployment-plan-sources, `billing.app.ts`/`module.ts`/`index.ts`, the `billing.api.ts` operation, three billing subscriber files; `packages/eventing/.../replay-event-source.clickhouse.ts` (defect fix only); two new entitlement feature files | Q1, Q3, Q4, Q10 and Q14 are ruled. The upcaster landed in 80e0a19a58 and `.withMigrations` in 40c22169e3. Verified open: no slice has landed, since `lw.usage.*`, `countBillableEventsByProjects` and `createDeploymentPlanSources` are all still in the tree. |
| 3 | `rest-owner-map` | REST namespace owner map in the catalogue, a policy and a RestHost refusal for an undeclared literal overlap, and the four overlaps declared (analytics permanent). | lane-opus | `modules/catalogue.json`; enforcer `feature-catalogue.ts` + new `rest-namespace-owners` policy; `packages/api/src/rest/{host,declaration,runtime}.ts`; `tools/devscripts/generatemodules.go` if needed; dashboard analytics rest, `evaluations-legacy.rest.ts`, `webhook-spend-replay.rest.ts`; new `specs/api/rest-namespace-owners.feature` | Ruled (night, second round), option (c) from `api-shared-path.md` §11. `.withSharedPath` landed in dc73c52144. The catalogue has no map yet, and none of the four overlaps declares one. |
| 4 | `process-doors-ready-metrics` | Q154(2): `/readyz` answers 503 until the modules have booted and the stores answer, and `/healthz` answers 200. W-03: Node default collectors restored, the registry left intact on a second install, and boot names a missing scrape token. | lane-opus | `packages/process/src` liveness/server/boot files (not `transport/`); `packages/process-stores/src/**`; `packages/observability/src/node/*metrics*` + `package.json`; `pnpm-lock.yaml` (sole owner); chart `app/deployment.yaml` readinessProbe; new `specs/server/process-readiness.feature` | Q154(2) is ruled (`rulings-2026-10-05.md:346`) and the metrics restore is ruled (afternoon, W-03). Verified: there is no readiness path anywhere in `packages/process`, the chart probes `/api/health`, and nothing calls `collectDefaultMetrics`. This lane binds `api-process-executable.feature:102` (after the §10 reword) and `api-process-metrics.feature:65`. |
| 5 | `browser-supply-1-3` | BS-1: an undeclared drawer name is refused by name, and a stale link does not crash. BS-2/3: a strict public config envelope and `withConfig(schema, project)`. | lane-opus | `packages/browser-host/src/drawer/**`; `packages/browser/src/**`; `packages/config/src/public-app-config*.ts`; `packages/process/src/transport/bundle-config.ts`; `apps/ui/src/{main.tsx,ui-feature-config.ts}`; new `specs/ui/browser-config-supply.feature` if needed | Ruled (night, second round). The open design questions in `browser-read-cache.md` §12 (items 2 to 4) are answered by that ruling. Verified: the envelope is still `z.record`, and an undeclared drawer still renders nothing. |
| 6 | `harness-live-oidc` | Move the duplicated live-upgrade helper into `@langwatch/test-harness`. Add an in-process OIDC provider and an end-to-end SSO callback test binding `identity-storage-adapter.feature:660` (ID-2). | lane-opus | `packages/test-harness/src/{live-upgrade,oidc-provider}/**` + `package.json` exports; the apps' `live-upgrade.*`, `api-live.fixture.ts`, `worker-live.fixture.ts`, `api-executable` import line; one new SSO integration test file | The AD-2 default is taken and landed in 3f5394a2b5; the move was proposed in `live-fixture-upgrade.md` §11. The OIDC harness is ruled (night, second round). Verified: two identical copies sit in `apps/api` and `apps/worker`. No new dependency is needed (`node:crypto`, and the tasks directory is passed in). |
| 7 | `oversized-operator-surface` | W-06 slice 4: one prefix lifecycle table in the chart docs, `.env.example` and the self-hosting docs, and one `objectRetentionConfirmed` flag that still honours `AZURE_BLOB_SPOOL_RETENTION_CONFIRMED`. | lane-sonnet | `modules/stored-object/{contract,process}` config leaf and its readers; chart `_helpers.tpl` Azure block, `values.yaml` docs; `.env.example` object-storage block; `docs/self-hosting` env rows + lifecycle section; new `modules/stored-object/specs/object-retention-confirmation.feature` | D1 to D8 are ruled and the ADR-172 points are ruled. Slices 1, 2, 3 and 5 landed. Verified: the flag is still Azure-spool-only (`stored-object.config.ts:14`), and no lifecycle table exists. |
| 8 | `ops-upgrade-image-steps` | Ops checkup follow-up: the image's steps are exported once from `@langwatch/upgrade`, so ops' ledger reader stops passing `steps: []`. Oversized slice 6: the `MONITORED_TABLES` comment. | lane-sonnet-medium | `packages/upgrade/src/**` (one export) + `package.json` exports; `apps/tasks/src/upgrade.ts`; ops `prisma.`/`memory.upgrade-ledger.repository.ts`; ops `storage-stats-collection.service.ts` comment | The Q-U8 default is taken. Verified: `prisma.upgrade-ledger.repository.ts:37` passes `steps: []`, `imageSteps` is private to `apps/tasks/src/upgrade.ts:86`, and ops already depends on `@langwatch/upgrade`. |

**Disjointness, checked by eye.**

- **`packages/process`.** Lane 5 owns only `src/transport/bundle-config.ts`. Lane 4 owns the named liveness, server and boot files and excludes `transport/`.
- **Trace.** Only lane 1 is in trace. Lane 7 sends the trace spool message change through §10.
- **Evaluation.** Only lane 3 is in evaluation (one transport file). The evaluation half of the oversized work is held back for this reason (see below).
- **Billing.** Only lane 2 is in billing.
- **Charts.** Lane 4 owns `templates/app/deployment.yaml`. Lane 7 owns `_helpers.tpl` and `values.yaml`.
- **`apps/*/src/__tests__`.** Lane 1 owns only the worker-installation test and lane 6 only the live-fixture files.
- **Shared files.** No two lanes share a module, a package file, `pnpm-lock.yaml` or `modules/catalogue.json`.

**Ceiling.** COORDINATOR.md §2 says six active lanes; the backlog says 12; tonight four are already running. If you keep to six, spawn lanes 1 and 2. In priority order for the merge gates: 1, 2, 3, 4, 5, 6, 7, 8.

**Tell the bind lanes.** These scenarios now belong to slate lanes and the bind lanes should skip them:

- `identity-storage-adapter.feature:660` (lane 6)
- `tracked-event-validation.feature:76-80` (lane 1)
- `api-process-executable.feature:92-106` and `api-process-metrics.feature:65` (lane 4)
- `declared-browser-supply.feature` @unimplemented rows (lane 5)

## Excluded, and why

| item | reason |
| --- | --- |
| Entitlement M5 (usage-warning threshold fact) | Ruled (Q8 a), but it needs entitlement's eventing and billing's subscriber, and lane 2 holds both modules tonight. It opens when `ent-merge-mr-m6` lands. |
| Entitlement M7 (the 12 commercial cuts, apart from `entitlement -> trace`, which is in M4) | Q9 rules that all 12 happen, but no pattern is ruled per edge. Plan §6 Q9 asked "by which pattern" and recommends only the batching, with licensing's three "decided separately". After R4 was superseded, nothing rules where dataset limits live. There is no default, so this needs Alex. |
| Entitlement M8 | Applies only under Q7 (b), and Q7 was ruled (a). |
| Browser supply 4 (ADR-148 §4 flags) | Ruled, but it is in the same packages as lane 5 and reaches about 28 module browser files. It is next after `browser-supply-1-3`. |
| Upcaster rewrite step | UP-4 is held with no default, and UP-3 likewise. Skipped as instructed. |
| Oversized: evaluation-inputs Azure refusal and slice 7 (D5-a copy step) | Ruled, but `modules/evaluation` has lane 3's transport file tonight (one lane per module). It is next, after `rest-owner-map` and lane 7's flag. |
| Oversized slice 8 (D8-b prefix delete, project-deleted fact) | Ruled, but `oversized-slice-1.md` §12 asks for a design lane first (a contract change). It also crosses `packages/process-stores` (lane 4) and project. |
| CRON_API_KEY leftovers | Already done in cd038dd988 and ff65b6a83f: the chart, docs, `llms-full.txt`, the `api-surface.ts` bearers line and the `RestHost` `bearers?` change are all gone from the tree. All that remains is the historical audit at `dev/docs/security/hono-api-rbac-audit.md:44` and a spec comment, which should stay. |
| Stale-spec rewording (`parity-rulings-reword.md` §9) | Every edit is to a feature file under `specs/**` or `modules/*/specs/**`, and the bind lanes are editing those now. It goes after them. |
| ID-1 storage-adapter reword (`identity-storage-adapter.feature:584`) | This is a one-line feature-file edit in the bind lanes' area. Its text is in `bind3-identity.md` §11, ready for the coordinator to apply. |
| CI-DEADCODES (ledger) | Re-run locally: `packages/handled-error` `codes.unit.test.ts` passes 8 of 8 on HEAD. No lane is needed; refresh the ledger row. |
| `system-migrations-runner.feature:151` split | This is not ruled. It is a bind-lane proposal (`bind-rest-night.md:31`). The split itself is a feature-file edit in the bind lanes' area. Its unproven halves (dispatch scope, worker-scoped subscribers, schedulers not started) are main-had-it regressions, which Alex rules row by row. The sibling row :308 is already bound (`preflight-non-convergence.unit.test.ts`). |
| Session-ceiling revoke (`ingest-api-key-lifecycle.feature:233`, modules/auth) | This is an open question, "which is wanted?" (`bind-rest-night.md:27`), with no ruling and no default. Add it to `held-questions.md`. |
| Scope knot SK, W-08 | These are in `packages/browser-host`, which lane 5 holds tonight. |
| S5 to S10, U4 to U9, OPS-UPG-WIRE | S5 waits on `packages/system-migrations` being released. The rest have no manifest, or are stopped on U2-API, U2-LIVE, U2-PHASES, Q-U6, Q-U7 or Q-U9. |
| Next in line (ruled, not candidates tonight) | W-01 (FK guard; in the enforcer after lane 3), W-02, W-05, W-09, W-12, W-13. |

## Slate table

| slug | model | owned paths | unblocked by |
| --- | --- | --- | --- |
| t1-d2-span-facts | lane-opus | trace decoder + eventing + app; coding-agent eventing; worker-installation test | D2 ruled; deps landed 9235671669; Trace 9 ruled |
| ent-merge-mr-m6 | lane-opus | modules/entitlement; billing billable-events, deployment-plan-sources, app/api lines; eventing replay source | Q1, Q3, Q4, Q10, Q14 ruled; upcaster 80e0a19a58; withMigrations 40c22169e3 |
| rest-owner-map | lane-opus | catalogue.json; enforcer catalogue + policy; packages/api rest host; four overlap route files | ruled night second round; withSharedPath dc73c52144 |
| process-doors-ready-metrics | lane-opus | packages/process boot/liveness; process-stores; observability metrics; pnpm-lock.yaml; chart readinessProbe | Q154(2) ruled; W-03 ruled |
| browser-supply-1-3 | lane-opus | browser-host drawer; packages/browser; config public-app-config; bundle-config.ts; apps/ui main | BS-1, BS-2/3 ruled |
| harness-live-oidc | lane-opus | packages/test-harness live-upgrade + oidc-provider; app live fixtures; one new SSO test | AD-2 landed; OIDC harness ruled |
| oversized-operator-surface | lane-sonnet | stored-object config leaf; chart helpers/values docs; .env.example; self-hosting docs | D1 to D8 and ADR-172 points ruled; slices 1-3, 5 landed |
| ops-upgrade-image-steps | lane-sonnet-medium | packages/upgrade export; apps/tasks upgrade.ts; ops upgrade-ledger repositories; ops comment | Q-U8 default taken |
