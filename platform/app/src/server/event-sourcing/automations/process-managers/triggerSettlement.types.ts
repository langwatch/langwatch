import { z } from "zod";
import type { TriggerActionClass } from "../aggregate";

/**
 * `triggerSettlement`'s durable state and its intent payload schemas.
 *
 * One instance per trigger (`groupKeys.ts`), accumulating that trigger's
 * matched-but-not-yet-dispatched traces until each settles. The intent
 * schemas below are the ONLY declaration of this process's intents — passed
 * straight into `defineProcessManager(...).state(...).intents(intentSchemas)`
 * in `triggerSettlement.ts`, which derives both the payload types and the
 * typed intent constructors from them. There is deliberately no second,
 * hand-written map of intent-type strings to keep in sync with this one.
 */

export interface PendingMatch {
  /** When this match's settle window closes — the instant after which
   *  duplicate/continuing activity for the same trace stops re-arming this
   *  round and a NEW round begins instead. */
  readonly settleDueAt: number;
  /** When this match is actually due to dispatch — equal to `settleDueAt`
   *  for a persist action or an immediate-cadence notify action; snapped to
   *  the next cadence-window boundary for a digest notify action. */
  readonly dispatchDueAt: number;
  readonly actionClass: TriggerActionClass;
  /** The settle round's own identity (`settleWindow.ts`) — carried on the
   *  pending match so a later round for the same trace is provably a
   *  DIFFERENT round, not a mutation of this one. */
  readonly settleWindowBucket: string;
}

export interface TriggerSettlementState {
  readonly pendingMatches: Record<string, PendingMatch>;
  /** Matches evicted from `pendingMatches` by `MAX_PENDING_MATCHES` and
   *  flushed to immediate dispatch instead of being discarded — a running
   *  total, never reset, so `logOverflow`'s reported count is monotone. */
  readonly overflowFlushed: number;
}

export const triggerSettlementStateSchema: z.ZodType<TriggerSettlementState> = z.object({
  pendingMatches: z.record(
    z.object({
      settleDueAt: z.number(),
      dispatchDueAt: z.number(),
      actionClass: z.enum(["notify", "persist"]),
      settleWindowBucket: z.string(),
    }),
  ),
  overflowFlushed: z.number().int().nonnegative(),
});

export const INITIAL_TRIGGER_SETTLEMENT_STATE: TriggerSettlementState = {
  pendingMatches: {},
  overflowFlushed: 0,
};

/** A trace-storm bound. Overflow never drops a match — the oldest pending
 *  matches flush to immediate dispatch instead (degraded batching, no loss)
 *  — but an unbounded map would let one runaway trigger hold unbounded
 *  process-manager state. */
export const MAX_PENDING_MATCHES = 1_000;

export const triggerSettlementIntentSchemas = {
  notifyDigest: z.object({
    triggerId: z.string().min(1),
    traceIds: z.array(z.string().min(1)).min(1),
    boundary: z.number().int().positive(),
  }),
  persistMatch: z.object({
    triggerId: z.string().min(1),
    traceId: z.string().min(1),
  }),
  logOverflow: z.object({
    triggerId: z.string().min(1),
    flushed: z.number().int().positive(),
    totalFlushed: z.number().int().positive(),
  }),
};

export type NotifyDigestIntent = z.infer<
  (typeof triggerSettlementIntentSchemas)["notifyDigest"]
>;
export type PersistMatchIntent = z.infer<
  (typeof triggerSettlementIntentSchemas)["persistMatch"]
>;
export type LogOverflowIntent = z.infer<
  (typeof triggerSettlementIntentSchemas)["logOverflow"]
>;
