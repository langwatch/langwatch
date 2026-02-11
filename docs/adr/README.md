# Architecture Decision Records (ADRs)

Document **important technical and architectural decisions** — context, trade-offs, and consequences.

## Decisions

| # | Decision | Status |
|---|----------|--------|
| [001](./001-rbac.md) | RBAC with Org → Team → Project hierarchy | Accepted |
| [002](./002-event-sourcing.md) | Event sourcing for traces/evaluations | Accepted |
| [003](./003-logging.md) | Logging and tracing infrastructure | Accepted |
| [004](./004-docker-dev-environment.md) | Docker dev environment with Make targets | Accepted |
| [005](./005-feature-flags.md) | Feature flags via tRPC and PostHog | Accepted |
| [006](./006-redis-cluster-bullmq-hash-tags.md) | Redis cluster hash tags for BullMQ | Accepted |

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
