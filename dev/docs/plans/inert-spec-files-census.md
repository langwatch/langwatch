# Inert spec files census

**Date:** 2026-09-03
**Branch:** `feat/strict-feature-layout-v0`
**Source of truth:** `pnpm -s check:feature-parity` from `packages/architecture-lint`, run once at
the head of this branch. Full output saved outside the repo; the JSON form of the same run is
what every count below is derived from.

## What the gate says

```
Enforced: 1373 file(s) · Legacy: 15 file(s) · Inert: 413 file(s)
FAIL: 4629 unbound scenario(s) in enforced files,
      352 unknown annotation(s),
      50 file(s) enforce no scenario at all
```

Three failure classes, and they are independent:

| Class | Count | What it means |
| --- | --- | --- |
| Inert, unexcused | **50 files / 389 scenarios** | Nothing in the file is tagged `@unit`/`@integration`/`@e2e`/`@regression`, and the file is not on `LEGACY_INERT` (363 entries). The file reports `0/0 · ✓ all bound` and enforces nothing. |
| Unbound scenarios | **4,629 of 10,842** in 559 enforced files | Tagged, but no test carries a matching `@scenario` annotation. |
| Unknown annotations | **352** across 67 test files | A test names a scenario title that no `.feature` file in the corpus carries. The binding is inert in the other direction. |

Overall binding rate today: 6,213 of 10,842 enforced scenarios bound (57%).

---

## Summary table

### The 50 inert files by classification

| Class | Files | Scenarios | Meaning |
| --- | --- | --- | --- |
| **BIND** | 45 | 363 | A test already exercises the behaviour and carries no `@scenario` annotation. Work = annotate the test + tag the scenario. |
| **WRITE** | 4 | 24 | Behaviour is live in the tree; nothing tests it. |
| **DECISION** | 1 | 2 | Unclear the behaviour should exist at all (`@langwatch/enterprise-web` has no dependents). |
| **RETIRE** | 0 | 0 | — |
| **@unimplemented, tag audit** | 4 (of the 45 above) | 93 nominal / 46 bindable | Inert by tag, not by omission: the checker skips `@unimplemented`. Part of what they describe now ships. |

File class is the dominant class in that file. At **scenario** granularity across all 50 files:
**257 BIND, 69 WRITE, 17 DECISION, 1 RETIRE** (`langy.feature` S2), plus **45 `@unimplemented`
scenarios that stay genuinely future work**. 257 + 69 + 17 + 1 + 45 = 389.

**Nothing in this census retires because of the platform deletion.** Every distinctive noun in
all 389 scenarios resolves to live code under `apps/` or `packages/features/`. The single RETIRE
is `packages/features/langy/specs/langy.feature` scenario 2, whose `abstract relay(frame)` and
`langy.repository.ts` were deleted together in `c4ded22900` — unrelated to `platform/app`.

### Where the 50 came from

| Origin | Files | Scenarios | Note |
| --- | --- | --- | --- |
| Feature-package extraction wave, 24–29 Aug | 41 | 314 | Boundary prose written alongside the move, never tagged. Every one of these packages' *sibling* specs is fully tagged and bound — the untagged file is always the broad `*-service.feature`. |
| `faaa9ec333` "Delete platform/app", 3 Sep | 9 | 75 | `R100` renames out of `platform/app/specs/**` — a second specs root the parity checker never scanned. These were inert there too; the move made them visible for the first time. |

### The 352 unknown annotations by cause

| Cause | Count | Files |
| --- | --- | --- |
| Spec rewritten during a feature-package move; tests kept the old titles | **303** | 47 |
| Annotation names a title no `.feature` ever carried | **49** | 20 |

Zero unknown annotations are caused by the `platform/app` deletion.

---

## Per-file rows

Effort is time-to-green for the whole file. "Recovers" is the scenario count that becomes
enforced and bound.

### Enterprise (9 files, 42 scenarios)

| File | Area | Scen | Behaviour exists | Untagged test already covering it | Class | Effort |
| --- | --- | --- | --- | --- | --- | --- |
| `packages/enterprise/composition/api/specs/api-composition.feature` | Enterprise API composition root | 2 | `composition/api/src/index.ts:65` `EnterpriseApiComposition` | `tests/api-composition.unit.test.ts` `it("retains an explicitly supplied licensing capability")` | BIND (1) + WRITE (1) | 15m |
| `packages/enterprise/composition/web/specs/web-composition.feature` | Enterprise web shell | 2 | `composition/web/src/index.ts:9` — but **no package depends on `@langwatch/enterprise-web`** | `tests/web-composition.unit.test.ts` `it("retains portable initial license status")` | **DECISION** | 10m |
| `packages/enterprise/composition/worker/specs/worker-composition.feature` | Worker composition + managed providers | 3 | wired at `apps/worker/src/app/worker-production.composition.ts:1468` | `tests/worker-composition.unit.test.ts` `it("creates a worker-only composition over the portable catalogue")` | BIND (2) + WRITE (1) | 15m |
| `packages/enterprise/features/billing/specs/billing.feature` | Plan resolution + metered usage | 3 | `billing/server/src/` plan provider + usage reporting | `server/src/__tests__/planProvider.unit.test.ts` `it("returns plan limits with custom overrides")` | BIND (2) + WRITE (1) | 25m |
| `packages/enterprise/features/governance/specs/governance.feature` | Governance boundary + control plane | 19 | 35 narrow ports under `governance/server/src/ports/` | `server/src/services/__tests__/spend-spike-anomaly-evaluator.service.unit.test.ts:168` `it("passes a source scope as structured data rather than SQL")`; `ports/__tests__/ocsf-export.service.unit.test.ts:62` | BIND (13) + WRITE (2) + DECISION (4) | 105m |
| `packages/enterprise/features/licensing/specs/licensing.feature` | License activation, signature, lapse | 6 | `licensing/server/src/` | `server/src/__tests__/license.service.unit.test.ts` `it("stores a valid signed license before provisioning missing retention")` (+4 more, near 1:1) | BIND (5) + WRITE (1) | 20m |
| `packages/enterprise/features/managed-provider/specs/managed-providers.feature` | Managed Bedrock credentials | 3 | `server/src/adapters/aws-sts.aws-sts.adapter.ts:29,52` two-role chain | `server/src/__tests__/managed-provider.service.unit.test.ts` `it("replaces an API key with chained Bedrock credentials")` | BIND (2) + WRITE (1) | 25m |
| `packages/enterprise/features/saas/specs/saas.feature` | SaaS third-party scripts | 2 | `web/src/extra-footer-components.tsx:33` `if (!props.isSaas) return null;` | `web/src/__tests__/extra-footer-components.integration.test.tsx` `it("tracks delayed gtag and Reo globals")` | BIND (1) + WRITE (1) | 10m |
| `packages/enterprise/specs/enterprise-catalogue.feature` | Feature catalogue discovery | 2 | `packages/enterprise/src/index.ts` | `tests/enterprise-catalogue.unit.test.ts` `it("discovers every installed Enterprise feature through portable package names")` | BIND (1) + WRITE (1) | 10m |

**Defect found:** `governance.feature` scenario 2 is factually wrong. It says architecture-lint
rejects a governance subject "until `feature.json` declares the subject", but
`packages/enterprise/features/governance/feature.json` is `{"layoutVersion": 0}` and
`packages/architecture-lint/src/workspace.ts:85` rejects any other key. Subjects live in
`packages/features/catalogue.json`. Binding it as written enforces the opposite of the lint.

### Feature packages A–D (7 files, 52 scenarios)

| File | Area | Scen | Behaviour exists | Untagged test already covering it | Class | Effort |
| --- | --- | --- | --- | --- | --- | --- |
| `packages/features/analytics/specs/analytics-timeseries.feature` | Timeseries read routing | 8 | `analytics/server/src/routing/route-table.ts:67,81`; `adapters/analytics.adapter.ts:29-38` | `server/src/repositories/__tests__/analytics.service.unit.test.ts` `it("routes safe additive trace reads to the trace rollup and keeps the tenant")` (+5) | BIND (6) + WRITE (2) | 55m |
| `packages/features/annotation/specs/annotation-service.feature` | Annotation service + web boundary | 10 | `contract/src/annotation.errors.ts:3`; `server/src/repositories/prisma/prisma.annotation.repository.ts:345` | `server/src/ports/__tests__/annotation.service.unit.test.ts` `it("throws at the service boundary when an annotation is absent")` | BIND (9) + WRITE (1) | 50m |
| `packages/features/auth/specs/browser-session.feature` | Better Auth session lifecycle | 3 | `auth/server/src/services/auth.service.ts:114,123` | `server/src/ports/__tests__/auth.service.unit.test.ts` `it("fails closed when Better Auth returns a cached session with no row")` — exact 1:1 for all three | BIND (3) | 10m |
| `packages/features/automation/specs/automation.feature` | Automation ownership boundary | 12 | `server/src/services/automation.service.ts:143`; `runaway-containment.service.ts` | `server/src/services/__tests__/runaway-containment.service.unit.test.ts` `it("pauses a condition-less automation and sends a paused notification")` | BIND (11) + WRITE (1) | 60m |
| `packages/features/coding-agent/specs/coding-agent-session-read.feature` | Session read service | 7 | `server/src/services/coding-agent-session-read.ts` | `server/src/services/__tests__/coding-agent-session-read.unit.test.ts` `it("clamps event pages at the package contract ceiling, including legacy limits")` — 7/7 | BIND (7) | 30m |
| `packages/features/data-privacy/specs/data-privacy-service.feature` | Policy resolution | 3 | `server/src/services/data-privacy.service.ts:13,165` (`safe-regex2`) | `server/src/ports/__tests__/data-privacy.service.unit.test.ts` `it("rejects unsafe custom secret patterns before persistence")` | BIND (1) + DECISION (2 — duplicate `data-privacy-resolution-seam.feature`) | 15m |
| `packages/features/data-retention/specs/data-retention-service.feature` | Retention cascade + pins | 9 | `server/src/services/data-retention.service.ts:41-65`; default at `apps/api/src/app/api-production.composition.ts:114` | `server/src/repositories/__tests__/data-retention.service.test.ts` `it("resolves policy through the project/team/organization cascade")` | BIND (7) + WRITE (2) | 60m |

### Feature packages E–M (10 files, 56 scenarios)

| File | Area | Scen | Behaviour exists | Untagged test already covering it | Class | Effort |
| --- | --- | --- | --- | --- | --- | --- |
| `packages/features/evaluation/specs/evaluation-service.feature` | Evaluation capability boundary | 6 | `server/src/services/evaluation.service.ts`; retry at `repositories/clickhouse/evaluation-run-read.repository.ts:281` | `server/src/ports/__tests__/evaluation.service.unit.test.ts:247` `it("validates workflow scope before dispatch")` | BIND (5) + DECISION (1) | 30m |
| `packages/features/evaluator/specs/evaluator-service.feature` | Evaluator capability + vocabulary | 5 | `server/src/services/evaluator.service.ts`; composed at `apps/api/src/app/api-trpc-collaborators.execution.composition.ts:378` | `server/src/ports/__tests__/evaluator.service.test.ts:179` `it("keeps nullable lookup and throwing lookup distinct")` | BIND (4) + WRITE (1) | 40m |
| `packages/features/experiment/specs/experiment-service.feature` | Experiment boundary + web split | 6 | `server/src/services/experiment.service.ts:117,183,287` | `server/src/repositories/__tests__/experiment.service.unit.test.ts:606` `it("deduplicates slugs inside a project")` | BIND (4) + WRITE (1) + reword (1) | 68m |
| `packages/features/gateway/specs/gateway-budget-service.feature` | Budget decision + config bundle | 5 | `contract/src/gateway.budget.ts:52-58`; `services/gateway.service.ts:312-331` | `contract/src/__tests__/gateway.contract.unit.test.ts` `it("locks the compatibility response fields")` — only 2/5 | **WRITE** (3) + BIND (2) | 75m |
| `packages/features/gateway/specs/gateway-realtime-session-reconciliation.feature` | ElevenLabs reconciliation | 3 | `server/src/services/gateway-realtime-session-reconciliation.service.ts:113,181,196` | `server/src/adapters/__tests__/realtime-session-reconciliation.worker.unit.test.ts` — exact 3/3 | BIND (3) | **10m** |
| `packages/features/github/specs/github-service.feature` | GitHub App boundary | 5 | `server/src/adapters/postgres.github.adapter.ts`; memoized at `apps/api/src/app/api-production.composition.ts:3137` | `server/src/adapters/__tests__/github-app-token.unit.test.ts:90` `it("signs an RS256 JWT issued by the app id, backdated, ≤10 minutes")` | BIND (4) + WRITE (1) | 40m |
| `packages/features/langy/specs/langy.feature` | Langy composition + portable surface | 10 | 9/10 live; **S2 dead** — `abstract relay(frame)` + `langy.repository.ts` deleted in `c4ded22900` | `server/src/ports/__tests__/langy-feedback-prompt.policy.unit.test.ts` `it("fails closed on reads and keeps writes best-effort")` | BIND (6) + WRITE (3) + **RETIRE (1)** | 100m |
| `packages/features/log/specs/log-processing.feature` | Canonical OTLP log processing | 6 | `contract/src/log.constants.ts:1,10`; 64-hex mint at `server/src/adapters/canonical-log.adapter.ts:594` | `server/src/adapters/__tests__/canonical-log.integration.test.ts:235` `it("isolates malformed and oversized siblings as partial success")` | BIND (4) + WRITE (2) | 55m |
| `packages/features/metric/specs/metric-processing.feature` | Canonical OTLP metric processing | 6 | `contract/src/schemas/metric-processing/constants.ts:1,2,10`; four tables at `clickhouse.metric-data-point-append.repository.ts:140,146,199,264` | `server/src/adapters/__tests__/record-metric-data-point.command.unit.test.ts:12` `it("uses PointId for the aggregate and a tenant-prefixed idempotency key")` — 6/6 | BIND (6) | **20m** |
| `packages/features/model-provider/specs/model-provider.feature` | Credentials, defaults, scope | 4 | `server/src/services/model-provider-project-scope.service.ts` | `server/src/ports/__tests__/model-provider.service.test.ts:1112` `it("masks credentials in frontend summaries")` — 4/4, zero `@scenario` in 2,211 lines | BIND (4) | **23m** |

**Live edit warning:** `evaluation-service.feature` has an *uncommitted* 7th scenario in the
working tree, `@unit`-tagged and already bound. That flips the file from fatal-inert to "enforces
1 of 7" — the reads-green-binds-nothing shape `LEGACY_INERT` cannot catch, because it only sees
fully-untagged files. Someone else in the fleet is writing there.

**Two claim conflicts to avoid:** `gateway-budget.service.unit.test.ts:146` is already claimed by
`specs/ai-gateway/budgets.feature:87`, and `log-command-coalescing.unit.test.ts:134` by
`packages/eventing/specs/producer-append-coalescing.feature`.

### Feature packages N–W (11 files, 71 scenarios)

| File | Area | Scen | Behaviour exists | Untagged test already covering it | Class | Effort |
| --- | --- | --- | --- | --- | --- | --- |
| `packages/features/monitor/specs/monitor-service.feature` | Monitor CRUD boundary | 7 | `server/src/services/monitor.service.ts:84,109,134` | `server/src/repositories/__tests__/monitor.service.unit.test.ts:175` `it("requires an evaluator on create")` (+4) | BIND (7) | **20m** |
| `packages/features/notification/specs/notification-service.feature` | Durable notification records | 2 | `repositories/prisma/prisma.notification.repository.ts:35` `orderBy: { sentAt: "desc" }` | `server/src/repositories/__tests__/notification.service.unit.test.ts:40` `it("creates and queries durable records through one repository")` — single record, so "newest first" is *not* asserted | BIND (2, one needs a stronger assertion) | **10m** |
| `packages/features/presence/specs/presence.feature` | Collaborative presence fanout | 5 | `presence/server/src/ports/presence.service.ts` | `server/src/ports/__tests__/presence.service.unit.test.ts:67` `it("persists and broadcasts the first session heartbeat")` — 5/5 | BIND (5) | **15m** |
| `packages/features/scenario/specs/scenario-execution.feature` | Isolated child-process execution | 5 | `server/src/services/scenario-processor.service.ts:230`; `adapters/scenario-child-execution.adapter.ts:197-213` | `child-environment-isolation.unit.test.ts:61` `it("does not inherit parent telemetry, trace context or Node preloads")` | BIND (4) + WRITE (1) | 40m |
| `packages/features/scenario/specs/scenario-service.feature` | Scenario CRUD boundary | 5 | `contract/src/scenario.errors.ts:3`, `scenario.parameters.ts:53` | `server/src/repositories/__tests__/scenario.service.unit.test.ts:317` `it("keeps reads project-scoped and only makes optional reads nullable")` | BIND (3) + DECISION (2 — duplicate `specs/scenarios/*`) | 20m |
| `packages/features/suite/specs/suite-service.feature` | Suite definitions + durable runs | 6 | live at `apps/api/src/app/api-trpc-collaborators.agent-group.composition.ts:502` | `server/src/repositories/__tests__/suite.service.unit.test.ts:129` `it("creates a slugged suite through its own repository")` — 6/6 | BIND (6) | **20m** |
| `packages/features/topic/specs/topic-read-surface.feature` | Topic projected read surface | 4 | `server/src/services/topic.service.ts:34,38,42,81` | `repositories/prisma/__tests__/prisma.topic.repository.unit.test.ts:45` `it("preserves the database order of topics and the legacy read selection")` — 4/4 | BIND (4) | **15m** |
| `packages/features/trace/specs/trace-query-language.feature` | Portable trace filter language | 3 | `contract/src/trace-query-{parser,mutations,analysis}.ts` | `contract/src/__tests__/trace-query-language.unit.test.ts` (142 its), exact 1:1 for all three | BIND (3) | 25m |
| `packages/features/trace/specs/trace-read-service.feature` | Paged span-tree read + legacy compat | 10 | 7/10; S6's Then is stale — routes moved to `trace/server/src/transport/api-trpc/traces-v2.api.ts:1126` in `a98cfaf487` | `server/src/__tests__/trace.adapter.unit.test.ts` `it("retries an empty first hinted page without the occurrence bound")` | BIND (6) + WRITE (2) + DECISION (2) | 120m |
| `packages/features/user/specs/user.feature` | Canonical user lifecycle | 3 | composite at `server/src/transport/api-trpc/user.api.ts:806-808` | Only 1 covered. `grep revokeCliTokensForUser` in tests returns **zero** — the tRPC composite is untested | **WRITE** (2) + BIND (1) | 35m |
| `packages/features/workflow/specs/workflow-service.feature` | Workflow service + Studio boundary | 21 | all 21; "application composition" now means `apps/ui` + `apps/api`, not the deleted platform | `web/src/behavior/__tests__/workflow-picker-flows.unit.test.tsx` `it("updates and selects a dropped node, while the app port owns drawer effects")` | BIND (15) + WRITE (6) | 140m |

**Stale premise:** `workflow-service.feature` S15 asserts an `edgeTypes` registry; `edgeTypes` is
built inline. Reword before tagging.

### Root `specs/` — nine platform refugees (75 scenarios)

All nine arrived as `R100` renames from `platform/app/specs/**` in `faaa9ec333`. None of them was
ever tagged, even in the old location — `platform/app/specs` was never a scanned specs root, so
they were invisible rather than green. Their production code had already moved into
`packages/features/*` before the deletion; `379b452def` then deleted 1,114 test files.

| File | Area | Scen | Behaviour exists | Untagged test already covering it | Class | Effort |
| --- | --- | --- | --- | --- | --- | --- |
| `specs/governance/edit-pull-source-config.feature` | Edit a pull ingestion source | 15 | `ingestion-source.service.ts:337` `assertReportUnchangedOncePulled`, `:159-207` cursor race guard | Three files named after the spec, all unannotated: `__tests__/edit-pull-source-config.{builders,cadence,presentation}.unit.test.ts` | BIND (11) + WRITE (4) | **40m** |
| `specs/period-selector.feature` | Relative vs absolute period | 7 | `analytics-period.ts:29-45` has the exact `{key:"15m", label:"Last 15 minutes"}` and `AnalyticsPeriodMode` | `model/__tests__/analytics-period.unit.test.ts` `it(...)` "names the preset and removes any absolute range" | BIND (4; 3 fold into `analytics-pages.feature`) | **20m** |
| `specs/monitors/automation-alert-firing.feature` | Trace automations fire only on match | 5 | `apps/worker/src/app/worker-trace-alert-trigger.composition.ts`; matcher in `analytics/server/src/services/legacy-filter-matching.service.ts` | `__tests__/legacy-filter-matching.unit.test.ts:317` `describe("given a thumbs-down automation filter")` — 4 matching tests | BIND (4) + WRITE (1) | 45m |
| `specs/monitors/slack-bot-delivery.feature` | Slack bot vs webhook | 7 | `slack-web-api.delivery.adapter.ts` (`chat.postMessage`), composed in the worker | `template-picker.integration.test.tsx` `it("renders a template that needs a Slack app but blocks selecting it")` | BIND (3) + partial (4) | 45m |
| `specs/monitors/report-content.feature` | What a scheduled report sends | 9 | contract exact (`report.ts:64-76`), **firing path unmounted** | `slack-templates/__tests__/registry.unit.test.ts` — verbatim title match | BIND + defect | 60m |
| `specs/model-providers/encrypt-custom-keys.feature` | Provider key encryption | 6 | `secret/server/src/adapters/aes-gcm.secret-encryption.adapter.ts:30,66` | `__tests__/encrypted.model-provider-credential.adapter.unit.test.ts` `it("writes null as null rather than as encrypted emptiness")` | BIND (5) + DECISION (1) | 45m |
| `specs/automations/automations-list.feature` | Automations list + fire history | 10 | `automation/web/src/features/overview/ui/elements/automation-table-cells.tsx` | `overview/__tests__/automation-history.unit.test.ts` `it("labels trace matches, reports, and alert recoveries…")` | BIND (3) + WRITE (7) | 90m |
| `specs/agents/http-agent-trace-emission.feature` | HTTP agent trace emission | 11 | `agent/server/src/transport/api-trpc/agent-test-tracing.ts` (`buildTraceparentHeader`); `http-proxy.api.ts:403` | `__tests__/agent-test-tracing.unit.test.ts` `it("redacts the token value")` — only 3 of 11 | **WRITE** (8) + BIND (3) | 90m |
| `specs/agents/workflow-agent-as-target.feature` | Workflow agent as experiment target | 5 | `experiment/web/.../target-header.tsx:325`; `experiment-run-orchestrator.service.ts:3185` `runsAsWorkflow` | **none** — `icon-workflow`, `open-workflow-link`, `runsAsWorkflow` match no test title | **WRITE** (5) | 120m |

**Three defects this lane surfaced:**

1. **Scheduled reports cannot fire on this branch.** `dispatchScheduledReport`
   (`packages/features/automation/server/src/services/report-dispatch.service.ts:162`) has zero
   callers outside its own barrel re-export; no `apps/` file names `ReportScheduleService`,
   `loadReportCharts` or `reportWindowMs`, and the worker has no report path.
   `report-content.feature` scenarios 1–5 describe unmounted code.
2. **`encrypt-custom-keys.feature`'s repository invariant is violated.**
   `apps/api/src/app/api-trpc-collaborators.product.composition.ts:823` calls
   `this.prisma.modelProvider.findFirst` directly. `prisma-boundaries.ts` governs imports, not
   call sites, so nothing catches it. Binding that scenario turns CI red.
3. **`edit-pull-source-config.feature` diverges from the code.** "Backfill start is not editable
   once the cursor has moved" is unconditional in the spec; `isBackfillStartLocked`
   (`governance-inventory.screen.tsx:1183`) deliberately narrows it to the usage report. Amend
   the spec, not the code.

### Root `specs/` — four `@unimplemented` files (93 scenarios)

These are inert *by tag*, not by omission: the checker skips `@unimplemented`. Part of what each
describes now ships, so the tags are partly stale. `@architecture`, `@typecheck`, `@catalogue`,
`@granularity` and `@migration` are **not** binding tags, which caps what three of them recover.

| File | Area | Scen | Bindable | Behaviour exists | Untagged test already covering it | Class | Effort |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `specs/server/feature-application-and-transports.feature` | Feature App + REST/tRPC doors | 19 | **19** | Plan doc says "not built"; `packages/api/src/rest/definition.ts` implements it in the spec's own words (`RestReady`, `ScopeBound`, `ScopeIdsIn<TInput>`) | `packages/api/src/rest/__tests__/fluent-registration.unit.test.ts` — **49 its, zero `@scenario`** | BIND | 90m |
| `specs/dependencies/application-workspace-boundaries.feature` | Physical app workspace split | 36 | 12 | Done: `apps/{ui,api,worker,server}`; `infra/docker/Dockerfile:38` "three deployable applications" | `packages/architecture-lint/tests/application-workspace-boundaries.test.ts` — 16 its, zero `@scenario`; `packages/prisma-client/src/import-side-effects.test.ts` is 1:1 | BIND | 60m |
| `specs/dependencies/oxc-toolchain.feature` | Oxlint/Oxfmt migration | 22 | 11 | Root has oxfmt + oxlint only; CI blocking `format:check` + `lint:oxlint` | `tests/oxlint-plugin.test.mjs` — RuleTester fixtures over 13 house rules, zero `@scenario` | BIND + DECISION (2) | 60m |
| `specs/dependencies/singular-feature-ownership.feature` | Singular feature ownership | 16 | 4 | `feature-layout.ts:421` emits *"claims Y, which belongs to the singular Z feature"* verbatim | `feature-catalogue.test.ts`, zero `@scenario` — but the key test is already bound to `feature-package-boundaries.test.ts:582` | BIND, duplicate-heavy | 30m |

**Stale scenarios in `oxc-toolchain.feature`:** its lint-debt-baseline scenario describes
machinery CI explicitly declined (`langwatch-app-ci.yml:986` — "none of that machinery has an
equivalent here"), and "every first-party root uses Oxlint" is false: `lint:oxlint`'s path set
excludes `sdks/`, `mcp/`, `tools/`, `skills/`, `tests/` and 20+ `packages/*`, with ESLint still
live in `sdks/typescript` and `mcp/typescript`.

---

## The 352 unknown annotations

An unknown annotation is a `@scenario "<title>"` on a test where no `.feature` in the corpus
(1,388 files, 19,603 distinct scenario titles) carries that title. Cause was established by
`git log -S"<title>" --all -- '*.feature'` on each of the 224 distinct titles; the newest commit
that changed the title's occurrence count is the one that removed it.

### By cause

| Cause | Count | Distinct titles | Test files |
| --- | --- | --- | --- |
| **A. Spec rewritten during a feature-package move** | **303** | 175 | 47 |
| **B. Title never existed in any `.feature`** | **49** | 49 | 20 |

Cause A decomposes by the commit that rewrote the spec:

| Commit | Annotations | Feature file it rewrote |
| --- | --- | --- |
| `94b95128a0` refactor(analytics): move the lwql workbench into feature web | 157 | `specs/analytics/lwql-workbench.feature` (86 scenarios) → `packages/features/analytics/specs/analytics-lwql-workbench.feature` (34) |
| `a380067e78` refactor(annotation): move controlled ui into feature web | 118 | `specs/annotations/annotation-queue-workflow.feature` → `packages/features/annotation/specs/annotation-queue-workflow.feature` (15) |
| `df4f775bd2` feat(lwql): workbench epic — granularity contract | 13 | granularity scenarios superseded in place |
| `e49da577ab` feat(event-sourcing): count work-conserving override dispatches | 9 | `specs/event-sourcing/work-conserving-fair-dispatch.feature` → `packages/group-queue/specs/` |
| `d7c18dd45e` refactor: finish the feature and runtime package move | 5 | eventing / coding-agent subscriber specs |
| `f3aad4edfb` feat(annotations): make the review inbox readable | 1 | annotation list columns |

The pattern is identical in every case: the `.feature` file was moved into its owning package
**and rewritten** in the same commit — 86 scenarios collapsed to 34 for LWQL — while the tests
kept the old titles. Nothing here is a typo, and nothing is caused by the platform deletion.

Cause B decomposes by how close the invented title sits to a real one:

| Sub-cause | Count | Reading |
| --- | --- | --- |
| Near-match ≥ 0.75 to a live title | 5 | Genuine drift or typo; retitle the annotation. |
| Weak 0.55–0.75 | 23 | The annotation names a scenario the author intended to write; the spec sentence does not exist. |
| No match < 0.55 | 21 | Annotation written ahead of any spec, mostly in the extraction-era composition tests. |

### By feature file (top clusters)

| Intended feature file | Annotations | Currently bound | Recoverable by repointing |
| --- | --- | --- | --- |
| `packages/features/analytics/specs/analytics-lwql-workbench.feature` | ~157 | 5 / 34 | +29 |
| `packages/features/annotation/specs/annotation-queue-workflow.feature` | ~118 | 1 / 15 | +14 |
| `packages/group-queue/specs/work-conserving-fair-dispatch.feature` | 9 | — | small |
| unattached (cause B) | 49 | — | needs a spec sentence first |

### By test file (top ten)

| Annotations | Test file |
| --- | --- |
| 33 | `packages/features/annotation/web/src/screens/my-queue/__tests__/my-queue-bar.integration.test.tsx` |
| 28 | `packages/features/annotation/web/src/ui/sections/__tests__/annotation-list.columns.integration.test.tsx` |
| 21 | `packages/features/annotation/web/src/ui/sections/__tests__/annotation-list.selection.integration.test.tsx` |
| 19 | `packages/features/analytics/web/src/ui/blocks/__tests__/langwatch-ql-result-pane.integration.test.tsx` |
| 16 | `packages/features/analytics/web/src/ui/sections/__tests__/langwatch-ql-vega-lite-chart.integration.test.tsx` |
| 16 | `packages/features/analytics/web/src/ui/sections/__tests__/langwatch-ql-workbench.integration.test.tsx` |
| 13 | `packages/features/annotation/web/src/screens/my-queue/__tests__/my-queue-conversation.integration.test.tsx` |
| 12 | `packages/features/analytics/server/src/langwatch-ql/__tests__/lwqlTimeWindow.unit.test.ts` |
| 11 | `packages/features/analytics/web/src/model/__tests__/lwql-request-state.unit.test.ts` |
| 11 | `packages/features/analytics/web/src/model/__tests__/lwql-value-format.unit.test.ts` |

### Five examples per cause

**A1 — `94b95128a0`, LWQL workbench (157):**

- `'The adversarial corpus is refused'`
- `'Caller-supplied datasets and inline values are rejected'`
- `'Spec-controlled runtime options are rejected'`
- `'The chart follows LangWatch theming in light and dark modes'`
- `'A stale result stays labelled as belonging to the previous submission'`

**A2 — `a380067e78`, annotation queue UI (118):**

- `'The open queue is the highlighted sidebar entry'`
- `'Every queue in the sidebar carries its own actions menu'`
- `'The queue bar labels its navigation and actions in words'`
- `'The queue bar shows my position in the queue'`
- `'A finished queue item opens the trace drawer'`

**A3 — `df4f775bd2`, LWQL granularity (13):**

- `'A statement declaring the granularity parameter runs at the step the workbench supplies'`
- `'The resolver reports an unfilled declared granularity rather than inventing a step'`
- `'The granularity parameter declared as anything but UInt32 is refused'`
- `'A caller that supplies period_granularity_seconds itself is refused'`
- `'A zero or fractional step is refused as a wrong declaration'`

**A4 — `e49da577ab` (9) and `d7c18dd45e` (5):**

- `'Slots filled by the override are counted separately from ordinary dispatch'`
- `'A saturated fleet records no override dispatches'`
- `'A failing relevance guard never drops a side effect'`
- `'A registration keeps its queue identity across the vocabulary change'`
- `'a staged shape from a newer build is refused, never quietly completed'`

**B — never existed (49):**

- `'A strict feature declares its layout version'` — 0.90 to `'A strict feature declares the initial layout version'` (`packages/architecture-lint/specs/strict-feature-layout.feature`). A one-word typo.
- `'The API-key transport moves without changing who may call it'` — 0.92 to `'The role transport moves without changing who may call it'` (`packages/features/role/specs/role-service.feature`). Copied and edited without a matching spec sentence.
- `'The worker composes the tenancy graph from its own client'` — 0.86 to `'The worker composes the identity guards from its own client'`.
- `'Shared table headers retain their type-specific visual cues'` (`packages/design-system/tests/column-type-icon.test.tsx`) — no near match; design-system has no spec at all.
- `'A new organization is created with its first team'` (`apps/api/.../api-trpc-collaborators.identity.composition.integration.test.ts`) — no spec sentence; the closest is `'A project is created with a new team'` at 0.64.

---

## Proposed lane plan

Six lanes, disjoint, ordered by scenarios recovered per hour. Every lane is independently
mergeable and none of them touches `platform/app`.

| # | Lane | Files | Scenarios | Hours | Rate |
| --- | --- | --- | --- | --- | --- |
| 1 | **Twenty-minute binds** | 17 | 70 | 4.5 | **15.6/h** |
| 2 | **Four big single-file binds** | 4 | 74 | 6.3 | 11.8/h |
| 3 | **`@unimplemented` tag audit** | 3 | 27 (of 74) | 2.5 | 10.8/h |
| 4 | **Service-spec sweep, features A–G** | 8 | 62 | 6.1 | 10.2/h |
| 5 | **Unknown-annotation repair** | 47 test files | ~50 + all 352 annotations | ~6 | 8.3/h |
| 6 | **Platform refugees + the expensive writes** | 18 | 109 | 17.9 | 6.1/h |

### Lane 1 — Twenty-minute binds (70 scenarios, 4.5 h)

The seventeen files where an existing test already matches the scenario near-verbatim and the
whole job is a `@scenario` annotation plus a binding tag. No spec is reworded, no test is written.

`gateway-realtime-session-reconciliation` (3), `notification-service` (2), `saas` (2),
`enterprise-catalogue` (2), `browser-session` (3), `presence` (5), `api-composition` (2),
`worker-composition` (3), `topic-read-surface` (4), `data-privacy-service` (3),
`period-selector` (7), `monitor-service` (7), `suite-service` (6), `licensing` (6),
`metric-processing` (6), `scenario-service` (5), `model-provider` (4).

Clears 17 of the 50 fatal files. Three overlap decisions ride along: `data-privacy` 1–2,
`scenario-service` 4–5 and `presence` 1–3 restate scenarios already bound elsewhere — dual-bind
or trim the package spec, but decide once at the top of the lane rather than per file.

### Lane 2 — Four big single-file binds (74 scenarios, 6.3 h)

`specs/server/feature-application-and-transports.feature` (19),
`packages/features/workflow/specs/workflow-service.feature` (21),
`packages/enterprise/features/governance/specs/governance.feature` (19),
`specs/governance/edit-pull-source-config.feature` (15).

Highest single-file yields in the census, each with a large unannotated test suite already
written against it (49 `it()`s for the feature-application spec alone). Two spec amendments are
in scope: governance S2's false `feature.json` claim and `edit-pull-source-config`'s
unconditional backfill-lock sentence.

### Lane 3 — `@unimplemented` tag audit (27 of 74 scenarios, 2.5 h)

`application-workspace-boundaries` (36 → 12 bindable), `oxc-toolchain` (22 → 11),
`singular-feature-ownership` (16 → 4).

The cheapest gate work in the census, because most of what these describe already shipped: drop
the stale `@unimplemented`, tag what the tree does, leave the rest honestly future. Note that
`@architecture`/`@typecheck`/`@catalogue` do not bind, so the recoverable count is 27, not 74 —
and two `oxc-toolchain` scenarios are false as written and need rewriting or deleting.

### Lane 4 — Service-spec sweep, features A–G (62 scenarios, 6.1 h)

`analytics-timeseries` (8), `annotation-service` (10), `automation` (12),
`coding-agent-session-read` (7), `data-retention-service` (9), `evaluation-service` (6),
`evaluator-service` (5), `github-service` (5).

Uniform shape: the package's service unit test was written scenario-for-scenario against the
spec and never annotated. Sequence `evaluation-service` last or coordinate — someone in the fleet
has an uncommitted seventh scenario there.

### Lane 5 — Unknown-annotation repair (~50 scenarios + all 352 annotations, ~6 h)

Two sub-lanes, one per rewrite commit. Analytics/LWQL: 157 annotations across 24 test files
remapped onto the 34 scenarios of `analytics-lwql-workbench.feature` (5 bound today).
Annotation web: 118 across 8 files onto `annotation-queue-workflow.feature` (1 of 15 bound). Then
the 28-annotation tail (`df4f775bd2`, `e49da577ab`, `d7c18dd45e`) and the 49 unattached ones,
which need a spec sentence written before they can point anywhere.

Ranked fifth on scenarios per hour but it is the only lane that clears a whole failure class —
the `352 unknown annotation(s)` line disappears entirely.

### Lane 6 — Platform refugees and the expensive writes (109 scenarios, 17.9 h)

The five remaining platform refugees (`automations-list` 10, `http-agent-trace-emission` 11,
`workflow-agent-as-target` 5, `report-content` 9, `slack-bot-delivery` 7,
`automation-alert-firing` 5, `encrypt-custom-keys` 6) plus the tail of feature packages
(`trace-read-service` 10, `trace-query-language` 3, `scenario-execution` 5, `experiment-service`
6, `log-processing` 6, `langy` 10, `user` 3, `gateway-budget-service` 5, `billing` 3,
`managed-providers` 3, `web-composition` 2).

This lane carries every genuine WRITE, the one RETIRE (`langy` S2), the one file-level DECISION
(`@langwatch/enterprise-web` has no dependents — decide whether the package survives before
spending ten minutes tagging its spec), and all three defects the census surfaced. Two of those
defects are product bugs, not spec bugs: scheduled reports cannot fire, and a direct
`prisma.modelProvider.findFirst` call breaks the repository invariant that
`encrypt-custom-keys.feature` asserts. Binding either scenario turns CI red until the code is
fixed, which is the point.

---

## Things worth deciding before any lane starts

1. **`@langwatch/enterprise-web` has no dependents.** No `package.json` requires it, no source
   imports `EnterpriseWebComposition`. Binding its spec ratifies dead code.
2. **Duplicate scenarios across package and root specs.** `data-privacy` 1–2, `scenario-service`
   4–5, `monitor-service` 1/3 and `presence` 1–3 restate scenarios already tagged and bound in
   root `specs/`. Dual-binding one `it()` to two titles works; trimming the package spec is
   cleaner. Pick one policy.
3. **Five scenarios describe code that moved and must be reworded before honest tagging:**
   `evaluator` S5, `experiment` S6, `langy` S6/S7/S8 — each ends with a clause asserting
   something "remains in the application" that no longer does. `trace-read-service` S6 and
   `workflow-service` S15 are the same failure in different words.
4. **`LEGACY_INERT` is the escape hatch, and it only ever shrinks.** Any file this census cannot
   land in one pass can be added with a reason rather than left as a hard failure — but that
   choice should be deliberate, not the default for the awkward ones.

---

## Lane 1 ledger — 2026-09-03

Sixteen of the seventeen files landed. `gateway-realtime-session-reconciliation` was skipped
because its only matching test lives in `packages/features/gateway/server`, which another lane
holds open; tagging its scenarios without annotating that test would have swapped three inert
scenarios for three unbound ones, which is worse than leaving it.

| Feature file | Scenarios bound | Test file(s) carrying the `@scenario` annotations |
| --- | --- | --- |
| `packages/features/notification/specs/notification-service.feature` | 2 of 2 | `notification/server/src/repositories/__tests__/notification.service.unit.test.ts`, `notification/server/src/repositories/prisma/__tests__/prisma.notification.repository.unit.test.ts` (new) |
| `packages/features/auth/specs/browser-session.feature` | 3 of 3 | `auth/server/src/ports/__tests__/auth.service.unit.test.ts` |
| `packages/features/presence/specs/presence.feature` | 5 of 5 | `presence/server/src/ports/__tests__/presence.service.unit.test.ts`, `presence/server/src/ports/__tests__/presence-trpc.api.unit.test.ts` |
| `packages/features/topic/specs/topic-read-surface.feature` | 4 of 4 | `topic/server/src/repositories/prisma/__tests__/prisma.topic.repository.unit.test.ts`, `topic/server/src/repositories/__tests__/topic.service.unit.test.ts` |
| `packages/features/monitor/specs/monitor-service.feature` | 7 of 7 | `monitor/server/src/repositories/__tests__/monitor.service.unit.test.ts`, `monitor/server/src/adapters/__tests__/postgres.monitor-catalog.adapter.unit.test.ts` |
| `packages/features/suite/specs/suite-service.feature` | 6 of 6 | `suite/server/src/repositories/__tests__/suite.service.unit.test.ts`, `suite/server/src/repositories/clickhouse/__tests__/clickhouse.suite-run.repository.unit.test.ts` |
| `packages/features/model-provider/specs/model-provider.feature` | 4 of 4 | `model-provider/server/src/ports/__tests__/model-provider.service.test.ts`, `model-provider/server/src/ports/__tests__/prisma-model-provider.repository.test.ts` |
| `packages/features/metric/specs/metric-processing.feature` | 5 of 6 | seven files under `metric/server/src/{adapters,services,repositories}/__tests__` |
| `packages/features/scenario/specs/scenario-service.feature` | 4 of 5 | `scenario/server/src/repositories/__tests__/scenario.service.unit.test.ts`, `scenario/contract/src/__tests__/scenario.contract.unit.test.ts` |
| `specs/period-selector.feature` | 5 of 7 | `analytics/web/src/model/__tests__/analytics-period.unit.test.ts`, `analytics/web/src/behavior/__tests__/use-analytics-period.unit.test.tsx` |
| `packages/features/data-privacy/specs/data-privacy-service.feature` | 1 of 3 | `data-privacy/server/src/ports/__tests__/data-privacy.service.unit.test.ts` |
| `packages/enterprise/features/licensing/specs/licensing.feature` | 3 more, 5 of 6 | `enterprise/features/licensing/server/src/__tests__/license.service.unit.test.ts` |
| `packages/enterprise/composition/worker/specs/worker-composition.feature` | 2 of 3 | `enterprise/composition/worker/tests/worker-composition.unit.test.ts` |
| `packages/enterprise/composition/api/specs/api-composition.feature` | 1 of 2 | `enterprise/composition/api/tests/api-composition.unit.test.ts` |
| `packages/enterprise/specs/enterprise-catalogue.feature` | 1 of 2 | `enterprise/tests/enterprise-catalogue.unit.test.ts` |
| `packages/enterprise/features/saas/specs/saas.feature` | 1 of 2 | `enterprise/features/saas/web/src/__tests__/extra-footer-components.integration.test.tsx` |
| `packages/features/gateway/specs/gateway-realtime-session-reconciliation.feature` | **skipped** | test lives in a directory another lane holds |

54 scenarios newly bound. Every file above reports `✓ all bound`.

### Gate, before and after

```
before  Enforced: 1375 file(s) · Legacy: 15 file(s) · Inert: 409 file(s)
        FAIL: 4629 unbound scenario(s) in enforced files, 352 unknown annotation(s),
              46 file(s) enforce no scenario at all

after   Enforced: 1376 file(s) · Legacy: 15 file(s) · Inert: 394 file(s)
        FAIL: 4629 unbound scenario(s) in enforced files, 354 unknown annotation(s),
              31 file(s) enforce no scenario at all
```

Fifteen fatal-inert files cleared (licensing was already enforcing two scenarios before this
lane, so it was not on the fatal list). The unbound count did not move: everything tagged here
was annotated in the same pass. The two extra unknown annotations are not from this lane — they
name `Credential password hashes never leave the user feature` and `Virtual key rows are read
only through the gateway feature`, both in-flight work in `packages/features/{user,gateway}`.

### Where a test was tightened rather than trusted

Seven scenarios named a clause the matching test did not assert. Each was closed with the
smallest honest assertion rather than tagged over:

- **notification** — "newest first" was unprovable at the service (its fake did the sorting), so
  the ordering is now pinned where it lives, on `orderBy: { sentAt: "desc" }` in a new Prisma
  repository test.
- **topic** — "known ids are returned with their names, unknown ids are absent" had no test at
  all; the repository test now exercises `findNamesByIds` with one present and one absent id.
- **monitor** — the replica's unique name and slug were unasserted, and "the source monitor is
  unchanged" now spies on the repository's `update` to prove no write reaches the source.
- **suite** — batch history asserted only the set-id filter and the limits; it now also pins
  `GROUP BY TenantId, ScenarioSetId, BatchRunId` and `ORDER BY t.CreatedAt DESC`.
- **presence** — "the service reports success" on a repeat leave is now an explicit `resolves`.
- **period selector** — the absolute write asserted only `startDate`; it now names `endDate` too,
  and the bogus-preset fallback asserts the mode it falls back to.
- **model provider** — "rejects the write before calling the repository" now proves the
  repository saw nothing, and the translation port records the model it was handed.
- **metric** — the preparation test now pins the 64-hex shape of `SeriesId` and `PointId`, and the
  exemplar test proves the malformed exemplar produced no correlation.

### Left untagged on purpose

| Scenario | Why |
| --- | --- |
| `data-privacy-service` 1–2 (platform default, nearest scope wins) | The resolution adapter test asserts `categories: expect.any(Object)` on an empty rule set — neither the default values nor scope precedence is exercised anywhere. A WRITE, not a bind. |
| `scenario-service` 5 (input mapping is portable) | True by imports only. Both surfaces reach `@langwatch/scenario-contract`, but no test and no boundary lint proves it. |
| `metric-processing` 3 (four tables and rollup width) | `metric_data_points`, `metric_usage_estimates` and the 30-second bucket are asserted; `metric_series` and `metric_time_rollups` are named by no test. The rollup insert only fires when the authoritative read returns rows, which needs a fixture nobody has written. |
| `period-selector` 1 (relative pick stores as relative) | Restates scenario 5 from a neutral address. The only test starts from an address that already carries an absolute range, and nothing proves the mode on the write path. |
| `period-selector` 7 (selector label reflects the mode) | `AnalyticsPeriodPicker` is rendered by no test. `getDateRangeLabel` is untested, and the model has no label function to stand in for it. |
| `licensing` 6, `api-composition` 2, `worker-composition` 3, `enterprise-catalogue` 2 | The four "import without side effects" scenarios. Nothing asserts import-time purity for these packages; the shape to copy is `architecture-lint/tests/identity-package-boundaries.test.ts`. |
| `saas` 1 (scripts stay dormant off SaaS) | No test renders the footer with `isSaas` false. |
| `monitor-service`, `presence`, `scenario-service` overlaps | The census flagged these as possible duplicates of root specs. Grepping the exact titles across every `.feature` file found no collision, so they were bound in place rather than trimmed. |

### Riders bound without their own assertion

Three scenarios carry an architectural clause the test cannot express, and were bound on the
behaviour the test does prove. Named here so nobody mistakes the binding for coverage:
`api-composition` 1 ("without registering routes" — registration is app-owned and the composition
class has no such method), `model-provider` 1 ("the provider repository remains private" — the
server package index never exports it), and `metric-processing` 2 (the partial-success clause is
proven at the service result; the OTLP route body that serialises it has no test).

---

## Lane 4 ledger — 2026-09-03

All eight service specs landed. Every scenario tagged in this lane is bound; nothing was tagged
over a gap. Where a scenario named a clause no test asserted, either the smallest honest
assertion was added or the scenario was left untagged with the reason recorded below.

| Feature file | Scenarios bound | Untagged, and why |
| --- | --- | --- |
| `packages/features/analytics/specs/analytics-timeseries.feature` | 7 of 8 | **Analytics does not own product lifecycles** — the claim is that Analytics owns no Dashboard or Topic repository. Nothing exercises it, and no boundary lint names those two features. |
| `packages/features/annotation/specs/annotation-service.feature` | 5 of 10 | **a process composes one annotation capability** — "the same contract AnnotationService instance" is only observable at the composition root in `apps/api`, held by another lane. **annotation persistence stays private** — no test parses a mapped row through the contract schema; the Prisma-containment half is the repo-wide `public-declarations` policy, not a package test. **queue-item writes are atomic** — the `$transaction` at `prisma.annotation.repository.ts:345` is reached by no test. **queue transport orchestration remains one annotation seam** — an architectural claim about where orchestration lives; nothing exercises it. **transport user projections preserve their legacy shape** — `transport/api-trpc/annotation.api.ts` has no test at all, in this package or anywhere. |
| `packages/features/automation/specs/automation.feature` | 12 of 12 | — |
| `packages/features/coding-agent/specs/coding-agent-session-read.feature` | 7 of 7 | — |
| `packages/features/data-retention/specs/data-retention-service.feature` | 8 of 9 | **Boot supplies the platform default** — the explicit injection happens in `apps/api`'s composition, which another lane holds, and the "importing the contract does not read environment state" half is asserted by nothing. `data-retention.schema.unit.test.ts` already carries a comment saying the environment refusal has no owner; this is that same hole. |
| `packages/features/evaluation/specs/evaluation-service.feature` | 6 of 7 (5 new; the `@unit` scenario from `691eceb652` kept) | **API and workers share the same service** — "both use the same service capability" is a composition-root claim, in `apps/api` and `apps/worker`. |
| `packages/features/evaluator/specs/evaluator-service.feature` | 3 of 5 | **A process composes one evaluator capability** — the REST and tRPC suites each build their own `EvaluatorApp` double, so neither proves one shared instance; that lives in `apps/api`'s composition. **Evaluator persistence stays behind the server boundary** — `PrismaEvaluatorRepository` appears in zero test files, so the row mapping is untested. |
| `packages/features/github/specs/github-service.feature` | 4 of 5 | **one process composes one GitHub capability** — the capability is memoized at `apps/api/src/app/api-production.composition.ts:3137`, in another lane's file. |

51 scenarios newly bound across the eight files (7 + 5 + 12 + 7 + 8 + 5 + 3 + 4). Every one of
those files reports `✓ all bound`. A 52nd scenario, in a root spec, is bound as a side effect —
see "One cross-bind" below.

### Gate, before and after

```
before  Enforced: 1376 file(s) · Legacy: 15 file(s) · Inert: 393 file(s)
        FAIL: 4629 unbound scenario(s) in enforced files, 352 unknown annotation(s),
              30 file(s) enforce no scenario at all

after   Enforced: 1376 file(s) · Legacy: 15 file(s) · Inert: 380 file(s)
        FAIL: 4628 unbound scenario(s) in enforced files, 352 unknown annotation(s),
              17 file(s) enforce no scenario at all
```

Seven fatal-inert files cleared here (`evaluation-service` was already enforcing one scenario, so
it was never on the fatal list). The fatal count fell by thirteen rather than seven because other
lanes were landing in the same working tree while this one ran — two consecutive runs minutes
apart, with no edit of mine between them, read 19 and then 17, so treat the totals as a moving
floor and the per-file rows above as the part this lane owns. The unknown-annotation count did not
move, which is the check that every `@scenario` title written here names a real scenario.

### Where a test was tightened rather than trusted

Eight scenarios named a clause the matching test did not assert. Each was closed with the
smallest honest assertion:

- **analytics** — "when it writes the row **or its rollup**" had no rollup test at all. The
  repository suite now appends a derived bucket, pins `evaluation_analytics_rollup` as the table,
  and proves a malformed bucket is refused before any insert.
- **annotation** — "validation fails before persistence is called" was only proven at the schema.
  The service test now calls `create` with a half anchor and asserts the repository saw nothing.
  Writing it surfaced that `AnnotationService.create` throws **synchronously**, so the assertion
  is `expect(() => …).toThrow()` rather than `rejects` — worth knowing before anyone treats that
  method as returning a rejected promise.
- **annotation** — "members are read in one OrganizationService batch" was unasserted. A new test
  pins one `getOrganizationMembers` call carrying the deduplicated user ids.
- **automation** — "it claims the containment check before evaluating project traffic" and "it
  sends at most one limit notification for the UTC day" were both unasserted. The runaway port now
  records its calls in order; the containment claim is proven to come first, a condition-less
  trigger is proven never to read project traffic, and a second breach after the check claim is
  released still mails once. The filtered-automation scenario got the same once-a-day assertion.
- **automation** — "an automation is read by id and project returns only the automation belonging
  to that project" had no test. The trigger fake now serves rows by `projectId:triggerId`, and the
  new test proves a read from another project fails and that both keys reach the repository.
- **data-retention** — "no ClickHouse retention command is issued" was true only because the pin
  suite composed no ClickHouse at all. It now composes a recording `RetroactiveRetentionRepository`
  and asserts the pin leaves it untouched.
- **evaluation** — "it validates the Zod 4 run contract" was unasserted. `upsertRun` with a
  malformed run now has to reject, and the read-back has to still throw `EvaluationNotFoundError`,
  proving nothing reached the repository.
- **github** — "no token is written to GitHub persistence" was unasserted. The turn-token test now
  proves `upsert`, `insertOrGetExisting` and `setRepositories` are all untouched by a mint.

### Riders bound without their own assertion

Five scenarios carry an architectural clause no test can express, and were bound on the behaviour
the test does prove:

- `annotation` 1 — "the card, editor body, diff and score controls come from annotation-web". The
  card and the score controls are rendered by tests; `AnnotateBody`, `SuggestBody` and `DiffPanel`
  are exported from the web root and rendered by nothing.
- `coding-agent` 6 — "application composition cannot inject Coding Agent repositories".
- `coding-agent` 7 — "application routing and query composition remain outside the feature".
- `data-retention` 5 — "its repository reads only retention policy rows".
- `github` 2 — "repository implementations are not exported from the server root". This one *is*
  enforced, repo-wide, by the `private-runtime-export` policy and
  `architecture-lint/tests/feature-package-boundaries.test.ts` `it("rejects private persistence
  exported through a server root barrel")` — deliberately left unannotated because the sibling
  `@unimplemented` architecture-spec lane holds that file.
- `evaluator` 4 — "it does not duplicate that vocabulary in an application module". True today
  (`AVAILABLE_EVALUATORS` appears nowhere under `apps/ui/src`), asserted by nothing.
- `automation` 11 — "application code retains only drawer and transport composition".

### One cross-bind, on purpose

`Pinning a trace does not change retention` is the only title in this lane that appears in two
feature files: the package spec and `specs/data-retention/pr-4147-regressions.feature:21`, which
was already `@regression @unit` and unbound. The new pin test satisfies the regression file's
sentence too ("no retention mutation is issued"), so it binds both — that is the single scenario
the unbound count fell by. Its second clause there, "trace follows the 49-day retention policy",
remains a rider.

---

## Lane 2 and 3 ledger — 2026-09-03

Six of the seven files land; `oxc-toolchain.feature` does not, for the reason below. 46 scenarios
newly enforced and bound, zero left unbound.

| Feature file | Bound | Untagged, with reason |
| --- | --- | --- |
| `packages/enterprise/features/governance/specs/governance.feature` | **10 of 19** — S2 (rewritten), S3, S4, S5, S6, S8, S10, S11, S15, S16 | S1 "orchestrates rather than absorbs" — no test; the only evidence is the server manifest, and governance legitimately depends on `@langwatch/{project,trace}-server`, so a naive contracts-only assertion would be false. S7 persona home — "the application remains responsible for authentication and redirect transport" has no subject in the resolver's own test. S9 anomaly-rule validation — the clause enumerates scope, severity, threshold and destinations; only threshold and rule type are ever rejected. S12 anomaly delivery — clause 3 names an SSRF-safe adapter that **nothing constructs**: `SsrfSafeAnomalyAlertHttpAdapter` and `startSpendSpikeAnomalyWorker` have zero callers repo-wide. S13 storage syntax — the ClickHouse half lives in `composition/api/src/governance/governance-kpis.clickhouse.repository.ts`, which has no test file. S14 departments — "an accounting dimension rather than an access grant" has no permission surface to assert against. S17 platform catalog reconcile — `syncPlatformCatalog` is called by no test; the memory repository's copy is dead scaffolding. S18 transports — the Hono half of the `When` is false: no Hono route resolves governance setup state. S19 contracts are transport independent — true, but the repo's import-graph walker runs backend→browser only. |
| `packages/features/workflow/specs/workflow-service.feature` | **8 of 21** — S1, S2, S3, S4, S7, S16 (reworded), S17, S19 | S5 — the Studio half of "Studio or execution materialises" is `transport/api-trpc/workflow.api.ts:540`, and `server/src/transport/` has no `__tests__` directory. S6 — `studioClientEventSchema` is never the subject of a test, the browser half has zero references, and the optimizer parameter shape is untested. S8, S9, S10, S11, S13 — each ends in an "application composition supplies X" clause that the platform deletion falsified: the create mutation, the project queries and dialogs, the Experiment renderers, the compatibility imports and the secrets transport are all inside Workflow Web now. Reworded and bound only where a test proves the reworded claim (S16). S12 — `buildLlmSignatureNode` has no test. S14 — `WorkflowNodeHostProvider` and `useWorkflowNodeHost` appear in no test file at all. S15 (reworded to the truth: one node registry, one inline default edge, canvas mounted by Workflow Web) — still no test; its only neighbour reads the component source with `fs.readFileSync` and a regex. S18 — `StudioEventPreparerService` sequences enrich-then-materialize and has no test file; swap the two lines and the package stays green. S20 — no test calls `POST /workflows/:id/evaluate`, and neither permission gate is exercised. S21 — "validates required entry inputs and model credentials" reaches two `ValidationError` throws no test has ever reached. |
| `specs/governance/edit-pull-source-config.feature` | **13 of 15+3** — S1–S8, the three rewritten backfill-lock scenarios, S10 (clause 4 amended), S11 | "A locked backfill start says why it is locked" — the copy lives in an unexported `PullConfigEditFields`; no test renders it. "A pull-mode source is not told its ingest secret is immutable", "A push-mode source is told both are immutable", "Editing is reachable from the detail page", "A viewer without manage permission cannot edit" — all four need a render of `SourceEditDrawer` / `IngestionSourceDetailPage` that nobody has written; the closest existing test asserts the *list*'s Add button and is already bound elsewhere. |
| `specs/server/feature-application-and-transports.feature` | **8 of 19** — S4, S8, S9, S11, S14, S15, S16, S17 | S1 — "it receives every service and port the feature's operations use" is not a testable proposition as written. S2, S3, S18, S19 — the two-door family: **no test in the repo drives both transports**, and none compares a REST refusal code with a tRPC one. S5 — clause 2 is false on the REST door, which restates the caller as a framework-owned `RequestActor`. S6 — the implementation contradicts it: `ServiceContext` extends Hono's `Context`, so `c.get("things")` is the dominant idiom in this very test file. S7, S12, S13 — compile-refusal scenarios with no `@ts-expect-error` or `expectTypeOf` anywhere near them; `public-rest.unit.test.ts`'s module-scope `AssertTrue<…>` aliases are real but sit outside any `it(`, so the checker cannot see them. S10 — its Given is refused by the implementation: `assertRouteDef` throws when no output schema is declared, so "an endpoint that declares no output schema" has no subject. |
| `specs/dependencies/application-workspace-boundaries.feature` | **4 of 36** — "Importing the Prisma client package has no process side effects", "The production API serves the built UI artifact", "API and worker remain commands in the same image", "The self-host command remains compatible" | `@unimplemented` moved from the feature to the 32 scenarios no test proves. Of the eight other binding-tagged ones: "Unlicensed self-hosted deployments retain enterprise discovery" and "Moving EE source does not change enterprise availability" have no test. "Development keeps the UI and API processes separate" — `vite-browser-entry.unit.test.ts` proves only the root-discovery proxy, not `/api`, and neither of the other two clauses. "Contributor environment files survive removal of the monolithic package" — the bats overlay suite pins what `.env.dev-up` contains, not that the root `.env` is the source of truth. "Standalone processes own separate Prisma clients" — the API half is proven by `api-database.infrastructure.unit.test.ts`; the worker has no equivalent. "Combined development shares Prisma explicitly" and its sibling name `tools/dev-runtime`, **which does not exist**: the repo went to three processes instead. "No new network service is required" and "Every extraction stage preserves supported entry points" have no test. |
| `specs/dependencies/singular-feature-ownership.feature` | **3 of 16** — "Every production subject has exactly one owner", "A local manifest cannot broaden a feature", "A new durable domain changes its architecture records" | `@unimplemented` moved from the feature to the 13 scenarios no test proves. The only other binding-tagged one, "Existing API paths survive a feature move", needs a compatibility-adapter test nobody has written. The rest carry `@architecture`/`@catalogue`/`@granularity` tags, which do not bind. |
| `specs/dependencies/oxc-toolchain.feature` | **0 — left as it was** | Its eleven binding-tagged scenarios have no test between them, and the one with a real fixture suite cannot be bound at all: `LangWatch house rules keep executable fixtures` is served by `packages/architecture-lint/tests/oxlint-plugin.test.mjs`, and the parity checker's `TEST_FILE_RE` is `/\.test\.tsx?$/`, so **no `.mjs` file can carry a binding**. Everything else is a CI-behaviour or command-behaviour claim with no runner: the nearest thing in the tree is `check-queue.test.ts`'s assertion that `oxlint` and `oxfmt` are the shimmed tools of the root checks, which serves two `@architecture` scenarios that do not bind. The census's "11 bindable" counted binding *tags*, not scenarios a test proves. |

### Where a test was tightened rather than trusted

- **feature-package-boundaries** — `rejects local subject ownership expansion` now writes a
  governance `project.service.ts` beside the local manifest and asserts both halves: the manifest
  is refused in its own right, *and* it does not suppress the claim it was written to legitimise
  (`belongs to the singular "project" feature`). `rejects an incomplete feature boundary ADR` now
  also proves the Gherkin half of the record, by removing the specs directory and asserting
  `Every documented feature boundary must own at least one Gherkin spec.`
- **governance** — a new `refuses a cost outside the exactly-representable nano-USD range` reaches
  the `pulled-usage-pricing.service.ts` guard that no test had ever reached; a new
  `encrypts a freshly typed credential on the edit path, not only on create` proves the update
  path encrypts, which was asserted only on create.
- **apps/api** — a new `starts the API by default and leaves the worker a command in the same
  image` pins the single runtime stage, the default `CMD` under `/app/apps/api`, and the worker's
  own start script. The wrong-project refusal moved out of the version-selection test into
  `refuses a project the credential does not cover without saying whether it exists`, which now
  asserts the body names neither the project nor "not found".
- **packages/api** — `exposes the process app directly on the handler context` carries a
  `@ts-expect-error` on an operation the composed app does not expose, which is the scenario's
  second clause and is load-bearing under `pnpm typecheck`. `installs no input validation` now
  spies the handler and asserts the framework passed `undefined`, twice. `rejects a validated
  project target…` declares `z.string().trim()` and adds a padded request that can only be
  accepted if the scope is read post-validation. `refuses a raw Response…` now asserts the
  transport kept the content type and dropped the handler's bytes.
- **workflow** — `creates, versions and publishes…` now pins the portable envelope the service
  stamps (`workflow_id`, `state`); a new `does not resolve a published version for another
  project` closes the tenant clause the fake repository could not prove on its own; a new
  `ships no model, leaving the project's resolved default to fill it` closes the template clause.

### Spec text corrected before binding

1. **`governance.feature` S2 was factually inverted.** It said lint "rejects it until `feature.json`
   declares the subject". `packages/architecture-lint/src/workspace.ts:84` rejects *any* key but
   `layoutVersion` with "feature.json may only select layoutVersion; feature ownership is declared
   centrally", and subjects live in `packages/features/catalogue.json` (governance owns 22 there).
   Rewritten to that truth and bound to `rejects local subject ownership expansion`.
2. **`edit-pull-source-config.feature`'s backfill lock was unconditional.** `isBackfillStartLocked`
   (`governance-inventory.screen.tsx:1190`) is `hasPulled && report === "usage"` — deliberately, as
   its own comment explains: the cost cursor binds `startingAt` into its identity, so moving the
   start is the repair lever for wrong early figures. Split into a usage lock, a cost-editable
   scenario and a no-report scenario, all three bound; the "explains why it is locked" copy became
   its own untagged scenario. S10's "the refusal points at archiving and recreating" was also
   false of the refusal — that copy is client-side, rendered because `lockedParserKeys` locks the
   report — so the clause now says what the form does.
3. **`workflow-service.feature` S15's `edgeTypes` registry does not exist.** The only `edgeTypes`
   in the tree is `useMemo(() => ({ default: WorkflowEdge }), [])` at
   `optimization-studio.tsx:500`; there is a node registry (`workflow-nodes.registry.ts`) and no
   edge registry, and `apps/ui` imports no `@xyflow` at all, so "the application mounts" was wrong
   too. Reworded to the truth and left untagged, since no test asserts either half. S16's
   "application port" became "injected drawer port" for the same reason — the picker-flow adapters
   moved into Workflow Web — and that one *is* bound.
4. **`feature-application-and-transports.feature` S14 said "either transport".** Only the REST door
   is exercised; narrowed to it rather than tagging a claim about both.

### Gate, before and after

```
before  Enforced: 1376 file(s) · Legacy: 15 file(s) · Inert: 391 file(s)
        FAIL: 4629 unbound scenario(s) in enforced files, 352 unknown annotation(s),
              28 file(s) enforce no scenario at all

after   Enforced: 1376 file(s) · Legacy: 15 file(s) · Inert: 380 file(s)
        FAIL: 4628 unbound scenario(s) in enforced files, 352 unknown annotation(s),
              17 file(s) enforce no scenario at all
```

The fatal-inert count is a moving target while other lanes land: it read 30, then 28, in two runs
minutes apart before this lane touched anything. Six of the eleven cleared between those two
measurements are this lane's; the rest are not. The unbound count did not move for this lane —
every scenario tagged here was annotated in the same pass — and the single unbound scenario
recovered is another lane's.

### Two findings worth acting on outside this lane

1. **`packages/architecture-lint/tests/oxlint-plugin.test.mjs` can never bind a scenario.** The
   checker's `TEST_FILE_RE` is `/\.test\.tsx?$/`, so its thirteen RuleTester fixture suites are
   invisible to the gate. Widening the regex to `.test.mjs` is a one-line change that would make
   `oxc-toolchain.feature`'s only fixture-backed scenario bindable, but it recomputes bindings
   repo-wide and should land on its own.
2. **Two governance wiring gaps, not test gaps.** `SsrfSafeAnomalyAlertHttpAdapter` and
   `startSpendSpikeAnomalyWorker` have no callers anywhere in `apps/` or `packages/`. The whole
   spend-spike anomaly delivery path describes behaviour no process currently starts.
   **Closed** — see "Spend-spike anomaly wiring ledger" at the end of this file.


---

## Lane 5 ledger — 2026-09-03

All 352 unknown annotations were resolved except the seven that sit in files other
lanes hold open. The `352 unknown annotation(s)` line falls to seven, and every scenario
written to give an annotation a home was tagged and bound in the same pass, so the unbound
count fell rather than rose.

### Gate, before and after

```
before  Enforced: 1376 file(s) · Legacy: 15 file(s) · Inert: 380 file(s)
        FAIL: 4628 unbound scenario(s) in enforced files, 352 unknown annotation(s),
              17 file(s) enforce no scenario at all

after   Enforced: 1378 file(s) · Legacy: 15 file(s) · Inert: 367 file(s)
        FAIL: 4586 unbound scenario(s) in enforced files, 7 unknown annotation(s),
              5 file(s) enforce no scenario at all
```

Unbound fell by 42 — 29 in `analytics-lwql-workbench.feature` (5 of 34 bound before, 43 of 43
after) and 13 in `annotation-queue-workflow.feature` (1 of 15 before, 17 of 18 after). Enforced
files rose by two, which are this lane's two new spec files. The fatal-inert count moved for
reasons outside this lane as well: other lanes were landing in the same tree.

### Counts by cause and outcome

| Cause | Annotations | Repointed | Kept, scenario written or restored | Held by another lane |
| --- | --- | --- | --- | --- |
| **A1** `94b95128a0` — LWQL workbench collapsed 86 scenarios to 34 | 157 | 148 | 9 | — |
| **A2** `a380067e78` — annotation queue and list specs collapsed | 119 | 114 | 5 | — |
| **A3** `df4f775bd2` — LWQL granularity and run-by-chart-id contract | 13 | 2 | 9 | 2 |
| **A4** `e49da577ab` — work-conserving override counting | 9 | — | 9 | — |
| **A5** `d7c18dd45e` — eventing and group-queue package move | 6 | 4 | 2 | — |
| **B** — title never existed in any `.feature` | 48 | 1 | 42 | 5 |
| **Total** | **352** | **269** | **76** | **7** |

Fourteen of the A2 repoints landed on a title the same test already carried, so the now-duplicate
JSDoc line was deleted rather than left twice: 255 repointed annotations survive, 14 are gone,
76 keep their original title, 7 are untouched. Nothing was deleted because the behaviour was
dropped — every unknown annotation in this lane names behaviour a live test still asserts.

### The two big collapses: repointed, not deleted

A1 and A2 are the same shape. The `.feature` file moved into its owning package and was
rewritten narrower in the same commit, so several old scenarios fold into one new one. That is
the case the census said is fine to bind many-to-one, and it is what happened: 80 distinct LWQL
titles onto 34 scenarios, 85 annotation-UI titles onto 33 across two files. Ten broader scenarios
absorbed most of it — `Requests are manual, single-flight, and cancellation-safe` (11 tests),
`Chart mode preserves data and offers an accessible table fallback` (13),
`Reserved period parameters are filled only when declared` (13),
`Policy validates names, fields, transforms, and complexity` (7),
`Reviewing and explicitly selecting traces builds the dataset set` (11),
`An unavailable trace can be skipped or removed` (9).

Where the collapse dropped a clause outright and the test still proves it, the scenario was
written back rather than stretched onto a neighbour. Nine in LWQL and five in the annotation
files:

| Scenario written back | Where | Tests it binds |
| --- | --- | --- |
| `Named scalar parameters accompany the SQL without rewriting it` | `analytics-lwql-workbench.feature` | 3 — the parameter form validates the request shape, and nothing is sent while a row is unsendable |
| `The schema browser names the reserved period parameters where SQL is written` | same | 1 |
| `A period-aware statement run with no window names what is unset` | same | 1 — the resolver defers the declared names rather than refusing |
| `A reviewer who cannot update annotations is offered no correction` | `annotation-queue-workflow.feature` | 2 |
| `Picking another turn opens that turn's trace in the drawer` | same | 1 |
| `Messages arrive expanded so the whole output can be read` | same | 1 |
| `The header controls sit outside the sideways-scrolling region` | `annotations-list-selection.feature` | 1 |

### Three contracts a branch race deleted, restored

A3, A4 and A5's tail are not collapses. In each case a feature branch landed a contract and a
package-move branch, cut before it, deleted or rewrote the file it lived in. The merge kept the
move. The code shipped, the tests shipped, the spec sentences did not.

- **LWQL granularity resolution** (`df4f775bd2`, 13 annotations). The workbench-facing half
  survived into `packages/features/analytics/specs/analytics-lwql-workbench.feature`; the
  resolver's own half did not. A new `Rule: The declared granularity step is resolved, never
  invented` restores six scenarios there — the supplied step, the unfilled declaration that must
  not be invented, the non-`UInt32` declaration, the malformed step, the mistyped period bound at
  save, and the window no offered step can bucket. `A caller that supplies
  period_granularity_seconds itself is refused` was repointed instead, onto the surviving
  `Reserved parameter misuse is refused before execution`, which already names that case.
- **Running a saved chart by id** (same commit, 3 annotations). Restored into
  `specs/analytics/lwql-saved-charts.feature`, which had kept only the dashboard-widget half.
- **Work-conserving override counting** (`e49da577ab`, 9 annotations). The whole
  `Rule: An operator can tell whether the override is actually filling slots` was restored to
  `packages/group-queue/specs/work-conserving-fair-dispatch.feature`, and that file left
  `LEGACY_INERT` — it now enforces two scenarios, both bound, where before it enforced none.
- **Post-event work** (`d7c18dd45e`, 2 annotations). `A failing relevance guard never drops a
  side effect` reads as the opposite of the surviving `A failing relevance guard is reported as a
  publish failure`, and both are true: the publisher reports the loss, and the projection router,
  which dispatches after a fold has already committed, cannot report one and so must not create
  one. Both scenarios now stand, with a comment saying which path each names.
  `A registration keeps its queue identity across the vocabulary change` was restored beside it.
- The other four A5 annotations repointed cleanly: `packages/eventing/specs/subscriber-staging-cost.feature`
  had rewritten `a staged shape from a newer build is refused, never quietly completed` as
  `work a build cannot read fails loudly, never half-processed`, and `work queued before the
  relevance rule existed still reaches the same outcome` as `an event the subscriber declines is
  still completed quietly`.

### Cause B: the inverse gap

Forty-eight annotations named a title no `.feature` ever carried. One was drift (an Agents
service test naming an RPC scenario; repointed onto a new service-level scenario). Five are in
another lane's files. The remaining 42 are tests written ahead of any spec — overwhelmingly the
extraction-era composition tests — and every one of them proves live behaviour, so each got a
spec sentence rather than a deleted annotation.

| Where the scenarios were written | Scenarios | Annotations | What they say |
| --- | --- | --- | --- |
| `specs/worker/worker-capability-mount.feature` | 12 | 14 | The worker's tenancy graph is its own client's or nothing; one model gateway over that graph, or none, with each refusal naming its own precondition |
| `specs/server/api-process-trpc-record.feature` *(new)* | 7 | 7 | The tRPC collaborator record is complete or unmounted, answers on the root the process serves, and refuses by name for a capability the deployment did not compose |
| `packages/features/trace/specs/span-storage-read.feature` *(new)* | 5 | 8 | A referenced span is read back inside its own partition window, without the nested columns; a miss is a miss, a refusal is reported |
| `packages/design-system/specs/design-system-boundary.feature` | 4 | 4 | Column-type icons, and the overflow measurement that decides whether a collapsed cell expands |
| `packages/features/authz/specs/package-boundary.feature` | 2 | 2 | AuthZ composes with or without a metrics port, and counts through the port it was given |
| `packages/features/api-key/specs/api-key.feature`, `evaluation-service.feature` | 2 | 3 | The two transports moved without changing who may call them — the twin of the Role scenario the same tests were copied from |
| `packages/features/share/specs/share.feature` | 1 | 1 | An active share owns its pin annotation, so a manual unpin is refused |
| `specs/navigation/ops-navigation-v2.feature` | 1 | 1 | Settings and internal ops addresses resolve as a settings route with organization scope and no product |
| `specs/webhooks/webhook-settings-ui.feature` | 1 | 1 | A project resolving to no organization resolves no virtual-key names |
| `packages/features/agent/specs/package-boundary.feature` | 1 | 1 | A created agent is validated, persisted once, and returned with its fields resolved |

Fifty-three scenarios were written or restored in total, across 15 existing feature files and
two new ones. Every one is bound by the annotation that asked for it, so none of them adds to
the unbound count.

### The seven left

They are in files other lanes hold open, and each is a real gap for that lane rather than
something this one could bind:

| Annotation | File | Lane |
| --- | --- | --- |
| `A strict feature declares its layout version` (a one-word drift from `A strict feature declares the initial layout version`), `Central subjects make broad feature ownership explicit` | `packages/architecture-lint/tests/feature-package-boundaries.test.ts` | the `@unimplemented` architecture-spec lane |
| `audit rows are identical apart from metadata.surface` | `packages/enterprise/features/governance/server/src/app/__tests__/governance.app.unit.test.ts` | enterprise governance |
| `A moved family reports a failure through its host, not the toaster`, `A moved family does not carry a toaster of its own` | `apps/ui/src/model/errors/__tests__/no-raw-error-toasts.unit.test.ts` | error presentation |
| `The refusal names the reserved parameter the caller actually supplied` ×2 | `apps/ui/src/model/errors/__tests__/presentation.unit.test.ts` | error presentation |

The last pair is the closest to this lane's work — it is the client copy for the LWQL reserved
parameter refusal — and the granularity Rule restored above is where its scenario would sit if
that lane would rather bind than write one.

### One scenario still unbound where the lane touched

`annotation-queue-workflow.feature` reports 17 of 18 bound. `Queue mutations are limited to the
reviewer's reachable items` was unbound before this lane and stays unbound: no test in the
annotation package tries to finish or remove a teammate's item, and inventing a binding for it
was not this lane's work.

### Verification

Package suites, run one at a time, all green:

```
@langwatch/analytics-contract    21 files, 115 tests
@langwatch/analytics-server      30 files (1 skipped), 744 tests (8 skipped)
@langwatch/analytics-web         34 files, 274 tests
@langwatch/annotation-web        16 files, 200 tests
@langwatch/coding-agent-server   22 files, 289 tests
@langwatch/trace-web            234 files, 1836 tests
@langwatch/agent-server           5 files, 62 tests
```

`oxlint` on the touched files reports one pre-existing warning, an unused `url` binding in a
`langwatch-ql-workbench.integration.test.tsx` helper this lane never edited.

## Spend-spike anomaly wiring ledger — 2026-09-03

Closes finding 2 of the Lane 2 and 3 ledger: `SsrfSafeAnomalyAlertHttpAdapter` and
`startSpendSpikeAnomalyWorker` had zero callers in `apps/` or `packages/`, so
`governance.feature`'s "Anomaly delivery delegates network safety" described a delivery path no
process started.

### How the platform ran it

`platform/app/src/server/workers/startWorkers.ts` had a `bootSpendSpikeAnomalyWorker` that lazily
imported `@ee/governance/services/spendSpikeAnomalyWorker`, called `startSpendSpikeAnomalyWorker()`
and pushed the handle's `stop()` onto the process's shutdown list. It was a **scheduler** — a
`setTimeout` loop, five seconds to the first tick and five minutes between ticks — replacing the
deleted BullMQ `anomalyDetectionQueue`/`anomalyDetectionWorker` pair. It claimed no queue key then
and claims none now, so `apps/worker/src/features/job-registry.json` needed no entry and none was
added.

The platform's root also built the evaluator over `prisma` alone
(`SpendSpikeAnomalyEvaluator.create(prisma)`): no spend reader and no dispatcher. So a fired alert
recorded `detail.dispatch: "log_only"` and an admin who had configured a webhook was paged by
nothing. That, not the loop, is the half that was missing.

### What was composed

The evaluator rides the **`governance-events`** installer rather than declaring one of its own —
the arrangement the scheduled-report calendar already has on Automation's installer, and for the
same mechanical reason: `worker-feature-catalogue.unit.test.ts` requires every catalogue feature to
own at least one pipeline in the frozen registry, and a scheduler owns none.

```
WorkerProductionComposition.create
  └─ GovernanceEventsWorkerFeatureInstaller.create({ …, anomalySchedule })
       install()  → anomalySchedule.start()
       close()    → anomalySchedule.stop()

createWorkerGovernanceAnomalySchedule
  ├─ database                  the one Prisma client this process opened
  ├─ AppGovernanceKpisAdapter  the tenant-keyed ClickHouse client, the same
  │                            `governance_kpis` adapter the trace roll-up writes
  └─ SsrfSafeAnomalyAlertHttpAdapter
       └─ webhookUrlValidator(false)          the shared strict address policy
            └─ WorkerAnomalyAlertTransportPort
                 └─ FencedAnomalyAlertTransport  fetchValidatedDestination,
                                                 followRedirects: false,
                                                 TLS = deployment.saas
```

The address policy is `webhookUrlValidator(false)` — the one every customer-supplied webhook
destination in this process is judged by — rather than a second hand-rolled
`createSsrfUrlValidator` call. The escape hatch is not passed, on the same grounds the automations
channel never passes it.

### Absence leg deleted

`SpendSpikeAnomalyWorkerDependencies.spend` was optional. The evaluator's
`"Spend storage is not configured"` skip is the leg it fed, and a worker that took it would evaluate
every rule, skip every one and log a healthy tick — indistinguishable from a fleet where nothing
spikes. It is now required; the worker holds the ClickHouse client already. The inert
`reportFailure?` hook went with it: nothing passed it, this process has no error tracker, and the
log line is the whole record — the same call `WorkerGovernanceIngestionPullHost.capture` makes.

### Files

| File | Change |
| --- | --- |
| `apps/worker/src/app/worker-governance-anomaly.composition.ts` | new — the schedule, the transport port and the production fenced transport |
| `apps/worker/src/app/worker-production.composition.ts` | anchored — import, and `anomalySchedule:` on the governance-events installer |
| `apps/worker/src/features/governance/governance-events-worker-feature.installer.ts` | `anomalySchedule` started on install, stopped on close |
| `apps/worker/src/app/__tests__/worker-governance-anomaly.composition.unit.test.ts` | new — four tests |
| `packages/enterprise/composition/worker/src/governance/spend-spike-anomaly.worker.ts` | `spend` required, `reportFailure` deleted |
| `packages/enterprise/composition/worker/src/index.ts` | re-exports the scheduler beside the ingestion host |
| `packages/enterprise/features/governance/specs/governance.feature` | `@integration` on "Anomaly delivery delegates network safety" |

### Sabotage

Both mutations were applied, run and reverted.

| Mutation | Result |
| --- | --- |
| `webhookUrlValidator(false)` → `(true)` | ✗ `expected [ { hostname: '127.0.0.1', …(2) } ] to have a length of +0 but got 1` — the loopback destination reaches the transport |
| `anomalySchedule:` renamed off the installer call | ✗ `expected "vi.fn()" to be called 1 times, but got 0 times` — the production root starts no evaluator |

### Gate

```
apps/worker            vitest run src/app   36 files, 309 tests, green
apps/worker            typecheck            green (it checks tests too)
enterprise-worker      test / typecheck     3 tests, green
governance server      test / typecheck     593 passed, 14 skipped, green
oxlint (touched)       no new warning; 7 pre-existing unused imports in
                       worker-production.composition.ts, untouched by this lane
oxfmt --check          6 files, correct
check:feature-parity   packages/enterprise/features/governance/specs/governance.feature
                       11/11 scenarios bound, ✓ all bound (was 10/11 unbound-eligible)
```

The first `vitest run src/app` had `worker-capability-mount.composition.unit.test.ts` time out at
10 s on a cold 367 s run. It passes alone and passed on the 194 s re-run of the whole directory; it
is the load flake, not this change.

---

## Lane 6 ledger — 2026-09-03

Seventeen of the lane's eighteen files landed. The eighteenth,
`web-composition.feature`, is the file-level DECISION and was deliberately left
untagged — see "The decision, not taken" below. **75 scenarios newly bound**,
and every file this lane touched reports `✓ all bound`.

The lane's brief was the WRITE scenarios — behaviour live in the tree with no
test — plus the one RETIRE and the one DECISION. Where a lane-6 file also held
a scenario an existing test already covered near-verbatim, it was annotated in
the same pass rather than left as a second visit.

| Feature file | Scenarios bound | Tests carrying them |
| --- | --- | --- |
| `specs/agents/http-agent-trace-emission.feature` | 10 of 11 (10 new) | **new** `agent/server/src/transport/api-trpc/__tests__/agent-test-trace.builder.unit.test.ts` (7 its), **new** `.../__tests__/http-proxy-trace-gate.unit.test.ts` (4 its), plus 5 annotations on `.../__tests__/agent-test-tracing.unit.test.ts` |
| `specs/monitors/report-content.feature` | 8 of 9 (3 new) | `automation/web/src/features/slack-templates/__tests__/registry.unit.test.ts`, `automation/web/src/features/authoring/__tests__/slack-client.integration.test.tsx` |
| `specs/monitors/slack-bot-delivery.feature` | 6 of 7 (6 new) | **new** `automation/server/src/adapters/__tests__/slack-web-api.delivery.adapter.unit.test.ts` (4 its), **new** `.../__tests__/slack-provider.adapter.unit.test.ts` (6 its), plus annotations on `automation/contract/.../block-kit-allowlist.unit.test.ts`, `automation/web/.../template-picker.integration.test.tsx`, `.../slack-client.integration.test.tsx` |
| `specs/monitors/automation-alert-firing.feature` | 5 of 5 (5 new) | **new** `automation/server/src/adapters/__tests__/record-trigger-match.command.unit.test.ts` (3 its), plus 6 annotations on `analytics/server/src/services/__tests__/legacy-filter-matching.unit.test.ts` |
| `specs/model-providers/encrypt-custom-keys.feature` | 6 of 6 (5 new) | **new** `apps/api/src/tasks/model-provider-migrate/__tests__/model-provider-keys-migration.unit.test.ts` (4 its), plus annotations on `secret/server/.../aes-gcm.secret-encryption.adapter.unit.test.ts` and `model-provider/server/.../encrypted.model-provider-credential.adapter.unit.test.ts` |
| `specs/automations/automations-list.feature` | 2 of 10 (2 new) | **new** `automation/server/src/repositories/prisma/__tests__/prisma.trigger-fire-history.repository.unit.test.ts` (2 its), plus annotations on `automation/web/src/features/overview/__tests__/automation-history.unit.test.ts` |
| `specs/agents/workflow-agent-as-target.feature` | 1 of 5 (1 new) | **new** `experiment/web/src/ui/sections/experiments-v3/TargetSection/__tests__/target-header-workflow-icon.integration.test.tsx` (2 its) |
| `packages/features/log/specs/log-processing.feature` | 6 of 6 (6 new) | **new** `log/server/src/adapters/__tests__/record-canonical-log.command.unit.test.ts` (3 its), 1 new it in `log/server/src/services/__tests__/log-request-collection.service.unit.test.ts`, plus annotations on `canonical-log.integration.test.ts`, `clickhouse.log-processing.adapter.unit.test.ts`, `clickhouse.canonical-log-record.repository.unit.test.ts` |
| `packages/features/langy/specs/langy.feature` | 5 of 9 (5 new; S2 retired) | 3 new its in `langy/server/src/__tests__/langy.langy.adapter.unit.test.ts`, **new** `langy/server/src/app/__tests__/langy.app.flat-contract.unit.test.ts` (2 its), plus annotations on `langy-feedback-prompt.policy.unit.test.ts` and `langy.service.unit.test.ts` |
| `packages/features/gateway/specs/gateway-budget-service.feature` | 4 of 5 (4 new) | 2 new its in `gateway/server/src/services/__tests__/gateway-budget.service.unit.test.ts`, 2 new its in `.../prisma.gateway-cache-rule.repository.unit.test.ts`, 2 new its in `.../gateway.service.unit.test.ts`, plus an annotation on `gateway/contract/.../gateway.contract.unit.test.ts` |
| `packages/features/trace/specs/trace-read-service.feature` | 7 of 10 (7 new) | 1 new it in `trace/server/src/ports/__tests__/trace.service.unit.test.ts`, plus annotations there and on `trace/server/src/__tests__/trace.adapter.unit.test.ts` and `trace/web/src/ui/sections/__tests__/trace-find-bar.integration.test.tsx` |
| `packages/features/trace/specs/trace-query-language.feature` | 3 of 3 (3 new) | `trace/contract/.../trace-query-language.unit.test.ts`, `.../trace-query-evaluator-group.unit.test.ts`, `trace/server/src/ports/__tests__/trace.service.unit.test.ts` |
| `packages/features/scenario/specs/scenario-execution.feature` | 5 of 5 (5 new) | **new** `scenario/server/src/adapters/__tests__/scenario-child-otel-flush.unit.test.ts` (4 its), plus 10 annotations across the prefetcher, processor, job-data-schema, child-isolation and run-execution-process suites |
| `packages/features/experiment/specs/experiment-service.feature` | 5 of 6 (5 new) | 3 new its in `experiment/server/src/repositories/__tests__/experiment.service.unit.test.ts`, plus 4 annotations there |
| `packages/features/user/specs/user.feature` | 3 of 4 (2 new) | **new** `user/server/src/transport/api-trpc/__tests__/user-deactivation.unit.test.ts` (1 it), plus annotations on `user/server/src/ports/__tests__/user.service.unit.test.ts` |
| `packages/enterprise/features/billing/specs/billing.feature` | 3 of 3 (3 new) | **new** `billing/web/src/__tests__/browser-pricing-boundary.unit.test.ts` (4 its), plus annotations on `planProvider.unit.test.ts` and `reportUsageForMonth.command.unit.test.ts` |
| `packages/enterprise/features/managed-provider/specs/managed-providers.feature` | 3 of 3 (3 new) | **new** `managed-provider/server/src/adapters/__tests__/aws-sts.aws-sts.adapter.unit.test.ts` (2 its), 2 new its in `.../__tests__/managed-provider.service.unit.test.ts` |
| `packages/enterprise/composition/web/specs/web-composition.feature` | **decision, not bound** | — |

Thirteen new test files, sixty-one new `it()`s, and forty-eight `@scenario`
annotations on tests that already covered their scenario.

### Gate, before and after

```
before  Enforced: 1376 file(s) · Legacy: 15 file(s) · Inert: 380 file(s)
        FAIL: 4628 unbound scenario(s) in enforced files, 352 unknown annotation(s),
              17 file(s) enforce no scenario at all

after   Enforced: 1378 file(s) · Legacy: 15 file(s) · Inert: 364 file(s)
        FAIL: 4586 unbound scenario(s) in enforced files, 7 unknown annotation(s),
              2 file(s) enforce no scenario at all
```

Fifteen fatal-inert files cleared by this lane. The two that remain are
`web-composition.feature` (this lane's DECISION, below) and
`gateway-realtime-session-reconciliation.feature`, which lane 1 skipped and
which is not this lane's. The unknown-annotation collapse from 352 to 7 is
lane 5 landing in the same tree, not this lane — none of the seven that remain
name a test this lane touched, and every `@scenario` written here names a title
the checker resolved.

### The retire

`packages/features/langy/specs/langy.feature` scenario 2, *"relay preserves the
event wire contract"*, is **deleted**. Its Then — "the frame is handed to the
relay repository unchanged" — names two things removed together in
`c4ded22900`: the `abstract relay(frame)` member and
`packages/features/langy/server/src/repositories/langy.repository.ts` (the whole
45-line file). `git log -S "abstract relay(" -- packages/features/langy` returns
only `3f986b6225` (introduction) and `c4ded22900` (removal), and
`packages/features/langy/contract/src/langy.service.ts:220-226` documents the
removal by name. The surviving relay is `LangyService.openRelayConnection()`,
whose `LangyRelayConnection.handle(raw)` **routes** frames to buffers and
durable commands rather than forwarding them unchanged — a different behaviour,
already covered by `langyTurnRelay.unit.test.ts` and the contract's
`it("rejects unknown relay fields at the wire boundary")`. Rewording the
scenario to describe routing would have duplicated those; deleting it is
honest.

### The decision, not taken

`@langwatch/enterprise-web` **has no dependents**, verified two ways:

- `grep -rn '"@langwatch/enterprise-web"' --include=package.json .` matches only
  the package's own `name` field at
  `packages/enterprise/composition/web/package.json:2`. Every other hit of
  `grep -rn "enterprise-web" --include=package.json` is
  `@langwatch/enterprise-web**hook**-{contract,server}`, a different package.
- `EnterpriseWebComposition` is imported by exactly one file in the repository:
  its own test, `packages/enterprise/composition/web/tests/web-composition.unit.test.ts`.

Both readings, recorded rather than decided:

**Retire it.** Nothing composes it. `apps/ui` never builds an
`EnterpriseWebComposition`, so the class is a shell whose only caller is its own
test, and binding its two scenarios ratifies dead code. The whole package is
seven files: `src/index.ts` (23 lines), a spec, a test, an ADR, a manifest and a
tsconfig.

**Keep it.** `packages/architecture-lint/src/workspace.ts:34` lists
`{ role: "web", name: "@langwatch/enterprise-web" }` in
`ENTERPRISE_COMPOSITION_PACKAGES` — the api/worker/web triad the lint enforces —
and `packages/architecture-lint/tests/application-workspace-boundaries.test.ts:79,256`
names it in fixtures. Deleting the package changes a lint invariant and two
architecture fixtures, not just seven files. Its own ADR
(`composition/web/adrs/001-web-composition-boundary.md`) says the shell is
deliberately React-free: it is the reserved seat `apps/ui` composes when the
first Enterprise web feature ships, and the two scenarios describe the seat's
contract rather than code in use.

Deciding needs the answer to a question outside this lane: is an Enterprise web
feature planned? Until then the file stays fatal-inert on purpose, which is a
louder marker than `LEGACY_INERT` would be.

### The three defects, re-checked

Two were already fixed before this lane started, as the brief said; both were
verified against the tree rather than taken on trust, and the census text above
is now wrong on both counts:

1. **"Scheduled reports cannot fire on this branch" — FALSE, and it was false
   when written.** `dispatchScheduledReport` is called at
   `apps/worker/src/app/worker-report-schedule.composition.ts:331`
   (`handler: (fire) => dispatchScheduledReport({ deps, fire })`, imported at
   `:13`); `ReportScheduleService.create` is at `:283`, `loadReportCharts` at
   `:297-298`, and `createWorkerReportSchedule` is mounted from
   `apps/worker/src/app/worker-production.composition.ts:1113`. Only
   `reportWindowMs` is genuinely unreferenced outside the service, and it is an
   internal helper at `report-dispatch.service.ts:101`, not the firing path.
   `report-content.feature`'s five `@unit` scenarios were already bound to
   `report-dispatch.service.unit.test.ts`, which is why the file never appeared
   on the fatal list.
2. **"`encrypt-custom-keys` repository invariant violated" — FALSE, already
   remediated.** `apps/api/src/app/api-trpc-collaborators.product.composition.ts:819-820`
   now reads through `this.modelProviders.hasEnabledProvider({ projectId })` on
   `ApiModelProviderEvidencePort`; the `findFirst` lives inside
   `packages/features/model-provider/server/src/repositories/prisma/prisma.model-provider-evidence.repository.ts:42`
   with `select: { id: true }` — an identifier, never a credential — and honours
   the org-scope cascade at `:45`. No `prisma.modelProvider.*` call remains in
   `apps/api` outside the migration task itself. Scenario 6 was already bound at
   `apps/api/src/app/__tests__/api-trpc-collaborators.product.integration.test.ts:829`.
3. `governance.feature` S2's inverted `feature.json` claim belongs to the
   sibling lane and was not touched here.

### A defect this lane found

**`http-agent-trace-emission.feature` scenario 4 describes behaviour that does
not exist.** *"Invalid JSON body creates a trace … the error message indicates
invalid JSON"* has no implementation anywhere:
`buildHttpNodeParameters` (`packages/features/agent/contract/src/http-node.ts:14-60`)
does not validate the template, and the Go engine codes refused destinations and
endpoint answers, not a body parse
(`services/nlpgo/app/engine/http_node_errors_test.go`). It is the one scenario in
that file left untagged. It is a WRITE for the *product*, not for a test: either
the executor learns to name an unrenderable body, or the scenario goes.

### Where a test was tightened rather than trusted

Six scenarios named a clause the matching test did not assert. Each was closed
with the smallest honest assertion:

- **log** — "each accepted record has a deterministic 64-hex record ID" asserted
  only determinism. `canonical-log.integration.test.ts` now pins
  `/^[0-9a-f]{64}$/` as well.
- **encrypt-custom-keys** — "the encrypted string is not valid JSON" was
  asserted nowhere. The AES-GCM suite now encrypts a real `customKeys` object
  and requires `JSON.parse` of the stored value to throw, so a reader still
  expecting the legacy plaintext column fails loudly rather than half-succeeding.
- **gateway** — "its row mutation, Gateway change event, and audit record use
  one persistence transaction" was proven for archive only. Create and update
  now assert the same `inTransaction: true` triple.
- **trace** — "a trace read is tenant scoped" had no test that ever passed a
  foreign tenant; the existing fake *asserted* `tenantId === "project_1"`
  instead of exercising a mismatch. A tenant-keyed repository now answers
  `project_2` with an empty page and a null cursor, and records which tenant the
  read was scoped by.
- **automations-list** — "history never exposes trace content" was true only by
  reading `mapFire`. The repository suite now drives both read paths over a row
  that carries `traceId: "trace_secret_1"` and requires the mapped view to hold
  neither the property nor the string.
- **slack** — "the token is stored encrypted, never in plaintext" needed a
  cipher double that does not spell its own input. The stand-in hex-encodes, so
  the assertion that the plaintext is absent from the persisted row cannot pass
  on a fake that still contains it.

The billing browser-boundary guard was checked the same way, by making it fail:
a throwaway `src/model/__sabotage.ts` importing `stripe` turned the suite red
with `src/model/__sabotage.ts imports stripe`, and was removed.

### Left untagged on purpose

| Scenario | Why |
| --- | --- |
| `http-agent-trace-emission` 4 (invalid JSON body) | No implementation. See "A defect this lane found". |
| `workflow-agent-as-target` 1, 3, 4, 5 | 1 needs `runsAsWorkflow` / `getLoadedDataForTarget`, both unexported locals inside `runOrchestrator`; 4's execution half needs `buildTargetInputs`, also unexported. 3's drawer lives in `scenario/web`, not `experiment/web`, and its "Open Workflow" affordance has no such literal text — it is `data-testid="open-workflow-link"`, so the spec sentence needs amending before a test can honestly key on it. 5's `handleSwitchTarget` / `addOrReplaceTarget` are unexported members of `evaluations-v3-table.tsx`. Each is a refactor before it is a test. |
| `automations-list` 1-6, 10 | Seven React cell components (`ReportRunCells`, `LastFiredCell`, `FiringStatus`, `EmptyHint`) that need a Chakra `Table` harness. Straightforward, but it is a rendering lane rather than a WRITE lane, and the file is no longer fatal. |
| `automations-list` 7 (recent activity across everything) | `toAutomationActivityEntries` is covered, but the day grouping the scenario names lives inside the `AutomationHistory` component and needs a render. |
| `report-content` 9 (preview renders against report data) | `previewContext` is inline in `automation-drawer.tsx:513-522` and not exported; a test either renders the whole drawer or the code needs an extraction first. |
| `slack-bot-delivery` 7 (guided to create a Slack app) | The link, the manifest copy and the two scopes are rendered by `slack.client.tsx:876-911`; the only test near it asserts the manifest shape, not the guidance the author reads. |
| `langy` 3 (owns its subordinate subjects) | An ownership claim no test or lint expresses — `specs/dependencies/singular-feature-ownership.feature`'s Examples table does not list langy. |
| `langy` 6, 7, 8 | Each ends with a clause asserting something "remains in the application" that no longer does: the tool-narrator adapter, the capability hydrators, the SPA-link builder and `buildSurfaceHref`/`buildResourceHref` have all moved **into** `langy/web`. What genuinely remains in `apps/ui` is routing and the host adapter. Reword before tagging — this is the census's "five scenarios describe code that moved", and it is three of them. |
| `gateway-budget-service` 3 (the process owns one budget decision service) | Its "API, CLI, and Gateway routes" clause is false today: `apps/api/src/app/api-production.composition.ts:2300` passes `budgets: undefined`, so `governance-cli.api.ts:466-467` short-circuits to `{ok:true}` and the CLI leg holds no service at all. Binding it as written would assert a wiring the tree does not have. |
| `trace-read-service` 6 (full compatibility routes wait for complete characterization) | The Then names `platform/`, which is gone; all four route families now live in `trace/server/src/transport/**` after `a98cfaf487`, and the owning ADR (`trace/adrs/001-trace-read-boundary.md:86-92`) is stale in the same way. Amend the spec and the ADR together. |
| `trace-read-service` 7 (storage vs projected summary distinctions) | Thens 1-3 are covered by `trace-legacy-summary-mapping.service.unit.test.ts:232`; Then 4 — no substitution among `trace_summaries` / `trace_analytics` / timeseries — is asserted only incidentally. A per-read table-isolation test is the missing piece. |
| `trace-read-service` 9 (browser presentation stays transport-neutral) | The toolkit is covered; the two negative Thens ("does not fetch, authorize, or reshape") are architecture claims whose only enforcement is the repo-wide `feature-package-boundaries` lint, held by another lane. |
| `experiment-service` 6 (batch-result presentation) | Needs rewording, and the census hint is confirmed: `apps/ui/src/features/experiments/index.ts:10-15` states the family has "NO API BINDING OF ITS OWN, and that absence is the design", and `grep refetchInterval\|poll apps/ui/src/features/experiments` returns nothing — polling moved into `experiment/web`. The sentence "the app keeps … polling" is false. |
| `user` 2 (changing an email refreshes authenticated identity) | Its second clause, "browser sessions are revoked", has **no code path**. `UserService.updateProfile` normalizes the address and stops; every `revokeOtherBrowserSessions` call in `user.api.ts` (`:679`, `:762`, `:793`) is on a credential or password flow. Either the email change learns to revoke, or the clause goes — not a binding either way. |
| `web-composition` 1-2 | The DECISION. See above. |

### Riders bound without their own assertion

Four scenarios carry a clause the test cannot express, and were bound on the
behaviour the test does prove. Named here so nobody mistakes the binding for
coverage:

- `log-processing` 3 — "the retry can persist the record without creating a
  second logical record". What is proven is that the retry mints an identical
  tenant-scoped idempotency key, which is the mechanism the eventing dedup
  relies on; the dedup itself is `@langwatch/eventing`'s, not Log's.
- `langy` 1 — "a public or internal adapter handles a Langy request". The
  adapter's memoization and `LangyApp.langyService` identity are proven; that
  the two REST doors and the tRPC router reach that same instance is an
  `apps/api` composition claim, in another lane's file.
- `langy` 5 — "it does not reach through a subordinate capability property".
  Proven twice over: the built service's prototype surface names none of
  `conversations` / `turns` / `messages` / `credentials`, and `LangyApp`'s
  forwarders are driven through a Proxy that would record such a hop. The
  subordinate repositories remain reachable at runtime as TypeScript-private
  instance fields — privacy there is compile-time, and no test can assert it.
- `automations-list` 9 — "gated by a weaker permission than trace content". The
  mapped row is proven to carry no trace id; the permission comparison itself is
  a route-level claim (`automation.api.ts:576` `policy("triggers:view")`).

### Package suites run

Each touched package's own script, one at a time, all green:
`enterprise-managed-provider-server`, `enterprise-billing-server`,
`enterprise-billing-web`, `log-server`, `langy-server`, `agent-server`,
`trace-contract`, `trace-server`, `trace-web`, `experiment-server`,
`experiment-web`, `analytics-server`, `automation-contract`,
`automation-server`, `automation-web`, `secret-server`,
`model-provider-server`, `gateway-contract`, `gateway-server`, `user-server`,
and the new `apps/api` task suite.

`scenario-server` is the one exception: `cancellation-channel.integration.test.ts`
and `scenario-tab-registry.integration.test.ts` both fail with their own
environment guards — "Scenario cancellation integration tests require Redis" and
"These tests need a real Redis; run them through the integration suite". Neither
file was touched by this lane; the other 63 files and all 827 tests pass.
