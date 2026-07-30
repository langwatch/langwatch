import { createHash } from "node:crypto";
import {
  LANGY_CONVERSATION_EVENT_TYPES,
  LANGY_CONVERSATION_EVENT_VERSIONS,
  type LangyMessagePart,
  type LangyMessageProjectionRecord,
  type LangyMessageRole,
  mapLangyMessageEvent,
} from "@langwatch/langy";
import { z } from "zod";

/** Deterministic JSON: object keys sort so the hash never depends on
 *  property order; array order stays meaningful. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const fields = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`);
    return `{${fields.join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Short, stable digest of an event's own payload — see `analyticsRow`. */
function stableEventDataHash(data: unknown): string {
  return createHash("sha256")
    .update(stableJson(data))
    .digest("hex")
    .slice(0, 16);
}

/**
 * One content-free analytics row per canonical event: dimensions only, never
 * message content and never an operational read.
 */
export const langyAnalyticsEventRecordSchema = z.object({
  eventId: z.string(),
  eventType: z.string(),
  eventVersion: z.string(),
  aggregateId: z.string(),
  turnId: z.string().nullable(),
  userId: z.string().nullable(),
  role: z.string().nullable(),
  toolName: z.string().nullable(),
  outcome: z.string().nullable(),
  model: z.string().nullable(),
  durationMs: z.number().nullable(),
  occurredAt: z.number(),
  acceptedAt: z.number(),
});

export type LangyAnalyticsEventRecord = z.infer<
  typeof langyAnalyticsEventRecordSchema
>;

type KnownDimensions = Partial<
  Omit<
    LangyAnalyticsEventRecord,
    | "eventId"
    | "eventType"
    | "eventVersion"
    | "aggregateId"
    | "occurredAt"
    | "acceptedAt"
  >
>;

/**
 * `eventId` and `acceptedAt` stand in for the event log's own id and accept
 * time: a `.withMap` handler is handed only `(data)`, so neither reaches this
 * function. `eventId` is deterministic in the event's own payload alone — the
 * same requirement ADR-105 puts on an intent's `messageKey` — so a
 * redelivery of the identical event lands on the same row, while two
 * genuinely distinct events sharing `(aggregateId, type, occurredAt)` (e.g.
 * two parallel tool calls in the same millisecond) still land on different
 * ones.
 */
function analyticsRow(args: {
  readonly type: string;
  readonly eventVersion: string;
  readonly aggregateId: string;
  readonly occurredAt: number;
  readonly payload: unknown;
  readonly known?: KnownDimensions;
}): LangyAnalyticsEventRecord {
  const known = args.known ?? {};
  return {
    eventId: `${args.aggregateId}:${args.type}:${args.occurredAt}:${stableEventDataHash(args.payload)}`,
    eventType: args.type,
    eventVersion: args.eventVersion,
    aggregateId: args.aggregateId,
    turnId: known.turnId ?? null,
    userId: known.userId ?? null,
    role: known.role ?? null,
    toolName: known.toolName ?? null,
    outcome: known.outcome ?? null,
    model: known.model ?? null,
    durationMs: known.durationMs ?? null,
    occurredAt: args.occurredAt,
    acceptedAt: args.occurredAt,
  };
}

export const langyAnalyticsEventRecords = {
  conversationStarted: (data: {
    conversationId: string;
    userId: string;
    occurredAt: number;
  }) =>
    analyticsRow({
      type: LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_STARTED,
      eventVersion: LANGY_CONVERSATION_EVENT_VERSIONS.CONVERSATION_STARTED,
      aggregateId: data.conversationId,
      occurredAt: data.occurredAt,
      payload: data,
      known: { userId: data.userId },
    }),
  conversationForked: (data: {
    conversationId: string;
    userId: string;
    occurredAt: number;
  }) =>
    analyticsRow({
      type: LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_FORKED,
      eventVersion: LANGY_CONVERSATION_EVENT_VERSIONS.CONVERSATION_FORKED,
      aggregateId: data.conversationId,
      occurredAt: data.occurredAt,
      payload: data,
      known: { userId: data.userId },
    }),
  messageRecorded: (data: {
    conversationId: string;
    userId: string;
    role: string;
    occurredAt: number;
  }) =>
    analyticsRow({
      type: LANGY_CONVERSATION_EVENT_TYPES.MESSAGE_RECORDED,
      eventVersion: LANGY_CONVERSATION_EVENT_VERSIONS.MESSAGE_RECORDED,
      aggregateId: data.conversationId,
      occurredAt: data.occurredAt,
      payload: data,
      known: { userId: data.userId, role: data.role },
    }),
  messageImported: (data: {
    conversationId: string;
    role: string;
    occurredAt: number;
  }) =>
    analyticsRow({
      type: LANGY_CONVERSATION_EVENT_TYPES.MESSAGE_IMPORTED,
      eventVersion: LANGY_CONVERSATION_EVENT_VERSIONS.MESSAGE_IMPORTED,
      aggregateId: data.conversationId,
      occurredAt: data.occurredAt,
      payload: data,
      known: { role: data.role },
    }),
  agentTurnAccepted: (data: {
    conversationId: string;
    turnId: string;
    occurredAt: number;
  }) =>
    analyticsRow({
      type: LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_ACCEPTED,
      eventVersion: LANGY_CONVERSATION_EVENT_VERSIONS.AGENT_TURN_ACCEPTED,
      aggregateId: data.conversationId,
      occurredAt: data.occurredAt,
      payload: data,
      known: { turnId: data.turnId },
    }),
  toolCallInitiated: (data: {
    conversationId: string;
    turnId: string;
    toolCallId: string;
    toolName: string;
    occurredAt: number;
  }) =>
    analyticsRow({
      type: LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_INITIATED,
      eventVersion: LANGY_CONVERSATION_EVENT_VERSIONS.TOOL_CALL_INITIATED,
      aggregateId: data.conversationId,
      occurredAt: data.occurredAt,
      payload: data,
      known: { turnId: data.turnId, toolName: data.toolName },
    }),
  toolCallSucceeded: (data: {
    conversationId: string;
    turnId: string;
    toolCallId: string;
    toolName: string;
    durationMs?: number;
    occurredAt: number;
  }) =>
    analyticsRow({
      type: LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_SUCCEEDED,
      eventVersion: LANGY_CONVERSATION_EVENT_VERSIONS.TOOL_CALL_SUCCEEDED,
      aggregateId: data.conversationId,
      occurredAt: data.occurredAt,
      payload: data,
      known: {
        turnId: data.turnId,
        toolName: data.toolName,
        durationMs: data.durationMs,
      },
    }),
  toolCallFailed: (data: {
    conversationId: string;
    turnId: string;
    toolCallId: string;
    toolName: string;
    durationMs?: number;
    occurredAt: number;
  }) =>
    analyticsRow({
      type: LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_FAILED,
      eventVersion: LANGY_CONVERSATION_EVENT_VERSIONS.TOOL_CALL_FAILED,
      aggregateId: data.conversationId,
      occurredAt: data.occurredAt,
      payload: data,
      known: {
        turnId: data.turnId,
        toolName: data.toolName,
        durationMs: data.durationMs,
      },
    }),
  planUpdated: (data: {
    conversationId: string;
    turnId: string;
    occurredAt: number;
  }) =>
    analyticsRow({
      type: LANGY_CONVERSATION_EVENT_TYPES.PLAN_UPDATED,
      eventVersion: LANGY_CONVERSATION_EVENT_VERSIONS.PLAN_UPDATED,
      aggregateId: data.conversationId,
      occurredAt: data.occurredAt,
      payload: data,
      known: { turnId: data.turnId },
    }),
  agentResponseFailed: (data: {
    conversationId: string;
    turnId: string;
    occurredAt: number;
  }) =>
    analyticsRow({
      type: LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONSE_FAILED,
      eventVersion: LANGY_CONVERSATION_EVENT_VERSIONS.AGENT_RESPONSE_FAILED,
      aggregateId: data.conversationId,
      occurredAt: data.occurredAt,
      payload: data,
      known: { turnId: data.turnId, outcome: "failed" },
    }),
  agentResponded: (data: {
    conversationId: string;
    turnId: string;
    role: string;
    outcome: string;
    occurredAt: number;
  }) =>
    analyticsRow({
      type: LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED,
      eventVersion: LANGY_CONVERSATION_EVENT_VERSIONS.AGENT_RESPONDED,
      aggregateId: data.conversationId,
      occurredAt: data.occurredAt,
      payload: data,
      known: { turnId: data.turnId, role: data.role, outcome: data.outcome },
    }),
  conversationArchived: (data: {
    conversationId: string;
    occurredAt: number;
  }) =>
    analyticsRow({
      type: LANGY_CONVERSATION_EVENT_TYPES.ARCHIVED,
      eventVersion: LANGY_CONVERSATION_EVENT_VERSIONS.ARCHIVED,
      aggregateId: data.conversationId,
      occurredAt: data.occurredAt,
      payload: data,
    }),
  conversationMetadataUpdated: (data: {
    conversationId: string;
    occurredAt: number;
  }) =>
    analyticsRow({
      type: LANGY_CONVERSATION_EVENT_TYPES.METADATA_UPDATED,
      eventVersion: LANGY_CONVERSATION_EVENT_VERSIONS.METADATA_UPDATED,
      aggregateId: data.conversationId,
      occurredAt: data.occurredAt,
      payload: data,
    }),
  conversationHandoffPending: (data: {
    conversationId: string;
    turnId: string;
    occurredAt: number;
  }) =>
    analyticsRow({
      type: LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_HANDOFF_PENDING,
      eventVersion:
        LANGY_CONVERSATION_EVENT_VERSIONS.CONVERSATION_HANDOFF_PENDING,
      aggregateId: data.conversationId,
      occurredAt: data.occurredAt,
      payload: data,
      known: { turnId: data.turnId },
    }),
  conversationHandoffConsumed: (data: {
    conversationId: string;
    turnId: string;
    occurredAt: number;
  }) =>
    analyticsRow({
      type: LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_HANDOFF_CONSUMED,
      eventVersion:
        LANGY_CONVERSATION_EVENT_VERSIONS.CONVERSATION_HANDOFF_CONSUMED,
      aggregateId: data.conversationId,
      occurredAt: data.occurredAt,
      payload: data,
      known: { turnId: data.turnId },
    }),
  conversationTitleGenerated: (data: {
    conversationId: string;
    turnId?: string;
    model: string;
    occurredAt: number;
  }) =>
    analyticsRow({
      type: LANGY_CONVERSATION_EVENT_TYPES.TITLE_GENERATED,
      eventVersion: LANGY_CONVERSATION_EVENT_VERSIONS.TITLE_GENERATED,
      aggregateId: data.conversationId,
      occurredAt: data.occurredAt,
      payload: data,
      known: { turnId: data.turnId ?? null, model: data.model },
    }),
};

/**
 * The three message-bearing events, selected and typed by the pipeline. The
 * row itself is `@langwatch/langy`'s own mapper — the same code the browser's
 * message list runs. `id`/`createdAt` stand in for the event log's identity
 * and accept time: `mapLangyMessageEvent` needs an envelope, and a `.withMap`
 * handler has none, so the message's own id (always present on a
 * message-bearing event) and its `occurredAt` fill both slots — deterministic
 * in `data` alone, so a redelivery still collapses onto the same row.
 */
export const langyMessageRecords = {
  messageRecorded: (data: {
    conversationId: string;
    userId: string;
    messageId: string;
    role: LangyMessageRole;
    parts: LangyMessagePart[];
    title?: string | null;
    occurredAt: number;
  }): LangyMessageProjectionRecord =>
    mapLangyMessageEvent({
      id: data.messageId,
      createdAt: data.occurredAt,
      occurredAt: data.occurredAt,
      type: LANGY_CONVERSATION_EVENT_TYPES.MESSAGE_RECORDED,
      data,
    }),
  messageImported: (data: {
    conversationId: string;
    sourceConversationId: string;
    sourceMessageId: string;
    messageId: string;
    role: LangyMessageRole;
    parts: LangyMessagePart[];
    occurredAt: number;
  }): LangyMessageProjectionRecord =>
    mapLangyMessageEvent({
      id: data.messageId,
      createdAt: data.occurredAt,
      occurredAt: data.occurredAt,
      type: LANGY_CONVERSATION_EVENT_TYPES.MESSAGE_IMPORTED,
      data,
    }),
  agentResponded: (data: {
    conversationId: string;
    turnId: string;
    messageId: string;
    role: LangyMessageRole;
    parts: LangyMessagePart[];
    outcome: "completed" | "failed" | "stopped";
    error?: string | null;
    occurredAt: number;
  }): LangyMessageProjectionRecord =>
    mapLangyMessageEvent({
      id: data.messageId,
      createdAt: data.occurredAt,
      occurredAt: data.occurredAt,
      type: LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED,
      data,
    }),
};
