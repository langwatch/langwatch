# Architecture Decision Records

67 records. Generated from the files themselves — every ADR in this
directory appears here, because an index that covers half of them sends readers
to `ls` instead.

## ⚠️ Numbers used more than once

A bare citation like "ADR-030" does not resolve to one document. When citing
any of these, link the path. 14 numbers are reused:

| # | Documents |
|---|---|
| 006 | [`006-redis-cluster-bullmq-hash-tags.md`](./006-redis-cluster-bullmq-hash-tags.md)<br>[`006-worker-architecture.md`](./006-worker-architecture.md) |
| 010 | [`010-e2e-testing-strategy.md`](./010-e2e-testing-strategy.md)<br>[`010-scenario-orphaned-run-reconciliation.md`](./010-scenario-orphaned-run-reconciliation.md) |
| 014 | [`014-prompt-labels-data-model.md`](./014-prompt-labels-data-model.md)<br>[`014-skynet-bullmq-removal.md`](./014-skynet-bullmq-removal.md) |
| 018 | [`018-form-validation-and-save.md`](./018-form-validation-and-save.md)<br>[`018-governance-unified-observability-substrate.md`](./018-governance-unified-observability-substrate.md) |
| 021 | [`021-lean-fold-cache.md`](./021-lean-fold-cache.md)<br>[`021-multi-scope-targeting-and-tenancy.md`](./021-multi-scope-targeting-and-tenancy.md) |
| 022 | [`022-data-retention.md`](./022-data-retention.md)<br>[`022-event-log-source-of-truth.md`](./022-event-log-source-of-truth.md) |
| 026 | [`026-groupqueue-payload-envelope.md`](./026-groupqueue-payload-envelope.md)<br>[`026-per-trigger-dispatch-timing.md`](./026-per-trigger-dispatch-timing.md)<br>[`026-reactor-should-react-predicate.md`](./026-reactor-should-react-predicate.md) |
| 027 | [`027-trace-drawer-code-highlighting.md`](./027-trace-drawer-code-highlighting.md)<br>[`027-typed-dispatcherror-contract.md`](./027-typed-dispatcherror-contract.md) |
| 028 | [`028-trace-facet-sidebar-presentation-and-perspectives.md`](./028-trace-facet-sidebar-presentation-and-perspectives.md)<br>[`028-visibility-blur-teaser-redaction.md`](./028-visibility-blur-teaser-redaction.md) |
| 029 | [`029-groupqueue-content-addressed-payload-store.md`](./029-groupqueue-content-addressed-payload-store.md)<br>[`029-trace-table-per-evaluator-columns.md`](./029-trace-table-per-evaluator-columns.md) |
| 030 | [`030-groupqueue-blob-handling-hardening.md`](./030-groupqueue-blob-handling-hardening.md)<br>[`030-transactional-outbox-for-stake-sensitive-dispatch.md`](./030-transactional-outbox-for-stake-sensitive-dispatch.md) |
| 040 | [`040-durable-stored-object-offload-for-evaluation-inputs.md`](./040-durable-stored-object-offload-for-evaluation-inputs.md)<br>[`040-webhook-http-request-automation-channel.md`](./040-webhook-http-request-automation-channel.md) |
| 043 | [`043-automation-facet-model.md`](./043-automation-facet-model.md)<br>[`043-langy-egress-enforcement.md`](./043-langy-egress-enforcement.md) |
| 048 | [`048-langy-dual-stream.md`](./048-langy-dual-stream.md)<br>[`048-langy-shutdown-handoff.md`](./048-langy-shutdown-handoff.md) |

## All records

| # | Record | Status |
|---|---|---|
| 001 | [RBAC with Organization → Team → Project Hierarchy](./001-rbac.md) | Accepted |
| 002 | [Event Sourcing for Traces and Evaluations](./002-event-sourcing.md) | Superseded by ADR-007 |
| 003 | [Logging and Tracing Infrastructure](./003-logging.md) | — |
| 004 | [Docker Compose Development Environment](./004-docker-dev-environment.md) | Accepted |
| 005 | [Feature Flags (registry, postgres, PostHog)](./005-feature-flags.md) | Accepted |
| 006 ⚠️ | [Redis Cluster Hash Tags for BullMQ Queue Names](./006-redis-cluster-bullmq-hash-tags.md) | Accepted |
| 006 ⚠️ | [Single Entry Point Worker Architecture](./006-worker-architecture.md) | Accepted |
| 007 | [Event Sourcing Architecture](./007-event-sourcing-architecture.md) | Accepted in outline; several decisions below a |
| 008 | [Extensible Metadata on Scenario Events](./008-extensible-metadata-on-scenario-events.md) | Accepted |
| 009 | [OTEL Trace Context Propagation for HTTP Scenario Targets](./009-otel-trace-context-propagation-for-http-scenarios.md) | Accepted |
| 010 ⚠️ | [E2E Testing Strategy — Browser Verification Over Generated Tests](./010-e2e-testing-strategy.md) | Accepted |
| 010 ⚠️ | [Scenario Orphaned-Run Reconciliation](./010-scenario-orphaned-run-reconciliation.md) | Accepted |
| 011 | [Internal Set ID Naming Convention](./011-internal-set-id-naming-convention.md) | Accepted |
| 012 | [Skills Information Architecture and Feature Map](./012-skills-information-architecture.md) | Accepted |
| 013 | [Workflow-Based Onboarding with Skills and Recipes](./013-workflow-based-onboarding.md) | Accepted |
| 014 ⚠️ | [Prompt Labels Data Model](./014-prompt-labels-data-model.md) | Accepted |
| 014 ⚠️ | [Remove BullMQ dependency and queue browser from Skynet](./014-skynet-bullmq-removal.md) | Accepted |
| 015 | [Projection Replay Coordination Protocol](./015-projection-replay-coordination.md) | Accepted |
| 016 | [Scoped Model Providers & Default Models](./016-scoped-model-providers.md) | Accepted |
| 017 | [Gateway Trace Payload Capture](./017-gateway-trace-payload-capture.md) | Accepted |
| 018 ⚠️ | [Form Validation and Save Button Behavior](./018-form-validation-and-save.md) | Accepted |
| 018 ⚠️ | [Governance ingestion uses the unified observability substrate](./018-governance-unified-observability-substrate.md) | Accepted |
| 019 | [Repository-service layering for project configuration access](./019-repository-service-layering.md) | Accepted |
| 020 | [020-cascading-default-models.md](./020-cascading-default-models.md) | Accepted |
| 021 ⚠️ | [Lean Fold Cache — cache the read-set, persist the write-set](./021-lean-fold-cache.md) | Proposed |
| 021 ⚠️ | [Multi-scope targeting and single-organization tenancy enforcement](./021-multi-scope-targeting-and-tenancy.md) | Accepted |
| 022 ⚠️ | [Per-tenant per-category data retention enforced by ClickHouse-native TTL](./022-data-retention.md) | Accepted |
| 022 ⚠️ | [event_log as single source of truth · S3 as transient spool only](./022-event-log-source-of-truth.md) | Proposed |
| 023 | [Reactor-seeded self-perpetuating chain for retention orphan sweep](./023-orphan-sweep-reactor-chain.md) | Superseded by ADR-025 |
| 024 | [Cold-path tiered storage for retention-managed tables](./024-cold-path-tiered-storage.md) | Accepted |
| 025 | [Remove the PG orphan sweep entirely](./025-remove-orphan-sweep.md) | Accepted |
| 026 ⚠️ | [GroupQueue payload envelope — opaque compressed payloads with a routing header](./026-groupqueue-payload-envelope.md) | Accepted |
| 026 ⚠️ | [Per-trigger dispatch timing — cadence and trace-readiness debounce](./026-per-trigger-dispatch-timing.md) | Accepted, amended by ADR-052 |
| 026 ⚠️ | [Pure `shouldReact` predicate gates reactor enqueue](./026-reactor-should-react-predicate.md) | Accepted |
| 027 ⚠️ | [Trace drawer code highlighting — lazy on-demand Shiki language loading](./027-trace-drawer-code-highlighting.md) | Accepted |
| 027 ⚠️ | [Typed `DispatchError` contract for dispatch endpoints](./027-typed-dispatcherror-contract.md) | Accepted |
| 028 ⚠️ | [Trace facet sidebar — numeric presentation modes and facet perspectives](./028-trace-facet-sidebar-presentation-and-perspectives.md) | Proposed |
| 028 ⚠️ | [Plan-based visibility windows via stateless service-layer teaser redaction](./028-visibility-blur-teaser-redaction.md) | Proposed |
| 029 ⚠️ | [GroupQueue content-addressed tiered payload store — flat jobs, fan-out dedup, holder-set reclaim](./029-groupqueue-content-addressed-payload-store.md) | Proposed |
| 029 ⚠️ | [Trace table per-evaluator eval columns](./029-trace-table-per-evaluator-columns.md) | Proposed |
| 030 ⚠️ | [GroupQueue blob-handling hardening](./030-groupqueue-blob-handling-hardening.md) | Proposed |
| 030 ⚠️ | [Transactional outbox for stake-sensitive reactor dispatch](./030-transactional-outbox-for-stake-sensitive-dispatch.md) | Superseded by ADR-052 |
| 031 | [Trigger email abuse protections — test-fire lockdown, hourly cap, unsubscribe](./031-trigger-email-abuse-protections.md) | Accepted |
| 032 | [Dataset content moves to S3 as chunked JSONL, with direct upload and an async normalize job](./032-datasets-s3-jsonl.md) | Accepted |
| 033 | [Langy worker network isolation under gVisor](./033-langy-worker-network-isolation-under-gvisor.md) | Draft |
| 034 | [Event-Sourced Analytics Materialization](./034-event-sourced-analytics-materialization.md) | Accepted |
| 035 | [Persist-class actions ride the settle stage (trace-readiness debounce)](./035-persist-class-debounce.md) | Accepted |
| 036 | [Liquid templates for user-customizable trigger notifications](./036-liquid-templates-for-trigger-notifications.md) | Accepted |
| 037 | [Automation operator surfaces — authoring drawer & dispatch-health view](./037-automation-operator-surfaces.md) | Accepted |
| 038 | [Onboarding forks on a first-class Organization intent — Agent Governance lands /me, LLMOps lands the project — and governance GA is a routing non-event for legacy orgs](./038-intent-forked-onboarding-governance-vs-llmops.md) | Accepted |
| 039 | [Outbox heartbeat primitive](./039-outbox-heartbeat.md) | Accepted |
| 040 ⚠️ | [durable stored-object offload for evaluation inputs](./040-durable-stored-object-offload-for-evaluation-inputs.md) | Proposed |
| 040 ⚠️ | [Webhook (generic HTTP request) automation channel](./040-webhook-http-request-automation-channel.md) | Proposed |
| 041 | [Modern Block Kit notification template suite for trace automations and graph alerts](./041-modern-block-kit-notification-template-suite.md) | Proposed |
| 042 | [Local observability stack (logs, traces, metrics → Grafana)](./042-local-observability-stack.md) | Accepted |
| 043 ⚠️ | [Automations as orthogonal facets (name / type / subject / cadence / severity / delivery)](./043-automation-facet-model.md) | — |
| 043 ⚠️ | [Langy egress enforcement — monitor first, enforce last](./043-langy-egress-enforcement.md) | Draft |
| 044 | [Scheduled reports — a schedule-triggered automation kind](./044-scheduled-reports-automation-kind.md) | Proposed |
| 045 | [Handled errors as the handled-error boundary (TS `HandledError` ⇔ Go `herr`)](./045-domain-errors-handled-boundary.md) | Accepted |
| 046 | [Event-sourced Langy conversations](./046-event-sourced-langy-conversations.md) | Superseded by ADR-049 for operational projecti |
| 047 | [Langy Foundations — hexagonal Go service, caller-scoped session key, deploy hardening](./047-langy-foundations.md) | Accepted |
| 048 ⚠️ | [Langy dual-stream — raw token fast-path (Stream B) alongside the durable event-sourced stream (Stream A)](./048-langy-dual-stream.md) | Accepted |
| 048 ⚠️ | [Langy worker shutdown-handoff — checkpoint on SIGTERM, resume on the next worker](./048-langy-shutdown-handoff.md) | Proposed |
| 049 | [Langy pilots Postgres operational state and projection-independent reactions](./049-langy-projection-independent-reactions.md) | Accepted |
| 050 | [Langy's prompts in the versioned prompt registry + dogfood scenarios/evals](./050-langy-versioned-prompts-and-dogfood-evals.md) | Proposed |
| 052 | [Automations on a dedicated process-manager pipeline](./052-automations-on-process-manager-substrate.md) | Accepted |
| 053 | [Consolidated event-sourcing invariants](./053-event-sourcing-consolidated-invariants.md) | Draft |

---

⚠️ marks a number shared with another record.

New records take the next free number — check this table first.
