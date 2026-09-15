import type { IntentSpec, ProcessManagerApplier, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";
import {
  runSpendSettlementSweep,
  type SpendSettlementProcessDeps,
} from "./gateway-spend-settlement.intent.ts";
import type { GatewaySpendProcessingEvent } from "./gateway-spend.intent.ts";

export const SPEND_SETTLEMENT_PROCESS_NAME = "spendSettlement" as const;

/**
 * How often the sweeper looks. Settlement latency is grace + at most one
 * interval, so five minutes is a rounding error against a thirty-minute
 * grace while keeping each sweep's scan small.
 */
export const SETTLEMENT_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

export interface SpendSettlementState {
  /** Epoch ms of the last sweep this process scheduled, for operators. */
  lastSweepAt: number | null;
}

export const INITIAL_SPEND_SETTLEMENT_STATE: SpendSettlementState = {
  lastSweepAt: null,
};

const sweepSchema = z.object({
  scheduledFor: z.number().int(),
});

type SpendSettlementIntents = {
  sweep: IntentSpec<typeof sweepSchema>;
};

/**
 * An explicit intents type, not inline inference (which types
 * `ctx.intents.sweep` as possibly-undefined). Wake handlers must be pure/sync,
 * so query + sends run behind the outbox lease as an intent.
 */
export const spendSettlementWake: WakeHandler<SpendSettlementState, SpendSettlementIntents> = (
  state,
  ctx,
) => ({
  state: { ...state, lastSweepAt: ctx.at },
  intents: [ctx.intents.sweep(`sweep:${ctx.at}`, { scheduledFor: ctx.at })],
});

/**
 * The settlement sweeper: ONE process instance for the whole install, woken
 * on a schedule to ask which admissions are open past grace — not one
 * instance per request, whose timer-per-call broke retention.
 */
export function spendSettlementPM(
  deps: SpendSettlementProcessDeps,
): ProcessManagerApplier<GatewaySpendProcessingEvent> {
  return (pm) =>
    pm
      .state<SpendSettlementState>(INITIAL_SPEND_SETTLEMENT_STATE)
      .schedule({ everyMs: SETTLEMENT_SWEEP_INTERVAL_MS })
      .onWake(spendSettlementWake)
      .intent("sweep", sweepSchema, runSpendSettlementSweep(deps))
      .outbox({
        maxAttempts: 3,
        concurrency: 1,
        batchSize: 1,
        // One sweep can settle thousands of rows, each a command append.
        leaseDurationMs: 10 * 60 * 1000,
      });
}
