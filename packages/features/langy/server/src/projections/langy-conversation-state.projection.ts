/**
 * The `langy_conversation` aggregate: its full durable event schemas and the fold that projects
 * them into conversation state.
 * payload schema, which lives in `@langwatch/langy-contract` (ADR-059). They
 */
import type { Projection, StateProjectionStore } from "@langwatch/eventing";
import { AbstractFoldProjection, EventSchema, type FoldEventHandlers } from "@langwatch/eventing";
import {
  foldLangyConversationState,
  initLangyConversationState,
  LANGY_CONVERSATION_PROJECTION_VERSIONS,
  type LangyConversationStateData,
} from "@langwatch/langy-contract";

import {
  LANGY_CONVERSATION_EVENT_TYPES,
  LANGY_CONVERSATION_EVENT_VERSIONS,
  langyAgentRespondedEventDataSchema,
  langyAgentResponseFailedEventDataSchema,
  langyAgentTurnAcceptedEventDataSchema,
  langyConversationArchivedEventDataSchema,
  langyConversationForkedEventDataSchema,
  langyConversationHandoffConsumedEventDataSchema,
  langyConversationHandoffPendingEventDataSchema,
  langyConversationMetadataUpdatedEventDataSchema,
  langyConversationStartedEventDataSchema,
  langyConversationTitleGeneratedEventDataSchema,
  langyLocalControlRequestedEventDataSchema,
  langyLocalPolicyChangedEventDataSchema,
  langyLocalWorkspaceConnectedEventDataSchema,
  langyLocalWorkspaceDisconnectedEventDataSchema,
  langyMessageImportedEventDataSchema,
  langyMessageRecordedEventDataSchema,
  langyPlanUpdatedEventDataSchema,
  langyToolCallFailedEventDataSchema,
  langyToolCallInitiatedEventDataSchema,
  langyToolCallSucceededEventDataSchema,
  langyUserWaitEndedEventDataSchema,
  langyUserWaitStartedEventDataSchema,
} from "@langwatch/langy-contract";
import { z } from "zod";

export const LangyConversationStartedEventSchema = EventSchema.extend({
  type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_STARTED),
  version: z.literal(LANGY_CONVERSATION_EVENT_VERSIONS.CONVERSATION_STARTED),
  data: langyConversationStartedEventDataSchema,
});
export type LangyConversationStartedEvent = z.infer<typeof LangyConversationStartedEventSchema>;

export const LangyConversationForkedEventSchema = EventSchema.extend({
  type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_FORKED),
  version: z.literal(LANGY_CONVERSATION_EVENT_VERSIONS.CONVERSATION_FORKED),
  data: langyConversationForkedEventDataSchema,
});
export type LangyConversationForkedEvent = z.infer<typeof LangyConversationForkedEventSchema>;

export const LangyMessageRecordedEventSchema = EventSchema.extend({
  type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.MESSAGE_RECORDED),
  version: z.literal(LANGY_CONVERSATION_EVENT_VERSIONS.MESSAGE_RECORDED),
  data: langyMessageRecordedEventDataSchema,
});
export type LangyMessageRecordedEvent = z.infer<typeof LangyMessageRecordedEventSchema>;

export const LangyMessageImportedEventSchema = EventSchema.extend({
  type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.MESSAGE_IMPORTED),
  version: z.literal(LANGY_CONVERSATION_EVENT_VERSIONS.MESSAGE_IMPORTED),
  data: langyMessageImportedEventDataSchema,
});
export type LangyMessageImportedEvent = z.infer<typeof LangyMessageImportedEventSchema>;

export const LangyAgentTurnAcceptedEventSchema = EventSchema.extend({
  type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_ACCEPTED),
  version: z.literal(LANGY_CONVERSATION_EVENT_VERSIONS.AGENT_TURN_ACCEPTED),
  data: langyAgentTurnAcceptedEventDataSchema,
});
export type LangyAgentTurnAcceptedEvent = z.infer<typeof LangyAgentTurnAcceptedEventSchema>;

export const LangyToolCallInitiatedEventSchema = EventSchema.extend({
  type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_INITIATED),
  version: z.literal(LANGY_CONVERSATION_EVENT_VERSIONS.TOOL_CALL_INITIATED),
  data: langyToolCallInitiatedEventDataSchema,
});
export type LangyToolCallInitiatedEvent = z.infer<typeof LangyToolCallInitiatedEventSchema>;

export const LangyToolCallSucceededEventSchema = EventSchema.extend({
  type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_SUCCEEDED),
  version: z.literal(LANGY_CONVERSATION_EVENT_VERSIONS.TOOL_CALL_SUCCEEDED),
  data: langyToolCallSucceededEventDataSchema,
});
export type LangyToolCallSucceededEvent = z.infer<typeof LangyToolCallSucceededEventSchema>;

export const LangyToolCallFailedEventSchema = EventSchema.extend({
  type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_FAILED),
  version: z.literal(LANGY_CONVERSATION_EVENT_VERSIONS.TOOL_CALL_FAILED),
  data: langyToolCallFailedEventDataSchema,
});
export type LangyToolCallFailedEvent = z.infer<typeof LangyToolCallFailedEventSchema>;

export const LangyPlanUpdatedEventSchema = EventSchema.extend({
  type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.PLAN_UPDATED),
  version: z.literal(LANGY_CONVERSATION_EVENT_VERSIONS.PLAN_UPDATED),
  data: langyPlanUpdatedEventDataSchema,
});
export type LangyPlanUpdatedEvent = z.infer<typeof LangyPlanUpdatedEventSchema>;

export const LangyAgentResponseFailedEventSchema = EventSchema.extend({
  type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONSE_FAILED),
  version: z.literal(LANGY_CONVERSATION_EVENT_VERSIONS.AGENT_RESPONSE_FAILED),
  data: langyAgentResponseFailedEventDataSchema,
});
export type LangyAgentResponseFailedEvent = z.infer<typeof LangyAgentResponseFailedEventSchema>;

// NOTE: `status_reported` and `progress_reported` are EPHEMERAL signals, not
// durable events — they never reach `event_log` or any projection (ADR-046).
// Their PAYLOAD schemas live in `../ephemeral.ts` (the signal contract PR3's
// Redis transport implements), not here, because these schemas are for durable
// event-sourcing events.

export const LangyAgentRespondedEventSchema = EventSchema.extend({
  type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED),
  version: z.literal(LANGY_CONVERSATION_EVENT_VERSIONS.AGENT_RESPONDED),
  data: langyAgentRespondedEventDataSchema,
});
export type LangyAgentRespondedEvent = z.infer<typeof LangyAgentRespondedEventSchema>;

export const LangyConversationArchivedEventSchema = EventSchema.extend({
  type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.ARCHIVED),
  version: z.literal(LANGY_CONVERSATION_EVENT_VERSIONS.ARCHIVED),
  data: langyConversationArchivedEventDataSchema,
});
export type LangyConversationArchivedEvent = z.infer<typeof LangyConversationArchivedEventSchema>;

export const LangyConversationMetadataUpdatedEventSchema = EventSchema.extend({
  type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.METADATA_UPDATED),
  version: z.literal(LANGY_CONVERSATION_EVENT_VERSIONS.METADATA_UPDATED),
  data: langyConversationMetadataUpdatedEventDataSchema,
});
export type LangyConversationMetadataUpdatedEvent = z.infer<
  typeof LangyConversationMetadataUpdatedEventSchema
>;

export const LangyConversationHandoffPendingEventSchema = EventSchema.extend({
  type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_HANDOFF_PENDING),
  version: z.literal(LANGY_CONVERSATION_EVENT_VERSIONS.CONVERSATION_HANDOFF_PENDING),
  data: langyConversationHandoffPendingEventDataSchema,
});
export type LangyConversationHandoffPendingEvent = z.infer<
  typeof LangyConversationHandoffPendingEventSchema
>;

export const LangyConversationHandoffConsumedEventSchema = EventSchema.extend({
  type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_HANDOFF_CONSUMED),
  version: z.literal(LANGY_CONVERSATION_EVENT_VERSIONS.CONVERSATION_HANDOFF_CONSUMED),
  data: langyConversationHandoffConsumedEventDataSchema,
});
export type LangyConversationHandoffConsumedEvent = z.infer<
  typeof LangyConversationHandoffConsumedEventSchema
>;

export const LangyConversationTitleGeneratedEventSchema = EventSchema.extend({
  type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.TITLE_GENERATED),
  version: z.literal(LANGY_CONVERSATION_EVENT_VERSIONS.TITLE_GENERATED),
  data: langyConversationTitleGeneratedEventDataSchema,
});
export type LangyConversationTitleGeneratedEvent = z.infer<
  typeof LangyConversationTitleGeneratedEventSchema
>;

export const LangyLocalControlRequestedEventSchema = EventSchema.extend({
  type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.LOCAL_CONTROL_REQUESTED),
  version: z.literal(LANGY_CONVERSATION_EVENT_VERSIONS.LOCAL_CONTROL_REQUESTED),
  data: langyLocalControlRequestedEventDataSchema,
});
export type LangyLocalControlRequestedEvent = z.infer<typeof LangyLocalControlRequestedEventSchema>;

export const LangyLocalWorkspaceConnectedEventSchema = EventSchema.extend({
  type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.LOCAL_WORKSPACE_CONNECTED),
  version: z.literal(LANGY_CONVERSATION_EVENT_VERSIONS.LOCAL_WORKSPACE_CONNECTED),
  data: langyLocalWorkspaceConnectedEventDataSchema,
});
export type LangyLocalWorkspaceConnectedEvent = z.infer<
  typeof LangyLocalWorkspaceConnectedEventSchema
>;

export const LangyLocalWorkspaceDisconnectedEventSchema = EventSchema.extend({
  type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.LOCAL_WORKSPACE_DISCONNECTED),
  version: z.literal(LANGY_CONVERSATION_EVENT_VERSIONS.LOCAL_WORKSPACE_DISCONNECTED),
  data: langyLocalWorkspaceDisconnectedEventDataSchema,
});
export type LangyLocalWorkspaceDisconnectedEvent = z.infer<
  typeof LangyLocalWorkspaceDisconnectedEventSchema
>;

export const LangyLocalPolicyChangedEventSchema = EventSchema.extend({
  type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.LOCAL_POLICY_CHANGED),
  version: z.literal(LANGY_CONVERSATION_EVENT_VERSIONS.LOCAL_POLICY_CHANGED),
  data: langyLocalPolicyChangedEventDataSchema,
});
export type LangyLocalPolicyChangedEvent = z.infer<typeof LangyLocalPolicyChangedEventSchema>;

export const LangyUserWaitStartedEventSchema = EventSchema.extend({
  type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.USER_WAIT_STARTED),
  version: z.literal(LANGY_CONVERSATION_EVENT_VERSIONS.USER_WAIT_STARTED),
  data: langyUserWaitStartedEventDataSchema,
});
export type LangyUserWaitStartedEvent = z.infer<typeof LangyUserWaitStartedEventSchema>;

export const LangyUserWaitEndedEventSchema = EventSchema.extend({
  type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.USER_WAIT_ENDED),
  version: z.literal(LANGY_CONVERSATION_EVENT_VERSIONS.USER_WAIT_ENDED),
  data: langyUserWaitEndedEventDataSchema,
});
export type LangyUserWaitEndedEvent = z.infer<typeof LangyUserWaitEndedEventSchema>;

/**
 * Union of all langy-conversation-processing event types.
 */
export type LangyConversationProcessingEvent =
  | LangyConversationStartedEvent
  | LangyConversationForkedEvent
  | LangyMessageRecordedEvent
  | LangyMessageImportedEvent
  | LangyAgentTurnAcceptedEvent
  | LangyToolCallInitiatedEvent
  | LangyToolCallSucceededEvent
  | LangyToolCallFailedEvent
  | LangyPlanUpdatedEvent
  | LangyAgentResponseFailedEvent
  | LangyAgentRespondedEvent
  | LangyConversationArchivedEvent
  | LangyConversationMetadataUpdatedEvent
  | LangyConversationHandoffPendingEvent
  | LangyConversationHandoffConsumedEvent
  | LangyConversationTitleGeneratedEvent
  | LangyLocalControlRequestedEvent
  | LangyLocalWorkspaceConnectedEvent
  | LangyLocalWorkspaceDisconnectedEvent
  | LangyLocalPolicyChangedEvent
  | LangyUserWaitStartedEvent
  | LangyUserWaitEndedEvent;

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
  // The events below change nothing in this projection, and it reads them all the same: the
  // cursor on this row is the conversation's position in its own event log, and the freshness
  // signal is published only once that cursor has reached the event that raised it. An event
  // this projection did not read was an event the cursor could never reach, so its signal was
  // retried until it was dropped and the panel heard nothing about it.
  LangyPlanUpdatedEventSchema,
  LangyLocalControlRequestedEventSchema,
  LangyLocalWorkspaceConnectedEventSchema,
  LangyLocalWorkspaceDisconnectedEventSchema,
  LangyLocalPolicyChangedEventSchema,
  LangyUserWaitStartedEventSchema,
  LangyUserWaitEndedEventSchema,
] as const;

/**
 * Type-safe fold projection for Langy conversation state. - `implements FoldEventHandlers` enforces
 * a handler for every event schema. - Handler names are derived from event type strings (e.g.
 * `foldLangyConversationState` (ADR-059) — the same reducer a browser spine
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
  implements FoldEventHandlers<typeof langyConversationEvents, LangyConversationStateData>
{
  readonly name = "langyConversationState";
  readonly version = LANGY_CONVERSATION_PROJECTION_VERSIONS.CONVERSATION_STATE;
  readonly store: StateProjectionStore<LangyConversationStateData>;

  protected readonly events = langyConversationEvents;

  static create(deps: {
    store: StateProjectionStore<LangyConversationStateData>;
  }): LangyConversationStateFoldProjection {
    return new LangyConversationStateFoldProjection(deps);
  }

  constructor(deps: { store: StateProjectionStore<LangyConversationStateData> }) {
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

  // Read, and folded into nothing. The turn document holds what these events say (the plan, the
  // folder, the cards) and the conversation row holds none of it. They are read here so the
  // cursor moves over them, which is what lets the freshness signal reach the panel while a
  // command is still running.

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
