import {
  AbstractMapProjection,
  type MapEventHandlers,
} from "../../../projections/abstractMapProjection";
import type { AppendStore } from "../../../projections/mapProjection.types";
import {
  type LangyAgentRespondedEvent,
  type LangyAgentResponseFailedEvent,
  type LangyAgentTurnAcceptedEvent,
  type LangyConversationArchivedEvent,
  type LangyMessageRecordedEvent,
  type LangyConversationForkedEvent,
  type LangyConversationHandoffConsumedEvent,
  type LangyConversationHandoffPendingEvent,
  type LangyConversationMetadataUpdatedEvent,
  type LangyConversationProcessingEvent,
  type LangyConversationStartedEvent,
  type LangyConversationTitleGeneratedEvent,
  type LangyMessageImportedEvent,
  type LangyPlanUpdatedEvent,
  type LangyToolCallFailedEvent,
  type LangyToolCallInitiatedEvent,
  type LangyToolCallSucceededEvent,
  LangyAgentRespondedEventSchema,
  LangyAgentResponseFailedEventSchema,
  LangyAgentTurnAcceptedEventSchema,
  LangyConversationArchivedEventSchema,
  LangyMessageRecordedEventSchema,
  LangyConversationForkedEventSchema,
  LangyConversationHandoffConsumedEventSchema,
  LangyConversationHandoffPendingEventSchema,
  LangyConversationMetadataUpdatedEventSchema,
  LangyConversationStartedEventSchema,
  LangyConversationTitleGeneratedEventSchema,
  LangyMessageImportedEventSchema,
  LangyPlanUpdatedEventSchema,
  LangyToolCallFailedEventSchema,
  LangyToolCallInitiatedEventSchema,
  LangyToolCallSucceededEventSchema,
} from "../schemas/events";
import { LANGY_CONVERSATION_EVENT_TYPES } from "../schemas/constants";

export interface LangyAnalyticsEventProjectionRecord {
  eventId: string;
  eventType: string;
  eventVersion: string;
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

const analyticsEvents = [
  LangyConversationStartedEventSchema,
  LangyConversationForkedEventSchema,
  LangyMessageRecordedEventSchema,
  LangyMessageImportedEventSchema,
  LangyAgentTurnAcceptedEventSchema,
  LangyToolCallInitiatedEventSchema,
  LangyToolCallSucceededEventSchema,
  LangyToolCallFailedEventSchema,
  LangyPlanUpdatedEventSchema,
  LangyAgentResponseFailedEventSchema,
  LangyAgentRespondedEventSchema,
  LangyConversationArchivedEventSchema,
  LangyConversationMetadataUpdatedEventSchema,
  LangyConversationHandoffPendingEventSchema,
  LangyConversationHandoffConsumedEventSchema,
  LangyConversationTitleGeneratedEventSchema,
] as const;

/**
 * One content-free ClickHouse analytics row per canonical Langy event.
 * This projection is a pure map: it never reads a prior row or projection.
 */
export class LangyAnalyticsEventMapProjection
  extends AbstractMapProjection<
    LangyAnalyticsEventProjectionRecord,
    typeof analyticsEvents
  >
  implements
    MapEventHandlers<
      typeof analyticsEvents,
      LangyAnalyticsEventProjectionRecord
    >
{
  readonly name = "langyAnalyticsEvent";
  readonly store: AppendStore<LangyAnalyticsEventProjectionRecord>;
  protected readonly events = analyticsEvents;

  constructor(deps: {
    store: AppendStore<LangyAnalyticsEventProjectionRecord>;
  }) {
    super();
    this.store = deps.store;
  }

  mapLangyConversationConversationStarted(event: LangyConversationStartedEvent) {
    return this.record(event);
  }

  mapLangyConversationMessageRecorded(
    event: LangyMessageRecordedEvent,
  ) {
    return this.record(event);
  }

  mapLangyConversationConversationForked(event: LangyConversationForkedEvent) {
    return this.record(event);
  }

  mapLangyConversationMessageImported(event: LangyMessageImportedEvent) {
    return this.record(event);
  }

  mapLangyConversationAgentTurnAccepted(
    event: LangyAgentTurnAcceptedEvent,
  ) {
    return this.record(event);
  }

  mapLangyConversationToolCallInitiated(event: LangyToolCallInitiatedEvent) {
    return this.record(event);
  }

  mapLangyConversationToolCallSucceeded(event: LangyToolCallSucceededEvent) {
    return this.record(event);
  }

  mapLangyConversationToolCallFailed(event: LangyToolCallFailedEvent) {
    return this.record(event);
  }

  mapLangyConversationPlanUpdated(event: LangyPlanUpdatedEvent) {
    return this.record(event);
  }

  mapLangyConversationAgentResponseFailed(event: LangyAgentResponseFailedEvent) {
    return this.record(event);
  }

  mapLangyConversationAgentResponded(event: LangyAgentRespondedEvent) {
    return this.record(event);
  }

  mapLangyConversationConversationArchived(
    event: LangyConversationArchivedEvent,
  ) {
    return this.record(event);
  }

  mapLangyConversationConversationMetadataUpdated(
    event: LangyConversationMetadataUpdatedEvent,
  ) {
    return this.record(event);
  }

  mapLangyConversationConversationHandoffPending(
    event: LangyConversationHandoffPendingEvent,
  ) {
    return this.record(event);
  }

  mapLangyConversationConversationHandoffConsumed(
    event: LangyConversationHandoffConsumedEvent,
  ) {
    return this.record(event);
  }

  mapLangyConversationConversationTitleGenerated(
    event: LangyConversationTitleGeneratedEvent,
  ) {
    return this.record(event);
  }

  private record(
    event: LangyConversationProcessingEvent,
  ): LangyAnalyticsEventProjectionRecord {
    const data = event.data;
    return {
      eventId: event.id,
      eventType: event.type,
      eventVersion: event.version,
      aggregateId: event.aggregateId,
      turnId: "turnId" in data ? (data.turnId ?? null) : null,
      userId: "userId" in data ? data.userId : null,
      role: "role" in data ? data.role : null,
      toolName: "toolName" in data ? data.toolName : null,
      outcome:
        event.type === LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED
          ? event.data.outcome
          : event.type === LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONSE_FAILED
            ? "failed"
            : null,
      model:
        event.type === LANGY_CONVERSATION_EVENT_TYPES.TITLE_GENERATED
          ? event.data.model
          : null,
      durationMs: "durationMs" in data ? (data.durationMs ?? null) : null,
      occurredAtMs: event.occurredAt,
      acceptedAtMs: event.createdAt,
    };
  }
}
