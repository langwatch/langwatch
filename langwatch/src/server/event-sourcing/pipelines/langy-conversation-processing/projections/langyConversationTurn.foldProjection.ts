import type { Projection } from "../../../";
import {
  AbstractFoldProjection,
  type FoldEventHandlers,
} from "../../../projections/abstractFoldProjection";
import type { StateProjectionStore } from "../../../projections/stateProjection.types";
import {
  LANGY_CONVERSATION_PROJECTION_VERSIONS,
  LANGY_CONVERSATION_TURN_STATUS,
  LANGY_TURN_TOOL_CALL_STATUS,
  type LangyConversationTurnStatus,
  type LangyTurnToolCallStatus,
} from "../schemas/constants";
import type {
  LangyJsonObject,
  LangyJsonValue,
  LangyMessagePart,
} from "../schemas/shared";
import type {
  LangyAgentResponseFailedEvent,
  LangyAgentTurnAcceptedEvent,
  LangyAgentRespondedEvent,
  LangyPlanItemData,
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

/**
 * Composite fold key: one turn document per `(conversationId, turnId)` within a
 * conversation's event stream. conversationId (ksuid) and turnId (uuid) never
 * contain ":", so a single ":" is an unambiguous delimiter (mirrors
 * experiment-run's makeExperimentRunKey).
 */
export function makeConversationTurnKey(
  conversationId: string,
  turnId: string,
): string {
  return `${conversationId}:${turnId}`;
}

/** Inverse of makeConversationTurnKey. Splits on the first ":" only. */
export function parseConversationTurnKey(key: string): {
  conversationId: string;
  turnId: string;
} {
  const i = key.indexOf(":");
  return i === -1
    ? { conversationId: key, turnId: "" }
    : { conversationId: key.slice(0, i), turnId: key.slice(i + 1) };
}

/**
 * One tool call in a turn, folded from its durable lifecycle events:
 * `tool_call_initiated` pushes it, `tool_call_succeeded`/`tool_call_failed`
 * resolves it. Tool OUTPUT is not here — it rides the final answer parts (the
 * tool-output cards on `agent_responded`); this list is the lifecycle audit
 * (what ran, how it went, how long) so a turn can be rendered without a join.
 */
export type LangyTurnToolCall = LangyJsonObject & {
  toolCallId: string;
  toolName: string;
  command?: string;
  input?: LangyJsonValue;
  status: LangyTurnToolCallStatus;
  durationMs?: number;
  errorText?: string;
};

/**
 * The turn render document — one turn folded into its final state. A SECOND fold
 * projection over the langy_conversation aggregate (the first is the
 * conversation spine): same event stream, keyed per turn instead of per
 * conversation. Reading one document is enough to render an entire turn.
 *
 * `QuestionParts` is reserved: it is populated once the conversation flow shares
 * a turnId between the user message (`message_recorded`) and the response
 * (`agent_turn_accepted`) — see LANGY_REWORK_PLAN.md, Step S2. Until then the
 * answer parts already carry everything renderable (text + tool-output cards +
 * enrichment card + actions).
 */
export interface LangyConversationTurnData {
  ConversationId: string;
  TurnId: string;
  Status: LangyConversationTurnStatus;
  /** The user's question that opened the turn. Reserved for S2 (see above). */
  QuestionParts: LangyMessagePart[];
  /** The agent's whole final answer — text, tool-output cards, enrichment, actions. */
  AnswerParts: LangyMessagePart[];
  /** Tool calls in initiation order (lifecycle audit; outputs live in AnswerParts). */
  ToolCalls: LangyTurnToolCall[];
  /**
   * The agent's plan (its `todowrite` todo list) for this turn — a full snapshot,
   * last-write-wins, so the checklist survives a reload from the fold. Null when
   * the turn never maintained a plan (⇒ today's rendering). Each item is
   * `{ content, status }` with status kept as the tool authored it.
   */
  Plan: LangyPlanItemData[] | null;
  Error: string | null;
  StartedAt: number | null;
  EndedAt: number | null;
  CreatedAt: number;
  UpdatedAt: number;
  LastEventOccurredAt: number;
}

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
    return {
      ConversationId: "",
      TurnId: "",
      Status: LANGY_CONVERSATION_TURN_STATUS.PENDING,
      QuestionParts: [],
      AnswerParts: [],
      ToolCalls: [],
      Plan: null,
      Error: null,
      StartedAt: null,
      EndedAt: null,
    };
  }

  /** Set identity from any turn event (the fold may hydrate mid-stream). */
  private withIdentity(
    event: { data: { conversationId: string; turnId: string } },
    state: LangyConversationTurnData,
  ): LangyConversationTurnData {
    return {
      ...state,
      ConversationId: state.ConversationId || event.data.conversationId,
      TurnId: state.TurnId || event.data.turnId,
    };
  }

  handleLangyConversationAgentTurnAccepted(
    event: LangyAgentTurnAcceptedEvent,
    state: LangyConversationTurnData,
  ): LangyConversationTurnData {
    const question = event.data.questionParts;
    return {
      ...this.withIdentity(event, state),
      Status: LANGY_CONVERSATION_TURN_STATUS.RUNNING,
      StartedAt: state.StartedAt ?? event.occurredAt,
      // The question rides the start event so the turn doc is self-contained.
      QuestionParts:
        question && question.length > 0 ? question : state.QuestionParts,
    };
  }

  /**
   * Resolve a tool call in place (by toolCallId), or append when it is missing —
   * a terminal that arrives before its `initiated` (out-of-order or dropped)
   * must still land. The base re-folds in occurredAt order, so the common path
   * is initiate-then-resolve; this is the defensive branch.
   */
  private upsertToolCall(
    state: LangyConversationTurnData,
    toolCallId: string,
    make: () => LangyTurnToolCall,
    patch: (existing: LangyTurnToolCall) => LangyTurnToolCall,
  ): LangyTurnToolCall[] {
    const idx = state.ToolCalls.findIndex((t) => t.toolCallId === toolCallId);
    if (idx === -1) return [...state.ToolCalls, patch(make())];
    const next = [...state.ToolCalls];
    next[idx] = patch(next[idx]!);
    return next;
  }

  handleLangyConversationToolCallInitiated(
    event: LangyToolCallInitiatedEvent,
    state: LangyConversationTurnData,
  ): LangyConversationTurnData {
    const { toolCallId, toolName, command, input } = event.data;
    const ToolCalls = this.upsertToolCall(
      state,
      toolCallId,
      () => ({ toolCallId, toolName, status: LANGY_TURN_TOOL_CALL_STATUS.INITIATED }),
      (existing) => ({
        ...existing,
        toolName: existing.toolName || toolName,
        // Only fill from the initiate frame; never regress a resolved status.
        status: existing.status ?? LANGY_TURN_TOOL_CALL_STATUS.INITIATED,
        ...(command !== undefined ? { command } : {}),
        ...(input !== undefined ? { input } : {}),
      }),
    );
    return { ...this.withIdentity(event, state), ToolCalls };
  }

  handleLangyConversationToolCallSucceeded(
    event: LangyToolCallSucceededEvent,
    state: LangyConversationTurnData,
  ): LangyConversationTurnData {
    const { toolCallId, toolName, command, input, durationMs } = event.data;
    const ToolCalls = this.upsertToolCall(
      state,
      toolCallId,
      () => ({ toolCallId, toolName, status: LANGY_TURN_TOOL_CALL_STATUS.SUCCEEDED }),
      (existing) => ({
        ...existing,
        toolName: existing.toolName || toolName,
        status: LANGY_TURN_TOOL_CALL_STATUS.SUCCEEDED,
        ...(command !== undefined ? { command } : {}),
        ...(input !== undefined ? { input } : {}),
        ...(durationMs !== undefined ? { durationMs } : {}),
      }),
    );
    return { ...this.withIdentity(event, state), ToolCalls };
  }

  handleLangyConversationToolCallFailed(
    event: LangyToolCallFailedEvent,
    state: LangyConversationTurnData,
  ): LangyConversationTurnData {
    const { toolCallId, toolName, command, input, durationMs, errorText } =
      event.data;
    const ToolCalls = this.upsertToolCall(
      state,
      toolCallId,
      () => ({ toolCallId, toolName, status: LANGY_TURN_TOOL_CALL_STATUS.FAILED }),
      (existing) => ({
        ...existing,
        toolName: existing.toolName || toolName,
        status: LANGY_TURN_TOOL_CALL_STATUS.FAILED,
        ...(command !== undefined ? { command } : {}),
        ...(input !== undefined ? { input } : {}),
        ...(durationMs !== undefined ? { durationMs } : {}),
        ...(errorText !== undefined ? { errorText } : {}),
      }),
    );
    return { ...this.withIdentity(event, state), ToolCalls };
  }

  /**
   * Fold a plan snapshot onto the turn. Whole-list, last-write-wins: the base
   * re-folds events in occurredAt order, so the LATEST plan_updated is the plan.
   * Never regresses the turn's status — a plan can arrive at any point in a
   * running turn.
   */
  handleLangyConversationPlanUpdated(
    event: LangyPlanUpdatedEvent,
    state: LangyConversationTurnData,
  ): LangyConversationTurnData {
    return {
      ...this.withIdentity(event, state),
      Plan: event.data.items,
    };
  }

  handleLangyConversationAgentResponseFailed(
    event: LangyAgentResponseFailedEvent,
    state: LangyConversationTurnData,
  ): LangyConversationTurnData {
    return {
      ...this.withIdentity(event, state),
      Status: LANGY_CONVERSATION_TURN_STATUS.FAILED,
      Error: event.data.error,
      EndedAt: event.occurredAt,
    };
  }

  handleLangyConversationAgentResponded(
    event: LangyAgentRespondedEvent,
    state: LangyConversationTurnData,
  ): LangyConversationTurnData {
    // Three terminal outcomes on the one answer-carrying event: a user stop keeps
    // the partial answer (AnswerParts) but renders distinctly from a clean finish,
    // and is never an error (ADR-058). A `failed` outcome here is the ran-but-
    // failed answer; the no-answer stall is agent_response_failed, handled above.
    const outcome = event.data.outcome;
    const status =
      outcome === "failed"
        ? LANGY_CONVERSATION_TURN_STATUS.FAILED
        : outcome === "stopped"
          ? LANGY_CONVERSATION_TURN_STATUS.STOPPED
          : LANGY_CONVERSATION_TURN_STATUS.COMPLETED;
    return {
      ...this.withIdentity(event, state),
      AnswerParts: event.data.parts ?? [],
      Status: status,
      Error:
        outcome === "failed" ? event.data.error ?? "unknown error" : state.Error,
      EndedAt: event.occurredAt,
    };
  }
}
