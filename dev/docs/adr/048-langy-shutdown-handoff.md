# ADR-048: Langy worker shutdown-handoff — checkpoint on SIGTERM, resume on the next worker

**Date:** 2026-07-11

**Status:** Proposed

**Builds on:** ADR-046 (event-sourced Langy conversations), ADR-047 (Langy
foundations — hexagonal Go service), ADR-044 (event-driven worker + streaming +
self-observability). Based on **PR3** (`feat/langy-worker-streaming`), where the
panic-recovery (`clog.Go`/`HandlePanic`) and early-OTel-flush-on-SIGTERM
primitives live, so this composes with them directly. Independent of the ADR-043
egress enforcement (PR4, a sibling branch) — the handoff is egress-agnostic.

## Context

Langy runs each conversation on a dedicated `opencode` subprocess inside a
single-replica `langyagent` pod (ADR-047: "SINGLE REPLICA ONLY … a turn that was
mid-flight when the pod died is lost"). Today, when Kubernetes terminates the pod
— a routine deploy, a node drain, an HPA-less rollout — the manager receives
SIGTERM, the lifecycle group drains, and every worker subprocess is killed by a
process-group signal. Any turn that was streaming at that instant is lost: the
control plane's reconcile sweep (ADR-044 part 2) eventually terminalises it as
`agent_turn_failed`, and the **next** turn starts the model over from a cold
`opencode` session with none of the work the previous turn had already done.

For short chat answers this is tolerable. For the long, tool-heavy turns Langy is
being built toward (multi-step investigations, a `gh pr create` flow that has
already cloned, branched, and edited), throwing away an in-flight turn on every
deploy is expensive and user-visible — the user watches a half-written answer
vanish and has to re-ask.

The constraint that shapes everything here: **on SIGTERM the pod has a bounded,
uncatchable deadline.** Kubernetes sends SIGTERM, waits
`terminationGracePeriodSeconds` (TGP), then sends SIGKILL, which no handler can
intercept — the same honest limit ADR-044's telemetry flush lives with. So a
graceful handoff can only ever be *best-effort*: it narrows the loss window, it
does not close it. A hard OOM or a TGP overrun still loses the turn and falls
back to today's cold restart.

Two more facts constrain the design:

- **Only the model knows what is meaningfully complete.** The manager sees an
  opaque ndjson token stream; it cannot decide where a resumable boundary is.
  The checkpoint must be *worker-authored* — `opencode` (or a small MCP tool it
  calls) writes it — which makes this a protocol between `opencode` and the
  control plane, not just manager plumbing.
- **The manager holds no durable state** (ADR-047: workers are in-memory,
  `SESSIONS_ROOT` is wiped on boot). Anything that must survive the pod dying has
  to be persisted by the control plane, on the event-sourced
  `langy-conversation-processing` pipeline (ADR-046).

## Decision

We add a four-step **shutdown-handoff protocol**. On SIGTERM the manager asks
each live worker to checkpoint; the worker authors an opaque resume token and
emits it as a terminal ndjson frame on the in-flight turn stream; the control
plane persists that token against the conversation as a durable event; the next
turn threads it back to a fresh worker, which resumes instead of cold-starting.

### 1. Manager: a pre-drain SIGTERM hook that notifies each worker

On SIGTERM, **before** the worker pool's process-group kill, the manager POSTs
`shutdown_imminent{ deadline }` to each live worker's `opencode` control API
(through the per-worker authProxy, ADR-047 — the same bearer-gated path every
control call uses). `deadline` is an absolute wall-clock instant (unix millis).

This is wired as a `pkg/lifecycle` **Closer registered after the worker-pool**,
so in the reverse-order stop sequence it runs *before* the worker-pool drain
(which kills the process groups and tears down the authProxies). It waits,
bounded by `deadline`, for each in-flight worker's turn to quiesce — i.e. for its
`StreamEvents` loop to see the terminal `handoff` frame and let the still-open
`/chat` HTTP response flush it to the control plane — and only then returns,
handing control to the worker-pool drain.

**Composition with the early-flush (PR3).** PR3's serve.go already has an
`otel-early-flush` Closer — also a pre-drain SIGTERM step. This PR registers the
handoff Closer *after* it, so the two coexist as sibling pre-drain Closers with
stop order **handoff → early-flush → http → worker-pool**: the handoff starts
first because the worker-authored checkpoint is the scarce artifact that benefits
most from a wall-clock head start, and the early-flush (bounded, operating on
already-buffered data) follows and also captures the handoff's own spans. Neither
depends on the other; both must complete before the worker-pool drain. The
notify fan-out goroutines are panic-guarded with `clog.Go` (PR3), so a panic
mid-shutdown can't crash the process before the drain.

### 2. Worker: a worker-authored, opaque resume token on a terminal frame

On receiving `shutdown_imminent`, `opencode` writes a resumable checkpoint (the
last completed step + a continue-token capturing "done so far") and emits a
single terminal ndjson event on the turn's `/event` stream:

```json
{ "type": "handoff", "token": "<opaque base64/JSON blob>" }
```

`streamSessionEvents` treats `handoff` as a terminal event type (alongside
`message.completed` / `session.idle` / `error`), so it forwards the frame to the
sink and returns, ending the turn cleanly.

**Token shape.** The token is **opaque to the manager and to the control plane**
— the manager forwards it, the control plane persists it verbatim, only
`opencode` authors and consumes it. The *recommended* shape `opencode` writes
(documented here, enforced nowhere outside `opencode`) is:

```json
{
  "v": 1,
  "sessionId": "<opencode internal session id>",
  "step": "<label of the last completed step>",
  "continue": "<worker-authored 'done so far' continuation state>",
  "issuedAt": 1752000000000
}
```

Keeping it opaque is deliberate: the resumable boundary is a model concern that
will evolve (checkpoint granularity, compression, a server-side blob ref instead
of an inline blob) without a manager or control-plane change. The manager treats
it as an opaque string with a sane size cap; the control plane stores it as a
`Nullable(String)` fold column.

### 3. Control plane: persist the token as a durable pipeline event

The in-flight turn's `/chat` response carries the `handoff` frame back to
`runTurn` (the control-plane spawn function, ADR-044). Instead of finalising the
turn, `runTurn` dispatches a new command on the `langy-conversation-processing`
pipeline (ADR-046), mirroring the existing `defineCommand` → event → fold
pattern:

- **`recordTurnHandoff` → `conversation_handoff_pending`** carries
  `{ conversationId, turnId, token }`. Its fold handler stores the token on the
  conversation state (`PendingHandoffToken` + `PendingHandoffTurnId`), **clears
  `CurrentTurnId`** (the turn is no longer in flight — it handed off, it did not
  fail), and sets `Status = idle`. Idempotency key
  `…:handoff:<turnId>` — a retried handoff for the same turn writes one event.

The token lives in the fold state (a new pair of columns on the
`langy_conversations` ClickHouse table, migration `00043`), so it survives the
pod dying and is readable by any future worker via the existing fold read path.

### 4. Resume: thread the token to a fresh worker on the next turn, once

The next `/chat` turn for that conversation resolves the conversation as usual,
then — before dispatching `StartAgentTurn` — reads any pending handoff off the
fold (`getPendingHandoff`). If one exists it:

- threads `resumeToken` into the out-of-band spawn handoff (ADR-044's Redis
  `LangyTurnHandoff`), so `runTurn` puts it on the manager `/chat` body; the
  manager threads it through `spawn` → `PostMessage`, and `opencode` restores the
  checkpoint instead of cold-starting; and
- dispatches **`consumeTurnHandoff` → `conversation_handoff_consumed`**
  `{ conversationId, turnId }`, whose fold handler clears
  `PendingHandoffToken` / `PendingHandoffTurnId`. Idempotency key
  `…:handoff-consumed:<turnId>` makes a double-consume a single durable event.

If no handoff is pending, the turn is a normal cold start — exactly today's
behaviour.

### Deadline math

The `deadline` sent to each worker MUST be strictly `< TGP − drainBudget`, where
`drainBudget` is the time the worker-pool drain needs after the handoff (per-worker
SIGINT → 2 s grace → SIGKILL, plus authProxy/egress teardown and a margin). The
manager only knows its own `GracefulSeconds` budget, not TGP, so we enforce the
process-local invariant and document the operator's obligation:

```
handoffDeadline + drainBudget  <  GracefulSeconds        (validated at config load)
GracefulSeconds                <  terminationGracePeriodSeconds   (operator sizes the chart)
⟹  handoffDeadline  <  GracefulSeconds − drainBudget  <  TGP − drainBudget   ✓
```

Config: `LANGY_SHUTDOWN_HANDOFF_DEADLINE_MS` (default 5000) and
`LANGY_SHUTDOWN_DRAIN_BUDGET_MS` (default 3000); `LoadConfig` fails closed if
`handoff + drain ≥ graceful`. The worker receives `deadline = now + handoffBudget`.

## Rationale / Trade-offs

- **Why a durable pipeline event, not a Redis key?** ADR-044 already stashes the
  *spawn inputs* in a short-lived Redis handoff. A resume token is different: it
  is the durable "this conversation has unfinished, resumable work" fact that
  must outlive the pod and be replayable, so it belongs on the event log and the
  fold, exactly like `turn_finalized`. Using the ADR-046 command→event→fold
  machinery gets idempotency, replay-safety, and the cross-worker read for free.

- **Why worker-authored + opaque?** The manager cannot know a resumable
  boundary; the model can. Making the token opaque to both the manager and the
  control plane means the checkpoint format can evolve entirely inside
  `opencode` — the layer that both writes and reads it — without touching Go
  plumbing or a ClickHouse schema. The opacity boundary is the whole point:
  **manager forwards, control plane persists, opencode authors/consumes.**

- **Why best-effort, stated honestly?** SIGKILL is uncatchable. We accept that a
  hard OOM or a TGP overrun loses the turn and falls back to cold restart (the
  current behaviour, ADR-047). The handoff narrows the window from "every deploy
  loses in-flight turns" to "only an ungraceful kill does" — a large practical
  win without pretending to a guarantee we cannot make.

- **Idempotency vs. eventual consistency.** The fold is written asynchronously,
  so a rare double-read of a pending token could thread it to two workers. We
  accept this: the `consumeTurnHandoff` idempotency key collapses the durable
  event to one, and `opencode`'s resume is itself idempotent (re-applying a
  checkpoint is safe). We do not add a distributed lock for a rare, benign race.

- **Alternatives rejected.** (a) *Persisting the full turn transcript* — the
  content already lives in `langy_messages`; re-deriving a resume point from it
  server-side re-introduces the "manager guesses the boundary" problem. (b) *A
  second HTTP channel from worker to control plane for the token* — the in-flight
  `/chat` stream is already open and already flows worker→manager→control-plane;
  reusing it needs no new auth surface. (c) *Blocking the whole grace window on
  the handoff* — capped by `deadline` so a slow/dead worker can never eat the
  drain budget out from under the process-group kill.

## Consequences

- Deploys and node drains no longer discard an in-flight Langy turn when the
  worker checkpoints in time; the next turn resumes from where it left off.
- New durable vocabulary on `langy-conversation-processing`:
  `conversation_handoff_pending` / `conversation_handoff_consumed` events and
  their `recordTurnHandoff` / `consumeTurnHandoff` commands; two new fold columns
  (`PendingHandoffToken`, `PendingHandoffTurnId`) and CH migration `00043`.
- New manager surface: a config-driven pre-drain SIGTERM Closer (sibling to
  PR3's early-flush), a per-worker `shutdown_imminent` POST, a `handoff` terminal
  frame in `streamSessionEvents`, and a `resumeToken` threaded through `spawn` →
  `PostMessage` (via the PR3 `baseURL` control-call API).
- `opencode` gains a contract it must honour to make any of this real: accept
  `shutdown_imminent`, author the checkpoint + `handoff` frame, and accept a
  `resumeToken` on the next prompt. Until `opencode` implements it, the Go and TS
  sides degrade cleanly — no `handoff` frame ⇒ the turn reconciles as it does
  today; no `resumeToken` support ⇒ a cold start.
- The honest limit remains: SIGKILL / OOM / a TGP shorter than
  `graceful + handoff` still loses the turn. Operators must size
  `terminationGracePeriodSeconds` above `GracefulSeconds`.

## References

- Related ADRs: ADR-046 (event-sourced Langy conversations), ADR-047 (Langy
  foundations), ADR-044 (event-driven worker + streaming), ADR-043 (egress
  enforcement), ADR-033 (worker network isolation).
- Spec: `specs/langy/langy-shutdown-handoff.feature`
- Code: `services/langyagent/` (serve.go, config.go, adapters/workerpool),
  `platform/app/src/server/routes/langy.ts`, the `langy-conversation-processing`
  pipeline, `platform/app/src/server/services/langy/execution/langy-turn.processor.ts`.
