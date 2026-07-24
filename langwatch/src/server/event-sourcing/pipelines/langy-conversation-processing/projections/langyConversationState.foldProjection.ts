import {
  foldLangyConversationState,
  initLangyConversationState,
  LANGY_CONVERSATION_PROJECTION_VERSIONS,
  type LangyConversationStateData,
} from "@langwatch/langy";
import type { Projection } from "../../../";
import {
  AbstractFoldProjection,
  type FoldEventHandlers,
} from "../../../projections/abstractFoldProjection";
import type { StateProjectionStore } from "../../../projections/stateProjection.types";
import type {
  LangyAgentResponseFailedEvent,
  LangyAgentTurnAcceptedEvent,
  LangyAgentRespondedEvent,
  LangyConversationArchivedEvent,
  LangyMessageRecordedEvent,
  LangyConversationForkedEvent,
  LangyConversationStartedEvent,
  LangyConversationHandoffConsumedEvent,
  LangyConversationHandoffPendingEvent,
  LangyConversationMetadataUpdatedEvent,
  LangyConversationTitleGeneratedEvent,
  LangyMessageImportedEvent,
  LangyToolCallFailedEvent,
  LangyToolCallInitiatedEvent,
  LangyToolCallSucceededEvent,
} from "../schemas/events";
import {
  LangyAgentResponseFailedEventSchema,
  LangyAgentTurnAcceptedEventSchema,
  LangyAgentRespondedEventSchema,
  LangyConversationArchivedEventSchema,
  LangyMessageRecordedEventSchema,
  LangyConversationForkedEventSchema,
  LangyConversationStartedEventSchema,
  LangyConversationHandoffConsumedEventSchema,
  LangyConversationHandoffPendingEventSchema,
  LangyConversationMetadataUpdatedEventSchema,
  LangyConversationTitleGeneratedEventSchema,
  LangyMessageImportedEventSchema,
  LangyToolCallFailedEventSchema,
  LangyToolCallInitiatedEventSchema,
  LangyToolCallSucceededEventSchema,
} from "../schemas/events";

export interface LangyConversationState extends Projection<LangyConversationStateData> {
  data: LangyConversationStateData;
}

const langyConversationEvents = [
  LangyConversationStartedEventSchema,
  LangyConversationForkedEventSchema,
  LangyMessageRecordedEventSchema,
  LangyMessageImportedEventSchema,
  LangyAgentTurnAcceptedEventSchema,
  LangyToolCallInitiatedEventSchema,
  LangyToolCallSucceededEventSchema,
  LangyToolCallFailedEventSchema,
  LangyAgentResponseFailedEventSchema,
  LangyAgentRespondedEventSchema,
  LangyConversationArchivedEventSchema,
  LangyConversationMetadataUpdatedEventSchema,
  LangyConversationHandoffPendingEventSchema,
  LangyConversationHandoffConsumedEventSchema,
  LangyConversationTitleGeneratedEventSchema,
] as const;

/**
 * Type-safe fold projection for Langy conversation state.
 *
 * - `implements FoldEventHandlers` enforces a handler for every event schema.
 * - Handler names are derived from event type strings (e.g.
 *   `"lw.langy_conversation.message_recorded"` -> `handleLangyConversationMessageRecorded`).
 * - `CreatedAt` / `UpdatedAt` / `LastEventOccurredAt` are auto-managed by the base.
 *
 * The reduction itself lives in `@langwatch/langy`'s
 * `foldLangyConversationState` (ADR-059) — the same reducer a browser spine
 * fold will run. This class is only the server rig: schema routing, the
 * store, versioning, and the bookkeeping stamps.
 */
export class LangyConversationStateFoldProjection
  extends AbstractFoldProjection<
    LangyConversationStateData,
    typeof langyConversationEvents,
    "CreatedAt",
    "UpdatedAt",
    "LastEventOccurredAt",
    StateProjectionStore<LangyConversationStateData>
  >
  implements
    FoldEventHandlers<
      typeof langyConversationEvents,
      LangyConversationStateData
    >
{
  readonly name = "langyConversationState";
  readonly version = LANGY_CONVERSATION_PROJECTION_VERSIONS.CONVERSATION_STATE;
  readonly store: StateProjectionStore<LangyConversationStateData>;

  protected readonly events = langyConversationEvents;

  constructor(deps: {
    store: StateProjectionStore<LangyConversationStateData>;
  }) {
    super();
    this.store = deps.store;
  }

  protected initState() {
    return initLangyConversationState();
  }

  handleLangyConversationConversationStarted(
    event: LangyConversationStartedEvent,
    state: LangyConversationStateData,
  ): LangyConversationStateData {
    return foldLangyConversationState(state, event);
  }

  handleLangyConversationConversationForked(
    event: LangyConversationForkedEvent,
    state: LangyConversationStateData,
  ): LangyConversationStateData {
    return foldLangyConversationState(state, event);
  }

  handleLangyConversationMessageRecorded(
    event: LangyMessageRecordedEvent,
    state: LangyConversationStateData,
  ): LangyConversationStateData {
    return foldLangyConversationState(state, event);
  }

  handleLangyConversationMessageImported(
    event: LangyMessageImportedEvent,
    state: LangyConversationStateData,
  ): LangyConversationStateData {
    return foldLangyConversationState(state, event);
  }

  handleLangyConversationAgentTurnAccepted(
    event: LangyAgentTurnAcceptedEvent,
    state: LangyConversationStateData,
  ): LangyConversationStateData {
    return foldLangyConversationState(state, event);
  }

  handleLangyConversationToolCallInitiated(
    event: LangyToolCallInitiatedEvent,
    state: LangyConversationStateData,
  ): LangyConversationStateData {
    return foldLangyConversationState(state, event);
  }

  handleLangyConversationToolCallSucceeded(
    event: LangyToolCallSucceededEvent,
    state: LangyConversationStateData,
  ): LangyConversationStateData {
    return foldLangyConversationState(state, event);
  }

  handleLangyConversationToolCallFailed(
    event: LangyToolCallFailedEvent,
    state: LangyConversationStateData,
  ): LangyConversationStateData {
    return foldLangyConversationState(state, event);
  }

  handleLangyConversationAgentResponseFailed(
    event: LangyAgentResponseFailedEvent,
    state: LangyConversationStateData,
  ): LangyConversationStateData {
    return foldLangyConversationState(state, event);
  }

  handleLangyConversationAgentResponded(
    event: LangyAgentRespondedEvent,
    state: LangyConversationStateData,
  ): LangyConversationStateData {
    return foldLangyConversationState(state, event);
  }

  handleLangyConversationConversationArchived(
    event: LangyConversationArchivedEvent,
    state: LangyConversationStateData,
  ): LangyConversationStateData {
    return foldLangyConversationState(state, event);
  }

  handleLangyConversationConversationMetadataUpdated(
    event: LangyConversationMetadataUpdatedEvent,
    state: LangyConversationStateData,
  ): LangyConversationStateData {
    return foldLangyConversationState(state, event);
  }

  handleLangyConversationConversationHandoffPending(
    event: LangyConversationHandoffPendingEvent,
    state: LangyConversationStateData,
  ): LangyConversationStateData {
    return foldLangyConversationState(state, event);
  }

  handleLangyConversationConversationHandoffConsumed(
    event: LangyConversationHandoffConsumedEvent,
    state: LangyConversationStateData,
  ): LangyConversationStateData {
    return foldLangyConversationState(state, event);
  }

  handleLangyConversationConversationTitleGenerated(
    event: LangyConversationTitleGeneratedEvent,
    state: LangyConversationStateData,
  ): LangyConversationStateData {
    return foldLangyConversationState(state, event);
  }
}
