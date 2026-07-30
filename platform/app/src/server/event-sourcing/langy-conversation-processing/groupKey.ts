import { renderGroupKey, type GroupKey } from "@langwatch/event-sourcing";

/**
 * Dispatch-plane keys for the `langy_conversation` pipeline (ADR-100). Every
 * key is the typed `{tenantId, lane, scope}` descriptor, so `validateMount`
 * can check a fold's lane against its scope before any event is processed.
 */

/** `langyConversationState`: one lane per conversation. `scope: aggregate` is
 *  REQUIRED for a fold (ADR-100 §2, ADR-106) — two concurrent applies to one
 *  conversation would race the read-modify-write cycle. */
export function langyConversationStateGroupKey(args: {
  tenantId: string;
  conversationId: string;
}): GroupKey {
  return {
    tenantId: args.tenantId,
    lane: { kind: "fold", name: "langyConversationState" },
    scope: {
      kind: "aggregate",
      aggregateType: "langy_conversation",
      aggregateId: args.conversationId,
    },
  };
}

/**
 * `langyConversationTurn`: one lane per TURN. The fold's key is the composite
 * `${conversationId}:${turnId}`, so its lane must match — two turns of one
 * conversation may apply concurrently. `aggregateType` here labels the
 * dispatch lane; the persisted `AggregateType` stays `langy_conversation`.
 */
export function langyConversationTurnGroupKey(args: {
  tenantId: string;
  conversationId: string;
  turnId: string;
}): GroupKey {
  return {
    tenantId: args.tenantId,
    lane: { kind: "fold", name: "langyConversationTurn" },
    scope: {
      kind: "aggregate",
      aggregateType: "langy_conversation_turn",
      aggregateId: `${args.conversationId}:${args.turnId}`,
    },
  };
}

/**
 * `langyMessageOperational`: one lane per message-bearing event. Each event
 * carries a distinct `messageId`, so this is already maximum parallelism —
 * matching the old pipeline's `groupKeyFn` (one lane per
 * `(conversationId, messageId)`), which never coalesced message writes
 * either. `scope: event` states that explicitly rather than leaving it
 * implicit in a key that happens not to repeat.
 */
export function langyMessageOperationalGroupKey(args: {
  tenantId: string;
  eventId: string;
}): GroupKey {
  return {
    tenantId: args.tenantId,
    lane: { kind: "map", name: "langyMessageOperational" },
    scope: { kind: "event", eventId: args.eventId },
  };
}

/**
 * `langyAnalyticsEvent`: one lane per conversation, so every analytics event
 * a conversation produces (message, tool call, terminal, …) coalesces into
 * one ClickHouse batch instead of one insert per event — the shape ADR-100's
 * own context names as the defect the two production rollups shipped with.
 * `scope: aggregate` on a MAP is legal (ADR-106's legality table; only a fold
 * is required to use it) and is simply the batching unit here, not an
 * ordering requirement.
 */
export function langyAnalyticsEventGroupKey(args: {
  tenantId: string;
  conversationId: string;
}): GroupKey {
  return {
    tenantId: args.tenantId,
    lane: { kind: "map", name: "langyAnalyticsEvent" },
    scope: {
      kind: "aggregate",
      aggregateType: "langy_conversation",
      aggregateId: args.conversationId,
    },
  };
}

/**
 * The command lane: one lane per conversation, the ADR-100 default for a
 * command (`scope: aggregate`, unnamed — `serializeByAggregate` is retired,
 * so every command type for one conversation already shares this lane; there
 * is no per-command-type opt-out to make).
 */
export function langyConversationCommandGroupKey(args: {
  tenantId: string;
  conversationId: string;
}): GroupKey {
  return {
    tenantId: args.tenantId,
    lane: { kind: "command" },
    scope: {
      kind: "aggregate",
      aggregateType: "langy_conversation",
      aggregateId: args.conversationId,
    },
  };
}

/**
 * The process manager lane: `langyConversation`, keyed by conversation —
 * `processManager` is its own lane KIND (ADR-100 §1), not a `pm:` name
 * prefix riding the subscriber lane the way the old process framework keyed
 * it (`process-manager/subscriberName.ts`).
 */
export function langyConversationProcessManagerGroupKey(args: {
  tenantId: string;
  conversationId: string;
}): GroupKey {
  return {
    tenantId: args.tenantId,
    lane: { kind: "processManager", name: "langyConversation" },
    scope: {
      kind: "aggregate",
      aggregateType: "langy_conversation",
      aggregateId: args.conversationId,
    },
  };
}

export { renderGroupKey };
