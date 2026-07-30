/**
 * The Langy turn fold — the WHOLE reduction of a turn's durable events into its
 * render document, as one pure module (ADR-059 §1, retired; ground now
 * ADR-098).
 *
 * `src/server/event-sourcing/langy-conversation-processing/` (ADR-098/105
 * greenfield rewrite) and the browser's local projection (`turnProjection.ts`)
 * both call `foldLangyConversationTurn`: same events, same reducer, so a turn
 * renders identically on both sides because it is literally the same
 * computation. Everything here is `(state, event) → state` — no store, no
 * versioning, no server types; those stay in the pipeline wrapper.
 *
 * The event parameter is the PORTABLE shape of a turn event — `type`,
 * `occurredAt`, `data` — which the server's full (branded-envelope) event types
 * satisfy structurally, and which a wire-parsed tail event satisfies exactly.
 *
 * Fixed here (not in the server pipeline — this module IS the shared browser
 * contract, so a fix here is a fix for both sides at once): the audited
 * order-invariance failures were all here. `makeConversationTurnKey` now
 * refuses an empty `conversationId`/`turnId` instead of keying every caller's
 * missing identity onto the one shared document `":"`.
 * `AGENT_TURN_ACCEPTED`/`AGENT_RESPONSE_FAILED`/`AGENT_RESPONDED` now share one
 * "first terminal wins" guard (`isTerminalTurnStatus`): `Status` used to reset
 * COMPLETED back to RUNNING on a stale accept, and a redelivered or stale
 * `agent_responded` — possibly carrying an EMPTY `parts`, since `event_log`
 * dedup happens at merge time, after dispatch, so both deliveries of a
 * "deduped" event reach the fold — could blank an already-settled answer.
 * `EndedAt` is now first-wins like `StartedAt`, not a bare assignment.
 */
import { z } from "zod";

import {
  LANGY_CONVERSATION_EVENT_TYPES,
  LANGY_CONVERSATION_TURN_STATUS,
  LANGY_TURN_TOOL_CALL_STATUS,
  type LangyConversationTurnStatus,
  type LangyTurnToolCallStatus,
} from "../../constants";
import type {
  LangyAgentResponseFailedEventData,
  LangyAgentRespondedEventData,
  LangyAgentTurnAcceptedEventData,
  LangyPlanItemData,
  LangyPlanUpdatedEventData,
  LangyToolCallFailedEventData,
  LangyToolCallInitiatedEventData,
  LangyToolCallSucceededEventData,
} from "../contracts/events";
import { langyJsonValueSchema } from "../../json";
import type {
  LangyJsonObject,
  LangyJsonValue,
  LangyMessagePart,
} from "../../json";

/**
 * Composite fold key: one turn document per `(conversationId, turnId)` within a
 * conversation's event stream. conversationId (ksuid) and turnId (uuid) never
 * contain ":", so a single ":" is an unambiguous delimiter (mirrors
 * experiment-run's makeExperimentRunKey).
 *
 * Refuses an empty identity rather than defaulting it. `makeConversationTurnKey("",
 * "")` used to silently key to `":"` — one shared document that every caller
 * with a missing id would collapse onto, across every conversation and every
 * tenant. A missing identity is a caller bug; keying it anyway hides the bug
 * and corrupts a document that has nothing to do with the caller's mistake.
 */
export function makeConversationTurnKey(
  conversationId: string,
  turnId: string,
): string {
  if (!conversationId || !turnId) {
    throw new Error(
      `makeConversationTurnKey requires a non-empty conversationId and turnId ` +
        `(got conversationId=${JSON.stringify(conversationId)}, turnId=${JSON.stringify(turnId)})`,
    );
  }
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
 * (`agent_turn_accepted`) — see the retired ADR-046 (ground now ADR-098).
 * Until then the
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
 * Terminal statuses, as a set rather than an ordering — ADR-098 decision 4's
 * "equal-rank terminal states" case: `completed`/`failed`/`stopped` do not
 * outrank one another, so this is a two-value lattice (terminal / not) rather
 * than a total order. A turn reaches exactly one terminal; which one is
 * decided by which arrives FIRST, not by which outranks the others.
 */
const TERMINAL_TURN_STATUSES = new Set<LangyConversationTurnStatus>([
  LANGY_CONVERSATION_TURN_STATUS.COMPLETED,
  LANGY_CONVERSATION_TURN_STATUS.FAILED,
  LANGY_CONVERSATION_TURN_STATUS.STOPPED,
]);

function isTerminalTurnStatus(status: LangyConversationTurnStatus): boolean {
  return TERMINAL_TURN_STATUSES.has(status);
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
      const withId = withIdentity(event, state);
      // A turn reaches exactly one terminal (see TERMINAL_TURN_STATUSES). A
      // stale or duplicate accept arriving after the turn already finished
      // must never resurrect it as RUNNING — that was the fold's Status
      // moving BACKWARDS from a terminal to a running state, one of the
      // audited order-invariance failures. Identity still hydrates either
      // way, matching every other handler's mid-stream-hydrate behaviour.
      if (isTerminalTurnStatus(state.Status)) return withId;
      const question = event.data.questionParts;
      return {
        ...withId,
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
      const withId = withIdentity(event, state);
      // First terminal wins (see TERMINAL_TURN_STATUSES): once the turn has
      // already reached completed/failed/stopped, a second terminal —
      // whether a genuine race between this and agent_responded, or a
      // straggling redelivery — is a duplicate, not a correction. Applying
      // it anyway is how a completed answer got silently overwritten by a
      // stale failure.
      if (isTerminalTurnStatus(state.Status)) return withId;
      return {
        ...withId,
        Status: LANGY_CONVERSATION_TURN_STATUS.FAILED,
        Error: event.data.error,
        // First-wins, matching StartedAt's policy — not bare-set. Once the
        // guard above lets exactly one terminal event through per turn this
        // makes no observable difference, but the two timestamps that bound
        // a turn's lifetime now carry the SAME ordering policy rather than
        // one being the accident of "whichever terminal survives the guard"
        // and the other an explicit `??`.
        EndedAt: state.EndedAt ?? event.occurredAt,
      };
    }
    case LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED: {
      const withId = withIdentity(event, state);
      // First terminal wins — see AGENT_RESPONSE_FAILED above. This is the
      // guard that stops a redelivered or stale agent_responded (possibly
      // carrying an EMPTY `parts`, since event_log dedup happens at merge
      // time, after dispatch — both deliveries of a "deduped" event reach
      // the fold) from blanking a customer's already-recorded reply. Once a
      // turn is terminal its AnswerParts are the source of truth; nothing
      // after that first terminal may touch them again.
      if (isTerminalTurnStatus(state.Status)) return withId;
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
        ...withId,
        AnswerParts: event.data.parts ?? [],
        Status: status,
        Error:
          outcome === "failed"
            ? (event.data.error ?? "unknown error")
            : state.Error,
        EndedAt: state.EndedAt ?? event.occurredAt,
      };
    }
  }
}
