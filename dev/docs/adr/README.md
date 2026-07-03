# Architecture Decision Records (ADRs)

Document **important technical and architectural decisions** — context, trade-offs, and consequences.

## Decisions

| # | Decision | Status |
|---|----------|--------|
| [001](./001-rbac.md) | RBAC with Org → Team → Project hierarchy | Accepted |
| [002](./002-event-sourcing.md) | Event sourcing for traces/evaluations | Superseded by 007 |
| [003](./003-logging.md) | Logging and tracing infrastructure | Accepted |
| [004](./004-docker-dev-environment.md) | Docker dev environment with Make targets | Accepted |
| [005](./005-feature-flags.md) | Feature flags via tRPC and PostHog | Accepted |
| [006](./006-redis-cluster-bullmq-hash-tags.md) | Redis cluster hash tags for BullMQ | Accepted |
| [007](./007-event-sourcing-architecture.md) | Event sourcing architecture (fold/map projections) | Accepted |
| [018](./018-form-validation-and-save.md) | Form validation and Save button behavior | Accepted |
| [021](./021-multi-scope-targeting-and-tenancy.md) | Multi-scope targeting and single-org tenancy enforcement | Accepted |
| [022](./022-data-retention.md) | Per-tenant per-category data retention enforced by ClickHouse-native TTL | Accepted |
| [023](./023-orphan-sweep-reactor-chain.md) | Reactor-seeded self-perpetuating chain for retention orphan sweep | Superseded by [025](./025-remove-orphan-sweep.md) |
| [024](./024-cold-path-tiered-storage.md) | Cold-path tiered storage for retention-managed tables | Accepted |
| [025](./025-remove-orphan-sweep.md) | Remove the PG orphan sweep entirely | Accepted |
| [026](./026-per-trigger-dispatch-timing.md) | Per-trigger dispatch timing — cadence and trace-readiness debounce | Accepted |
| [027](./027-typed-dispatcherror-contract.md) | Typed `DispatchError` contract for dispatch endpoints | Accepted |
| [036](./036-liquid-templates-for-trigger-notifications.md) | Liquid templates for user-customizable trigger notifications | Accepted |
| [037](./037-automation-operator-surfaces.md) | Automation operator surfaces — authoring drawer & dispatch-health view | Accepted |
| [030](./030-transactional-outbox-for-stake-sensitive-dispatch.md) | Transactional outbox for stake-sensitive reactor dispatch | Accepted |

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
