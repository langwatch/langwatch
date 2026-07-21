# ADR-059: Event-sourced Langy frontend — shared projections in `packages/langy`

**Date:** 2026-07-21

**Status:** Proposed (forked off ADR-058's branch; incremental, turn-document-first)

**Builds on:** ADR-046 (event-sourced conversations), ADR-048 (dual-stream),
ADR-049 (Postgres projections), ADR-058 (turn-phase machine — the proof of
concept for the pure-reducer pattern this ADR generalises).

**Spec:** [`specs/langy/langy-event-sourced-frontend.feature`](../../../specs/langy/langy-event-sourced-frontend.feature)
— which *evolves* `langy-frontend-realtime.feature` (signal-then-refetch →
signal-then-fold-the-tail) while keeping its core invariant: the real-time
channel never pushes conversation data.

## Context

The Langy backend is event-sourced: domain events fold, through pure handlers,
into projections (`langyConversationState`, `langyConversationTurn`,
`langyMessageStorage`). The **frontend** re-derives its own view of the same
turn out of a pile of ad-hoc, per-render signals — `isBusy`,
`serverTurnInFlight`, a settled-marker, `isStopping`, `isFoldTurnInFlight` — plus
a React-Query "signal-then-refetch" that re-downloads the whole projection on
every change. Two hand-written models of one turn, free to drift, and a data
layer that fights async timing by hand (ADR-058 already had to consolidate one
corner of it into a state machine).

ADR-058's `langyTurnPhase` proved a better shape: a **pure `(state, event) →
state` reducer** the store wires in a few lines and the UI reads as one value.
The backend's fold handlers are *already* that shape — they are just wrapped in
projection plumbing (server-only store + versioning). So the frontend can fold
the **same events** through the **same reducers** and hold its turn/conversation
view as a genuine projection — event-driven, backend-driven, and replayable —
instead of a bag of booleans.

## Feasibility — verified against the storage layer

Every load-bearing mechanism this ADR needs already exists in production form;
none of it is speculative. Traced 2026-07-21:

- **The cursor is already a system primitive.** `ProjectionCursor
  { acceptedAt, eventId }` (KSUID tie-breaker) is defined in
  `event-sourcing/projections/stateProjection.types.ts`, persisted per document
  by `StateProjectionStore` (`StoredProjection.cursor`) — including by the
  Langy turn fold — with a comparator in
  `app-layer/langy/subscribers/projection-cursor.ts`. "Snapshot + cursor" means
  exposing a stored field, not inventing one.
- **The live push channel exists.** The
  `langyConversationUpdateBroadcast` subscriber receives every Langy event
  **in-band from the Redis queue** (no event-log read), waits until the
  Postgres projection's cursor has reached the event, then publishes on
  `broadcastToTenant` → the `onConversationUpdate` SSE, behind a fail-closed
  per-user visibility gate (`langyConversationUpdateVisibility.ts`).
- **ClickHouse is never on the live path — and the catch-up read is cheap by
  construction.** `event_log` is
  `ORDER BY (TenantId, AggregateType, AggregateId, IdempotencyKey)`, so a
  per-conversation tail read is a primary-key-prefix scan; weekly partitions
  plus the existing `EventOccurredAt >=` predicate prune cold storage; and the
  strict-after cursor WHERE clause already exists in
  `getEventRecordsUpToPaged` — the tail query is that clause minus the upper
  bound.
- **No read-after-write gap.** Event inserts use `async_insert: 1,
  wait_for_async_insert: 1`: an acknowledged append is immediately visible to a
  catch-up read.
- **ReplacingMergeTree duplicates are handled** — the abstract store dedups by
  idempotency key after every read (`deduplicateEvents`), and the folds are
  idempotent regardless.

Net: no new infrastructure, no schema migration, no CH scaling concern.

## Decision

### 1. One projection library, shared by both sides: `packages/langy`

Extract the **pure** projection logic — event schemas (Zod, already portable),
state types, the cursor type + its comparator, and the fold reducers — into a
new source-only workspace package `@langwatch/langy` (`packages/langy`, exports
`./src/index.ts`, no build step), consumed by `langwatch/` via `workspace:*`
exactly like `@langwatch/cli-cards`.

- **Server** keeps its thin fold-projection wrappers, but the handler bodies
  become calls into the shared reducer (`foldTurn(state, event)`), the way
  `langyStore` wires `langyTurnPhase`. The event append pipeline, ClickHouse,
  Postgres, versioning — all stay server-side.
- **Client** imports the same reducer and folds a local projection.
- **Constraint:** the package must not leak server deps (ClickHouse / Prisma /
  Node / `~/server` aliases). The one shared primitive the schemas need — the
  event envelope — is a plain Zod object and moves with them (the server type
  aliases it). `zod` is a peer dependency so both sides share one instance.
- **One comparator.** Cursor ordering is `(acceptedAt, eventId)` with
  **byte-wise** string comparison on the KSUID — never `localeCompare` (a bug
  class we have hit before). The package exports the single comparator; the
  server's `projection-cursor.ts` consumers are updated to import it (no
  re-export shim).

`langyTurnPhase` moves into this package first, unchanged, as the seed.

### 2. Loading model: snapshot, then only the tail

The client never replays full history — the projection **is** the compressed
history:

1. **On open:** read the current projection (spine + turn documents + messages)
   as a snapshot, plus its **cursor** (the `ProjectionCursor` the store already
   persists next to the state).
2. **Subscribe** to the conversation's live signal **before** the snapshot
   read, buffering.
3. **Catch up** by fetching the recorded events strictly after the cursor and
   folding them locally with the shared reducer.

Gaplessness rests on two properties inherited for free:
- **Subscribe-before-snapshot:** signals buffered during the snapshot read are
  processed after it; any that point at-or-before the snapshot cursor are
  no-ops.
- **Idempotent, order-insensitive-by-cursor folds:** a re-delivered or
  overlapping event is dropped by the cursor comparison, so snapshot/stream
  overlap is harmless — which is also what makes the local tail *replayable*.

### 3. The durable channel: signal-carries-the-cursor, tail via query

**(Amended from "signal-carries-the-event" after the feasibility trace.)**

The broadcast payload gains the projection **cursor** (the subscriber already
holds it — it reads the cursor today for its projection-ready check). The
client compares the signalled cursor with its local one; if ahead, it fetches
the tail through a new **authorized query** (`events after cursor`, gated
exactly like reading the conversation) and folds it. Three reasons this beats
pushing events over the broadcast:

1. **The subscriber coalesces** (15s dedup per conversation). Correct for
   signals; would *drop events* if the signal were the event. Signal+cursor is
   immune — any signal means "fetch everything after my position", so
   coalescing becomes a feature (one fetch per burst).
2. **The broadcast channel is tenant-wide.** Every member's SSE sees every
   conversation's signal, filtered per-event by the visibility gate. A cursor
   is inert if it leaks past a gate bug; an `agent_responded` payload is not.
   The tail fetch reuses the read path's authorization — one implementation.
3. **It preserves `langy-frontend-realtime.feature`'s invariant** — the
   real-time channel never pushes conversation data.

The token stream (ADR-048 Stream B) stays the ephemeral fast-path for delta
text / reasoning. The optimistic token text reconciles against the folded
durable answer — the same length-monotone rule as today, but the "durable" side
is now a *local fold* rather than a re-fetch.

### 4. Ad-hoc state collapses into the projection

`turnPhase`, the working-line signals, the feedback gate, "is a turn in flight"
— all become **derivations of the local projection**, with one honest
exception: the instant between clicking Send and the backend recording
`agent_turn_accepted` is covered by an **optimistic pending-command overlay**
that reconciles against (and is erased by) the fold. `isBusy` survives only as
what it actually is: the client token stream's liveness, an input to
reconciliation, not a second source of turn truth.

## Full plan

Each phase is a separately reviewable, separately shippable PR with its own
green test run. Phases 0–2 change no user-visible behaviour. Stop and review
after each.

### Phase 0 — cleanups (this branch, first commit)

Sharpen the seams the later phases build on; no behaviour change.

- Remove the `messages as unknown as Parameters<…>` cast in `LangyPanel.tsx` by
  typing `deriveWaveActivity`'s parameter to the message shape it actually
  reads.
- Fold `resetChatEngine`'s `void stop(); clearError(); recovery.reset();` into
  one owned chat-engine reset seam (single function owned by the engine hook,
  called by the panel).
- Sweep `features/langy` for `as any` / `as unknown as`; eliminate each or
  leave a justifying comment where a third-party boundary genuinely forces it.
- **Exit:** existing langy frontend suites green; no rendering change.

### Phase 1 — `packages/langy` + shared reducers (no behaviour change)

- Scaffold `packages/langy` modeled on `packages/handled-error`: `private`,
  `"type": "module"`, `exports → ./src/index.ts`, `incremental` +
  per-package `tsBuildInfoFile`, `zod` as **peer** dependency; add
  `"@langwatch/langy": "workspace:*"` to `langwatch/package.json`.
- Move in, as the seed, `features/langy/stores/langyTurnPhase.ts` + its unit
  test; update the `langyStore` import.
- Move the event schemas (`pipelines/langy-conversation-processing/schemas/
  events.ts` + `constants.ts` + the shared Zod helpers they need) into the
  package with a portable event-envelope type; the server aliases it.
- Move `ProjectionCursor` + a byte-wise `cursorHasReachedEvent` /
  `compareCursor` into the package; update the server's subscriber and
  projection imports (no re-exports).
- Extract the `langyConversationTurn` fold body into a pure
  `foldTurn(state, event)` in the package; the server projection becomes a thin
  wrapper. Point the existing fold tests at the shared reducer.
- **Pinning test (time base):** the comparator compares `cursor.acceptedAt`
  against `event.createdAt`, and the CH tail read orders by `EventTimestamp` —
  pin, with a unit test at the store seam, that these are the same clock
  (log-acceptance time), so a cursor from Postgres is valid against a tail from
  ClickHouse.
- **Exit:** langy backend + frontend suites green; `packages/langy` has no
  server imports (typecheck of the package alone proves it).

### Phase 2 — cursor on the signal + authorized tail read (backend only)

- Broadcast payload gains `cursor` (`langy-conversation-update-broadcast.
  subscriber.ts` already holds `record.cursor`); the client-facing signal
  schema passes it through (owner/share fields stay server-side-stripped).
- New event-store read `getEventsAfter({ tenantId, aggregateType, aggregateId,
  after: cursor, limit })`: the strict-after clause from
  `getEventRecordsUpToPaged` minus the upper bound, `ORDER BY (EventTimestamp,
  EventId)`, with the `EventOccurredAt` lower-bound predicate derived from
  `after.acceptedAt` (minus a safety window) for partition pruning. TenantId is
  the first predicate, per house CH rules.
- New service method (`LangyConversationService` or the turn service):
  `getConversationEventsAfter({ projectId, conversationId, userId, after })` —
  visibility guard identical to `getById` (owner-or-shared), **HandledErrors
  only** (`LangyConversationNotFoundError` / `LangyConversationNotOwnedError`),
  returns shared-schema-parsed events + the next cursor.
- New tRPC query `langy.conversationEventsAfter` on the langy procedure, gated
  like the existing watch path.
- **Exit:** service unit tests (auth refusal, strict-after paging, empty tail);
  signal schema test; no frontend change yet.

### Phase 3 — client fold for the turn (snapshot + tail) — the vertical slice

- Expose the turn document's stored `cursor` on the snapshot read path
  (`{ state, cursor }` — mechanical; the store already persists it).
- New store slice: the local turn projection — `{ turn, cursor }` plus
  `applyDurableEvents(events)` folding through the shared `foldTurn` with
  cursor-guarded idempotence; signal handling becomes "if signalled cursor >
  local cursor, fetch tail, fold".
- Subscribe-before-snapshot wiring in the panel's coordinator; buffered signals
  drained after snapshot load.
- `turnPhase` collapses into a **derivation**: recorded turn status ⊕ the
  optimistic pending-command overlay (send clicked, not yet
  `agent_turn_accepted`) ⊕ stop-requested. The ADR-058 reducer shrinks to the
  overlay; backend truth comes from the fold.
- Token-stream reconciliation now compares against the folded answer (same
  length-monotone rule); **rejoin-after-refresh** falls out: load snapshot →
  fold tail → if the folded turn is in flight, reattach the token stream — the
  remaining half of `langy-stop-and-resume`.
- **Exit:** the spec's refresh/rejoin, catch-up, idempotence, and composer
  scenarios pass; the turn document renders from the fold alone. Short-lived
  flag only if the diff demands it; removed in Phase 4.

### Phase 4 — spine + messages under the fold; retire the leftovers

- The conversation spine (`langyConversationState`) gets the same treatment:
  shared `foldConversation`, snapshot+tail in the store.
- Messages: extract the message *map* logic (`langyMessageOperational.
  mapProjection`) into a shared `mapMessageEvent(event)`; the client applies it
  over the same tail to maintain the open conversation's message list. The
  recents *list* stays React Query + signal-then-refetch (slim, cross-
  conversation — the old model is right there).
- Retire: `isBusy`-as-turn-truth, signal-then-refetch for the *open*
  conversation, and the remaining derived booleans.
- **Exit:** full spec green; `features/langy` holds no turn/conversation state
  outside the projection slice + the optimistic overlay.

## Risks

- **Fold purity.** The extracted reducers must not drag server imports into
  the package — surfaced immediately at the module graph in Phase 1.
- **Cursor comparison.** Byte-wise KSUID ordering, one shared comparator —
  regression here corrupts catch-up on both sides at once; pinned by package
  unit tests.
- **Time base.** `acceptedAt` (Postgres cursor) vs `EventTimestamp` (CH order)
  must be the same clock; pinned by the Phase 1 test before Phase 3 trusts it.
- **Tenant-wide fan-out.** Unchanged payload class (a cursor is as inert as
  today's invalidation), but the visibility gate remains load-bearing; its
  fail-closed tests stand.
- **Phase 4 breadth.** The message map is the widest surface; that is exactly
  why the turn document ships first as the validating slice.

## Alternatives considered

- **Keep signal-then-refetch, just tidy the booleans.** Rejected as the
  ceiling: it leaves two models of a turn and re-downloads projections; ADR-058
  showed the booleans want to be a fold, and a fold wants the events.
- **Signal-carries-the-event (this ADR's own first draft).** Rejected after
  the feasibility trace: it fights the subscriber's coalescing (dropped
  events), fattens a tenant-wide channel with content the visibility gate must
  then protect, and breaks the realtime spec's no-data-on-the-channel
  invariant. Signal+cursor keeps all three properties and costs one indexed CH
  read per burst.
- **Ship the reducers from `langwatch/src/shared` instead of a package.**
  Workable, but a package is the existing convention for code both the server
  and client import (`cli-cards`, `handled-error`), enforces the
  no-server-deps boundary at the module graph, and fits the `/packages`
  consolidation direction.
- **Replay full event history on the client.** Rejected: unbounded; the
  snapshot already is the folded history — only the live tail needs folding.

## Consequences

- New `packages/langy` (`@langwatch/langy`), `workspace:*` dep of `langwatch/`.
- Server fold projections become thin wrappers over shared reducers (ADR-058
  shape), with no change to storage, versioning, or the event vocabulary.
- The broadcast signal gains a cursor; a new authorized tail-read query joins
  the langy router (Phase 2), backed by one new event-store read.
- The frontend data layer for the open conversation moves from
  refetch-on-signal to fold-the-tail; React Query remains the snapshot loader
  and the recents list.
