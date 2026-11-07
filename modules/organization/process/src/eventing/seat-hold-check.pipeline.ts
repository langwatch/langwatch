/**
 * The hourly seat hold check (specs/licensing/seat-rotation.feature): ended holds go, and each
 * organization a seat freed in admits the people waiting longest while a full seat fits.
 */
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";

import type { OrganizationModule } from "../app/organization.app.ts";
import type { OrganizationRepositories } from "../repositories/organization.repositories.ts";
import { runSeatHoldCheck, type SeatHoldCheckDeps } from "./seat-hold-check.intent.ts";
import {
  SEAT_HOLD_CHECK_INITIAL_STATE,
  SEAT_HOLD_CHECK_INTERVAL_MS,
  SEAT_HOLD_CHECK_PIPELINE_NAME,
  SEAT_HOLD_CHECK_PROCESS_NAME,
  seatHoldCheckSchema,
  seatHoldCheckStateSchema,
  seatHoldCheckWake,
} from "./seat-hold-check.process.ts";

export const seatHoldCheckEventing = defineEventingModule({
  pipeline: SEAT_HOLD_CHECK_PIPELINE_NAME,
  build: ({ app, processStore }: EventingSetup<OrganizationRepositories, OrganizationModule>) =>
    buildSeatHoldCheckPipeline({
      check: () => app.runSeatHoldCheck(),
      deleteDispatchedBefore: (params) => processStore.deleteDispatchedBefore(params),
    }),
});

/** A scheduled sweep, no events: holds end by the clock, not by a fact. */
export function buildSeatHoldCheckPipeline(
  deps: SeatHoldCheckDeps,
): StaticPipelineDefinition<never> {
  return definePipeline({
    name: SEAT_HOLD_CHECK_PIPELINE_NAME,
    // `global`: the sweep spans every tenant by design and appends nothing.
    aggregate: defineAggregate({ type: "global" }),
  })
    .withEvents([])
    .withProcessManager(SEAT_HOLD_CHECK_PROCESS_NAME, (pm) =>
      pm
        .state(seatHoldCheckStateSchema, SEAT_HOLD_CHECK_INITIAL_STATE)
        .schedule({ everyMs: SEAT_HOLD_CHECK_INTERVAL_MS })
        .onWake(seatHoldCheckWake)
        .intent("check", seatHoldCheckSchema, runSeatHoldCheck(deps))
        // A few holds end each hour; each admission is one role write and one enable.
        .outbox({ leaseDurationMs: 5 * 60 * 1000, maxAttempts: 3 }),
    )
    .build();
}
