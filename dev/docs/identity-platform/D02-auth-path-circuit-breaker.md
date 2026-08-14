# D02 — Auth-path circuit breaker (Redis-loss resilience)

Epic: `../identity-platform-redesign.md` · Plan: `delivery-plan.md` · Wave 1 · Depends on: D01 · Flag: `AUTH_REDIS_BREAKER`

# Overview

Today, Redis down ⇒ nobody can sign in ⇒ nobody can even open the app to see what's wrong. This deliverable puts a circuit breaker on the auth path: when Redis staging is unhealthy, identity commands process inline in the web process and sessions go PG-only. Everything else stalls and catches up. Pulled ahead of the router cutover (D03) deliberately — the cutover should not be the moment we learn Redis-loss kills sign-in.

# Requirements

- Breaker wraps two seams: (a) GroupQueue staging for the identity pipeline, (b) better-auth Redis secondary-storage calls.
- Per-process, in-memory state; opens on staging/read failures; half-open probes on a timer; no meta-dependency on Redis to detect Redis being down.
- Breaker open ⇒ identity commands dispatch through the framework's **in-memory processor** (synchronous, in the web process); sessions read/write PG only (PG is already the dual-write source of truth).
- Non-identity pipelines (langy, analytics, automations) never see the breaker — they stall and drain on recovery.
- Rate limiting degrades to fail-open-with-logging while the breaker is open (accepted for outage windows; flagged in Security).
- Breaker state transitions emitted as metrics.

# Out of Scope

- Fleet-wide Redis decoupling. Any other pipeline's resilience. Queue-level persistence changes.

# Research

- **Corpus-audit finding this deliverable resolves:** ADR-007:84-89 pins process roles — "**web**: Only dispatches commands and events to queues. Does not start BullMQ workers… ensures that the web servers remains responsive." Inline processing in the web role contradicts this; no ADR sanctions in-memory production processing (007:114 lists `Memory` stores under test support only). ADR-2 must amend 007 **for the identity pipeline only**, with the load analysis (identity volume is hundreds of commands/day — in-process processing is safe at that scale; this is not a general precedent).
- Countervailing doctrine in our favor: ADR-049:31-33,270-273 — Redis already removed from durable state for PG-operational domains; "a Redis outage cannot erase a committed Postgres projection." PG-only sessions align with 049.
- The in-memory processor already exists in the framework for no-Redis operation — this deliverable productionizes it for one pipeline.

# Technical Plan

1. Breaker primitive: per-process state machine (closed/open/half-open), failure detection on the two seams, probe timer.
2. Seam (a): identity command dispatch checks the breaker; open ⇒ route to the in-memory processor instead of GroupQueue staging.
3. Seam (b): wrap better-auth's Redis secondary-storage calls; open ⇒ skip Redis, PG only.
4. Metrics: state transitions, inline-processed command count, probe outcomes.
5. ADR-2: amendment to ADR-007 scoped to the identity pipeline, including the failure-semantics analysis and the explicit "no other pipeline gets this" boundary.
6. Tests: unit (breaker transitions), integration (dev-compose Redis kill mid-flow).

# Exit gate / rollback

- **Exit:** dev-compose Redis-kill test — sign-in, identifier attach, detach, session refresh all pass with Redis down; breaker metrics visible.
- **Rollback:** `AUTH_REDIS_BREAKER` off = today's behavior.

# Security Concerns

- Rate limiting fails open while the breaker is open (logged, bounded to outage windows).
- Inline processing must not leak command failures into HTTP latency beyond a bounded timeout — a slow inline command must not hold the sign-in request hostage; define the timeout budget in ADR-2.

# Open Questions

- Inline-processing timeout budget for sign-in-path commands (implementation decision, recorded in ADR-2).
