# Architecture Decision Records (ADRs)

Document **important technical and architectural decisions** — context, trade-offs, and consequences.

## Decisions

| # | Decision | Domains | Status |
|---|----------|---------|--------|
| [001](./001-rbac.md) | RBAC with Org → Team → Project hierarchy | auth | Accepted |
| [002](./002-event-sourcing.md) | Event sourcing for traces/evaluations | event-sourcing | Superseded by 007 |
| [003](./003-logging.md) | Logging and tracing infrastructure | observability | Accepted |
| [004](./004-docker-dev-environment.md) | Docker dev environment with Make targets | dev-env | Accepted |
| [005](./005-feature-flags.md) | Feature flags via tRPC and PostHog | platform | Accepted |
| [006](./006-redis-cluster-bullmq-hash-tags.md) | Redis cluster hash tags for BullMQ | queues | Accepted |
| [006](./006-worker-architecture.md) | Single entry point worker architecture | workers | Accepted |
| [007](./007-event-sourcing-architecture.md) | Event sourcing architecture (fold/map projections) | event-sourcing | Accepted |
| [008](./008-extensible-metadata-on-scenario-events.md) | Extensible metadata on scenario events | scenarios | Accepted |
| [009](./009-otel-trace-context-propagation-for-http-scenarios.md) | OTEL trace context propagation for HTTP scenarios | scenarios, observability | Accepted |
| [010](./010-e2e-testing-strategy.md) | E2E testing: browser verification over generated tests | testing | Accepted |
| [011](./011-internal-set-id-naming-convention.md) | Internal set ID naming convention | platform | Accepted |
| [012](./012-skills-information-architecture.md) | Skills information architecture and feature map | skills | Accepted |
| [013](./013-workflow-based-onboarding.md) | Workflow-based onboarding with skills and recipes | onboarding, skills | Accepted |
| [014](./014-prompt-labels-data-model.md) | Prompt labels data model | prompts | Accepted |
| [014](./014-skynet-bullmq-removal.md) | Remove BullMQ from Skynet | queues | Accepted |
| [015](./015-projection-replay-coordination.md) | Projection replay coordination protocol | event-sourcing | Accepted |
| [016](./016-scoped-model-providers.md) | Scoped model providers & default models | model-providers | Accepted |
| [017](./017-gateway-trace-payload-capture.md) | Gateway trace payload capture | gateway, observability | Accepted |
| [018](./018-form-validation-and-save.md) | Form validation and Save button behavior | frontend | Accepted |
| [018](./018-governance-unified-observability-substrate.md) | Governance ingestion uses the unified observability substrate | governance, event-sourcing | Accepted |
| [019](./019-repository-service-layering.md) | Repository-service layering for project config access | architecture | Accepted |
| [020](./020-cascading-default-models.md) | Cascading default models | model-providers | Accepted |
| [021](./021-lean-fold-cache.md) | Lean fold cache — cache read-set, persist write-set | event-sourcing | Proposed |
| [021](./021-multi-scope-targeting-and-tenancy.md) | Multi-scope targeting and single-org tenancy enforcement | governance, tenancy | Accepted |
| [022](./022-data-retention.md) | Per-tenant per-category retention via ClickHouse-native TTL | retention | Accepted |
| [022](./022-event-log-source-of-truth.md) | event_log as source of truth · S3 as transient spool | event-sourcing | Proposed |
| [023](./023-orphan-sweep-reactor-chain.md) | Reactor-seeded chain for retention orphan sweep | retention | Superseded by 025 |
| [024](./024-cold-path-tiered-storage.md) | Cold-path tiered storage for retention-managed tables | retention, clickhouse | Accepted |
| [025](./025-remove-orphan-sweep.md) | Remove the PG orphan sweep entirely | retention | Accepted |
| [026](./026-groupqueue-payload-envelope.md) | GroupQueue payload envelope with routing header | queues | Accepted |
| [026](./026-reactor-should-react-predicate.md) | Pure `shouldReact` predicate gates reactor enqueue | event-sourcing | Accepted |
| [027](./027-storage-gb-billing.md) | Stored GB-hours billing to Stripe via event-sourced projection | billing, retention, event-sourcing | Proposed |

> Note: duplicate numbers (006, 014, 018, 021, 022, 026) are historical collisions from parallel branches — kept as-is; links disambiguate. New ADRs: take max+1 **at merge time**.

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
