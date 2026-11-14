// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The seat line repair every 15 minutes (specs/licensing/seat-rotation.feature): a seat line
 * Stripe refused to put back after a refused charge is moved to the recorded quantity.
 */
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";

import type { BillingModule } from "../app/billing.app.ts";
import type { BillingRepositories } from "../repositories/billing.repositories.ts";
import { runSeatLineRepair, type SeatLineRepairDeps } from "./seat-line-repair.intent.ts";
import {
  SEAT_LINE_REPAIR_INITIAL_STATE,
  SEAT_LINE_REPAIR_INTERVAL_MS,
  SEAT_LINE_REPAIR_PIPELINE_NAME,
  SEAT_LINE_REPAIR_PROCESS_NAME,
  seatLineRepairSchema,
  seatLineRepairStateSchema,
  seatLineRepairWake,
} from "./seat-line-repair.process.ts";

export const seatLineRepairEventing = defineEventingModule({
  pipeline: SEAT_LINE_REPAIR_PIPELINE_NAME,
  build: ({ app, processStore }: EventingSetup<BillingRepositories, BillingModule>) =>
    buildSeatLineRepairPipeline({
      repair: () => app.repairSeatLines(),
      deleteDispatchedBefore: (params) => processStore.deleteDispatchedBefore(params),
    }),
});

/** A scheduled sweep, no events: a repair is retried by the clock, not by a fact. */
export function buildSeatLineRepairPipeline(
  deps: SeatLineRepairDeps,
): StaticPipelineDefinition<never> {
  return definePipeline({
    name: SEAT_LINE_REPAIR_PIPELINE_NAME,
    // `global`: the sweep spans every tenant by design and appends nothing.
    aggregate: defineAggregate({ type: "global" }),
  })
    .withEvents([])
    .withProcessManager(SEAT_LINE_REPAIR_PROCESS_NAME, (pm) =>
      pm
        .state(seatLineRepairStateSchema, SEAT_LINE_REPAIR_INITIAL_STATE)
        .schedule({ everyMs: SEAT_LINE_REPAIR_INTERVAL_MS })
        .onWake(seatLineRepairWake)
        .intent("repair", seatLineRepairSchema, runSeatLineRepair(deps))
        // One pass at a time: a pass changes seat lines at the payment provider.
        .outbox({ maxAttempts: 3, concurrency: 1, batchSize: 1, leaseDurationMs: 5 * 60 * 1000 }),
    )
    .build();
}
