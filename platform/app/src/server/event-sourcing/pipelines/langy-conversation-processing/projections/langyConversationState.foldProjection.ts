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
  LangyAgentRespondedEvent,
  LangyAgentResponseFailedEvent,
  LangyAgentTurnAcceptedEvent,
  LangyConversationArchivedEvent,
  LangyConversationForkedEvent,
  LangyConversationHandoffConsumedEvent,
  LangyConversationHandoffPendingEvent,
  LangyConversationMetadataUpdatedEvent,
  LangyConversationStartedEvent,
  LangyConversationTitleGeneratedEvent,
  LangyLocalControlRequestedEvent,
  LangyLocalPolicyChangedEvent,
  LangyLocalWorkspaceConnectedEvent,
  LangyLocalWorkspaceDisconnectedEvent,
  LangyMessageImportedEvent,
  LangyMessageRecordedEvent,
  LangyPlanUpdatedEvent,
  LangyToolCallFailedEvent,
  LangyToolCallInitiatedEvent,
  LangyToolCallSucceededEvent,
  LangyUserWaitEndedEvent,
  LangyUserWaitStartedEvent,
} from "../schemas/events";
import {
  LangyAgentRespondedEventSchema,
  LangyAgentResponseFailedEventSchema,
  LangyAgentTurnAcceptedEventSchema,
  LangyConversationArchivedEventSchema,
  LangyConversationForkedEventSchema,
  LangyConversationHandoffConsumedEventSchema,
  LangyConversationHandoffPendingEventSchema,
  LangyConversationMetadataUpdatedEventSchema,
  LangyConversationStartedEventSchema,
  LangyConversationTitleGeneratedEventSchema,
  LangyLocalControlRequestedEventSchema,
  LangyLocalPolicyChangedEventSchema,
  LangyLocalWorkspaceConnectedEventSchema,
  LangyLocalWorkspaceDisconnectedEventSchema,
  LangyMessageImportedEventSchema,
  LangyMessageRecordedEventSchema,
  LangyPlanUpdatedEventSchema,
  LangyToolCallFailedEventSchema,
  LangyToolCallInitiatedEventSchema,
  LangyToolCallSucceededEventSchema,
  LangyUserWaitEndedEventSchema,
  LangyUserWaitStartedEventSchema,
} from "../schemas/events";

export interface LangyConversationState
  extends Projection<LangyConversationStateData> {
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
  // The events below change nothing in this projection, and it reads them all
  // the same: the cursor on this row is the conversation's position in its own
  // event log, and the freshness signal is published only once that cursor has
  // reached the event that raised it. An event this projection did not read
  // was an event the cursor could never reach, so its signal was retried until
  // it was dropped and the panel heard nothing about it. A permission card
  // answered in the terminal then kept its buttons until the next event this
  // projection did read, which is the command finishing.
  LangyPlanUpdatedEventSchema,
  LangyLocalControlRequestedEventSchema,
  LangyLocalWorkspaceConnectedEventSchema,
  LangyLocalWorkspaceDisconnectedEventSchema,
  LangyLocalPolicyChangedEventSchema,
  LangyUserWaitStartedEventSchema,
  LangyUserWaitEndedEventSchema,
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

  // ── Read, and folded into nothing ─────────────────────────────────────────
  //
  // The turn document holds what these events say (the plan, the folder, the
  // cards), and the conversation row holds none of it. They are read here so
  // the cursor moves over them, which is what lets the freshness signal reach
  // the panel while a command is still running.

  handleLangyConversationPlanUpdated(
    _event: LangyPlanUpdatedEvent,
    state: LangyConversationStateData,
  ): LangyConversationStateData {
    return state;
  }

  handleLangyConversationLocalControlRequested(
    _event: LangyLocalControlRequestedEvent,
    state: LangyConversationStateData,
  ): LangyConversationStateData {
    return state;
  }

  handleLangyConversationLocalWorkspaceConnected(
    _event: LangyLocalWorkspaceConnectedEvent,
    state: LangyConversationStateData,
  ): LangyConversationStateData {
    return state;
  }

  handleLangyConversationLocalWorkspaceDisconnected(
    _event: LangyLocalWorkspaceDisconnectedEvent,
    state: LangyConversationStateData,
  ): LangyConversationStateData {
    return state;
  }

  handleLangyConversationLocalPolicyChanged(
    _event: LangyLocalPolicyChangedEvent,
    state: LangyConversationStateData,
  ): LangyConversationStateData {
    return state;
  }

  handleLangyConversationUserWaitStarted(
    _event: LangyUserWaitStartedEvent,
    state: LangyConversationStateData,
  ): LangyConversationStateData {
    return state;
  }

  handleLangyConversationUserWaitEnded(
    _event: LangyUserWaitEndedEvent,
    state: LangyConversationStateData,
  ): LangyConversationStateData {
    return state;
  }
}
