# ADR-067: Shrinking Langy worker credential concentration in the mediation relay

**Date:** 2026-07-24

**Status:** Proposed

## Context

Langy workers are model-driven, prompt-injectable opencode subprocesses. To keep
customer secrets out of that subprocess, the manager-side mediation relay
(`services/langyagent/adapters/otelrelay`) brokers the two flows that used to
need a secret in the worker env:

- **Telemetry** — the worker exports OTLP over loopback with no auth header; the
  relay re-parents the spans and forwards them to the customer's project,
  authenticated with the session key the manager holds.
- **LLM calls** — the worker's `OPENAI_BASE_URL` points at the relay; the relay
  injects the per-conversation LLM virtual key and forwards to the AI gateway.

Neither the session key nor the virtual key ever enters the worker env. Workers
are multiplexed by a 128-bit unguessable routing token in the path, and
co-hosted workers are additionally isolated at the kernel by unique UIDs +
`chmod 0700` on their session/workspace dirs (`pool.go`). For the **realistic
threat — a compromised/prompt-injected worker — this is sound**: that worker
knows only its own token, cannot read a sibling's token off disk (different UID,
0700), and holds no raw customer secret, so its blast radius is its own tenant.

The residual concern is **concentration, not leakage between workers**. Today:

1. A single manager process is **multi-tenant** — it pools workers for many
   conversations across many organizations at once (`pool.go:81-91`).
2. `WorkerInfo` retains the **raw** `LangwatchAPIKey` (session key) and
   `LLMVirtualKey` in the manager's `r.workers` map (`otelrelay.go:90-122`).
3. Those secrets are captured at `Register` (spawn) and dropped only at
   `Unregister` (worker death / reap) — so they live for the worker's **entire
   pooled lifetime**, spanning idle periods and every turn, not just the seconds
   a turn is actually calling out (`pool.go` idle reaper; `WorkerInfo` is set
   once at spawn and never per-turn).

The net effect: the manager process holds, in plaintext, **every currently-live
tenant's session key and virtual key simultaneously, for as long as each worker
stays warm in the pool**. A manager-process compromise, a memory-disclosure bug,
or a crash dump therefore exposes all live tenants' credentials at once — and the
exposure window is dominated by idle time, when no turn is even running. This is
acknowledged as the deliberate trade in the relay's own `SECURITY POSTURE NOTE`
(`otelrelay.go:29-34`); this ADR revisits whether the *window* and *fan-in* can
be cut without giving up the keep-secrets-out-of-the-worker property that
motivated the relay.

## Decision

We will shrink the retained-secret window from *worker lifetime* to *turn
duration*, and cap per-manager tenant fan-in, in the following priority order.
Item 1 is the recommended first step; 2 and 3 are escalations if 1 proves
insufficient.

1. **Hold LLM/session secrets only while a turn is in flight.** The control
   plane already opens a per-turn channel to the relay at turn start
   (`SetTurnContext`, `otelrelay.go:451`). Extend that channel to *supply* the
   session key and virtual key at turn start and add a matching *drop* when the
   turn settles (success, failure, or stop), zeroing them in the entry. An idle
   pooled worker then holds **no customer secret in the manager** — its routing
   token and workspace survive idle (so warm reuse is preserved), but a memory
   snapshot taken between turns yields nothing. A mid-turn LLM retry arriving
   after the drop must re-supply or fail closed (never fall back to a stale key).

2. **Just-in-time secret fetch (if 1 is not enough).** The manager holds only a
   short-lived handle; it fetches the raw secret from the credential broker at
   turn start and zeroes it at turn end. A snapshot then holds at most the keys
   of turns *actively mid-call*, at the cost of one broker round-trip per turn.

3. **Bound manager tenant fan-in.** Cap the number of distinct organizations a
   single manager pools concurrently, or (heavier) shard managers per org. This
   trades warm-pool reuse — and the documented cold-start latency — for a smaller
   blast radius per process.

## Rationale / Trade-offs

Item 1 is where nearly all the value is for the least cost. A pooled worker
spends most of its life idle between turns, so moving secrets from
*spawn→reap* to *turn-start→turn-settle* removes them from the manager for the
majority of every worker's lifetime and reduces "all live workers' keys" to "only
the keys of workers with a turn actually in flight." It introduces **no new trust
boundary** — the control plane already brokers and transmits per-turn context to
the relay — and only a small amount of new state machinery (a supply call, a
settle hook, and fail-closed handling of a post-drop retry). The cost is that the
session/virtual key must be re-transmitted each turn rather than once at spawn;
this is a loopback-adjacent control-plane call, not a customer-facing hop, so the
latency is negligible against the turn's own model latency.

Item 2 buys a strictly smaller window than 1 (only *actively-calling* turns) but
adds a broker round-trip to the hot path and more failure modes; it is worth it
only if 1 leaves an unacceptable window. Item 3 attacks fan-in rather than
window, and is the most expensive because it forfeits warm-pool reuse that the
cold-start work was specifically built to preserve — reserved for when the
multi-tenant manager itself is judged too large a single point of exposure.

We accept that none of these removes the fundamental fact that a manager
mediating secrets must, at *some* instant, hold the secret of a turn it is
actively brokering. The goal is to make that instant as short and as narrow as
the mediation design allows, not to eliminate it — eliminating it means putting
the secret back in the prompt-injectable worker, which is the exact exposure the
relay exists to prevent.

## Consequences

- The retained-secret window drops from a worker's full pooled lifetime to a
  single turn's duration; idle pooled workers become secret-free in the manager.
- A manager-process compromise exposes only the keys of turns in flight at that
  instant, not every warm worker's keys.
- `SetTurnContext` (or a sibling supply call) becomes the authority for a turn's
  live secrets, and the turn lifecycle gains an explicit "settled → drop secrets"
  hook. Post-drop mid-turn retries must re-supply or fail closed.
- Per-entry non-secret state (the turn trace context, `LastLLMError`) is
  unaffected — it is not a customer credential.
- No change to the worker-isolation story (kernel UID + 0700 + 128-bit token +
  secrets-out-of-worker), which already contains the likely threat; this ADR
  only narrows the manager-side concentration behind it.

## References

- Related ADRs: [ADR-053](053-tenant-aware-egress-and-workload-isolation.md)
  (tenant-aware egress and workload isolation),
  [ADR-061](061-langy-trace-dual-export.md) (the mirror lane this relay also
  drives).
- `services/langyagent/adapters/otelrelay/otelrelay.go` — `SECURITY POSTURE
  NOTE` (lines 29-34), `WorkerInfo` (90-122), `Register`/`Unregister`
  (335-356), `SetTurnContext` (451).
- `services/langyagent/app/workerpool/pool.go` — multi-tenant pool, kernel-UID
  isolation (81-95), idle reaper.
