import type { IntentSpec, ProcessManagerApplier, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";
import {
  runSpendSettlementSweep,
  type SpendSettlementProcessDeps,
} from "../intents/gateway-spend-settlement.intent";
import type { GatewaySpendProcessingEvent } from "../adapters/gateway-spend-events.adapter";

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
 * Arms the next sweep and hands the work to the outbox.
 *
 * Declared out here with an explicit intents type rather than inline in the
 * applier, the same way every other scheduled process does it: the builder
 * infers a wake handler's intents from the handler itself, so an inline one
 * types `ctx.intents.sweep` as possibly-undefined and cannot be called.
 *
 * Wake handlers must be pure and synchronous — the commit that persists this
 * evolution is what fences racing workers — so the query and the sends run
 * behind the outbox lease as an intent instead.
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
 * on a schedule, asking the spend record which admissions are still open
 * past their grace and settling each one.
 *
 * It used to be one instance per gateway request, each holding a durable row
 * and a wake armed at admission + grace. That is the right shape for a
 * long-lived entity and the wrong one for a request: the aggregate is
 * per-request, so the framework keyed an instance per request, and
 * `ProcessManagerInstance` has no retention sweep because it is documented as
 * bounded by entity population rather than by traffic. A timer per LLM call
 * made that false.
 *
 * The join those rows existed to perform is already done: the fold writes one
 * `gateway_spend` row per request and leaves it at `admitted` until an
 * outcome arrives, so "which requests are still open" is a query, not a
 * memory. Settlement latency becomes grace + at most one sweep interval, and
 * the settle command is idempotent by (tenant, request, step), so a
 * re-settled row is a no-op rather than a double charge.
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
