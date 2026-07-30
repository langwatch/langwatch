import {
  createMapExecutor,
  type AppendStore,
  type Metrics,
} from "@langwatch/event-sourcing";
import {
  LANGY_CONVERSATION_EVENT_TYPES,
  mapLangyMessageEvent,
  type LangyAgentRespondedEventData,
  type LangyMessageImportedEventData,
  type LangyMessageProjectionRecord,
  type LangyMessageRecordedEventData,
} from "@langwatch/langy";
import type { LangyConversationDispatchedEvent } from "./dispatchedEvent";

/**
 * The `langyMessageOperational` map projection: `message_recorded` /
 * `agent_responded` / `message_imported` become one message row each. Row
 * construction is `@langwatch/langy`'s `mapLangyMessageEvent`, shared with the
 * browser's message list.
 */

interface EventMeta {
  readonly eventId: string;
  readonly occurredAt: number;
  readonly acceptedAt: number;
}

const messageHandlers = {
  [LANGY_CONVERSATION_EVENT_TYPES.MESSAGE_RECORDED]: (
    data: LangyMessageRecordedEventData,
    meta: EventMeta,
  ): LangyMessageProjectionRecord =>
    mapLangyMessageEvent({
      type: LANGY_CONVERSATION_EVENT_TYPES.MESSAGE_RECORDED,
      id: meta.eventId,
      createdAt: meta.acceptedAt,
      occurredAt: meta.occurredAt,
      data,
    }),
  [LANGY_CONVERSATION_EVENT_TYPES.MESSAGE_IMPORTED]: (
    data: LangyMessageImportedEventData,
    meta: EventMeta,
  ): LangyMessageProjectionRecord =>
    mapLangyMessageEvent({
      type: LANGY_CONVERSATION_EVENT_TYPES.MESSAGE_IMPORTED,
      id: meta.eventId,
      createdAt: meta.acceptedAt,
      occurredAt: meta.occurredAt,
      data,
    }),
  [LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED]: (
    data: LangyAgentRespondedEventData,
    meta: EventMeta,
  ): LangyMessageProjectionRecord =>
    mapLangyMessageEvent({
      type: LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED,
      id: meta.eventId,
      createdAt: meta.acceptedAt,
      occurredAt: meta.occurredAt,
      data,
    }),
} as const;

function dispatchMessageEvent(
  event: LangyConversationDispatchedEvent,
): LangyMessageProjectionRecord | null {
  const handler = (
    messageHandlers as Record<
      string,
      (data: unknown, meta: EventMeta) => LangyMessageProjectionRecord
    >
  )[event.type];
  if (!handler) return null;
  return handler(event.data, {
    eventId: event.id,
    occurredAt: event.occurredAt,
    acceptedAt: event.createdAt,
  });
}

const PROJECTION_NAME = "langyMessageOperational";

export function createLangyMessageMapExecutor(deps: {
  readonly store: AppendStore<LangyMessageProjectionRecord>;
  readonly metrics?: Metrics;
}): ReturnType<
  typeof createMapExecutor<LangyConversationDispatchedEvent, LangyMessageProjectionRecord>
> {
  return createMapExecutor<LangyConversationDispatchedEvent, LangyMessageProjectionRecord>({
    store: deps.store,
    map: dispatchMessageEvent,
    projectionName: PROJECTION_NAME,
    metrics: deps.metrics,
  });
}
