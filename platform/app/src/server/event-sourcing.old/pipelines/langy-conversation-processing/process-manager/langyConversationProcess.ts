import {
  LANGY_CONVERSATION_EVENT_TYPES,
  LANGY_TITLE_SOURCE,
} from "@langwatch/langy";
import type { ProcessManagerApplier } from "~/server/event-sourcing.old/pipeline/processBuilder";
import type {
  EventHandler,
  IntentExecutor,
} from "~/server/event-sourcing.old/pipeline/processManagerDefinition";
import type { LangyConversationProcessingEvent } from "~/server/event-sourcing.old/pipelines/langy-conversation-processing/schemas/events";

import {
  LANGY_PROCESS_INTENT_TYPES,
  type LangyConversationProcessState,
  type LangyGenerateTitleIntent,
  type LangyProcessEventView,
  type LangyWorkerDispatchIntent,
  langyGenerateTitleIntentSchema,
  langyProcessEventViewSchema,
  langyWorkerDispatchIntentSchema,
} from "./langyConversationProcess.types";
import {
  LANGY_OUTBOX_LEASE_DURATION_MS,
  type LangyEffectPorts,
} from "./langyEffectPorts";

/**
 * The content boundary (`toPayload`): narrows a committed Langy pipeline event
 * to identities and flags only.
 *
 * Everything else is dropped here, before the runtime builds the envelope —
 * message parts, question/answer text, tool commands and inputs, plan items,
 * error text, titles, run tokens, handoff tokens. The process manager persists
 * its payload verbatim into process state and outbox rows, so anything this
 * function keeps becomes durable. It keeps nothing that is customer content.
 */
export function buildLangyProcessEventView(
  event: LangyConversationProcessingEvent,
): LangyProcessEventView {
  return {
    turnId: "turnId" in event.data ? (event.data.turnId ?? null) : null,
    outcome:
      event.type === LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED
        ? event.data.outcome
        : null,
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

export type LangyIntents = {
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
 * Handlers receive the envelope payload built by {@link
 * buildLangyProcessEventView}, not the raw event, so they are typed `unknown`
 * and parse the view — the same shape topic-clustering uses for a process with
 * a content boundary.
 */
type LangyHandler = EventHandler<
  LangyConversationProcessState,
  unknown,
  LangyIntents
>;

/**
 * Automatic titling is a one-shot logical transition: the first SUCCESSFUL
 * agent_responded while the title is still the derived placeholder. Once
 * requested, or once titleSource becomes auto or user, no counter or timer
 * may ever retitle.
 */
function shouldGenerateTitle(state: LangyConversationProcessState): boolean {
  return (
    state.titleSource === LANGY_TITLE_SOURCE.DERIVED &&
    !state.autoTitleRequested
  );
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
      ctx.intents[LANGY_PROCESS_INTENT_TYPES.WORKER_DISPATCH](
        `dispatch:${view.turnId}`,
        {
          conversationId: ctx.key,
          turnId: view.turnId,
          resumeFromTurnId: state.pendingHandoffTurnId,
        },
      ),
    ],
  };
};

export const handleAgentResponded: LangyHandler = (state, payload, ctx) => {
  const view = langyProcessEventViewSchema.parse(payload);
  if (view.turnId === null || view.turnId !== state.currentTurnId) {
    return { state };
  }
  const succeeded = view.outcome !== "failed";
  const generateTitle =
    succeeded && !state.archived && shouldGenerateTitle(state);
  return {
    state: {
      ...state,
      currentTurnId: null,
      turnStatus: succeeded ? "completed" : "failed",
      autoTitleRequested: state.autoTitleRequested || generateTitle,
    },
    intents: generateTitle
      ? [
          ctx.intents[LANGY_PROCESS_INTENT_TYPES.GENERATE_TITLE](
            `title:${view.turnId}`,
            { conversationId: ctx.key, turnId: view.turnId },
          ),
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
  // The turn handed off — it did not fail (ADR-098). Back to idle, keep
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
 * The `langyConversation` process-manager topology, exported standalone so the
 * pipeline mounts one expression of it and tests can build the exact definition
 * the runtime runs. `langy-conversation-processing/pipeline.ts` mounts it as
 * `.withProcessManager(LANGY_CONVERSATION_PROCESS_NAME,
 * langyConversationPM(effects))` (ADR-098: the whole topology — state, intents,
 * the content boundary, every event decision and the outbox lease).
 */
export function langyConversationPM(
  effects: LangyEffectPorts,
): ProcessManagerApplier<LangyConversationProcessingEvent> {
  return (pm) =>
    pm
      .state<LangyConversationProcessState>(INITIAL_LANGY_PROCESS_STATE)
      .intent(
        LANGY_PROCESS_INTENT_TYPES.WORKER_DISPATCH,
        langyWorkerDispatchIntentSchema,
        (intent, { projectId }) =>
          effects.workerDispatch.dispatchTurn({ ...intent, projectId }),
      )
      .intent(
        LANGY_PROCESS_INTENT_TYPES.GENERATE_TITLE,
        langyGenerateTitleIntentSchema,
        (intent, { projectId }) =>
          effects.titleGeneration.generateTitle({ ...intent, projectId }),
      )
      .toPayload(buildLangyProcessEventView)
      .on(
        LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_ACCEPTED,
        handleAgentTurnAccepted,
      )
      .on(LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED, handleAgentResponded)
      .on(
        LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONSE_FAILED,
        handleAgentResponseFailed,
      )
      .on(LANGY_CONVERSATION_EVENT_TYPES.ARCHIVED, handleArchived)
      .on(
        LANGY_CONVERSATION_EVENT_TYPES.METADATA_UPDATED,
        handleMetadataUpdated,
      )
      .on(LANGY_CONVERSATION_EVENT_TYPES.TITLE_GENERATED, handleTitleGenerated)
      .on(
        LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_HANDOFF_PENDING,
        handleHandoffPending,
      )
      .on(
        LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_HANDOFF_CONSUMED,
        handleHandoffConsumed,
      )
      // Conversation-level and turn-progress activity with no process
      // decision to make. Tool and plan events land here — they only ever
      // mattered to the liveness window, which the heartbeat-aware
      // subscriber owns.
      .ignores(
        LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_STARTED,
        LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_FORKED,
        LANGY_CONVERSATION_EVENT_TYPES.MESSAGE_RECORDED,
        LANGY_CONVERSATION_EVENT_TYPES.MESSAGE_IMPORTED,
        LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_INITIATED,
        LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_SUCCEEDED,
        LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_FAILED,
        LANGY_CONVERSATION_EVENT_TYPES.PLAN_UPDATED,
      )
      // The lease MUST outlive the slowest accepted dispatch, or a healthy
      // long-running turn loses its lease mid-flight and a second instance
      // re-delivers it concurrently (the completing handler is then fenced
      // out and the message never retires). The generic 30s default is
      // unsafe against the dispatch budget.
      .outbox({ leaseDurationMs: LANGY_OUTBOX_LEASE_DURATION_MS });
}
