import type { EventHandler, IntentExecutor, ProcessManagerApplier } from "@langwatch/eventing";
import { LANGY_CONVERSATION_EVENT_TYPES, LANGY_TITLE_SOURCE } from "@langwatch/langy-contract";
import type { LangyConversationProcessingEvent } from "../adapters/eventing.langy-conversation-events.adapter";
import {
  LANGY_PROCESS_INTENT_TYPES,
  type LangyConversationProcessState,
  type LangyGenerateTitleIntent,
  type LangyProcessEventView,
  type LangyWorkerDispatchIntent,
  langyGenerateTitleIntentSchema,
  langyProcessEventViewSchema,
  langyWorkerDispatchIntentSchema,
} from "../ports/langy-conversation-process.port";
import { LANGY_OUTBOX_LEASE_DURATION_MS, type LangyEffectPorts } from "../ports/langy-effect.port";
import {
  createLangyGenerateTitleIntent,
  createLangyWorkerDispatchIntent,
} from "../intents/langy-conversation.intent";

/**
 * The content boundary (`toPayload`): narrows a committed Langy pipeline event to identities and
 * flags only.
 */
export function buildLangyProcessEventView(
  event: LangyConversationProcessingEvent,
): LangyProcessEventView {
  return {
    turnId: "turnId" in event.data ? (event.data.turnId ?? null) : null,
    outcome:
      event.type === LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED ? event.data.outcome : null,
    titleTouched:
      event.type === LANGY_CONVERSATION_EVENT_TYPES.METADATA_UPDATED &&
      typeof event.data.title === "string",
  };
}

export const INITIAL_LANGY_PROCESS_STATE: LangyConversationProcessState = {
  currentTurnId: null,
  turnStatus: "idle",
  titleSource: LANGY_TITLE_SOURCE.DERIVED,
  autoTitleRequested: false,
  archived: false,
  pendingHandoffTurnId: null,
};

type LangyIntents = {
  [LANGY_PROCESS_INTENT_TYPES.WORKER_DISPATCH]: {
    schema: typeof langyWorkerDispatchIntentSchema;
    run: IntentExecutor<LangyWorkerDispatchIntent>;
  };
  [LANGY_PROCESS_INTENT_TYPES.GENERATE_TITLE]: {
    schema: typeof langyGenerateTitleIntentSchema;
    run: IntentExecutor<LangyGenerateTitleIntent>;
  };
};

/**
 * Handlers receive the envelope payload built by {@link buildLangyProcessEventView}, not the raw
 * event, so they are typed `unknown` and parse the view — the same shape topic-clustering uses for
 * a process with a content boundary.
 */
type LangyHandler = EventHandler<LangyConversationProcessState, unknown, LangyIntents>;

/**
 * Automatic titling is a one-shot logical transition: the first SUCCESSFUL agent_responded while
 * the title is still the derived placeholder. Once requested, or once titleSource becomes auto or
 * user, no counter or timer may ever retitle.
 */
function shouldGenerateTitle(state: LangyConversationProcessState): boolean {
  return state.titleSource === LANGY_TITLE_SOURCE.DERIVED && !state.autoTitleRequested;
}

export const handleAgentTurnAccepted: LangyHandler = (state, payload, ctx) => {
  const view = langyProcessEventViewSchema.parse(payload);
  if (state.archived || view.turnId === null) return { state };
  // Postgres admission is authoritative. This guard is the final defence
  // for an older/misbehaving caller that bypassed it: never replace the
  // running turn or emit a second dispatch for the same conversation.
  if (state.turnStatus === "running" && state.currentTurnId !== view.turnId) {
    return { state };
  }
  return {
    state: { ...state, currentTurnId: view.turnId, turnStatus: "running" },
    intents: [
      ctx.intents[LANGY_PROCESS_INTENT_TYPES.WORKER_DISPATCH](`dispatch:${view.turnId}`, {
        conversationId: ctx.key,
        turnId: view.turnId,
        resumeFromTurnId: state.pendingHandoffTurnId,
      }),
    ],
  };
};

export const handleAgentResponded: LangyHandler = (state, payload, ctx) => {
  const view = langyProcessEventViewSchema.parse(payload);
  if (view.turnId === null || view.turnId !== state.currentTurnId) {
    return { state };
  }
  const succeeded = view.outcome !== "failed";
  const generateTitle = succeeded && !state.archived && shouldGenerateTitle(state);
  return {
    state: {
      ...state,
      currentTurnId: null,
      turnStatus: succeeded ? "completed" : "failed",
      autoTitleRequested: state.autoTitleRequested || generateTitle,
    },
    intents: generateTitle
      ? [
          ctx.intents[LANGY_PROCESS_INTENT_TYPES.GENERATE_TITLE](`title:${view.turnId}`, {
            conversationId: ctx.key,
            turnId: view.turnId,
          }),
        ]
      : undefined,
  };
};

export const handleAgentResponseFailed: LangyHandler = (state, payload) => {
  const view = langyProcessEventViewSchema.parse(payload);
  if (view.turnId === null || view.turnId !== state.currentTurnId) {
    return { state };
  }
  return { state: { ...state, currentTurnId: null, turnStatus: "failed" } };
};

export const handleArchived: LangyHandler = (state) => ({
  state: { ...state, archived: true, currentTurnId: null, turnStatus: "idle" },
});

export const handleMetadataUpdated: LangyHandler = (state, payload) => {
  const view = langyProcessEventViewSchema.parse(payload);
  // A manual rename is sticky and permanently suppresses auto titles.
  if (!view.titleTouched) return { state };
  return { state: { ...state, titleSource: LANGY_TITLE_SOURCE.USER } };
};

export const handleTitleGenerated: LangyHandler = (state) => {
  if (state.titleSource === LANGY_TITLE_SOURCE.USER) return { state };
  return { state: { ...state, titleSource: LANGY_TITLE_SOURCE.AUTO } };
};

export const handleHandoffPending: LangyHandler = (state, payload) => {
  const view = langyProcessEventViewSchema.parse(payload);
  // The turn handed off — it did not fail (ADR-048). Back to idle, keep
  // the turn id (identity only, never the token) so the next dispatch
  // can thread the resume.
  return {
    state: {
      ...state,
      currentTurnId: null,
      turnStatus: "idle",
      pendingHandoffTurnId: view.turnId,
    },
  };
};

export const handleHandoffConsumed: LangyHandler = (state) => ({
  state: { ...state, pendingHandoffTurnId: null },
});

/**
 * Conversation-level or turn-progress activity with no process decision to make. Declared rather
 * than omitted.
 */
export const handleNoDecision: LangyHandler = (state) => ({ state });

/**
 * Only the effect ports are injected; the topology — state, intents, the content boundary,
 * The Langy conversation process, as a pipeline declaration (ADR-049 §4,
 * ADR-052).
 */
export function langyConversationProcess(
  ports: LangyEffectPorts,
): ProcessManagerApplier<LangyConversationProcessingEvent> {
  return (pm) =>
    pm
      .state<LangyConversationProcessState>(INITIAL_LANGY_PROCESS_STATE)
      .intent(
        LANGY_PROCESS_INTENT_TYPES.WORKER_DISPATCH,
        langyWorkerDispatchIntentSchema,
        createLangyWorkerDispatchIntent(ports),
      )
      .intent(
        LANGY_PROCESS_INTENT_TYPES.GENERATE_TITLE,
        langyGenerateTitleIntentSchema,
        createLangyGenerateTitleIntent(ports),
      )
      .toPayload(buildLangyProcessEventView)
      .on(LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_ACCEPTED, handleAgentTurnAccepted)
      .on(LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED, handleAgentResponded)
      .on(LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONSE_FAILED, handleAgentResponseFailed)
      .on(LANGY_CONVERSATION_EVENT_TYPES.ARCHIVED, handleArchived)
      .on(LANGY_CONVERSATION_EVENT_TYPES.METADATA_UPDATED, handleMetadataUpdated)
      .on(LANGY_CONVERSATION_EVENT_TYPES.TITLE_GENERATED, handleTitleGenerated)
      .on(LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_HANDOFF_PENDING, handleHandoffPending)
      .on(LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_HANDOFF_CONSUMED, handleHandoffConsumed)
      .on(LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_STARTED, handleNoDecision)
      .on(LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_FORKED, handleNoDecision)
      .on(LANGY_CONVERSATION_EVENT_TYPES.MESSAGE_RECORDED, handleNoDecision)
      .on(LANGY_CONVERSATION_EVENT_TYPES.MESSAGE_IMPORTED, handleNoDecision)
      .on(LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_INITIATED, handleNoDecision)
      .on(LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_SUCCEEDED, handleNoDecision)
      .on(LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_FAILED, handleNoDecision)
      .on(LANGY_CONVERSATION_EVENT_TYPES.PLAN_UPDATED, handleNoDecision)
      // The lease MUST outlive the slowest accepted dispatch, or a healthy
      // long-running turn loses its lease mid-flight and a second instance
      // re-delivers it concurrently (the completing handler is then fenced out
      // and the message never retires). The generic 30s default is unsafe
      // against the dispatch budget. Previously set in the registry.
      .outbox({ leaseDurationMs: LANGY_OUTBOX_LEASE_DURATION_MS });
}
