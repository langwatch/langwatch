import { z } from "zod";

import { TriggerAction } from "@prisma/client";
import { NOTIFICATION_CADENCES } from "~/automations/cadences";

export const TRIGGER_SETTLEMENT_PROCESS_NAME = "triggerSettlement" as const;

export const TRIGGER_SETTLEMENT_INTENT_TYPES = {
  /** One cadence digest for a set of settled matches (notify class). */
  NOTIFY_DIGEST: "notify-digest",
  /** One settled match to persist (dataset / annotation queue). */
  PERSIST_MATCH: "persist-match",
} as const;

/**
 * The two dispatch classes of ADR-026/035, carried on the envelope so the
 * pure definition never reads the trigger row.
 */
export const triggerActionClassSchema = z.enum(["notify", "persist"]);
export type TriggerActionClass = z.infer<typeof triggerActionClassSchema>;

/**
 * What a match subscriber tells the settlement process about one matched
 * (trigger, trace) pair. Identity plus the trigger's *timing config
 * snapshot* — never trace content (the dispatch handler re-reads the fold),
 * never full trigger config (the handler re-loads the trigger).
 */
export const triggerMatchEventViewSchema = z.object({
  traceId: z.string().min(1),
  action: z.nativeEnum(TriggerAction),
  actionClass: triggerActionClassSchema,
  /** ADR-026 per-trigger trace-readiness debounce, ms. */
  traceDebounceMs: z.number().int().nonnegative(),
  notificationCadence: z.enum(NOTIFICATION_CADENCES),
});
export type TriggerMatchEventView = z.infer<typeof triggerMatchEventViewSchema>;

/** One pending (not yet dispatched) match inside the process state. */
export interface PendingMatch {
  /** Debounce deadline — a re-match moves it later (ADR-026 settle). */
  settleDueAt: number;
  /** Wall-clock cadence boundary this match dispatches at (ADR-027). */
  dispatchDueAt: number;
  actionClass: TriggerActionClass;
}

/**
 * Settlement state for one (projectId, triggerId). Bounded: see
 * MAX_PENDING_MATCHES in the definition.
 */
export interface TriggerSettlementState {
  /** traceId -> pending match. */
  pendingMatches: Record<string, PendingMatch>;
  /** Count of matches dropped by the pending bound, for observability. */
  overflowDropped: number;
}

/** Payload of a NOTIFY_DIGEST intent. */
export const notifyDigestIntentSchema = z.object({
  triggerId: z.string().min(1),
  /** Sorted for deterministic identity. */
  traceIds: z.array(z.string().min(1)).min(1),
  /** The wall-clock boundary the digest drained at (epoch ms). */
  boundary: z.number().int().positive(),
});
export type NotifyDigestIntent = z.infer<typeof notifyDigestIntentSchema>;

/** Payload of a PERSIST_MATCH intent. */
export const persistMatchIntentSchema = z.object({
  triggerId: z.string().min(1),
  traceId: z.string().min(1),
});
export type PersistMatchIntent = z.infer<typeof persistMatchIntentSchema>;
