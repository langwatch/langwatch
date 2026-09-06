/**
 * The Langy turn fold — the WHOLE reduction of a turn's events into its
 * render document, one pure module (ADR-059 §1). Server and browser both
 * call `foldLangyConversationTurn`: same reducer, identical render.
 */
import { z } from "zod";

import {
  LANGY_CONVERSATION_EVENT_TYPES,
  LANGY_CONVERSATION_TURN_STATUS,
  LANGY_PERMISSION_DECISIONS,
  LANGY_TURN_TOOL_CALL_STATUS,
  LANGY_USER_WAIT_KINDS,
  LANGY_USER_WAIT_OUTCOMES,
  type LangyConversationTurnStatus,
  type LangyPermissionDecision,
  type LangyTurnToolCallStatus,
  type LangyUserWaitKind,
  type LangyUserWaitOutcome,
} from "../../constants";
import type {
  LangyAgentResponseFailedEventData,
  LangyAgentRespondedEventData,
  LangyAgentTurnAcceptedEventData,
  LangyPermissionAnswerSource,
  LangyPlanItemData,
  LangyPlanUpdatedEventData,
  LangyToolCallFailedEventData,
  LangyToolCallInitiatedEventData,
  LangyToolCallSucceededEventData,
  LangyUserWaitEndedEventData,
  LangyUserWaitStartedEventData,
} from "../contracts/langy.events";
import { langyJsonValueSchema } from "../../json";
import type { LangyJsonObject, LangyJsonValue, LangyMessagePart } from "../../json";

/**
 * Composite fold key: one turn document per `(conversationId, turnId)`.
 * Neither id contains ":", so a single ":" is an unambiguous delimiter.
 */
export function makeConversationTurnKey(conversationId: string, turnId: string): string {
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
 * One tool call, folded from `tool_call_initiated`/`_succeeded`/`_failed`.
 * Tool OUTPUT is not here — it rides `agent_responded`'s parts; this is the
 * lifecycle audit (what ran, how, how long).
 */
export type LangyTurnToolCall = LangyJsonObject & {
  toolCallId: string;
  toolName: string;
  command?: string;
  input?: LangyJsonValue;
  status: LangyTurnToolCallStatus;
  durationMs?: number;
  errorText?: string;
  /** The card this call put in front of the developer, when it asked for one. */
  wait?: LangyTurnWait;
};

/** The card one tool call put in front of the developer: a permission ask or a question, ridden on the call it belongs to. */
/** One card the developer's machine put up, as the durable record holds it. */
export type LangyLocalRecordWait = LangyTurnWait & {
  /** The turn that raised it, so the panel keeps them in turn order. */
  turnId: string;
  /** The tool call it rides on. */
  toolCallId: string;
};

/** Every card of one conversation, and whether the folder is connected now. */
export type LangyLocalRecord = {
  waits: LangyLocalRecordWait[];
  /** Whether the last thing the folder did was connect. */
  workspaceConnected: boolean;
};

export type LangyTurnWait = {
  waitId: string;
  kind: LangyUserWaitKind;
  status: "pending" | LangyUserWaitOutcome;
  expiresAt: number;
  /** The local control call this permission card belongs to. */
  callId: string | null;
  summary: string | null;
  pattern: string | null;
  /** Every pattern one session grant covers, first one first. */
  patterns: string[];
  reason: string | null;
  /** The seconds after which the command is stopped, or null when it has no limit. */
  timeoutSeconds: number | null;
  skipOffered: boolean;
  workspaceName: string | null;
  hostname: string | null;
  questions: LangyJsonValue;
  decision: LangyPermissionDecision | null;
  /** Where a permission answer was given: the card, or the terminal. */
  source: LangyPermissionAnswerSource | null;
  answers: LangyJsonValue;
  answeredBy: string | null;
  answeredAt: number | null;
};

/** Wire/persistence schema for one card, in this package's own zod instance. */
export const langyTurnWaitSchema = z.object({
  waitId: z.string(),
  kind: z.union([
    z.literal(LANGY_USER_WAIT_KINDS.PERMISSION),
    z.literal(LANGY_USER_WAIT_KINDS.QUESTION),
  ]),
  status: z.union([
    z.literal("pending"),
    z.literal(LANGY_USER_WAIT_OUTCOMES.ANSWERED),
    z.literal(LANGY_USER_WAIT_OUTCOMES.EXPIRED),
    z.literal(LANGY_USER_WAIT_OUTCOMES.CANCELLED),
  ]),
  expiresAt: z.number(),
  callId: z.string().nullable(),
  summary: z.string().nullable(),
  pattern: z.string().nullable(),
  // Records written before the card named every pattern carry none, and they
  // read back as a card whose one pattern is the whole answer.
  patterns: z.array(z.string()).default([]),
  reason: z.string().nullable(),
  timeoutSeconds: z.number().nullable().default(null),
  skipOffered: z.boolean(),
  workspaceName: z.string().nullable(),
  hostname: z.string().nullable(),
  questions: langyJsonValueSchema,
  decision: z
    .union([
      z.literal(LANGY_PERMISSION_DECISIONS.ALLOW_ONCE),
      z.literal(LANGY_PERMISSION_DECISIONS.ALLOW_PATTERN),
      z.literal(LANGY_PERMISSION_DECISIONS.DENY),
    ])
    .nullable(),
  // Records written before the terminal could answer carry none, and they read
  // back as answered on the card, which is where they were answered.
  source: z
    .union([z.literal("panel"), z.literal("terminal")])
    .nullable()
    .default(null),
  answers: langyJsonValueSchema,
  answeredBy: z.string().nullable(),
  answeredAt: z.number().nullable(),
});

/**
 * Wire/persistence schema for one folded tool call. Lives HERE, in the
 * package's own zod instance: zod v3's `z.record` overload detection
 * instanceof-checks its argument and mis-parses across two zod copies.
 */
export const langyTurnToolCallSchema = z.record(z.string(), langyJsonValueSchema).and(
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
    wait: langyTurnWaitSchema.optional(),
  }),
);

/** A wait with no answer yet, from what the start event carried. */
function pendingWait(data: LangyUserWaitStartedEventData): LangyTurnWait {
  const permission = data.permission ?? null;
  return {
    waitId: data.waitId,
    kind: data.kind,
    status: "pending",
    expiresAt: data.expiresAt,
    callId: permission?.callId ?? null,
    summary: permission?.summary ?? null,
    pattern: permission?.pattern ?? null,
    patterns: permission?.patterns ?? [],
    reason: permission?.reason ?? null,
    timeoutSeconds: permission?.timeoutSeconds ?? null,
    skipOffered: permission?.skipOffered ?? false,
    workspaceName: permission?.workspaceName ?? null,
    hostname: permission?.hostname ?? null,
    questions: (data.questions ?? null) as LangyJsonValue,
    decision: null,
    source: null,
    answers: null,
    answeredBy: null,
    answeredAt: null,
  };
}

/** The wait fields one terminal writes, whichever terminal it is. */
function endedWait(
  wait: LangyTurnWait,
  data: LangyUserWaitEndedEventData,
  occurredAt: number,
): LangyTurnWait {
  return {
    ...wait,
    status: data.outcome,
    decision: data.decision ?? null,
    source: data.source ?? null,
    answers: (data.answers ?? null) as LangyJsonValue,
    answeredBy: data.userId ?? null,
    answeredAt: occurredAt,
  };
}

/**
 * The turn render document. A SECOND fold over langy_conversation (first is
 * the spine), keyed per turn. `QuestionParts` is reserved for ADR-046 S2.
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
  /** The `todowrite` plan snapshot, last-write-wins. Null when the turn never maintained one. */
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
  | TurnFoldEvent<typeof LANGY_CONVERSATION_EVENT_TYPES.PLAN_UPDATED, LangyPlanUpdatedEventData>
  | TurnFoldEvent<
      typeof LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONSE_FAILED,
      LangyAgentResponseFailedEventData
    >
  | TurnFoldEvent<
      typeof LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED,
      LangyAgentRespondedEventData
    >
  | TurnFoldEvent<
      typeof LANGY_CONVERSATION_EVENT_TYPES.USER_WAIT_STARTED,
      LangyUserWaitStartedEventData
    >
  | TurnFoldEvent<
      typeof LANGY_CONVERSATION_EVENT_TYPES.USER_WAIT_ENDED,
      LangyUserWaitEndedEventData
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
 * Resolve a tool call in place, or append when missing — a terminal arriving
 * before its `initiated` must still land (defensive; common path re-folds).
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

/** The tool a wait of this kind belongs to, when its call id never arrived. */
function waitToolName(kind: LangyUserWaitKind): string {
  return kind === LANGY_USER_WAIT_KINDS.PERMISSION ? "local_bash" : "question";
}

/**
 * Fold ONE turn event onto the turn document. Pure and total over the turn
 * vocabulary; unknown events must be filtered before the call.
 */
export function foldLangyConversationTurn<S extends LangyConversationTurnFoldState>(
  state: S,
  event: LangyConversationTurnEvent,
): S {
  switch (event.type) {
    case LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_ACCEPTED: {
      const question = event.data.questionParts;
      return {
        ...withIdentity(event, state),
        Status: LANGY_CONVERSATION_TURN_STATUS.RUNNING,
        StartedAt: state.StartedAt ?? event.occurredAt,
        // The question rides the start event so the turn doc is self-contained.
        QuestionParts: question && question.length > 0 ? question : state.QuestionParts,
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
      const { toolCallId, toolName, command, input, durationMs, errorText } = event.data;
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
    // A card went up in front of the developer, on the tool call that asked
    // for it. Idempotent: a redelivered start keeps the outcome an end wrote.
    case LANGY_CONVERSATION_EVENT_TYPES.USER_WAIT_STARTED: {
      const started = pendingWait(event.data);
      const key = event.data.toolCallId ?? started.waitId;
      const ToolCalls = upsertToolCall(
        state,
        key,
        () => ({
          toolCallId: key,
          toolName: waitToolName(started.kind),
          status: LANGY_TURN_TOOL_CALL_STATUS.INITIATED,
          wait: started,
        }),
        (existing) => {
          const current = existing.wait;
          const settled = current?.waitId === started.waitId && current.status !== "pending";
          return { ...existing, wait: settled ? current : started };
        },
      );
      return { ...withIdentity(event, state), ToolCalls };
    }
    // The card reached its one terminal. A second end never overwrites the
    // first, so a late answer to an expired card leaves the record alone.
    case LANGY_CONVERSATION_EVENT_TYPES.USER_WAIT_ENDED: {
      const data = event.data;
      const key = data.toolCallId ?? data.waitId;
      const blank = pendingWait({
        conversationId: data.conversationId,
        turnId: data.turnId,
        waitId: data.waitId,
        kind: data.kind,
        expiresAt: 0,
      });
      const ToolCalls = upsertToolCall(
        state,
        key,
        () => ({
          toolCallId: key,
          toolName: waitToolName(data.kind),
          status: LANGY_TURN_TOOL_CALL_STATUS.INITIATED,
          wait: endedWait(blank, data, event.occurredAt),
        }),
        (existing) => {
          const current = existing.wait;
          if (!current || current.waitId !== data.waitId) return existing;
          if (current.status !== "pending") return existing;
          return {
            ...existing,
            wait: endedWait(current, data, event.occurredAt),
          };
        },
      );
      return { ...withIdentity(event, state), ToolCalls };
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
      // clean finish, and is never an error (ADR-078). A `failed` outcome here
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
        Error: outcome === "failed" ? (event.data.error ?? "unknown error") : state.Error,
        EndedAt: event.occurredAt,
      };
    }
  }
}
