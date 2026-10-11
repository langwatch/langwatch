import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";

import type { OrganizationModule } from "../app/organization.app.ts";
import type { OrganizationRepositories } from "../repositories/organization.repositories.ts";
import {
  PRIVATE_DATAPLANE_RECORDER_PROCESS_NAME,
  runPrivateDataplaneRecord,
} from "./organization-private-dataplane.intent.ts";
import {
  PRIVATE_DATAPLANE_RECORD_INTERVAL_MS,
  PRIVATE_DATAPLANE_RECORDER_INITIAL_STATE,
  privateDataplaneRecordSchema,
  privateDataplaneRecorderStateSchema,
  privateDataplaneRecorderWake,
} from "./organization-private-dataplane.process.ts";

export const PRIVATE_DATAPLANE_RECORDER_PIPELINE_NAME = "organization_private_dataplane_recorder";

/** Records privately routed organizations once across the fleet: a scheduled process, no events. */
export function buildPrivateDataplaneRecorder({
  app,
  processStore,
}: EventingSetup<
  unknown,
  Pick<OrganizationModule, "recordPrivateDataplanes">
>): StaticPipelineDefinition<never> {
  return definePipeline({
    name: PRIVATE_DATAPLANE_RECORDER_PIPELINE_NAME,
    aggregate: defineAggregate({ type: "global" }),
  })
    .withEvents([])
    .withProcessManager(PRIVATE_DATAPLANE_RECORDER_PROCESS_NAME, (pm) =>
      pm
        .state(privateDataplaneRecorderStateSchema, PRIVATE_DATAPLANE_RECORDER_INITIAL_STATE)
        .schedule({ everyMs: PRIVATE_DATAPLANE_RECORD_INTERVAL_MS })
        .onWake(privateDataplaneRecorderWake)
        .intent(
          "record",
          privateDataplaneRecordSchema,
          runPrivateDataplaneRecord({
            record: () => app.recordPrivateDataplanes(),
            deleteDispatchedBefore: (params) => processStore.deleteDispatchedBefore(params),
          }),
        )
        .outbox({ leaseDurationMs: 60 * 1000, maxAttempts: 3, concurrency: 1, batchSize: 1 }),
    )
    .build();
}

export const privateDataplaneRecorderEventing = defineEventingModule({
  pipeline: PRIVATE_DATAPLANE_RECORDER_PIPELINE_NAME,
  build: (setup: EventingSetup<OrganizationRepositories, OrganizationModule>) =>
    buildPrivateDataplaneRecorder(setup),
});
