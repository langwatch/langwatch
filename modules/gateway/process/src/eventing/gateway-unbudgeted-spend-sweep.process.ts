import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

export const UNBUDGETED_SPEND_SWEEP_PROCESS_NAME = "unbudgetedSpendSweep" as const;

/**
 * Every six hours. Each sweep records the fact again, but it is sent at most once per
 * organization per ISO week, so a finer tick buys only an earlier first send at the cost of more
 * ledger reads.
 */
export const UNBUDGETED_SPEND_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

export const unbudgetedSpendSweepSchema = z.object({
  scheduledFor: z.number().int(),
});

export const unbudgetedSpendSweepStateSchema = z.object({
  /** Epoch ms of the last sweep this process scheduled, for operators. */
  lastSweepAt: z.number().nullable().default(null),
});
type UnbudgetedSpendSweepState = z.infer<typeof unbudgetedSpendSweepStateSchema>;

export const UNBUDGETED_SPEND_SWEEP_INITIAL_STATE: UnbudgetedSpendSweepState = {
  lastSweepAt: null,
};

type UnbudgetedSpendSweepIntents = {
  sweep: IntentSpec<typeof unbudgetedSpendSweepSchema>;
};

/** Pure and synchronous: the reads and the record run behind the outbox lease as an intent. */
export const unbudgetedSpendSweepWake: WakeHandler<
  UnbudgetedSpendSweepState,
  UnbudgetedSpendSweepIntents
> = (_state, ctx) => ({
  state: { lastSweepAt: ctx.at },
  intents: [ctx.intent("sweep", `sweep:${ctx.at}`, { scheduledFor: ctx.at })],
});
