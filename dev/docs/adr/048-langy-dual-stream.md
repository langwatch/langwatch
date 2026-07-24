# ADR-048: Langy dual-stream — raw token fast-path (Stream B) alongside the durable event-sourced stream (Stream A)

**Date:** 2026-07-11

**Status:** Accepted

**Builds on:** ADR-044 (Langy event-driven turns: out-of-band spawn + Redis token
buffer + liveness), ADR-046 (event-sourced Langy conversations: durable
`message_sent`/`tool_call_*`/`turn_finalized` + `langy_conversation_updated`
broadcast + ephemeral status/progress), ADR-047 (hexagonal Go manager). Does
**not** change any of those models — it adds one ephemeral channel beside them.

## Context

Langy's live answer reaches the browser today through **one** path (ADR-044):

```
opencode → manager /chat (ndjson) → runTurn (worker) → Redis token buffer
        → browser useChat stream (attachTurnStream: XRANGE tail + XREAD BLOCK follow)
```

That path is the **truth**: durable, replayable, survives refresh, and the
authoritative final answer is the `turn_finalized` event, not the tokens. But it
is deliberately *slow at the edge* for good reasons that we do not want to
change:

- `runTurn` runs **out of band** — it is dispatched by the `spawnAgent` reactor
  off `agent_turn_started`, not on the browser's request socket. Time-to-first
  token includes event dispatch → GroupQueue drain → reactor → pool → manager
  spawn.
- The token buffer **batches** `CHUNK_TOKENS = 64` words before flushing a
  `delta` to Redis (bounds XADD volume on a fast stream), and the reader picks it
  up via `XREAD BLOCK`. So the durable answer *visibly* arrives in ~64-word
  chunks, never token-by-token.

The result is correct and resumable but not *fast* to first paint or *smooth* as
it types. We want a genuinely low-latency "it's typing" experience without giving
up the durable stream's correctness, replay, or the reconciled final answer.

## Decision

Run **two** streams. Stream A is the existing durable path, unchanged. Stream B
is a new ephemeral raw-token pipe optimised purely for time-to-first-token and
smoothness.

### Stream A — durable / event-sourced (the truth). Unchanged.

Everything in ADR-044/046 stays exactly as is: the token buffer, the
`useChat` bridge, `useLangyFreshness` / `useLangyTurnSignals`, the
`langy_conversation_updated` broadcast, and `turn_finalized` as the
authoritative final answer. Stream A renders tool-call cards, progress, and the
reconciled final message; it survives refresh (the buffered tail is the
"resume" state); it is authoritative and slightly behind.

### Stream B — raw agent tokens (speed). New.

A thin pipe of the opencode `text-delta` tokens straight to the UI, with minimal
parsing, ephemeral, not persisted, and dying on disconnect. Three layers:

1. **Manager (Go) — a *multiplexed frame*, not a second endpoint.** The manager
   already tails opencode `/event` **once** per turn in `streamSessionEvents`
   and unmarshals each event for session routing + terminal detection. When that
   already-parsed event is a text delta, it additionally writes a compact
   `{"type":"langy.token","text":"<verbatim delta>"}` ndjson frame — flushed
   immediately, *before* the verbatim full-event line — then forwards the full
   event line exactly as before. The delta text is passed through verbatim; the
   only new work is one map lookup + one small write per delta.

2. **Control plane — split at `runTurn`, fan onto an ephemeral Redis pub/sub.**
   `runTurn` already reads every manager frame. It now routes the new
   `langy.token` frame to a dedicated **fire-and-forget Redis pub/sub channel**
   (`langy:fast:{conv}:turn`), separate from the durable XADD buffer. The
   existing `message.part.delta` frames continue to feed the durable buffer
   byte-for-byte — so the two channels never share state and the durable path is
   untouched. A new SSE route `GET /langy/conversations/:id/fast?turnId=`
   subscribes to that channel and streams raw tokens to the browser. Pub/sub, not
   a stream: **no persistence, no replay** — a subscriber that joins late or
   disconnects simply misses tokens, which is exactly the ephemeral contract.

3. **Frontend — a dual consumer with a length-monotone reconciliation.** A new
   `useLangyFastStream` hook consumes Stream B and accumulates the optimistic
   answer text. The existing `StreamingText` renders it. On `turn_finalized`
   (Stream A) the optimistic text is dropped and the persisted message +
   settled tool calls take over.

### Why a multiplexed frame, not a second manager endpoint

A second manager endpoint tailing opencode `/event` for the same worker would
mean a **second upstream subscription** (double the load opencode holds open) and
a **worker-lookup-by-conversation race** against the out-of-band spawn (the raw
endpoint could arrive before the worker exists). It would also need its own
auth/isolation reasoning. Multiplexing keeps **one** opencode subscription, **one**
parse pass, and inherits the `/chat` route's guarantees unchanged: same internal
bearer secret, same per-worker `Claim`, same session routing (ADR-033/047). There
is nothing new to secure and no new goroutine to panic-guard on the manager —
the frame rides the existing `StreamEvents` goroutine.

### Why the split lives at `runTurn`, and pub/sub not the buffer

`runTurn` is already the single reader of the manager stream, so branching there
adds no new consumer of opencode. Using Redis **pub/sub** (not the XADD token
buffer) makes Stream B truly ephemeral by construction — messages published with
no subscriber are dropped, there is no TTL key to clean, and a disconnect ends
it. The web SSE route subscribes on a duplicated connection (same pattern as
`BroadcastService`), so the worker→web hop is a plain publish. Stream B does not
touch the tenant-wide broadcast bus — it is a per-turn channel, so a chatty token
stream never competes with `langy_conversation_updated` fan-out or its rate
limiter.

### UI reconciliation contract

The optimistic (fast) text and the durable (`useChat`) text are reconciled by a
pure, length-monotone rule (`reconcileOptimisticText`):

- Render the **fast** text only while it is a *superset* of the durable text
  (`fast.startsWith(durable) && fast.length > durable.length`); otherwise render
  the durable text.
- This shows the fast lead immediately (durable starts empty, and `"".startsWith`
  is always true), keeps it ahead as the 64-word durable batches catch up, and —
  crucially — **falls back to durable** if Stream B ever has a gap (e.g. it
  subscribed a token late), so the UI can never show corrupted/mis-prefixed text.
- On `turn_finalized`, `isStreaming` flips false: `MessageContent` switches from
  `StreamingText` to the Markdown render of the **persisted** message and settles
  tool-call cards. The optimistic text is no longer consulted. Because the
  durable buffer flushes its tail on `markEnd` *before* `end`, the durable text
  is complete at that instant — no flash of shorter text.
- On mid-stream refresh, Stream B is gone (nothing replays it) but Stream A
  replays the buffered token tail via `GET /conversations/:id/stream`. No lost
  work.

## Consequences

- **Faster first paint + smooth typing** without weakening the durable stream:
  Stream B is per-token over pub/sub; Stream A stays 64-word-batched and
  authoritative.
- **Additive and merge-isolated.** New Go helper (`textDeltaFromEvent`) + one
  extra frame; new TS module (`langyFastStream.ts`); one new SSE route; one new
  hook + one pure reconciler. Shared render files change minimally: `MessageContent`
  gains one optional `optimisticText` prop consulted only in the streaming branch;
  `LangyPanel` captures `x-langy-turn-id` and mounts the hook.
- **Best-effort by design.** A dropped token, a missed subscribe window, or a
  Redis blip degrades Stream B to "durable only" — never an error, never lost
  data. The durable stream remains the contract.
- **No new attack surface.** Stream B rides the existing `/chat` auth on the
  manager and the same session+ownership gate (`requireSessionAndPermission` +
  `conversations.getById`) as the resume route on the control plane. The channel
  is keyed per (conversation, turn); the SSE route refuses a turn the caller
  cannot see.
- **Cost.** One extra tiny ndjson frame per delta on the manager→worker hop, and
  one Redis publish per token on the worker→web hop (fire-and-forget, dropped
  when no browser is attached). Bounded by the answer length; no persistence.

### Alternatives considered

- **Second manager endpoint (read-only `/event` tail).** Rejected: double
  opencode subscription + spawn race + new auth surface (see above).
- **Discriminated frame on the existing `useChat` stream.** Rejected: that stream
  is the Vercel-AI-SDK UI-message protocol (Stream A) and must stay as-is; a
  separate SSE keeps Stream B independent and lets it die on disconnect without
  perturbing Stream A.
- **Lower `CHUNK_TOKENS` / drop batching on the durable buffer.** Rejected: that
  trades away the XADD-volume bound that protects Redis on fast streams, and
  still carries the out-of-band spawn latency. Stream B gets speed *without*
  touching the durable path's tuning.
- **Publish tokens onto the tenant `BroadcastService`.** Rejected: tenant-wide
  fan-out + a shared rate limiter is the wrong shape for a per-turn token torrent;
  a dedicated per-turn channel isolates it.
