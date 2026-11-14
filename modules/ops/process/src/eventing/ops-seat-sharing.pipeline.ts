import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import { nowInstant } from "@langwatch/time";

import type { OpsModule } from "../app/ops.app.ts";
import type { OpsRepositories } from "../repositories/ops.repositories.ts";
import { SEAT_SHARING_PROCESS_NAME, type SeatSharingRunDeps } from "./ops-seat-sharing.intent.ts";
import { seatSharingPM } from "./ops-seat-sharing.process.ts";

export const SEAT_SHARING_PIPELINE_NAME = "ops_seat_sharing";

/**
 * The daily Ops seat sharing check, a scheduled process with no events of its own. `global`,
 * like the other maintenance pipelines: the check walks every organization.
 * Spec: modules/ops/specs/seat-sharing-check.feature
 */
export function buildOpsSeatSharingPipeline(
  deps: SeatSharingRunDeps,
): StaticPipelineDefinition<never> {
  return definePipeline({
    name: SEAT_SHARING_PIPELINE_NAME,
    aggregate: defineAggregate({ type: "global" }),
  })
    .withEvents([])
    .withProcessManager(SEAT_SHARING_PROCESS_NAME, seatSharingPM(deps))
    .build();
}

/** The pipeline over only the one app operation it calls. */
function buildSeatSharing({
  app,
  processStore,
}: EventingSetup<
  unknown,
  Pick<OpsModule, "runSeatSharingCheck">
>): StaticPipelineDefinition<never> {
  return buildOpsSeatSharingPipeline({
    check: () => app.runSeatSharingCheck(),
    deleteDispatchedBefore: (params) => processStore.deleteDispatchedBefore(params),
    now: () => nowInstant().epochMilliseconds,
  });
}

export const seatSharingEventing = defineEventingModule({
  pipeline: SEAT_SHARING_PIPELINE_NAME,
  build: (setup: EventingSetup<OpsRepositories, OpsModule>) => buildSeatSharing(setup),
});
