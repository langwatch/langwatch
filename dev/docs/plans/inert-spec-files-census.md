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
