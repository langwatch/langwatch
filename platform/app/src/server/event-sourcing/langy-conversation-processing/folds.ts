import {
  foldLangyConversationState,
  foldLangyConversationTurn,
  initLangyConversationState,
  initLangyConversationTurnState,
  LANGY_CONVERSATION_EVENT_TYPES,
  LANGY_CONVERSATION_TURN_STATUS,
  LANGY_TITLE_SOURCE,
  LANGY_TURN_TOOL_CALL_STATUS,
  type LangyConversationStateEvent,
  type LangyConversationStateFoldState,
  type LangyConversationTurnEvent,
  type LangyConversationTurnFoldState,
  langyMessagePartSchema,
} from "@langwatch/langy";
import { z } from "zod";

/**
 * Pinned rather than derived: both folds cut over onto tables that already hold
 * live rows, and a derived hash would fail every one of them at its version gate.
 */
export const LANGY_CONVERSATION_SPINE_VERSION = "2026-07-10";
export const LANGY_CONVERSATION_TURN_VERSION = "2026-07-15";

export const LANGY_CONVERSATION_SPINE_PROJECTION = "langyConversationState";
export const LANGY_CONVERSATION_TURN_PROJECTION = "langyConversationTurn";

export type LangyConversationSpineState = LangyConversationStateFoldState;
export type LangyConversationTurnState = LangyConversationTurnFoldState;

export const initLangyConversationSpineState = initLangyConversationState;
export const initLangyConversationTurnState_ = initLangyConversationTurnState;

/** Structural mirror of `LangyConversationStateFoldState`, for `.withFold`'s
 *  version hash — the pin above is what actually governs the row. */
export const langyConversationSpineStateSchema = z.object({
  ConversationId: z.string(),
  UserId: z.string(),
  Title: z.string().nullable(),
  TitleSource: z.enum([
    LANGY_TITLE_SOURCE.DERIVED,
    LANGY_TITLE_SOURCE.AUTO,
    LANGY_TITLE_SOURCE.USER,
  ]),
  // `LangyConversationStateData.Status` is a plain `string`, not the enum's
  // literal union — the fold's own doc calls this out as a flagged gap.
  Status: z.string(),
  IsShared: z.boolean(),
  SharedAt: z.number().nullable(),
  SharedById: z.string().nullable(),
  MessageCount: z.number(),
  LastActivityAt: z.number().nullable(),
  CurrentTurnId: z.string().nullable(),
  LastError: z.string().nullable(),
  PendingHandoffToken: z.string().nullable(),
  PendingHandoffTurnId: z.string().nullable(),
  RunToken: z.string().nullable(),
  ArchivedAt: z.number().nullable(),
}) satisfies z.ZodType<LangyConversationSpineState>;

/**
 * `langyTurnToolCallSchema`/`langyPlanItemSchema` (`@langwatch/langy`) are
 * `z.record(...).and(z.object(...))` — a `ZodIntersection`, a node kind the
 * state-version hash walker (`packages/event-sourcing`) does not handle. The
 * object-only shape below is what a `.withFold` state schema is walked for
 * (the version hash and the output type); nothing here ever calls `.parse()`
 * on it, so dropping the arbitrary-extra-keys record half costs nothing.
 */
const toolCallStateSchema = z.object({
  toolCallId: z.string(),
  toolName: z.string(),
  command: z.string().optional(),
  input: z.unknown().optional(),
  status: z.enum([
    LANGY_TURN_TOOL_CALL_STATUS.INITIATED,
    LANGY_TURN_TOOL_CALL_STATUS.SUCCEEDED,
    LANGY_TURN_TOOL_CALL_STATUS.FAILED,
  ]),
  durationMs: z.number().optional(),
  errorText: z.string().optional(),
});

const planItemStateSchema = z.object({
  content: z.string(),
  status: z.string(),
});

/** Structural mirror of `LangyConversationTurnFoldState`, same purpose. */
export const langyConversationTurnStateSchema = z.object({
  ConversationId: z.string(),
  TurnId: z.string(),
  Status: z.enum([
    LANGY_CONVERSATION_TURN_STATUS.PENDING,
    LANGY_CONVERSATION_TURN_STATUS.RUNNING,
    LANGY_CONVERSATION_TURN_STATUS.COMPLETED,
    LANGY_CONVERSATION_TURN_STATUS.FAILED,
    LANGY_CONVERSATION_TURN_STATUS.STOPPED,
  ]),
  QuestionParts: z.array(langyMessagePartSchema),
  AnswerParts: z.array(langyMessagePartSchema),
  ToolCalls: z.array(toolCallStateSchema),
  Plan: z.array(planItemStateSchema).nullable(),
  Error: z.string().nullable(),
  StartedAt: z.number().nullable(),
  EndedAt: z.number().nullable(),
});

type WithOccurredAt<Data> = Data & { readonly occurredAt: number };

/**
 * `foldLangyConversationState` (`@langwatch/langy`, shared with the browser)
 * reads only `type`/`occurredAt`/`data` — never an event id or accept time —
 * so a `.withFold` handler, which is handed nothing but `(state, data)`, can
 * reconstruct exactly what it needs as long as `occurredAt` rides the payload
 * (see `events.ts`). One factory closed over the persisted type literal
 * replaces one handwritten handler per event.
 */
function spineHandler<Type extends LangyConversationStateEvent["type"]>(
  type: Type,
): (
  state: LangyConversationSpineState,
  data: WithOccurredAt<
    Extract<LangyConversationStateEvent, { type: Type }>["data"]
  >,
) => LangyConversationSpineState {
  return (state, data) =>
    foldLangyConversationState(state, {
      type,
      occurredAt: data.occurredAt,
      data,
    });
}

function turnHandler<Type extends LangyConversationTurnEvent["type"]>(
  type: Type,
): (
  state: LangyConversationTurnState,
  data: WithOccurredAt<
    Extract<LangyConversationTurnEvent, { type: Type }>["data"]
  >,
) => LangyConversationTurnState {
  return (state, data) =>
    foldLangyConversationTurn(state, {
      type,
      occurredAt: data.occurredAt,
      data,
    });
}

/** Every event the spine fold reacts to, except `planUpdated` — a turn-only
 *  concern the spine never read even in the retired tree. */
export const applyLangyConversationSpineEvent = {
  conversationStarted: spineHandler(
    LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_STARTED,
  ),
  conversationForked: spineHandler(
    LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_FORKED,
  ),
  messageRecorded: spineHandler(
    LANGY_CONVERSATION_EVENT_TYPES.MESSAGE_RECORDED,
  ),
  messageImported: spineHandler(
    LANGY_CONVERSATION_EVENT_TYPES.MESSAGE_IMPORTED,
  ),
  agentTurnAccepted: spineHandler(
    LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_ACCEPTED,
  ),
  toolCallInitiated: spineHandler(
    LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_INITIATED,
  ),
  toolCallSucceeded: spineHandler(
    LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_SUCCEEDED,
  ),
  toolCallFailed: spineHandler(LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_FAILED),
  agentResponseFailed: spineHandler(
    LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONSE_FAILED,
  ),
  agentResponded: spineHandler(LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED),
  conversationArchived: spineHandler(LANGY_CONVERSATION_EVENT_TYPES.ARCHIVED),
  conversationMetadataUpdated: spineHandler(
    LANGY_CONVERSATION_EVENT_TYPES.METADATA_UPDATED,
  ),
  conversationHandoffPending: spineHandler(
    LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_HANDOFF_PENDING,
  ),
  conversationHandoffConsumed: spineHandler(
    LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_HANDOFF_CONSUMED,
  ),
  conversationTitleGenerated: spineHandler(
    LANGY_CONVERSATION_EVENT_TYPES.TITLE_GENERATED,
  ),
};

/** The seven events the per-turn render document folds — identical to
 *  the retired tree's `LangyConversationTurnFoldProjection`. */
export const applyLangyConversationTurnEvent = {
  agentTurnAccepted: turnHandler(
    LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_ACCEPTED,
  ),
  toolCallInitiated: turnHandler(
    LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_INITIATED,
  ),
  toolCallSucceeded: turnHandler(
    LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_SUCCEEDED,
  ),
  toolCallFailed: turnHandler(LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_FAILED),
  planUpdated: turnHandler(LANGY_CONVERSATION_EVENT_TYPES.PLAN_UPDATED),
  agentResponseFailed: turnHandler(
    LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONSE_FAILED,
  ),
  agentResponded: turnHandler(LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED),
};
