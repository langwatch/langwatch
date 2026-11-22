# ADR-046: Langy records meaningful conversation transitions as events

**Date:** 2026-07-14

**Status:** Accepted

**Storage amended by:**
[ADR-049](./049-langy-projection-independent-reactions.md), which places
operational projections and process state in Postgres while retaining the
event vocabulary and durable/ephemeral boundary defined here.

## Context

A Langy conversation must survive refreshes, worker restarts and process
handoffs without turning every streamed token into a durable event. The domain
needs a replayable record of user messages, tool activity and turn outcomes,
plus a low-latency ephemeral path for in-progress output.

## Decision

Each conversation is an event-sourced aggregate:

- aggregate type: `langy_conversation`;
- aggregate identity: the conversation ID;
- tenant identity: the project ID; and
- stable KSUID resource types for conversation and message IDs.

### Commands initiate domain work

The command vocabulary includes:

| Command                      | Purpose                               |
| ---------------------------- | ------------------------------------- |
| `SendMessage`                | accept a user message                 |
| `StartAgentTurn`             | begin an assistant turn               |
| `ReconcileAgentTurn`         | record the authoritative final answer |
| `ArchiveConversation`        | remove a conversation from active use |
| `UpdateConversationMetadata` | rename or update sharing metadata     |

Command retries reuse their command identity. Emitted events have deterministic
idempotency identities derived from the command and event position.

### Meaningful transitions are durable events

The event log records:

- `message_sent`;
- `agent_turn_started`;
- `tool_call_started` and `tool_call_completed`;
- `agent_responded`;
- `agent_turn_completed` and `agent_turn_failed`;
- `turn_finalized`;
- `conversation_archived`; and
- `conversation_metadata_updated`.

These are business facts that a replay may use to rebuild conversation,
message, turn and analytical projections. Tool calls are durable because they
are part of the audit of what the agent did, not because they are liveness
heartbeats.

### Tokens and progress are ephemeral

Individual streamed tokens, status reports, progress reports, worker
heartbeats and handoff tokens are not domain events. They travel through the
bounded Redis streaming/handoff surfaces and may be dropped after the durable
turn outcome is recorded.

`turn_finalized` is the authoritative final answer. A browser may render the
ephemeral stream for immediacy, but it reconciles to the finalized projection
and does not treat token delivery as the durable conversation record.

### Projections and process state are separate concerns

The ClickHouse `event_log` is the replay authority. ADR-049 owns the current
storage split:

- Postgres conversation, turn and message projections serve operational reads;
- the conversation process manager owns worker-dispatch and title-generation
  intent; and
- ClickHouse projections serve analytics.

An event subscriber receives a committed event and no projection state. A
projection subscriber may emit an invalidation only after its named projection
commits. Neither subscriber family runs during replay.

### Content and privacy boundaries

Process-manager rows contain IDs, compact status and bounded intent payloads,
not prompts, message bodies, tool output, credentials or handoff tokens.
Conversation content lives in the event log and product projections under the
project's retention and authorization policy.

Archiving is a domain fact and hides the conversation from normal reads. A
hard-erasure workflow must delete or tombstone the canonical event and
projection data explicitly; replay cannot resurrect data after that workflow.

## Alternatives considered

Persisting every token would turn streaming rate into event-log write rate and
make replay reproduce transport noise. Keeping the full conversation only in
Postgres would remove the canonical event history required for deterministic
rebuilds and process recovery. Treating tool transitions as ephemeral would
make the durable audit disagree with what the agent executed.

## Consequences

- Conversation and turn state can be rebuilt from meaningful facts.
- Streaming remains low latency without making each token durable.
- Worker dispatch and other stake-sensitive effects use process-manager intent.
- Operational and analytical projections can use different stores without
  changing the event contract.
- Hard erasure remains an explicit product workflow rather than a side effect
  of archiving.
