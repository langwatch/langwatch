# D02 — Auth-path circuit breaker (Redis-loss resilience)

Epic: `../identity-platform-redesign.md` · Plan: `delivery-plan.md` · Wave 1 · Depends on: D01 · Flag: `AUTH_REDIS_BREAKER`

# Overview

Today, Redis down ⇒ nobody can sign in ⇒ nobody can even open the app to see what's wrong. This deliverable applies the grants ledger's per-pipeline circuit breaker (its PR 1 — a shared primitive, consumed here, not built here) to the auth path: when Redis staging is unhealthy, identity commands process inline in the web process and sessions go PG-only. Everything else stalls and catches up. The sign-in hot path itself emits no commands at all (R12 — sessions and tokens are repository rows), so the command seam exists for the ceremonies (sign-up, attach, detach), not for sign-in. Pulled ahead of the router cutover (D03) deliberately — the cutover should not be the moment we learn Redis-loss kills sign-in.

# Requirements

- Breaker wraps two seams: (a) GroupQueue staging for the identity pipeline, (b) better-auth Redis secondary-storage calls.
- The primitive is the ledger's (its PR 1): per-process, in-memory state; opens on staging/read failures; half-open probes on a timer; no meta-dependency on Redis to detect Redis being down. This deliverable registers the identity pipeline with it and builds no breaker of its own.
- Breaker open ⇒ identity commands dispatch through the framework's **in-memory processor** (synchronous, in the web process); sessions read/write PG only (PG is already the dual-write source of truth).
- Non-identity pipelines (langy, analytics, automations) never see the breaker — they stall and drain on recovery.
- Rate limiting degrades to fail-open-with-logging while the breaker is open (accepted for outage windows; flagged in Security).
- Breaker state transitions emitted as metrics.

# Out of Scope

- Fleet-wide Redis decoupling. Any other pipeline's resilience. Queue-level persistence changes.
- ClickHouse loss: sign-in is unaffected by construction (R12 — the hot path emits no events); ceremony commands surface a clear retryable error for the outage window. No CH breaker.

# Research

- **Corpus-audit finding this deliverable resolves:** ADR-007:84-89 pins process roles — "**web**: Only dispatches commands and events to queues. Does not start BullMQ workers… ensures that the web servers remains responsive." Inline processing in the web role deviates from this; the sanction is ADR-007's shared amendment **"Redis-loss circuit breaker for named pipelines"** (2026-08-17, lands with ledger PR 1), which names `authz_grants` and expects `identity` to join. ADR-2 adds `identity` to that amendment with its own load analysis (identity volume is hundreds of commands/day — in-process processing is safe at that scale); the amendment's boundary — named pipelines only, never a fleet-wide default — stands.
- Countervailing doctrine in our favor: ADR-049:31-33,270-273 — Redis already removed from durable state for PG-operational domains; "a Redis outage cannot erase a committed Postgres projection." PG-only sessions align with 049.
- The in-memory processor already exists in the framework for no-Redis operation — this deliverable productionizes it for one pipeline.

# Technical Plan

1. Adopt the shared breaker primitive (ledger PR 1); wire its failure detection to the two seams. No new primitive.
2. Seam (a): identity command dispatch checks the breaker; open ⇒ route to the in-memory processor instead of GroupQueue staging.
3. Seam (b): wrap better-auth's Redis secondary-storage calls; open ⇒ skip Redis, PG only.
4. Metrics: state transitions, inline-processed command count, probe outcomes.
5. ADR-2: add `identity` to ADR-007's shared Redis-loss amendment, carrying the identity-specific failure-semantics analysis (the amendment's named-pipelines-only boundary stands).
6. Tests: unit (breaker transitions), integration (dev-compose Redis kill mid-flow).

# Exit gate / rollback

- **Exit:** dev-compose Redis-kill test — sign-in, identifier attach, detach, session refresh all pass with Redis down; breaker metrics visible.
- **Rollback:** `AUTH_REDIS_BREAKER` off = today's behavior.

# Security Concerns

- Rate limiting fails open while the breaker is open (logged, bounded to outage windows).
- Inline processing must not leak command failures into HTTP latency beyond a bounded timeout — a slow inline command must not hold the sign-in request hostage; define the timeout budget in ADR-2.

# Open Questions

- Inline-processing timeout budget for sign-in-path commands (implementation decision, recorded in ADR-2).
