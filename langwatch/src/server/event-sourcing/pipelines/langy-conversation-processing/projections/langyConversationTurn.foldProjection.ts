import {
  foldLangyConversationTurn,
  initLangyConversationTurnState,
  makeConversationTurnKey,
  LANGY_CONVERSATION_PROJECTION_VERSIONS,
  type LangyConversationTurnData,
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
  LangyPlanUpdatedEvent,
  LangyToolCallFailedEvent,
  LangyToolCallInitiatedEvent,
  LangyToolCallSucceededEvent,
} from "../schemas/events";
import {
  LangyAgentResponseFailedEventSchema,
  LangyAgentTurnAcceptedEventSchema,
  LangyAgentRespondedEventSchema,
  LangyPlanUpdatedEventSchema,
  LangyToolCallFailedEventSchema,
  LangyToolCallInitiatedEventSchema,
  LangyToolCallSucceededEventSchema,
} from "../schemas/events";

export interface LangyConversationTurn
  extends Projection<LangyConversationTurnData> {
  data: LangyConversationTurnData;
}

const langyConversationTurnEvents = [
  LangyAgentTurnAcceptedEventSchema,
  LangyToolCallInitiatedEventSchema,
  LangyToolCallSucceededEventSchema,
  LangyToolCallFailedEventSchema,
  LangyPlanUpdatedEventSchema,
  LangyAgentResponseFailedEventSchema,
  LangyAgentRespondedEventSchema,
] as const;

/**
 * Per-turn fold projection. `key` partitions the conversation's stream by turn,
 * so each turn accretes into its own document. Handler names derive from the
 * event type strings, exactly like the conversation-state fold.
 *
 * The reduction itself — the whole `(state, event) → state` body — lives in
 * `@langwatch/langy`'s `foldLangyConversationTurn` (ADR-059): the SAME reducer
 * the browser folds its local tail with, so a turn renders identically on both
 * sides. This class is only the server rig — schema routing, the store,
 * versioning, and the bookkeeping stamps.
 */
export class LangyConversationTurnFoldProjection
  extends AbstractFoldProjection<
    LangyConversationTurnData,
    typeof langyConversationTurnEvents,
    "CreatedAt",
    "UpdatedAt",
    "LastEventOccurredAt",
    StateProjectionStore<LangyConversationTurnData>
  >
  implements
    FoldEventHandlers<
      typeof langyConversationTurnEvents,
      LangyConversationTurnData
    >
{
  readonly name = "langyConversationTurn";
  readonly version = LANGY_CONVERSATION_PROJECTION_VERSIONS.CONVERSATION_TURN;
  readonly store: StateProjectionStore<LangyConversationTurnData>;

  protected readonly events = langyConversationTurnEvents;

  /** One document per (conversationId, turnId). */
  key = (event: { type: string }): string => {
    const data = (
      event as { data?: { conversationId?: string; turnId?: string } }
    ).data;
    return makeConversationTurnKey(
      data?.conversationId ?? "",
      data?.turnId ?? "",
    );
  };

  constructor(deps: {
    store: StateProjectionStore<LangyConversationTurnData>;
  }) {
    super();
    this.store = deps.store;
  }

  protected initState() {
    return initLangyConversationTurnState();
  }

  handleLangyConversationAgentTurnAccepted(
    event: LangyAgentTurnAcceptedEvent,
    state: LangyConversationTurnData,
  ): LangyConversationTurnData {
    return foldLangyConversationTurn(state, event);
  }

  handleLangyConversationToolCallInitiated(
    event: LangyToolCallInitiatedEvent,
    state: LangyConversationTurnData,
  ): LangyConversationTurnData {
    return foldLangyConversationTurn(state, event);
  }

  handleLangyConversationToolCallSucceeded(
    event: LangyToolCallSucceededEvent,
    state: LangyConversationTurnData,
  ): LangyConversationTurnData {
    return foldLangyConversationTurn(state, event);
  }

  handleLangyConversationToolCallFailed(
    event: LangyToolCallFailedEvent,
    state: LangyConversationTurnData,
  ): LangyConversationTurnData {
    return foldLangyConversationTurn(state, event);
  }

  handleLangyConversationPlanUpdated(
    event: LangyPlanUpdatedEvent,
    state: LangyConversationTurnData,
  ): LangyConversationTurnData {
    return foldLangyConversationTurn(state, event);
  }

  handleLangyConversationAgentResponseFailed(
    event: LangyAgentResponseFailedEvent,
    state: LangyConversationTurnData,
  ): LangyConversationTurnData {
    return foldLangyConversationTurn(state, event);
  }

  handleLangyConversationAgentResponded(
    event: LangyAgentRespondedEvent,
    state: LangyConversationTurnData,
  ): LangyConversationTurnData {
    return foldLangyConversationTurn(state, event);
  }
}
