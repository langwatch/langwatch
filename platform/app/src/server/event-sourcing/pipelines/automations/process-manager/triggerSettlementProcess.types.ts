import { z } from "zod";
import type { TriggerActionClass } from "~/server/event-sourcing/pipelines/automations/schemas/events";

export const TRIGGER_SETTLEMENT_INTENT_TYPES = {
  NOTIFY_DIGEST: "notifyDigest",
  PERSIST_MATCH: "persistMatch",
  LOG_OVERFLOW: "logOverflow",
} as const;

export interface PendingMatch {
  settleDueAt: number;
  dispatchDueAt: number;
  actionClass: TriggerActionClass;
  settleWindowBucket: string;
}

export interface TriggerSettlementState {
  pendingMatches: Record<string, PendingMatch>;
  /** Matches flushed early because the pending set hit its cap. Overflow
   *  never discards customer matches — it dispatches them ahead of their
   *  settle boundary instead (degraded batching, no loss). */
  overflowFlushed: number;
}

export const notifyDigestIntentSchema = z.object({
  triggerId: z.string().min(1),
  traceIds: z.array(z.string().min(1)).min(1),
  boundary: z.number().int().positive(),
});
export type NotifyDigestIntent = z.infer<typeof notifyDigestIntentSchema>;

export const persistMatchIntentSchema = z.object({
  triggerId: z.string().min(1),
  traceId: z.string().min(1),
});
export type PersistMatchIntent = z.infer<typeof persistMatchIntentSchema>;

export const logOverflowIntentSchema = z.object({
  triggerId: z.string().min(1),
  flushed: z.number().int().positive(),
  totalFlushed: z.number().int().positive(),
});
export type LogOverflowIntent = z.infer<typeof logOverflowIntentSchema>;
