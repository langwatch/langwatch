import {
  AbstractMapProjection,
  type MapEventHandlers,
} from "../../../projections/abstractMapProjection";
import type { AppendStore } from "../../../projections/mapProjection.types";
import {
  type LangyAgentRespondedEvent,
  type LangyConversationContinuedEvent,
  LangyAgentRespondedEventSchema,
  LangyConversationContinuedEventSchema,
} from "../schemas/events";

/**
 * Record matching the existing `langy_messages` ClickHouse table
 * (00036_create_langy_messages.sql). `ReplacingMergeTree(UpdatedAt)`,
 * ORDER BY (TenantId, ConversationId, MessageId) — so a retried event with the
 * same MessageId collapses to one row.
 */
export interface ClickHouseLangyMessageRecord {
  TenantId: string;
  ConversationId: string;
  MessageId: string;
  Role: string;
  /** JSON-serialised UI-message parts (opaque to the pipeline). */
  Parts: string;
  /** Logical send time (the event's occurredAt), ISO string. */
  CreatedAt: string;
  /** Version column for the ReplacingMergeTree LWW dedup, ISO string. */
  UpdatedAt: string;
}

const messageEvents = [
  LangyConversationContinuedEventSchema,
  LangyAgentRespondedEventSchema,
] as const;

/**
 * Map projection: turns durable message-bearing events into per-message rows in
 * `langy_messages`. `conversation_continued` records the user's message;
 * `agent_responded` records the assistant's final answer (the source of truth
 * for the response).
 *
 * Streamed tokens and ephemeral heartbeats never reach this projection — only
 * these two durable events do — so the message table never floods.
 */
export class LangyMessageStorageMapProjection
  extends AbstractMapProjection<
    ClickHouseLangyMessageRecord,
    typeof messageEvents
  >
  implements
    MapEventHandlers<typeof messageEvents, ClickHouseLangyMessageRecord>
{
  readonly name = "langyMessageStorage";
  readonly store: AppendStore<ClickHouseLangyMessageRecord>;
  protected readonly events = messageEvents;

  // Per-message parallelism: distinct messages of one conversation can be
  // appended concurrently (no ordering requirement in the append sink).
  override options = {
    groupKeyFn: (event: {
      data: { conversationId: string; messageId: string };
    }) => `langy:${event.data.conversationId}:msg:${event.data.messageId}`,
  };

  constructor(deps: { store: AppendStore<ClickHouseLangyMessageRecord> }) {
    super();
    this.store = deps.store;
  }

  mapLangyConversationConversationContinued(
    event: LangyConversationContinuedEvent,
  ): ClickHouseLangyMessageRecord {
    return {
      TenantId: event.tenantId,
      ConversationId: event.data.conversationId,
      MessageId: event.data.messageId,
      Role: event.data.role,
      Parts: JSON.stringify(event.data.parts ?? []),
      CreatedAt: new Date(event.occurredAt).toISOString(),
      UpdatedAt: new Date().toISOString(),
    };
  }

  mapLangyConversationAgentResponded(
    event: LangyAgentRespondedEvent,
  ): ClickHouseLangyMessageRecord {
    return {
      TenantId: event.tenantId,
      ConversationId: event.data.conversationId,
      MessageId: event.data.messageId,
      Role: event.data.role,
      Parts: JSON.stringify(event.data.parts ?? []),
      CreatedAt: new Date(event.occurredAt).toISOString(),
      UpdatedAt: new Date().toISOString(),
    };
  }
}
