import { z } from "zod";

import type { LangyTitleSource } from "~/server/event-sourcing/pipelines/langy-conversation-processing/schemas/constants";

/**
 * Langy conversation process manager (ADR-049 §4) — typed contracts for the
 * pilot adapter over the generic event-sourcing/process-manager core.
 *
 * The process is keyed by (LANGY_CONVERSATION_PROCESS_NAME, projectId,
 * conversationId). Its state holds only identities, statuses, and flags —
 * never prompts, message parts, tool output, credentials, run tokens, or
 * handoff tokens (those stay in the Langy domain tables and the short-lived
 * Redis transport).
 *
 * LIVENESS IS OUT OF THIS PILOT. The pure process has no way to observe the
 * ephemeral Redis heartbeat, so any wake-driven redispatch or fail-turn
 * decision would re-drive (or kill) healthy long-running turns that stream
 * without durable milestones. The heartbeat-aware liveness subscriber remains
 * the sole liveness owner until the core offers an observed-liveness input contract.
 * This process therefore schedules no wake-ups and emits no fail intents.
 */
export const LANGY_CONVERSATION_PROCESS_NAME = "langyConversation";

export const LANGY_PROCESS_INTENT_TYPES = {
  WORKER_DISPATCH: "langy.conversation.worker_dispatch",
  GENERATE_TITLE: "langy.conversation.generate_title",
} as const;

export type LangyProcessIntentType =
  (typeof LANGY_PROCESS_INTENT_TYPES)[keyof typeof LANGY_PROCESS_INTENT_TYPES];

export interface LangyConversationProcessState {
  currentTurnId: string | null;
  turnStatus: "idle" | "running" | "completed" | "failed";
  titleSource: LangyTitleSource;
  /**
   * One-shot latch: the automatic title intent was already recorded. The
   * title may only be generated at the first successful agent_responded
   * boundary while the title is still the derived placeholder — never again
   * from a counter or timer once this is set or titleSource leaves
   * "derived".
   */
  autoTitleRequested: boolean;
  archived: boolean;
  /** ADR-048: id of the turn whose resume handoff is pending — identity only. */
  pendingHandoffTurnId: string | null;
}

export const langyWorkerDispatchIntentSchema = z.object({
  conversationId: z.string(),
  turnId: z.string(),
  /**
   * ADR-048: the handed-off turn whose worker-authored resume token the next
   * worker should thread — by id only. The token itself lives in the Redis
   * handoff store and never enters process state or outbox rows.
   */
  resumeFromTurnId: z.string().nullable(),
});
export type LangyWorkerDispatchIntent = z.infer<
  typeof langyWorkerDispatchIntentSchema
>;

export const langyGenerateTitleIntentSchema = z.object({
  conversationId: z.string(),
  /** The finalized turn that triggered generation (idempotency scope). */
  turnId: z.string(),
});
export type LangyGenerateTitleIntent = z.infer<
  typeof langyGenerateTitleIntentSchema
>;

/**
 * The content-stripped view of a Langy event the decision function receives
 * as its envelope payload: identities and flags only. Building it is the
 * boundary that keeps parts/tokens/titles out of the process manager
 * entirely — the process never even sees them.
 */
export const langyProcessEventViewSchema = z.object({
  turnId: z.string().nullable(),
  outcome: z.enum(["completed", "failed", "stopped"]).nullable(),
  /** metadata_updated only: the user set a title (rename is sticky). */
  titleTouched: z.boolean(),
});
export type LangyProcessEventView = z.infer<typeof langyProcessEventViewSchema>;
