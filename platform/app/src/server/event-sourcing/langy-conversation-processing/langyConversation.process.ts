import { LANGY_TITLE_SOURCE } from "@langwatch/langy";
import { z } from "zod";

/**
 * The `langyConversation` process manager (ADR-098). LIVENESS IS OUT OF THIS
 * PILOT: the pure process has no way to observe the ephemeral Redis
 * heartbeat, so any wake-driven redispatch or fail-turn decision would
 * re-drive (or kill) healthy long-running turns that stream without durable
 * milestones. It schedules no wake-ups and emits no fail intents; the
 * heartbeat-aware liveness subscriber remains the sole liveness owner.
 */
export const LANGY_CONVERSATION_PROCESS_NAME = "langyConversation";

export const langyConversationProcessStateSchema = z.object({
  currentTurnId: z.string().nullable(),
  turnStatus: z.enum(["idle", "running", "completed", "failed"]),
  titleSource: z.enum(["derived", "auto", "user"]),
  /** One-shot latch: the automatic title may only fire once, at the first
   *  successful `agentResponded` while the title is still derived. */
  autoTitleRequested: z.boolean(),
  archived: z.boolean(),
  /** Identity only, never the token — the token lives in the Redis handoff
   *  store and never enters process state (ADR-098). */
  pendingHandoffTurnId: z.string().nullable(),
});

export type LangyConversationProcessState = z.infer<
  typeof langyConversationProcessStateSchema
>;

export function initLangyConversationProcessState(): LangyConversationProcessState {
  return {
    currentTurnId: null,
    turnStatus: "idle",
    titleSource: LANGY_TITLE_SOURCE.DERIVED,
    autoTitleRequested: false,
    archived: false,
    pendingHandoffTurnId: null,
  };
}

export const langyWorkerDispatchIntentSchema = z.object({
  conversationId: z.string(),
  turnId: z.string(),
  resumeFromTurnId: z.string().nullable(),
});

export const langyGenerateTitleIntentSchema = z.object({
  conversationId: z.string(),
  turnId: z.string(),
});

function shouldGenerateTitle(state: LangyConversationProcessState): boolean {
  return (
    state.titleSource === LANGY_TITLE_SOURCE.DERIVED &&
    !state.autoTitleRequested
  );
}

export function handleAgentTurnAccepted(
  state: LangyConversationProcessState,
  data: { turnId: string },
  ctx: { processKey: string },
) {
  if (state.archived) return { state, intents: [], nextWakeAt: null };
  // Postgres admission is authoritative; this is the final defence against
  // an older/misbehaving caller that bypassed it.
  if (state.turnStatus === "running" && state.currentTurnId !== data.turnId) {
    return { state, intents: [], nextWakeAt: null };
  }
  return {
    state: {
      ...state,
      currentTurnId: data.turnId,
      turnStatus: "running" as const,
    },
    intents: [
      {
        type: "workerDispatch" as const,
        payload: {
          conversationId: ctx.processKey,
          turnId: data.turnId,
          resumeFromTurnId: state.pendingHandoffTurnId,
        },
      },
    ],
    nextWakeAt: null,
  };
}

export function handleAgentResponded(
  state: LangyConversationProcessState,
  data: { turnId: string; outcome: "completed" | "failed" | "stopped" },
  ctx: { processKey: string },
) {
  if (data.turnId !== state.currentTurnId) {
    return { state, intents: [], nextWakeAt: null };
  }
  const succeeded = data.outcome !== "failed";
  const generateTitle =
    succeeded && !state.archived && shouldGenerateTitle(state);
  return {
    state: {
      ...state,
      currentTurnId: null,
      turnStatus: succeeded ? ("completed" as const) : ("failed" as const),
      autoTitleRequested: state.autoTitleRequested || generateTitle,
    },
    intents: generateTitle
      ? [
          {
            type: "generateTitle" as const,
            payload: { conversationId: ctx.processKey, turnId: data.turnId },
          },
        ]
      : [],
    nextWakeAt: null,
  };
}

export function handleAgentResponseFailed(
  state: LangyConversationProcessState,
  data: { turnId: string },
) {
  if (data.turnId !== state.currentTurnId) {
    return { state, intents: [], nextWakeAt: null };
  }
  return {
    state: { ...state, currentTurnId: null, turnStatus: "failed" as const },
    intents: [],
    nextWakeAt: null,
  };
}

export function handleArchived(state: LangyConversationProcessState) {
  return {
    state: {
      ...state,
      archived: true,
      currentTurnId: null,
      turnStatus: "idle" as const,
    },
    intents: [],
    nextWakeAt: null,
  };
}

export function handleMetadataUpdated(
  state: LangyConversationProcessState,
  data: { title?: string | null },
) {
  // A manual rename is sticky and permanently suppresses auto titles. `null` is
  // "not titled yet", not a rename, so it must not latch.
  if (typeof data.title !== "string") {
    return { state, intents: [], nextWakeAt: null };
  }
  return {
    state: { ...state, titleSource: LANGY_TITLE_SOURCE.USER },
    intents: [],
    nextWakeAt: null,
  };
}

export function handleTitleGenerated(state: LangyConversationProcessState) {
  if (state.titleSource === LANGY_TITLE_SOURCE.USER) {
    return { state, intents: [], nextWakeAt: null };
  }
  return {
    state: { ...state, titleSource: LANGY_TITLE_SOURCE.AUTO },
    intents: [],
    nextWakeAt: null,
  };
}

export function handleHandoffPending(
  state: LangyConversationProcessState,
  data: { turnId: string },
) {
  // The turn handed off — it did not fail. Back to idle, keep the turn id so
  // the next dispatch can thread the resume.
  return {
    state: {
      ...state,
      currentTurnId: null,
      turnStatus: "idle" as const,
      pendingHandoffTurnId: data.turnId,
    },
    intents: [],
    nextWakeAt: null,
  };
}

export function handleHandoffConsumed(state: LangyConversationProcessState) {
  return {
    state: { ...state, pendingHandoffTurnId: null },
    intents: [],
    nextWakeAt: null,
  };
}
