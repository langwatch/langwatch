import { createMapExecutor, type AppendStore, type Metrics } from "@langwatch/event-sourcing";
import {
  LANGY_CONVERSATION_EVENT_TYPES,
  type LangyAgentResponseFailedEventData,
  type LangyAgentRespondedEventData,
  type LangyAgentTurnAcceptedEventData,
  type LangyConversationArchivedEventData,
  type LangyConversationForkedEventData,
  type LangyConversationHandoffConsumedEventData,
  type LangyConversationHandoffPendingEventData,
  type LangyConversationMetadataUpdatedEventData,
  type LangyConversationStartedEventData,
  type LangyConversationTitleGeneratedEventData,
  type LangyMessageImportedEventData,
  type LangyMessageRecordedEventData,
  type LangyPlanUpdatedEventData,
  type LangyToolCallFailedEventData,
  type LangyToolCallInitiatedEventData,
  type LangyToolCallSucceededEventData,
} from "@langwatch/langy";
import type { LangyConversationDispatchedEvent } from "./dispatchedEvent";

/**
 * The `langyAnalyticsEvent` map projection (ADR-098 §2, ADR-105 §6): one
 * content-free ClickHouse analytics row per canonical Langy event — never an
 * operational read, never message content.
 */
export interface LangyAnalyticsEventProjectionRecord {
  eventId: string;
  eventType: string;
  aggregateId: string;
  turnId: string | null;
  userId: string | null;
  role: string | null;
  toolName: string | null;
  outcome: string | null;
  model: string | null;
  durationMs: number | null;
  occurredAtMs: number;
  acceptedAtMs: number;
}

interface EventMeta {
  readonly eventId: string;
  readonly occurredAt: number;
  readonly acceptedAt: number;
}

function baseRecord(
  type: string,
  aggregateId: string,
  meta: EventMeta,
  fields: Partial<
    Pick<
      LangyAnalyticsEventProjectionRecord,
      "turnId" | "userId" | "role" | "toolName" | "outcome" | "model" | "durationMs"
    >
  > = {},
): LangyAnalyticsEventProjectionRecord {
  return {
    eventId: meta.eventId,
    eventType: type,
    aggregateId,
    turnId: fields.turnId ?? null,
    userId: fields.userId ?? null,
    role: fields.role ?? null,
    toolName: fields.toolName ?? null,
    outcome: fields.outcome ?? null,
    model: fields.model ?? null,
    durationMs: fields.durationMs ?? null,
    occurredAtMs: meta.occurredAt,
    acceptedAtMs: meta.acceptedAt,
  };
}

const analyticsHandlers = {
  [LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_STARTED]: (
    data: LangyConversationStartedEventData,
    meta: EventMeta,
  ) =>
    baseRecord(LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_STARTED, data.conversationId, meta, {
      userId: data.userId,
    }),
  [LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_FORKED]: (
    data: LangyConversationForkedEventData,
    meta: EventMeta,
  ) =>
    baseRecord(LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_FORKED, data.conversationId, meta, {
      userId: data.userId,
    }),
  [LANGY_CONVERSATION_EVENT_TYPES.MESSAGE_RECORDED]: (
    data: LangyMessageRecordedEventData,
    meta: EventMeta,
  ) =>
    baseRecord(LANGY_CONVERSATION_EVENT_TYPES.MESSAGE_RECORDED, data.conversationId, meta, {
      userId: data.userId,
      role: data.role,
    }),
  [LANGY_CONVERSATION_EVENT_TYPES.MESSAGE_IMPORTED]: (
    data: LangyMessageImportedEventData,
    meta: EventMeta,
  ) =>
    baseRecord(LANGY_CONVERSATION_EVENT_TYPES.MESSAGE_IMPORTED, data.conversationId, meta, {
      role: data.role,
    }),
  [LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_ACCEPTED]: (
    data: LangyAgentTurnAcceptedEventData,
    meta: EventMeta,
  ) =>
    baseRecord(LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_ACCEPTED, data.conversationId, meta, {
      turnId: data.turnId,
    }),
  [LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_INITIATED]: (
    data: LangyToolCallInitiatedEventData,
    meta: EventMeta,
  ) =>
    baseRecord(LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_INITIATED, data.conversationId, meta, {
      turnId: data.turnId,
      toolName: data.toolName,
    }),
  [LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_SUCCEEDED]: (
    data: LangyToolCallSucceededEventData,
    meta: EventMeta,
  ) =>
    baseRecord(LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_SUCCEEDED, data.conversationId, meta, {
      turnId: data.turnId,
      toolName: data.toolName,
      durationMs: data.durationMs ?? null,
    }),
  [LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_FAILED]: (
    data: LangyToolCallFailedEventData,
    meta: EventMeta,
  ) =>
    baseRecord(LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_FAILED, data.conversationId, meta, {
      turnId: data.turnId,
      toolName: data.toolName,
      durationMs: data.durationMs ?? null,
    }),
  [LANGY_CONVERSATION_EVENT_TYPES.PLAN_UPDATED]: (
    data: LangyPlanUpdatedEventData,
    meta: EventMeta,
  ) =>
    baseRecord(LANGY_CONVERSATION_EVENT_TYPES.PLAN_UPDATED, data.conversationId, meta, {
      turnId: data.turnId,
    }),
  [LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONSE_FAILED]: (
    data: LangyAgentResponseFailedEventData,
    meta: EventMeta,
  ) =>
    baseRecord(LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONSE_FAILED, data.conversationId, meta, {
      turnId: data.turnId,
      outcome: "failed",
    }),
  [LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED]: (
    data: LangyAgentRespondedEventData,
    meta: EventMeta,
  ) =>
    baseRecord(LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED, data.conversationId, meta, {
      turnId: data.turnId,
      role: data.role,
      outcome: data.outcome,
    }),
  [LANGY_CONVERSATION_EVENT_TYPES.ARCHIVED]: (
    data: LangyConversationArchivedEventData,
    meta: EventMeta,
  ) => baseRecord(LANGY_CONVERSATION_EVENT_TYPES.ARCHIVED, data.conversationId, meta),
  [LANGY_CONVERSATION_EVENT_TYPES.METADATA_UPDATED]: (
    data: LangyConversationMetadataUpdatedEventData,
    meta: EventMeta,
  ) => baseRecord(LANGY_CONVERSATION_EVENT_TYPES.METADATA_UPDATED, data.conversationId, meta),
  [LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_HANDOFF_PENDING]: (
    data: LangyConversationHandoffPendingEventData,
    meta: EventMeta,
  ) =>
    baseRecord(
      LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_HANDOFF_PENDING,
      data.conversationId,
      meta,
      { turnId: data.turnId },
    ),
  [LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_HANDOFF_CONSUMED]: (
    data: LangyConversationHandoffConsumedEventData,
    meta: EventMeta,
  ) =>
    baseRecord(
      LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_HANDOFF_CONSUMED,
      data.conversationId,
      meta,
      { turnId: data.turnId },
    ),
  [LANGY_CONVERSATION_EVENT_TYPES.TITLE_GENERATED]: (
    data: LangyConversationTitleGeneratedEventData,
    meta: EventMeta,
  ) =>
    baseRecord(LANGY_CONVERSATION_EVENT_TYPES.TITLE_GENERATED, data.conversationId, meta, {
      turnId: data.turnId ?? null,
      model: data.model,
    }),
} as const;

function dispatchAnalyticsEvent(
  event: LangyConversationDispatchedEvent,
): LangyAnalyticsEventProjectionRecord | null {
  const handler = (
    analyticsHandlers as Record<
      string,
      (data: unknown, meta: EventMeta) => LangyAnalyticsEventProjectionRecord
    >
  )[event.type];
  if (!handler) return null;
  return handler(event.data, {
    eventId: event.id,
    occurredAt: event.occurredAt,
    acceptedAt: event.createdAt,
  });
}

const PROJECTION_NAME = "langyAnalyticsEvent";

export function createLangyAnalyticsEventMapExecutor(deps: {
  readonly store: AppendStore<LangyAnalyticsEventProjectionRecord>;
  readonly metrics?: Metrics;
}): ReturnType<
  typeof createMapExecutor<LangyConversationDispatchedEvent, LangyAnalyticsEventProjectionRecord>
> {
  return createMapExecutor<LangyConversationDispatchedEvent, LangyAnalyticsEventProjectionRecord>({
    store: deps.store,
    map: dispatchAnalyticsEvent,
    projectionName: PROJECTION_NAME,
    metrics: deps.metrics,
  });
}
