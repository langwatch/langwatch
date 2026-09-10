import { z } from "zod";

/**
 * Langy conversation process manager (ADR-049 §4) — typed contracts for the
 * pilot adapter over the generic event-sourcing/process-manager core.
 *
 * The process is keyed by (LANGY_CONVERSATION_PROCESS_NAME, projectId,
 * conversationId). Its state holds only identities, statuses, and flags —
 * never prompts, message parts, tool output, credentials, run tokens, or
 * handoff tokens (those stay in the Langy domain tables and the short-lived
 * Redis transport).
 */
export const LANGY_CONVERSATION_PROCESS_NAME = "langyConversation";

/** Worker dispatch budget used by both the worker adapter and process lease. */
export const LANGY_AGENT_DISPATCH_TIMEOUT_MS = 60_000;

/** Margin kept between a worker dispatch timeout and its process lease. */
export const LANGY_OUTBOX_LEASE_MARGIN_MS = 30_000;

/** The outbox lease must outlive one accepted worker dispatch. */
export const LANGY_OUTBOX_LEASE_DURATION_MS =
  LANGY_AGENT_DISPATCH_TIMEOUT_MS + LANGY_OUTBOX_LEASE_MARGIN_MS;

export const LANGY_PROCESS_INTENT_TYPES = {
  WORKER_DISPATCH: "langy.conversation.worker_dispatch",
  GENERATE_TITLE: "langy.conversation.generate_title",
} as const;

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

export const langyGenerateTitleIntentSchema = z.object({
  conversationId: z.string(),
  /** The finalized turn that triggered generation (idempotency scope). */
  turnId: z.string(),
});

/**
 * The content-stripped view of a Langy event the decision function receives
 * as its envelope payload: identities and flags only.
 */
export const langyProcessEventViewSchema = z.object({
  turnId: z.string().nullable(),
  outcome: z.enum(["completed", "failed", "stopped"]).nullable(),
  /** metadata_updated only: the user set a title (rename is sticky). */
  titleTouched: z.boolean(),
});

/** The named resources Langy mints KSUIDs for. */
export const LANGY_ID_RESOURCES = {
  conversation: "langyconv",
  message: "langymsg",
} as const;
