# D02 — Auth-path Redis-loss resilience

Epic: `../identity-platform-redesign.md` · Plan: `delivery-plan.md` · Wave 1 · Depends on: D01 · Flag: `AUTH_REDIS_FAIL_OPEN`

# Overview

Today, Redis down ⇒ nobody can sign in ⇒ nobody can even open the app to see what's wrong. This deliverable applies **ADR-007's Redis-loss amendment** ("Redis-loss circuit breaker for named pipelines", 2026-08-17) to the auth path. The amendment is **doctrine, not a primitive**: the ledger program deliberately shipped no breaker code, no state machine, no probes, and — pinned in its delivery plan — *no fold runs inline anywhere, ever; no in-memory processor*. What a named pipeline gets is a discipline: durable appends still land (ClickHouse, waited), operations that cannot wait apply their sanctioned write on the calling path, and everything else stalls and drains on recovery.

Identity fits that doctrine better than grants does, by construction: the sign-in hot path emits no commands at all (R12 — sessions and tokens are repository rows), and D01's pinned dispatch order (append waited → fold apply on the calling path → GroupQueue staging last, best-effort) means every identity ceremony already completes without Redis. D02 is the deliverable that makes those properties hold under a *real* outage — where Redis is configured but erroring or hanging, not absent — and proves it with a Redis-kill test. Pulled ahead of the router cutover (D03) deliberately — the cutover should not be the moment we learn Redis-loss kills sign-in.

# Requirements

- **Seam (a) — command dispatch:** identity's GroupQueue staging is best-effort by D01 doctrine; D02 hardens it for the outage case: a bounded timeout on the staging call, failure ⇒ log + `identity_staging_dropped_total` metric, ceremony still succeeds (append + calling-path apply already landed). The cursor-guarded fold converges the missed re-apply on the aggregate's next event or on replay. Non-identity pipelines are untouched — they stall and drain on recovery, per the amendment's named-pipelines-only boundary.
- **Seam (b) — better-auth Redis secondary storage:** today's implementation already returns null / reports a dropped write when the handle is *absent*; D02 covers *configured-but-down*: every secondary-storage call gets a bounded timeout and fails open to PG (PG is already the dual-write source of truth for sessions), with a `betterauth_secondary_storage_fail_open_total` metric. Sessions read/write PG-only for the window.
- **Rate limiting** degrades to fail-open-with-logging for the window (accepted; flagged in Security).
- **Metrics**, not breaker state (there is no breaker state): staging drops, secondary-storage fail-opens, calling-path apply latency histogram.
- **ADR-2** adds `identity` to ADR-007's Redis-loss amendment with identity's own analysis: volume (hundreds of commands/day — calling-path applies are safe at that scale), the pinned dispatch order, and the timeout budgets for seams (a) and (b). The amendment's boundary — named pipelines only, never a fleet-wide default — stands.

# Out of Scope

- Fleet-wide Redis decoupling. Any other pipeline's resilience. Queue-level persistence changes.
- Any in-memory command processor or inline fold for queued work — explicitly rejected by the ledger program's simplification (2026-08-17); identity does not resurrect it.
- ClickHouse loss: sign-in is unaffected by construction (R12 — the hot path emits no events); ceremony commands surface a clear retryable error for the outage window. No CH breaker.

# Research

- **The amendment as merged:** `dev/docs/adr/007-event-sourcing-architecture.md:136` — names `authz_grants`, states "the identity pipeline is expected to join under its own deliverable (identity programme D02), with its own volume analysis. No other pipeline gets this." The ledger delivery plan pins the simplification: "the breaker is a doctrine, not a processor… nothing to build beyond the enforcement write itself."
- **Ordering precedent — positive and negative.** The ledger's `rollBackAuthzCutover` gets the discipline right (enforcement write first, ledger fact best-effort in a try/catch). Its `appendGrantRevocation` gets it wrong: the Redis queue `send()` runs *before* the enforcement delete, so with Redis genuinely down the deny never applies — filed upstream as its own issue. D01's pinned dispatch order (durable append → calling-path apply → staging last) is the same lesson applied structurally, so identity cannot reproduce that hole.
- Countervailing doctrine in our favor: ADR-049:31-33,270-273 — Redis already removed from durable state for PG-operational domains; "a Redis outage cannot erase a committed Postgres projection." PG-only sessions align with 049.
- better-auth secondary storage today: `platform/app/src/server/better-auth/index.ts:150` — null-handle tolerant, not down-handle tolerant.

# Technical Plan

1. Timeout-bounded, fail-open wrapper on better-auth's secondary-storage `get`/`set`/`delete` (seam b), behind `AUTH_REDIS_FAIL_OPEN`.
2. Timeout-bounded, best-effort staging for identity command dispatch (seam a) — the failure path is metric + log, never a thrown ceremony error.
3. Rate-limit fail-open for the window, logged.
4. Metrics: `identity_staging_dropped_total`, `betterauth_secondary_storage_fail_open_total`, calling-path apply latency.
5. ADR-2: identity joins ADR-007's Redis-loss amendment (volume analysis, dispatch order, timeout budgets).
6. Tests: unit (both seams' timeout/failure paths), integration (dev-compose Redis kill mid-flow).

# Exit gate / rollback

- **Exit:** dev-compose Redis-kill test — sign-in, identifier attach, detach, session refresh all pass with Redis down; the drop/fail-open metrics are visible; queued work for other pipelines drains cleanly on recovery.
- **Rollback:** `AUTH_REDIS_FAIL_OPEN` off = today's behavior.

# Security Concerns

- Rate limiting fails open while Redis is down (logged, bounded to outage windows).
- The seam timeouts are the guard against a *slow* (not dead) Redis holding sign-in requests hostage — budgets recorded in ADR-2.

# Open Questions

- ~~Timeout budgets for seams (a) and (b)~~ — decided and recorded in
  ADR-007's identity entry (2026-08-20): staging 2s
  (`IDENTITY_STAGING_TIMEOUT_MS`), secondary storage 500ms per call
  (`SECONDARY_STORAGE_TIMEOUT_MS`).
