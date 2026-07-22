# ADR-058: Langy user-initiated turn controls — stop for real, continue, resume-on-refresh

**Date:** 2026-07-21

**Status:** Accepted

**Builds on:** ADR-044 (event-driven turns: Redis token buffer + liveness),
ADR-046 (event-sourced conversations: the `langy_conversation` aggregate, the
`agent_responded` terminal, the one-terminal-per-turn idempotency slot), ADR-048
(dual-stream + "the buffered tail is the resume state"), ADR-049 (Postgres
operational projections). Adds three USER-initiated controls; changes none of
those transports.

**Spec:** [`specs/langy/langy-stop-and-resume.feature`](../../../specs/langy/langy-stop-and-resume.feature)

## Context

Three things a person chatting with Langy cannot do today, all about staying in
control of one in-flight turn:

1. **Stop it for real.** The Stop button calls `useChat`'s `stop()`, which aborts
   the browser's `onTurnStream` subscription and nothing else. The Go worker keeps
   driving opencode, keeps calling tools, keeps spending tokens, and eventually
   POSTs a durable final for a question the user already abandoned. The UI says
   "stopped"; the backend never heard. It is a lie, and on an agent that can open
   PRs and run shell commands, a lie with consequences.

2. **Continue a stopped chat.** With no real stop there is no real resume. Even the
   conversation lifecycle has no notion of "the user stopped here."

3. **Carry on after a refresh.** ADR-048 made the durable token buffer the resume
   state and the server already settles a turn whose terminal frame was missed
   (`langyTurnSettlement.ts`), but the browser never *rejoins* a running turn on a
   cold mount — `reconnectToStream()` returns null and the "Catching up…" state is
   hard-coded off. A refresh mid-answer drops you to a working-line placeholder
   that only reconciles once the turn ends.

The turn lifecycle these must extend is deliberately strict (ADR-046): a turn is
an event-sourced aggregate that reaches **exactly one terminal**, guarded by a
shared `turn-terminal:${turnId}` idempotency slot so a late liveness failure
racing the real answer collapses instead of double-terminating. Any new control
has to respect that, not route around it.

## Decision

### 1. A stop is a third terminal *outcome*, not a new event

`agent_responded` already carries `outcome: "completed" | "failed"` and the whole
final answer as its payload. A user-stop is not a failure (nothing went wrong) and
not a completion (the agent did not finish) — but it **has a partial answer to
carry**, which is precisely what distinguishes `agent_responded` from
`agent_response_failed` (the no-answer, stalled terminal). So a stop is
`agent_responded` with a third outcome, **`"stopped"`**, carrying the partial
answer streamed so far.

This buys the entire terminal machinery for free:

- **First-writer-wins for free.** The stop dispatches `recordAgentResponse` on the
  same `turn-terminal:${turnId}` slot as a natural completion. If the real answer
  landed first, the stop collapses (the user simply gets the whole answer); if the
  stop landed first, the worker's late final collapses. The messageId is *derived
  from the turnId* (`turnMessageId`), so the two writers even agree on the message
  identity — no duplicate reply.
- **The partial is preserved for free.** The message map projection already
  materialises the assistant message from `agent_responded` regardless of outcome.
- **The conversation lands idle & continuable for free.** The conversation-state
  fold sends any non-`failed` outcome to `idle` with `LastError: null`. A stopped
  conversation is therefore settled and ready for the next turn — no bespoke state.

The only projection that changes is the per-turn render document
(`langyConversationTurn`): a new `stopped` turn status so the turn renders
distinctly (not a red error, not a plain completion) and anchors the Continue
affordance. `LANGY_CONVERSATION_STATUS` (the conversation spine) is untouched.

### 2. The control plane terminalises; the worker cancel is best-effort on top

"Real backend confirmation" must not depend on a possibly-wedged worker. So the
`langy.stopTurn` mutation, via a `LangyTurnService.stopTurn`:

1. Reconstructs the partial answer from the **durable token buffer** (`readTail`,
   concatenating the `delta` entries) — the source of truth, refresh-safe, never
   trusting whatever the browser happened to paint. The worker's un-flushed
   in-memory tail (≤ a few words) is not the control plane's to see and is not
   needed.
2. Dispatches `recordAgentResponse{ outcome: "stopped", parts }` — the durable
   terminal. **This is the confirmation.**
3. `markEnd` on the buffer — the stream's terminal, so every attached browser's
   `onTurnStream` ends and the UI settles out of its spinner.
4. **Best-effort** signals the worker to abandon the generation (below). If this
   never lands, the stop is still truthful — the turn is terminal, the stream
   ended, and the worker's late final is dropped by the one-terminal guard. Only
   the wasted tokens are the cost.

The browser's Stop shows **"Stopping…"** from the click until the terminal is
observed on the stream, then settles to **stopped** — it never claims stopped
while the turn still runs on the backend.

### 3. The worker cancel (Go manager) — stop the token burn

A new internal `POST /worker/cancel { conversationId, turnId }` (bearer
`LANGY_INTERNAL_SECRET`, same as the other `/worker/*` verbs). The manager keys
workers by `conversationId` (pool lookup) and each worker tracks its live
`currentTurnID`; cancel verifies the turn still matches (so it cannot cancel a
newer turn) and then:

- fires a **per-turn CancelFunc** stored on the worker (today the turn's
  `streamCtx` cancel is reachable only by the GitHub gate — this generalises that
  exact injection pattern) to detach the manager's `/event` read and relay, and
- calls **opencode's session abort** (`POST /session/{id}/abort`) to actually halt
  generation — modelled on the existing `shutdown_imminent` control POST. This is
  the surgical token-burn halt; it is best-effort (if the opencode build lacks the
  route, the call degrades and the turn still detaches — see Open Questions).

A cancelled turn emits a vetted **stopped terminal frame** (mirroring the
shutdown-handoff terminal path), so the relay does not mistake a cancel for a
success and the durable POST never races the control plane into a `completed`.

### 4. Continue a stopped chat

Because a stop lands the conversation idle, the simplest continue is just the next
message — nothing is bricked. The richer **Continue** affordance (offered only on a
turn whose last outcome was `stopped`) re-drives a fresh turn WITHOUT re-posting
anything, exactly like re-driving a recovered turn (ADR / langy-turn-recovery): it
runs against the conversation already on record, whose history now includes the
stopped partial, so the agent continues from where it left off. It reuses
`startConversationTurn`'s `isRetry` path (no user-message write) and the daily
PR-permit reservation is not double-spent for the same intent.

### 5. Resume after a refresh

The transport already survives refresh; the browser just never rejoins. The
in-flight `turnId` lives on the conversation fold (`CurrentTurnId`), so the
`langy.messages` read surfaces `currentTurnId` alongside `isTurnInFlight`. On a
cold mount with a turn in flight, the panel resubscribes to `onTurnStream` for
that turn (the `resume-stream` trigger already exists), shows **"Catching up…"**,
replays the buffered tail, and keeps streaming — without re-sending the question.
If the turn finished (or was stopped) while away, the read shows no in-flight turn
and the panel renders the final/stopped answer instead of reattaching to nothing.

## Consequences

- **Additive to the fragile core.** No new event kind, command, or idempotency
  slot on the terminal path; a stop is one new enum value threaded through the two
  fold handlers and the finalize signature. The turn-terminal race is unchanged.
- **A stop is honest end-to-end.** Durable terminal + stream end give confirmation
  independent of the worker; the worker cancel + opencode abort stop the spend.
  Each degrades safely to the layer beneath it.
- **Cross-tab correctness falls out.** A stop is a real terminal on the shared
  stream, so a second tab attached to the same turn sees it end.
- **Cost.** One nullable enum value; one Go verb + a stored per-turn CancelFunc;
  one opencode control POST; a `currentTurnId` field on an existing read; frontend
  wiring for three states (stopping, stopped+continue, catching-up). No migration
  if the turn-fold status is stored schemalessly (confirm at implementation).

## Alternatives considered

- **A dedicated `agent_response_stopped` event.** Rejected: it would need its own
  command, schema, map-projection branch (to store the partial as a message), and
  fold handlers, and a *second* terminal slot to keep first-writer-wins — all to
  express what `outcome` already discriminates. The house already carries
  completed/failed on one `agent_responded`; stopped is the same shape.
- **Client-only stop (status quo) + a server "reap" sweep.** Rejected: the sweep is
  the liveness backstop for *dead* workers; using it for a deliberate stop means
  minutes of token burn and a UI that lies until the sweep catches up.
- **Worker-authored stop (the worker POSTs a stopped-final on cancel).** Rejected
  as the *primary* path: it makes confirmation depend on a live, responsive worker.
  Kept as the *token-burn* half only; the control-plane terminal is authoritative.
- **Kill the worker process to stop generation (`Pool.kill`).** Rejected as the
  default: it destroys the warm session and cold-starts the next turn. The opencode
  session abort is surgical; process kill stays the heavy fallback it already is.

## Open questions

1. **opencode abort route.** The adapter wires `prompt_async`, `shutdown_imminent`,
   and `/event`, but no abort. If the pinned opencode build exposes
   `POST /session/{id}/abort` (or equivalent), the token-burn halt is surgical; if
   not, this ADR ships tiers 1–2 (control-plane terminal + manager detach + stopped
   terminal frame) and the surgical opencode abort is a fast follow, with the turn
   still detaching cleanly in the meantime. Verify against the pinned build.
2. **Turn-fold projection version.** Adding a `stopped` status value does not change
   how any *existing* event folds (only new stopped terminals produce it), so no
   version bump / re-projection is strictly required. Confirm we are comfortable
   not bumping `CONVERSATION_TURN`.
3. **Continue depth.** V1 continues by re-driving against durable history. Reusing
   the ADR-048 handoff/`revive` machinery to resume the *same* opencode session
   (preserving in-memory context past a hard cancel) is a later enhancement.
