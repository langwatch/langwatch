import {
  AbstractMapProjection,
  type MapEventHandlers,
} from "../../../projections/abstractMapProjection";
import type { AppendStore } from "../../../projections/mapProjection.types";
import type { LangyMessageRole } from "../schemas/shared";
import {
  type LangyAgentRespondedEvent,
  type LangyMessageRecordedEvent,
  type LangyMessageImportedEvent,
  LangyAgentRespondedEventSchema,
  LangyMessageRecordedEventSchema,
  LangyMessageImportedEventSchema,
} from "../schemas/events";
import type { LangyMessagePart } from "../schemas/shared";

export interface LangyMessageProjectionRecord {
  ConversationId: string;
  MessageId: string;
  Role: LangyMessageRole;
  Parts: LangyMessagePart[];
  SourceEventId: string;
  OccurredAt: number;
  AcceptedAt: number;
  CreatedAt: number;
  UpdatedAt: number;
}

const messageEvents = [
  LangyMessageRecordedEventSchema,
  LangyAgentRespondedEventSchema,
  LangyMessageImportedEventSchema,
] as const;

/** Type-aware event-to-row projection for Postgres operational messages. */
export class LangyMessageOperationalMapProjection
  extends AbstractMapProjection<
    LangyMessageProjectionRecord,
    typeof messageEvents
  >
  implements
    MapEventHandlers<typeof messageEvents, LangyMessageProjectionRecord>
{
  readonly name = "langyMessageOperational";
  readonly store: AppendStore<LangyMessageProjectionRecord>;
  protected readonly events = messageEvents;

  override options = {
    groupKeyFn: (event: {
      data: { conversationId: string; messageId: string };
    }) => `langy:${event.data.conversationId}:message:${event.data.messageId}`,
  };

  constructor(deps: { store: AppendStore<LangyMessageProjectionRecord> }) {
    super();
    this.store = deps.store;
  }

  mapLangyConversationMessageRecorded(
    event: LangyMessageRecordedEvent,
  ): LangyMessageProjectionRecord {
    return this.record(event);
  }

  mapLangyConversationAgentResponded(
    event: LangyAgentRespondedEvent,
  ): LangyMessageProjectionRecord {
    return this.record(event);
  }

  mapLangyConversationMessageImported(
    event: LangyMessageImportedEvent,
  ): LangyMessageProjectionRecord {
    return this.record(event);
  }

  private record(
    event:
      | LangyMessageRecordedEvent
      | LangyAgentRespondedEvent
      | LangyMessageImportedEvent,
  ): LangyMessageProjectionRecord {
    return {
      ConversationId: event.data.conversationId,
      MessageId: event.data.messageId,
      Role: event.data.role,
      Parts: event.data.parts,
      SourceEventId: event.id,
      OccurredAt: event.occurredAt,
      AcceptedAt: event.createdAt,
      CreatedAt: event.occurredAt,
      UpdatedAt: event.occurredAt,
    };
  }
}
