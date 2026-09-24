import {
  type AppendStore,
  AbstractMapProjection,
  type MapEventHandlers,
} from "@langwatch/eventing";
import { LANGY_CONVERSATION_EVENT_TYPES } from "@langwatch/langy-contract";

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
  type LangyLocalControlRequestedEvent,
  LangyLocalControlRequestedEventSchema,
  type LangyLocalPolicyChangedEvent,
  LangyLocalPolicyChangedEventSchema,
  type LangyLocalWorkspaceConnectedEvent,
  LangyLocalWorkspaceConnectedEventSchema,
  type LangyLocalWorkspaceDisconnectedEvent,
  LangyLocalWorkspaceDisconnectedEventSchema,
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
  type LangyUserWaitEndedEvent,
  LangyUserWaitEndedEventSchema,
  type LangyUserWaitStartedEvent,
  LangyUserWaitStartedEventSchema,
} from "./langy-conversation-state.projection.ts";

/**
 * How the event ended, for the analytics column. Only the three events that
 * carry an outcome answer; everything else has none, which is not the same as
 * a failure.
 */
function extractOutcome(event: LangyConversationProcessingEvent): string | null {
  if (event.type === LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED) {
    return event.data.outcome;
  }
  if (event.type === LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONSE_FAILED) {
    return "failed";
  }
  if (event.type === LANGY_CONVERSATION_EVENT_TYPES.USER_WAIT_ENDED) {
    return event.data.outcome;
  }
  return null;
}

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
  LangyLocalControlRequestedEventSchema,
  LangyLocalWorkspaceConnectedEventSchema,
  LangyLocalWorkspaceDisconnectedEventSchema,
  LangyLocalPolicyChangedEventSchema,
  LangyUserWaitStartedEventSchema,
  LangyUserWaitEndedEventSchema,
] as const;

/**
 * One content-free ClickHouse analytics row per canonical Langy event.
 * This projection is a pure map: it never reads a prior row or projection.
 */
export class LangyAnalyticsEventMapProjection
  extends AbstractMapProjection<LangyAnalyticsEventProjectionRecord, typeof analyticsEvents>
  implements MapEventHandlers<typeof analyticsEvents, LangyAnalyticsEventProjectionRecord>
{
  readonly name = "langyAnalyticsEvent";
  readonly store: AppendStore<LangyAnalyticsEventProjectionRecord>;
  protected readonly events = analyticsEvents;

  static create(deps: {
    store: AppendStore<LangyAnalyticsEventProjectionRecord>;
  }): LangyAnalyticsEventMapProjection {
    return new LangyAnalyticsEventMapProjection(deps);
  }

  constructor(deps: { store: AppendStore<LangyAnalyticsEventProjectionRecord> }) {
    super();
    this.store = deps.store;
  }

  mapLangyConversationConversationStarted(
    event: LangyConversationStartedEvent,
  ): LangyAnalyticsEventProjectionRecord {
    return this.record(event);
  }

  mapLangyConversationMessageRecorded(
    event: LangyMessageRecordedEvent,
  ): LangyAnalyticsEventProjectionRecord {
    return this.record(event);
  }

  mapLangyConversationConversationForked(
    event: LangyConversationForkedEvent,
  ): LangyAnalyticsEventProjectionRecord {
    return this.record(event);
  }

  mapLangyConversationMessageImported(
    event: LangyMessageImportedEvent,
  ): LangyAnalyticsEventProjectionRecord {
    return this.record(event);
  }

  mapLangyConversationAgentTurnAccepted(
    event: LangyAgentTurnAcceptedEvent,
  ): LangyAnalyticsEventProjectionRecord {
    return this.record(event);
  }

  mapLangyConversationToolCallInitiated(
    event: LangyToolCallInitiatedEvent,
  ): LangyAnalyticsEventProjectionRecord {
    return this.record(event);
  }

  mapLangyConversationToolCallSucceeded(
    event: LangyToolCallSucceededEvent,
  ): LangyAnalyticsEventProjectionRecord {
    return this.record(event);
  }

  mapLangyConversationToolCallFailed(
    event: LangyToolCallFailedEvent,
  ): LangyAnalyticsEventProjectionRecord {
    return this.record(event);
  }

  mapLangyConversationPlanUpdated(
    event: LangyPlanUpdatedEvent,
  ): LangyAnalyticsEventProjectionRecord {
    return this.record(event);
  }

  mapLangyConversationAgentResponseFailed(
    event: LangyAgentResponseFailedEvent,
  ): LangyAnalyticsEventProjectionRecord {
    return this.record(event);
  }

  mapLangyConversationAgentResponded(
    event: LangyAgentRespondedEvent,
  ): LangyAnalyticsEventProjectionRecord {
    return this.record(event);
  }

  mapLangyConversationConversationArchived(
    event: LangyConversationArchivedEvent,
  ): LangyAnalyticsEventProjectionRecord {
    return this.record(event);
  }

  mapLangyConversationConversationMetadataUpdated(
    event: LangyConversationMetadataUpdatedEvent,
  ): LangyAnalyticsEventProjectionRecord {
    return this.record(event);
  }

  mapLangyConversationConversationHandoffPending(
    event: LangyConversationHandoffPendingEvent,
  ): LangyAnalyticsEventProjectionRecord {
    return this.record(event);
  }

  mapLangyConversationConversationHandoffConsumed(
    event: LangyConversationHandoffConsumedEvent,
  ): LangyAnalyticsEventProjectionRecord {
    return this.record(event);
  }

  mapLangyConversationConversationTitleGenerated(
    event: LangyConversationTitleGeneratedEvent,
  ): LangyAnalyticsEventProjectionRecord {
    return this.record(event);
  }

  mapLangyConversationLocalControlRequested(
    event: LangyLocalControlRequestedEvent,
  ): LangyAnalyticsEventProjectionRecord {
    return this.record(event);
  }

  mapLangyConversationLocalWorkspaceConnected(
    event: LangyLocalWorkspaceConnectedEvent,
  ): LangyAnalyticsEventProjectionRecord {
    return this.record(event);
  }

  mapLangyConversationLocalWorkspaceDisconnected(
    event: LangyLocalWorkspaceDisconnectedEvent,
  ): LangyAnalyticsEventProjectionRecord {
    return this.record(event);
  }

  mapLangyConversationLocalPolicyChanged(
    event: LangyLocalPolicyChangedEvent,
  ): LangyAnalyticsEventProjectionRecord {
    return this.record(event);
  }

  mapLangyConversationUserWaitStarted(
    event: LangyUserWaitStartedEvent,
  ): LangyAnalyticsEventProjectionRecord {
    return this.record(event);
  }

  mapLangyConversationUserWaitEnded(
    event: LangyUserWaitEndedEvent,
  ): LangyAnalyticsEventProjectionRecord {
    return this.record(event);
  }

  private record(event: LangyConversationProcessingEvent): LangyAnalyticsEventProjectionRecord {
    const data = event.data;
    return {
      eventId: event.id,
      eventType: event.type,
      eventVersion: event.version,
      aggregateId: event.aggregateId,
      turnId: "turnId" in data ? (data.turnId ?? null) : null,
      userId: "userId" in data ? (data.userId ?? null) : null,
      role: "role" in data ? data.role : null,
      toolName: "toolName" in data ? data.toolName : null,
      outcome: extractOutcome(event),
      model:
        event.type === LANGY_CONVERSATION_EVENT_TYPES.TITLE_GENERATED ? event.data.model : null,
      durationMs: "durationMs" in data ? (data.durationMs ?? null) : null,
      occurredAtMs: event.occurredAt,
      acceptedAtMs: event.createdAt,
    };
  }
}
