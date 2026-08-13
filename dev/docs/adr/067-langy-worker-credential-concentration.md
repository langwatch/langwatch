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

1. A single manager process is **multi-tenant** — one `Pool` pools workers for
   many conversations across many organizations at once (`pool.go`).
2. `WorkerInfo` retains the **raw** `LangwatchAPIKey` (session key) and
   `LLMVirtualKey`, as Go strings, in the manager's `r.workers` map
   (`otelrelay.go`).
3. Those secrets are captured at `Relay.Register` (spawn) and dropped only at
   `Relay.Unregister` (worker death / reap) — so they live for the worker's
   **entire pooled lifetime**, spanning idle periods and every turn, not just
   the seconds a turn is actually calling out (`pool.go` idle reaper;
   `WorkerInfo` is set once at spawn and never per-turn).

The net effect: the manager process holds, in plaintext, **every currently-live
tenant's session key and virtual key simultaneously, for as long as each worker
stays warm in the pool**. A manager-process compromise, a memory-disclosure bug,
or a crash dump therefore exposes all live tenants' credentials at once — and the
exposure window is dominated by idle time, when no turn is even running. This is
acknowledged as the deliberate trade in the relay's own `SECURITY POSTURE NOTE`
(top of `otelrelay.go`); this ADR revisits whether the *window* and *fan-in* can
be cut without giving up the keep-secrets-out-of-the-worker property that
motivated the relay.

## Decision

**We will hold a worker's LLM/session secrets in the manager only while one of
its turns is in flight**, shrinking the retained-secret window from *worker
lifetime* to *turn duration*. That is the single decision this ADR takes.

The control plane already opens a per-turn channel to the relay at turn start
(`Relay.SetTurnContext` in `otelrelay.go`). Extend that channel to *supply* the
session key and virtual key at turn start, and add a matching *drop* when the
turn settles (success, failure, or stop). An idle pooled worker then holds **no
customer secret in the manager** — its routing token and workspace survive idle
(so warm reuse is preserved), but a memory snapshot taken between turns yields
nothing. A mid-turn LLM retry arriving after the drop must re-supply or fail
closed (never fall back to a stale key).

Concretely, that means the raw `LangwatchAPIKey` and `LLMVirtualKey` stop being
registration state: they leave `WorkerInfo` and the `workerEntry` that
`Relay.Register` populates, and live instead in a turn-scoped holder the settle
hook clears. **Erasure is best-effort and must be designed as such**: Go strings
are immutable and their backing bytes are not reliably reachable, so the
credential fields become `[]byte` that the drop path explicitly overwrites, and
we accept that copies the runtime made (interface boxing, GC-moved stacks) are
not erasable. The property claimed is "no live reference between turns", not
"provably absent from process memory".

### Escalations, not decisions

The two options below are **not** adopted here. They are pre-analysed
escalations, each with the evidence that would trigger it. Adopting either needs
its own ADR.

- **Just-in-time secret fetch.** The manager holds only a short-lived handle and
  fetches the raw secret from the credential broker at turn start.
  *Trigger:* measured concurrent-turn residency stays high enough that the
  in-flight window is itself the exposure — i.e. p99 concurrent in-flight turns
  per manager remains within the same order of magnitude as pooled workers, so
  the decision above buys materially less than the 90%+ idle-time reduction it
  is predicated on. Cost: one broker round-trip on the hot path.

- **Bound manager tenant fan-in.** Cap the distinct organizations a single
  manager pools concurrently, or shard managers per org.
  *Trigger:* a single manager routinely pools workers for more distinct
  organizations than the blast radius we are willing to accept for one process
  compromise, and that count is driven by fan-in rather than by window. Cost:
  forfeits the warm-pool reuse the cold-start work exists to preserve.

## Rationale / Trade-offs

Turn-scoping is where nearly all the value is for the least cost. A pooled
worker spends most of its life idle between turns, so moving secrets from
*spawn→reap* to *turn-start→turn-settle* removes them from the manager for the
majority of every worker's lifetime and reduces "all live workers' keys" to "only
the keys of workers with a turn actually in flight." It introduces **no new trust
boundary** — the control plane already brokers and transmits per-turn context to
the relay — and only a small amount of new state machinery (a supply call, a
settle hook, and fail-closed handling of a post-drop retry). The cost is that the
session/virtual key must be re-transmitted each turn rather than once at spawn;
this is a loopback-adjacent control-plane call, not a customer-facing hop, so the
latency is negligible against the turn's own model latency.

The escalations are deliberately left unadopted. Just-in-time fetch buys a
strictly smaller window (only *actively-calling* turns) but adds a broker
round-trip to the hot path and more failure modes, so it is worth paying for only
once the in-flight window is measured and found wanting. Fan-in bounding attacks
a different axis and is the most expensive of the three, because it forfeits the
warm-pool reuse the cold-start work was specifically built to preserve — reserved
for when the multi-tenant manager itself is judged too large a single point of
exposure. Deciding either now would be deciding without the evidence.

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
- `Relay.SetTurnContext` (or a sibling supply call) becomes the authority for a
  turn's live secrets, and the turn lifecycle gains an explicit "settled → drop
  secrets" hook. Post-drop mid-turn retries must re-supply or fail closed.
- `WorkerInfo` / `workerEntry` lose their credential fields, so `Relay.Register`
  no longer carries a secret at all and the pool's spawn path stops passing one.
  The fields that replace them are `[]byte`, explicitly overwritten on drop; the
  guarantee is "no live reference between turns", not erasure from process
  memory, which Go does not offer.
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
- `services/langyagent/adapters/otelrelay/otelrelay.go` — the `SECURITY POSTURE
  NOTE` above `package otelrelay`, and the symbols `WorkerInfo`,
  `Relay.Register`, `Relay.Unregister`, `Relay.SetTurnContext`. Referenced by
  symbol rather than line, so the references cannot go stale.
- `services/langyagent/app/workerpool/pool.go` — the `Pool` type (multi-tenant
  registry, kernel-UID isolation) and its idle reaper.
