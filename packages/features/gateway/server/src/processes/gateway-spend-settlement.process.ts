import type { IntentSpec, ProcessManagerApplier, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";
import {
  runSpendSettlementSweep,
  type SpendSettlementProcessDeps,
} from "../intents/gateway-spend-settlement.intent";
import type { GatewaySpendProcessingEvent } from "../intents/gateway-spend.intent";

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
 * Declared out here with an explicit intents type rather than inline — inline, the builder infers a wake handler's intents from the handler itself and types ctx.intents.sweep as possibly-undefined. Wake handlers must be pure/synchronous, so the query and sends run behind the outbox lease as an intent instead.
 */
export const spendSettlementWake: WakeHandler<SpendSettlementState, SpendSettlementIntents> = (
  state,
  ctx,
) => ({
  state: { ...state, lastSweepAt: ctx.at },
  intents: [ctx.intents.sweep(`sweep:${ctx.at}`, { scheduledFor: ctx.at })],
});

/**
 * The settlement sweeper: ONE process instance for the whole install, woken on a schedule, asking the spend record which admissions are open past grace. Replaces one instance per request (wrong shape — ProcessManagerInstance has no retention sweep, being bounded by entity population, and a timer per LLM call broke that). The fold already writes one gateway_spend row per request, staying "admitted" until an outcome lands, so "which requests are open" is a query, and settle is idempotent by (tenant, request, step) so a re-settled row is a no-op.
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
