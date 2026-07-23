import {
  mapLangyMessageEvent,
  type LangyMessageProjectionRecord,
} from "@langwatch/langy";
import {
  AbstractMapProjection,
  type MapEventHandlers,
} from "../../../projections/abstractMapProjection";
import type { AppendStore } from "../../../projections/mapProjection.types";
import {
  type LangyAgentRespondedEvent,
  type LangyMessageRecordedEvent,
  type LangyMessageImportedEvent,
  LangyAgentRespondedEventSchema,
  LangyMessageRecordedEventSchema,
  LangyMessageImportedEventSchema,
} from "../schemas/events";

const messageEvents = [
  LangyMessageRecordedEventSchema,
  LangyAgentRespondedEventSchema,
  LangyMessageImportedEventSchema,
] as const;

/**
 * Type-aware event-to-row projection for Postgres operational messages. The
 * mapping itself is `@langwatch/langy`'s `mapLangyMessageEvent` (ADR-059) —
 * shared with the browser's local message list; this class is only the server
 * rig (schema routing, store, per-message grouping).
 */
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
    return mapLangyMessageEvent(event);
  }

  mapLangyConversationAgentResponded(
    event: LangyAgentRespondedEvent,
  ): LangyMessageProjectionRecord {
    return mapLangyMessageEvent(event);
  }

  mapLangyConversationMessageImported(
    event: LangyMessageImportedEvent,
  ): LangyMessageProjectionRecord {
    return mapLangyMessageEvent(event);
  }
}
