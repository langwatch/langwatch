# Architecture Decision Records (ADRs)

Document **important technical and architectural decisions** — context, trade-offs, and consequences.

Reusable framework decisions live with their packages:

- [Eventing decisions](../../../packages/eventing/adrs/README.md)
- [Group Queue decisions](../../../packages/group-queue/adrs/README.md)
- [API decisions](../../../packages/api/adrs/README.md)

## Decisions

| #                                                                      | Decision                                                                                                                  | Status                    |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| [001](./001-rbac.md)                                                   | RBAC with Org → Team → Project hierarchy                                                                                  | Accepted                  |
| [003](./003-logging.md)                                                | Logging and tracing infrastructure                                                                                        | Accepted                  |
| [004](./004-docker-dev-environment.md)                                 | Docker dev environment with Make targets                                                                                  | Accepted                  |
| [005](./005-feature-flags.md)                                          | Feature flags via PostHog                                                                                                 | Superseded                |
| [018](./018-form-validation-and-save.md)                               | Form validation and Save button behavior                                                                                  | Accepted                  |
| [021](./021-multi-scope-targeting-and-tenancy.md)                      | Multi-scope targeting and single-org tenancy enforcement                                                                  | Accepted                  |
| [022](./022-data-retention.md)                                         | Per-tenant per-category data retention enforced by ClickHouse-native TTL                                                  | Accepted                  |
| [024](./024-cold-path-tiered-storage.md)                               | Cold-path tiered storage for retention-managed tables                                                                     | Accepted                  |
| [025](./025-remove-orphan-sweep.md)                                    | Remove the PG orphan sweep entirely                                                                                       | Accepted                  |
| [026](./026-per-trigger-dispatch-timing.md)                            | Per-trigger dispatch timing — cadence and trace-readiness debounce                                                        | Accepted                  |
| [027](./027-typed-dispatcherror-contract.md)                           | Typed `DispatchError` contract for dispatch endpoints                                                                     | Accepted                  |
| [031](./031-trigger-email-abuse-protections.md)                        | Trigger email abuse protections — per-trigger cap, per-project daily cap, unsubscribe                                     | Accepted                  |
| [032](./032-datasets-s3-jsonl.md)                                      | Datasets stored as S3 JSONL chunks                                                                                        | Accepted                  |
| [033](./033-langy-worker-network-isolation-under-gvisor.md)            | Langy worker network isolation under gVisor                                                                               | Draft                     |
| [034](./034-event-sourced-analytics-materialization.md)                | Event-sourced analytics materialization — slim + rollup ClickHouse tables                                                 | Accepted                  |
| [035](./035-persist-class-debounce.md)                                 | Persist-class actions ride the settle → cadence outbox path                                                               | Accepted                  |
| [036](./036-liquid-templates-for-trigger-notifications.md)             | Liquid templates for user-customizable trigger notifications                                                              | Accepted                  |
| [037](./037-automation-operator-surfaces.md)                           | Automation operator surfaces — authoring drawer & dispatch-health view                                                    | Accepted                  |
| [038](./038-intent-forked-onboarding-governance-vs-llmops.md)          | Onboarding forks on a first-class Organization intent                                                                     | Accepted                  |
| [040](./040-webhook-http-request-automation-channel.md)                | Webhook (generic HTTP request) automation channel                                                                         | Proposed                  |
| [041](./041-modern-block-kit-notification-template-suite.md)           | Modern Block Kit notification template suite                                                                              | Proposed                  |
| [042](./042-local-observability-stack.md)                              | Local observability stack (logs, traces, metrics → Grafana)                                                               | Accepted                  |
| [043](./043-automation-facet-model.md)                                 | Automations as orthogonal facets (name / type / subject / cadence / severity / delivery)                                  | Proposed                  |
| [044](./044-scheduled-reports-automation-kind.md)                      | Scheduled reports — a schedule-triggered automation kind + generic event-sourcing scheduler                               | Proposed                  |
| [045](./045-domain-errors-handled-boundary.md)                         | Handled errors as the handled-error boundary (TS `HandledError` ⇔ Go `herr`)                                              | Accepted                  |
| [046](./046-event-sourced-langy-conversations.md)                      | Event-sourced Langy conversations                                                                                         | Superseded in part by 049 |
| [047](./047-langy-foundations.md)                                      | Langy foundations — hexagonal Go service, caller-scoped sessions                                                          | Accepted                  |
| [048](./048-langy-shutdown-handoff.md)                                 | Langy worker shutdown-handoff — checkpoint on SIGTERM, resume on the next worker                                          | Proposed                  |
| [049](./049-langy-projection-independent-reactions.md)                 | Langy pilots projection-independent reactions                                                                             | Accepted                  |
| [050](./050-langy-versioned-prompts-and-dogfood-evals.md)              | Langy's prompts in the versioned prompt registry + dogfood scenarios/evals                                                | Proposed                  |
| [053](./053-tenant-aware-egress-and-workload-isolation.md)             | Tenant-aware egress and per-workload sandbox isolation                                                                    | Proposed                  |
| [057](./057-token-gated-trace-sharing.md)                              | Token-gated trace sharing (ShareLink)                                                                                     | Accepted                  |
| [058](./058-full-stack-trace-correlation-browser-rum.md)               | Full-stack trace correlation — browser RUM into the internal trace                                                        | Draft                     |
| [059](./059-event-sourced-langy-frontend.md)                           | Event-sourced Langy frontend — shared projections in `packages/langy`                                                     | Accepted                  |
| [060](./060-langy-model-emitted-blocks.md)                             | The model's in-stream data channel — derived cards and choice questions                                                   | Accepted                  |
| [061](./061-langy-trace-dual-export.md)                                | Langy turns export twice — the customer's trace, and ours                                                                 | Accepted                  |
| [068](./068-windowed-clickhouse-reads.md)                              | One windowed ClickHouse read with a measured fallback (`queryWindowed`)                                                   | Accepted                  |
| [070](./070-modular-package-architecture.md)                           | Packages enforce bounded contexts and one-way runtime dependencies                                                        | Accepted                  |
| [071](./071-coding-agent-session-immutable-storage-anchor.md)          | A storage anchor is immutable and platform-assigned — take the moving column out of the dedup scope                       | Accepted                  |
| [076](./076-langy-egress-enforcement.md)                               | Langy egress enforcement — monitor first, enforce last (implemented)                                                      | Accepted                  |
| [077](./077-langy-dual-stream.md)                                      | Langy dual-stream — raw token fast-path alongside the durable event-sourced stream                                        | Accepted                  |
| [078](./078-langy-user-turn-controls.md)                               | Langy user-initiated turn controls — stop for real, continue, resume-on-refresh                                           | Accepted                  |
| [079](./079-card-selection-is-deterministic.md)                        | Card selection is deterministic — the model supplies data, never presentation (amended 2026-07-22)                        | Accepted                  |
| [081](./081-lwql-table-function-and-ssrf-policy.md)                    | LangWatchQL analytics SQL blocks user-supplied table functions, by AST policy and by grants                               | Accepted                  |
| [082](./082-lwql-analytics-views-invoker-column-grants-final-dedup.md) | The LangWatchQL `analytics.*` schema is invoker-rights views, column grants, and `FINAL`                                  | Accepted                  |
| [083](./083-lwql-diagnostics-read-the-single-parse.md)                 | LangWatchQL diagnostics read the validator's single parse, never a second one                                             | Accepted                  |
| [084](./084-lwql-postgres-mapping-tenant-predicate.md)                 | PostgreSQL-resident data is reached through an approved view, a policed engine table, and a view-carried tenant predicate | Accepted                  |
| [092](./092-unified-authorization-engine.md)                           | Unified authorization engine — one registry, one resolver, every principal                                                | Proposed                  |
| [094](./094-simulation-execution-on-process-manager-substrate.md)      | Simulation execution on the process-manager substrate — durable execute/cancel intents, stall & cancel-grace watchdogs    | Accepted                  |
| [101](./101-feature-package-surfaces.md)                               | Feature ownership roots contain physical contract, server, and optional web packages                                      | Accepted                  |
| [102](./102-runtime-composition-roots.md)                              | One application package contains separate app and worker runtimes                                                         | Superseded in part by 111 |
| [103](./103-standard-schema-api-boundary.md)                           | Feature contracts use Zod 4 behind Standard Schema                                                                        | Accepted                  |
| [104](./104-runtime-environment-configuration.md)                      | Runtime roots validate environment and inject semantic configuration                                                      | Accepted                  |
| [105](./105-mcp-access-via-discover-catalogues.md)                     | RPC services are MCP-accessible through one adapter over the rpc.discover catalogues                                      | Proposed                  |
| [110](./110-grant-aggregates-are-grants.md)                            | A grant aggregate is a grant, not an organization                                                                         | Proposed                  |
| [111](./111-physical-application-workspaces.md)                        | Physical application workspaces preserve the current deployment topology                                                  | Accepted                  |
| [112](./112-singular-feature-ownership.md)                             | Product domains use singular feature ownership                                                                            | Accepted                  |
| [113](./113-explicit-runtime-boot.md)                                  | Explicit runtime boot owns configuration and application construction                                                     | Accepted                  |

Package-local decisions are indexed beside their owners. The framework
records are the [Eventing ADR index](../../../packages/eventing/adrs/README.md)
and [Group Queue ADR index](../../../packages/group-queue/adrs/README.md).

## When to Write an ADR

- Long-lasting or hard to reverse
- Affects multiple teams/services
- Tools, frameworks, data models, protocols, patterns
- Impacts costs, performance, or maintainability

Skip for small implementation details or experiments.

## How to Write

1. **One decision per ADR** — keep it focused
2. **Keep it short** — 1-2 pages max
3. **Write for the future** — assume someone reads this in 2 years
4. **Be honest about trade-offs** — no decision is perfect
5. **Use narrative** — explain reasoning, not just bullet points

Use [`TEMPLATE.md`](./TEMPLATE.md) for new ADRs. Name: `NNN-short-title.md`

## Status

- **Draft** → initial write-up
- **Proposed** → under discussion
- **Accepted** → in effect
- **Superseded** → replaced by later ADR
- **Deprecated** → no longer relevant
