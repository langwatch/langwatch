import { z } from "zod";

export const TRIGGER_SETTLEMENT_INTENT_TYPES = {
  NOTIFY_DIGEST: "notifyDigest",
  PERSIST_MATCH: "persistMatch",
  LOG_OVERFLOW: "logOverflow",
} as const;

export const notifyDigestIntentSchema = z.object({
  triggerId: z.string().min(1),
  traceIds: z.array(z.string().min(1)).min(1),
  boundary: z.number().int().positive(),
});
export type NotifyDigestIntent = z.infer<typeof notifyDigestIntentSchema>;

/**
 * Union of the paged shape and the legacy single-trace shape: the
 * rolling-deploy contract. Outbox rows are durable, so a deploy's fleet
 * holds both, and the emitter moves to pages only once every pod can read them.
 */
export const persistMatchIntentSchema = z.union([
  z.object({
    triggerId: z.string().min(1),
    traceIds: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    triggerId: z.string().min(1),
    traceId: z.string().min(1),
  }),
]);
export type PersistMatchIntent = z.infer<typeof persistMatchIntentSchema>;

export const logOverflowIntentSchema = z.object({
  triggerId: z.string().min(1),
  flushed: z.number().int().positive(),
  totalFlushed: z.number().int().positive(),
});
export type LogOverflowIntent = z.infer<typeof logOverflowIntentSchema>;
