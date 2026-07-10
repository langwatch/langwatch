# ADR-043: Event-sourced Langy conversations

**Date:** 2026-07-10

**Status:** Draft

## Context

Langy (the in-product LangWatch AI coding assistant, staff-only today) persists
a chat turn with a **dual write** across two databases:

- a thin Postgres `LangyConversation` spine (`id`, `projectId`, `userId`,
  `title`, `isShared`, `lastActivityAt`, `messageCount`, `deletedAt`) — the
  "conversation" row, and
- a ClickHouse `langy_messages` table (`ReplacingMergeTree(UpdatedAt)`,
  `ORDER BY (TenantId, ConversationId, MessageId)`) holding the per-message
  content (`Role`, `Parts`).

The two are joined **by value** (`conversationId`) with no foreign key, no
idempotency, and no way to replay. `POST /api/langy/chat` writes the message row
(`LangyMessageService.append`) and then bumps the spine
(`LangyConversationService.bumpActivity`) as two independent writes: a crash
between them silently desynchronises the message count / last-activity from the
stored messages. The content lives in ClickHouse deliberately (Rogerio's PR
#4913 note: hybrid-deployment customers must never have conversation content on
LangWatch infrastructure), but the *coordination* between spine and content has
none of the guarantees the rest of the platform gets from its event-sourcing
framework (`src/server/event-sourcing/`): per-aggregate FIFO ordering, an
append-only `event_log` source of truth, idempotent commands, and replayable
projections.

Langy is **not rolled out** (staff-only, gated by `release_langy_enabled`).
There is no production conversation data to migrate and no external contract to
preserve, so this is greenfield: we can make breaking changes freely.

This ADR covers **the conversation model and the read/write paths only** (PR2 of
a 4-PR stack). It deliberately does **not** build the streaming worker, the
Redis token buffer, or the reconcile reactor — those are PR3. PR2 defines the
`turn_finalized` event as the seam PR3 will drive.

## Decision

We will model a Langy conversation as an **event-sourced aggregate** on the
existing framework, and **delete the Postgres `LangyConversation` spine
outright** (no dual-write, no migration, no back-compat).

### Aggregate

- Aggregate type: **`langy_conversation`** (registered in
  `schemas/typeIdentifiers.ts`). `aggregateId = conversationId`,
  `TenantId = projectId` (the platform-wide convention).
- IDs are KSUIDs: `LANGY_CONVERSATION` (`langyconv`) and `LANGY_MESSAGE`
  (`langymsg`), added to `KSUID_RESOURCES`.
- Event/command type strings are `lw.langy_conversation.*`, calendar-versioned.

### Commands (imperative — a command initiates)

| Command | Emits | Dispatched by (PR2) |
|---|---|---|
| `SendMessage` | `message_sent` | `/chat` route, on the user's turn |
| `StartAgentTurn` | `agent_turn_started` | `/chat` route, when the agent turn begins |
| `ReportStatus` | `status_reported` | worker heartbeat (API surface; wired in PR3) |
| `ReportProgress` | `progress_reported` | worker progress (API surface; wired in PR3) |
| `ReconcileAgentTurn` | `turn_finalized` | `/chat` route, when the streamed answer completes |
| `ArchiveConversation` | `conversation_archived` | delete / clear-memory routes |
| `UpdateConversationMetadata` | `conversation_metadata_updated` | PATCH rename/share route |

`UpdateConversationMetadata` / `conversation_metadata_updated` is **beyond the
prescribed 6-command / 11-event vocabulary** — added to preserve the existing
`PATCH /langy/conversations/:id` rename+share surface (and its audit-log +
cross-user-visibility behaviour) without a feature regression. Flagged as an
open question below.

### Events (past-tense — an event records)

`message_sent`, `agent_turn_started`, `tool_call_started`,
`tool_call_completed`, `agent_responded`, `agent_turn_completed`,
`agent_turn_failed`, `status_reported`, `progress_reported`, `turn_finalized`,
`conversation_archived` (+ `conversation_metadata_updated`).

In PR2, six of these have a dispatching command (see table). The remaining
turn-lifecycle events — `tool_call_started`, `tool_call_completed`,
`agent_responded`, `agent_turn_completed`, `agent_turn_failed` — are the **PR3
seam**: their schemas and fold handlers ship now (so the projection is complete
and forward-compatible) but the worker/reactor that emits them lands in PR3.

### Streaming-persistence rule

Individual streamed tokens are **not** events — persisting one event per token
would flood `event_log`. Only meaningful transitions (turn start, tool calls,
final answer) and liveness signals (status/progress heartbeats) are events.
**`turn_finalized` carries the whole final answer payload as the source of
truth.** In PR3 the live token tail accumulates in a Redis buffer (not the
event log) and the worker emits one `turn_finalized` when the turn ends; in PR2
the `/chat` route, which still owns the stream, emits `turn_finalized` directly
after it assembles the full text.

### Ephemeral events (PR3 seam + cross-pipeline direction)

Not every event needs to be durable. `status_reported` and `progress_reported`
(and, in PR3, streamed token deltas) are pure **liveness/transport** signals:
they carry no state the conversation needs after the turn ends, and persisting
one per tick/token would flood `event_log`. We classify these as **ephemeral
events**: they keep the *same* event vocabulary and command surface as durable
events, but PR3 will route them to a short-lived, per-aggregate **Redis buffer**
(TTL'd) that backs the live UI transport, instead of appending them to
`event_log` / projecting them to ClickHouse.

The key invariant that makes this safe: because ephemeral events are never
replayed, the fold only lets them touch transient "live" fields (here,
`LastHeartbeatAt`). On replay they are simply absent and that field resets to
null harmlessly — no durable projection state depends on an ephemeral event.
Everything the conversation must keep (messages, counts, turn outcome) rides on
durable events (`message_sent`, `turn_finalized`, …).

PR2 ships the classification (`LANGY_EPHEMERAL_EVENT_TYPES` +
`isEphemeralLangyConversationEventType`) and the fold discipline; PR3 adds the
Redis ephemeral store + the routing that reads the classification. This is
deliberately a **candidate to generalise**: simulations already flood
`simulation_runs` with `text_message_start` / `text_message_end` /
`message_snapshot`, which are the same durable-vs-ephemeral split. The
classification should graduate from Langy-local to a framework-level durability
tag on the event/command definition, shared across pipelines, once the Redis
transport exists. Flagged as open question 4.

### Projections

- **Fold** `langyConversationState` → a **new** ClickHouse `langy_conversations`
  table (`ReplacingMergeTree(UpdatedAt)`, `ORDER BY (TenantId, ConversationId)`).
  Accumulates `UserId`, `Title`, `Status`, `IsShared`/`SharedAt`/`SharedById`,
  `MessageCount`, `LastActivityAt`, `LastHeartbeatAt`, `CurrentTurnId`,
  `LastError`, `ArchivedAt`. This replaces the Postgres spine.
- **Map** `langyMessageStorage` → the **existing** `langy_messages` table
  (reused as-is). Maps `message_sent` (the user message) and `turn_finalized`
  (the assistant's final message) into per-message rows.

### Domain errors (handled vs unhandled)

The Langy flow raises **handled domain errors** (via the platform
`app-layer/domain-error.ts` framework) wherever it knows the issue —
`LangyConversationNotFoundError` (404), `LangyConversationNotOwnedError` (403).
Each carries a serialisable `kind` discriminant, renderable `meta`, and an
`httpStatus`. The route returns `{ error: message, code: kind, meta }` for these
so Langy's UI (and an AI agent) can render a tailored experience by matching on
`kind`, never by parsing a message. **Unhandled** infrastructure errors
(ClickHouse `StoreError`, etc.) stay opaque: a generic message on the wire, the
detail in logs (`DomainError.isUnhandled` / `toUserMessage`).

`kind` is cross-process- and cross-language-safe by design, so a handled error
raised in the Go worker (PR1/PR3) can proxy across the boundary as the same
`kind` and render identically. **Content rule:** a domain error's `message` and
`meta` hold ONLY what a user, an AI agent, or the UI can act on (here: the
`conversationId` the caller already has) — never internal/private detail or
over-engineered payloads; those go to logs. Not every failure is an error: a
missing conversation on the list path is simply an empty list, not a surfaced
error.

### Delete becomes archive

"Delete conversation" and "clear memory" flip the fold's `ArchivedAt` /
`Status` via `conversation_archived` — no ClickHouse hard-deletion (explicitly
out of scope). The list/read queries filter `ArchivedAt IS NULL`.

### Read/write wiring

`LangyConversationService` and `LangyMessageService` are rewritten: writes
become command dispatch; reads become ClickHouse projection queries (fold table
for conversation state, `langy_messages` for content). The conversation domain
moves under `app-layer/langy/` (alongside the other app-layer domains —
`simulations`, `suites`, …); the Langy credential/GitHub/key services stay in
`services/langy/` (PR1's territory). Both services are constructed at the
composition root (`app-layer/presets.ts`) with their command dispatchers + read
repositories injected, and exposed on the `App` as `app.langy`. The
`/chat` route's dual write (`persistMessage` + `bumpActivity`) collapses into a
single `SendMessage` dispatch; the assistant persist collapses into
`ReconcileAgentTurn`. Routes call services only; services call repositories /
dispatchers — never ClickHouse or the pipeline directly. Every ClickHouse query
filters `TenantId` first and dedups with `argMax`/`max(UpdatedAt)` in an
IN-tuple subquery (never `FINAL`).

## Rationale / Trade-offs

- **One source of truth.** The append-only `event_log` becomes authoritative;
  both the conversation row and the message rows are *derived* projections, so
  they cannot drift from each other the way the dual write can. A desynced
  count is now a replay away from repair.
- **Idempotency + ordering for free.** Commands carry idempotency keys and the
  in-house Redis GroupQueue serialises per-aggregate (per-conversation) FIFO, so
  SDK/agent retries collapse and message order is deterministic.
- **Content stays customer-side.** The map projection still writes to
  `langy_messages` in ClickHouse, preserving the hybrid-deployment guarantee.
  The fold's `langy_conversations` table holds only spine-level metadata (title,
  counts, timestamps, sharing) — no message content — so nothing that was
  customer-side moves back onto LangWatch infra.
- **Eventual consistency is the accepted cost.** The fold is written by the
  worker asynchronously, so `messageCount` / `lastActivityAt` / a freshly
  created conversation appear in the list a beat after the turn. For a
  staff-only tool at low volume this is acceptable; the trade is the same one
  every other pipeline on this framework already makes.
- **Ownership checks are read-time.** `ensureConversation` verifies ownership
  against the fold; on a rapid second turn the fold may not be written yet, in
  which case the id is treated as new/first-turn. `message_sent`'s fold handler
  sets `UserId` on the first event only (first-writer-wins), so a late continue
  cannot silently re-owner a conversation.

## Consequences

- The Postgres `LangyConversation` model and its relations are deleted; a Prisma
  migration drops the table. `LangyMessage` never existed in Postgres, so
  nothing else moves.
- A new ClickHouse migration creates `langy_conversations`; `langy_messages` is
  untouched (reused as the map sink).
- `LangyConversationService` / `LangyMessageService` no longer take a
  `PrismaClient`; they are built at the composition root and reached via
  `app.langy`. The `/chat`, conversation-management, and memory routes call
  `getApp().langy.*`.
- PR3 can build the streaming worker + reconcile reactor against a stable event
  vocabulary: it drives `turn_finalized` (and the turn-lifecycle seam events)
  without touching the model defined here.
- GDPR hard-erase is now archive-only (soft). A ClickHouse purge path for
  Langy is a follow-up (out of scope here).

## Open questions (for review)

1. **Rename/share beyond the prescribed vocabulary.** I kept the PATCH
   rename+share route working via `UpdateConversationMetadata` /
   `conversation_metadata_updated`. Alternative: drop the PATCH surface entirely
   in PR2 and treat title as first-message-derived + immutable, deferring share.
2. **List-query time window.** Listing "my conversations" has no natural
   partition-key time cap. I bound the fold-table list scan to a rolling window
   (`CreatedAt >= now() - INTERVAL 12 MONTH`) for partition pruning; older
   archived-off conversations fall out of the list. Confirm the window.
3. **Retention.** `langy_conversations` ships without a `_retention_days` TTL
   column (matching the existing `langy_messages` shape). A retention/erase
   sweep for Langy content is deferred.
4. **Ephemeral events as a framework concept.** PR2 keeps the ephemeral
   classification Langy-local. Should it graduate to a framework-level
   durability tag on the event/command definition (so simulations' streaming
   snapshot events reuse the same Redis transport), and if so, in PR3 or a
   dedicated framework change?

## References

- Spec: [`specs/langy/langy-event-sourced-conversations.feature`](../../../specs/langy/langy-event-sourced-conversations.feature)
- Framework: `src/server/event-sourcing/ARCHITECTURE.md`, `README.md`
- Template pipeline: `src/server/event-sourcing/pipelines/simulation-processing/`,
  `experiment-run-processing/` (fold + map + append store)
- Related ADRs: ADR-033 (Langy worker network isolation), ADR-022
  (event-log source of truth), ADR-034 (event-sourced analytics materialization)
- Prior art: PR #4913 (Langy dual-write baseline), migration
  `00036_create_langy_messages.sql`
