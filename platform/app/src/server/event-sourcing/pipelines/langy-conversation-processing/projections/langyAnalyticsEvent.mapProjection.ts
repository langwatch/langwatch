import { LANGY_CONVERSATION_EVENT_TYPES } from "@langwatch/langy";
import {
  AbstractMapProjection,
  type MapEventHandlers,
} from "../../../projections/abstractMapProjection";
import type { AppendStore } from "../../../projections/mapProjection.types";
import {
  type LangyAgentRespondedEvent,
  LangyAgentRespondedEventSchema,
  type LangyAgentResponseFailedEvent,
  LangyAgentResponseFailedEventSchema,
  type LangyAgentTurnAcceptedEvent,
  LangyAgentTurnAcceptedEventSchema,
  type LangyConversationArchivedEvent,
  LangyConversationArchivedEventSchema,
  type LangyConversationForkedEvent,
  LangyConversationForkedEventSchema,
  type LangyConversationHandoffConsumedEvent,
  LangyConversationHandoffConsumedEventSchema,
  type LangyConversationHandoffPendingEvent,
  LangyConversationHandoffPendingEventSchema,
  type LangyConversationMetadataUpdatedEvent,
  LangyConversationMetadataUpdatedEventSchema,
  type LangyConversationProcessingEvent,
  type LangyConversationStartedEvent,
  LangyConversationStartedEventSchema,
  type LangyConversationTitleGeneratedEvent,
  LangyConversationTitleGeneratedEventSchema,
  type LangyMessageImportedEvent,
  LangyMessageImportedEventSchema,
  type LangyMessageRecordedEvent,
  LangyMessageRecordedEventSchema,
  type LangyPlanUpdatedEvent,
  LangyPlanUpdatedEventSchema,
  type LangyToolCallFailedEvent,
  LangyToolCallFailedEventSchema,
  type LangyToolCallInitiatedEvent,
  LangyToolCallInitiatedEventSchema,
  type LangyToolCallSucceededEvent,
  LangyToolCallSucceededEventSchema,
} from "../schemas/events";

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

function deriveTurnId(
  data: LangyConversationProcessingEvent["data"],
): string | null {
  return "turnId" in data ? (data.turnId ?? null) : null;
}

function deriveUserId(
  data: LangyConversationProcessingEvent["data"],
): string | null {
  return "userId" in data ? data.userId : null;
}

function deriveRole(
  data: LangyConversationProcessingEvent["data"],
): string | null {
  return "role" in data ? data.role : null;
}

function deriveToolName(
  data: LangyConversationProcessingEvent["data"],
): string | null {
  return "toolName" in data ? data.toolName : null;
}

function deriveDurationMs(
  data: LangyConversationProcessingEvent["data"],
): number | null {
  return "durationMs" in data ? (data.durationMs ?? null) : null;
}

function deriveOutcome(event: LangyConversationProcessingEvent): string | null {
  if (event.type === LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED) {
    return event.data.outcome;
  }
  if (event.type === LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONSE_FAILED) {
    return "failed";
  }
  return null;
}

function deriveModel(event: LangyConversationProcessingEvent): string | null {
  return event.type === LANGY_CONVERSATION_EVENT_TYPES.TITLE_GENERATED
    ? event.data.model
    : null;
}

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

  mapLangyConversationConversationStarted(
    event: LangyConversationStartedEvent,
  ) {
    return this.record(event);
  }

  mapLangyConversationMessageRecorded(event: LangyMessageRecordedEvent) {
    return this.record(event);
  }

  mapLangyConversationConversationForked(event: LangyConversationForkedEvent) {
    return this.record(event);
  }

  mapLangyConversationMessageImported(event: LangyMessageImportedEvent) {
    return this.record(event);
  }

  mapLangyConversationAgentTurnAccepted(event: LangyAgentTurnAcceptedEvent) {
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

  mapLangyConversationAgentResponseFailed(
    event: LangyAgentResponseFailedEvent,
  ) {
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
      turnId: deriveTurnId(data),
      userId: deriveUserId(data),
      role: deriveRole(data),
      toolName: deriveToolName(data),
      outcome: deriveOutcome(event),
      model: deriveModel(event),
      durationMs: deriveDurationMs(data),
      occurredAtMs: event.occurredAt,
      acceptedAtMs: event.createdAt,
    };
  }
}
