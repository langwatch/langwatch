/**
 * The Langy turn fold — the WHOLE reduction of a turn's durable events into its
 * render document, as one pure module (ADR-059 §1).
 *
 * The server's `LangyConversationTurnFoldProjection` and the browser's local
 * projection both call `foldLangyConversationTurn`: same events, same reducer,
 * so a turn renders identically on both sides because it is literally the same
 * computation. Everything here is `(state, event) → state` — no store, no
 * versioning, no server types; those stay in the pipeline wrapper.
 *
 * The event parameter is the PORTABLE shape of a turn event — `type`,
 * `occurredAt`, `data` — which the server's full (branded-envelope) event types
 * satisfy structurally, and which a wire-parsed tail event satisfies exactly.
 */
import { z } from "zod";

import {
  LANGY_CONVERSATION_EVENT_TYPES,
  LANGY_CONVERSATION_TURN_STATUS,
  LANGY_TURN_TOOL_CALL_STATUS,
  type LangyConversationTurnStatus,
  type LangyTurnToolCallStatus,
} from "./constants";
import {
  langyAgentResponseFailedEventDataSchema,
  langyAgentRespondedEventDataSchema,
  langyAgentTurnAcceptedEventDataSchema,
  langyPlanUpdatedEventDataSchema,
  langyToolCallFailedEventDataSchema,
  langyToolCallInitiatedEventDataSchema,
  langyToolCallSucceededEventDataSchema,
} from "./events";
import { langyJsonValueSchema } from "./shared";
import type {
  LangyAgentResponseFailedEventData,
  LangyAgentRespondedEventData,
  LangyAgentTurnAcceptedEventData,
  LangyPlanItemData,
  LangyPlanUpdatedEventData,
  LangyToolCallFailedEventData,
  LangyToolCallInitiatedEventData,
  LangyToolCallSucceededEventData,
} from "./events";
import type {
  LangyJsonObject,
  LangyJsonValue,
  LangyMessagePart,
} from "./shared";

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
 * Wire/persistence schema for one folded tool call. Lives HERE — composed
 * inside the package's own zod instance — because zod v3's `z.record(key,
 * value)` overload detection instanceof-checks its second argument: composing
 * a package schema into a consumer-side `z.record` silently mis-parses when
 * two physical zod copies are in play. Consumers compose it only through
 * instanceof-safe combinators (`z.array`, `.parse`).
 */
export const langyTurnToolCallSchema = z
  .record(z.string(), langyJsonValueSchema)
  .and(
    z.object({
      toolCallId: z.string(),
      toolName: z.string(),
      command: z.string().optional(),
      input: langyJsonValueSchema.optional(),
      status: z.union([
        z.literal(LANGY_TURN_TOOL_CALL_STATUS.INITIATED),
        z.literal(LANGY_TURN_TOOL_CALL_STATUS.SUCCEEDED),
        z.literal(LANGY_TURN_TOOL_CALL_STATUS.FAILED),
      ]),
      durationMs: z.number().optional(),
      errorText: z.string().optional(),
    }),
  );

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

/**
 * The document's fold-owned fields, before the projection machinery stamps the
 * bookkeeping timestamps (server) or a snapshot supplies them (browser).
 */
export type LangyConversationTurnFoldState = Omit<
  LangyConversationTurnData,
  "CreatedAt" | "UpdatedAt" | "LastEventOccurredAt"
>;

export function initLangyConversationTurnState(): LangyConversationTurnFoldState {
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

/** The portable shape of one turn event: what the fold actually reads. */
interface TurnFoldEvent<Type extends string, Data> {
  type: Type;
  /** When the business action occurred (Unix ms). Orders the fold. */
  occurredAt: number;
  data: Data;
}

/**
 * The turn-scoped event vocabulary, discriminated on `type`. The server's full
 * event types (branded envelope) satisfy these members structurally; a
 * wire-parsed tail event satisfies them exactly.
 */
export type LangyConversationTurnEvent =
  | TurnFoldEvent<
      typeof LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_ACCEPTED,
      LangyAgentTurnAcceptedEventData
    >
  | TurnFoldEvent<
      typeof LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_INITIATED,
      LangyToolCallInitiatedEventData
    >
  | TurnFoldEvent<
      typeof LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_SUCCEEDED,
      LangyToolCallSucceededEventData
    >
  | TurnFoldEvent<
      typeof LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_FAILED,
      LangyToolCallFailedEventData
    >
  | TurnFoldEvent<
      typeof LANGY_CONVERSATION_EVENT_TYPES.PLAN_UPDATED,
      LangyPlanUpdatedEventData
    >
  | TurnFoldEvent<
      typeof LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONSE_FAILED,
      LangyAgentResponseFailedEventData
    >
  | TurnFoldEvent<
      typeof LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED,
      LangyAgentRespondedEventData
    >;

/** The `type` strings the turn fold consumes (routing/subscription filters). */
export const LANGY_CONVERSATION_TURN_EVENT_TYPES = [
  LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_ACCEPTED,
  LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_INITIATED,
  LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_SUCCEEDED,
  LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_FAILED,
  LANGY_CONVERSATION_EVENT_TYPES.PLAN_UPDATED,
  LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONSE_FAILED,
  LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED,
] as const;

/**
 * The WIRE envelope of one turn event, as the tail read serves it (ADR-059 §3):
 * the event's identity, its cursor coordinates (`createdAt` is the log-accept
 * time — the same clock as `LangyEventCursor.acceptedAt` — `id` the KSUID
 * tie-break), the fold clock (`occurredAt`), and the typed payload. No tenant,
 * aggregate, or server-only fields ever ride it.
 */
const turnWireEnvelope = {
  id: z.string(),
  createdAt: z.number().int().nonnegative(),
  occurredAt: z.number().int().nonnegative(),
} as const;

export const langyConversationTurnEventSchema = z.discriminatedUnion("type", [
  z.object({
    ...turnWireEnvelope,
    type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_ACCEPTED),
    data: langyAgentTurnAcceptedEventDataSchema,
  }),
  z.object({
    ...turnWireEnvelope,
    type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_INITIATED),
    data: langyToolCallInitiatedEventDataSchema,
  }),
  z.object({
    ...turnWireEnvelope,
    type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_SUCCEEDED),
    data: langyToolCallSucceededEventDataSchema,
  }),
  z.object({
    ...turnWireEnvelope,
    type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_FAILED),
    data: langyToolCallFailedEventDataSchema,
  }),
  z.object({
    ...turnWireEnvelope,
    type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.PLAN_UPDATED),
    data: langyPlanUpdatedEventDataSchema,
  }),
  z.object({
    ...turnWireEnvelope,
    type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONSE_FAILED),
    data: langyAgentResponseFailedEventDataSchema,
  }),
  z.object({
    ...turnWireEnvelope,
    type: z.literal(LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED),
    data: langyAgentRespondedEventDataSchema,
  }),
]);
export type LangyConversationTurnWireEvent = z.infer<
  typeof langyConversationTurnEventSchema
>;

/** Set identity from any turn event (the fold may hydrate mid-stream). */
function withIdentity<S extends LangyConversationTurnFoldState>(
  event: { data: { conversationId: string; turnId: string } },
  state: S,
): S {
  return {
    ...state,
    ConversationId: state.ConversationId || event.data.conversationId,
    TurnId: state.TurnId || event.data.turnId,
  };
}

/**
 * Resolve a tool call in place (by toolCallId), or append when it is missing —
 * a terminal that arrives before its `initiated` (out-of-order or dropped)
 * must still land. Callers re-fold in occurredAt order, so the common path
 * is initiate-then-resolve; this is the defensive branch.
 */
function upsertToolCall(
  state: LangyConversationTurnFoldState,
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

/**
 * Fold ONE turn event onto the turn document. Pure and total over the turn
 * vocabulary; unknown-to-this-fold events must be filtered before the call
 * (the server routes by handler name, the browser by
 * LANGY_CONVERSATION_TURN_EVENT_TYPES).
 */
export function foldLangyConversationTurn<
  S extends LangyConversationTurnFoldState,
>(state: S, event: LangyConversationTurnEvent): S {
  switch (event.type) {
    case LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_ACCEPTED: {
      const question = event.data.questionParts;
      return {
        ...withIdentity(event, state),
        Status: LANGY_CONVERSATION_TURN_STATUS.RUNNING,
        StartedAt: state.StartedAt ?? event.occurredAt,
        // The question rides the start event so the turn doc is self-contained.
        QuestionParts:
          question && question.length > 0 ? question : state.QuestionParts,
      };
    }
    case LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_INITIATED: {
      const { toolCallId, toolName, command, input } = event.data;
      const ToolCalls = upsertToolCall(
        state,
        toolCallId,
        () => ({
          toolCallId,
          toolName,
          status: LANGY_TURN_TOOL_CALL_STATUS.INITIATED,
        }),
        (existing) => ({
          ...existing,
          toolName: existing.toolName || toolName,
          // Only fill from the initiate frame; never regress a resolved status.
          status: existing.status ?? LANGY_TURN_TOOL_CALL_STATUS.INITIATED,
          ...(command !== undefined ? { command } : {}),
          ...(input !== undefined ? { input } : {}),
        }),
      );
      return { ...withIdentity(event, state), ToolCalls };
    }
    case LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_SUCCEEDED: {
      const { toolCallId, toolName, command, input, durationMs } = event.data;
      const ToolCalls = upsertToolCall(
        state,
        toolCallId,
        () => ({
          toolCallId,
          toolName,
          status: LANGY_TURN_TOOL_CALL_STATUS.SUCCEEDED,
        }),
        (existing) => ({
          ...existing,
          toolName: existing.toolName || toolName,
          status: LANGY_TURN_TOOL_CALL_STATUS.SUCCEEDED,
          ...(command !== undefined ? { command } : {}),
          ...(input !== undefined ? { input } : {}),
          ...(durationMs !== undefined ? { durationMs } : {}),
        }),
      );
      return { ...withIdentity(event, state), ToolCalls };
    }
    case LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_FAILED: {
      const { toolCallId, toolName, command, input, durationMs, errorText } =
        event.data;
      const ToolCalls = upsertToolCall(
        state,
        toolCallId,
        () => ({
          toolCallId,
          toolName,
          status: LANGY_TURN_TOOL_CALL_STATUS.FAILED,
        }),
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
      return { ...withIdentity(event, state), ToolCalls };
    }
    // Fold a plan snapshot onto the turn. Whole-list, last-write-wins: callers
    // re-fold events in occurredAt order, so the LATEST plan_updated is the
    // plan. Never regresses the turn's status — a plan can arrive at any point
    // in a running turn.
    case LANGY_CONVERSATION_EVENT_TYPES.PLAN_UPDATED: {
      return {
        ...withIdentity(event, state),
        Plan: event.data.items,
      };
    }
    case LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONSE_FAILED: {
      return {
        ...withIdentity(event, state),
        Status: LANGY_CONVERSATION_TURN_STATUS.FAILED,
        Error: event.data.error,
        EndedAt: event.occurredAt,
      };
    }
    case LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED: {
      // Three terminal outcomes on the one answer-carrying event: a user stop
      // keeps the partial answer (AnswerParts) but renders distinctly from a
      // clean finish, and is never an error (ADR-058). A `failed` outcome here
      // is the ran-but-failed answer; the no-answer stall is
      // agent_response_failed, handled above.
      const outcome = event.data.outcome;
      const status =
        outcome === "failed"
          ? LANGY_CONVERSATION_TURN_STATUS.FAILED
          : outcome === "stopped"
            ? LANGY_CONVERSATION_TURN_STATUS.STOPPED
            : LANGY_CONVERSATION_TURN_STATUS.COMPLETED;
      return {
        ...withIdentity(event, state),
        AnswerParts: event.data.parts ?? [],
        Status: status,
        Error:
          outcome === "failed"
            ? (event.data.error ?? "unknown error")
            : state.Error,
        EndedAt: event.occurredAt,
      };
    }
  }
}
