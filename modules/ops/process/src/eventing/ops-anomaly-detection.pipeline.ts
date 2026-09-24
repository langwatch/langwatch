import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type StaticPipelineDefinition,
  type Event,
} from "@langwatch/eventing";

import type { OpsApp } from "../app/ops.app.ts";
import type { OpsRepositories } from "../repositories/ops.repositories.ts";
import {
  ANOMALY_DETECTION_PROCESS_NAME,
  runAnomalyDetection,
} from "./ops-anomaly-detection.intent.ts";
import {
  ANOMALY_DETECTION_INITIAL_STATE,
  ANOMALY_DETECTION_INTERVAL_MS,
  type AnomalyDetectionState,
  anomalyDetectionSchema,
  anomalyDetectionWake,
} from "./ops-anomaly-detection.process.ts";

export const ANOMALY_DETECTION_PIPELINE_NAME = "ops_anomaly_detection";

/** Per-tenant rate anomaly detection, a scheduled process with no events of its own. */
export function buildAnomalyDetection({
  app,
  processStore,
}: EventingSetup<unknown, Pick<OpsApp, "detectAnomalies">>): StaticPipelineDefinition<Event> {
  return definePipeline({
    name: ANOMALY_DETECTION_PIPELINE_NAME,
    aggregate: defineAggregate({ type: "global" }),
  })
    .withEvents([])
    .withProcessManager(ANOMALY_DETECTION_PROCESS_NAME, (pm) =>
      pm
        .state<AnomalyDetectionState>(ANOMALY_DETECTION_INITIAL_STATE)
        .schedule({ everyMs: ANOMALY_DETECTION_INTERVAL_MS })
        .onWake(anomalyDetectionWake)
        .intent(
          "detect",
          anomalyDetectionSchema,
          runAnomalyDetection({
            detect: () => app.detectAnomalies(),
            deleteDispatchedBefore: (params) => processStore.deleteDispatchedBefore(params),
          }),
        )
        // One tick at a time, as main's serial loop; a repeated tick converges.
        .outbox({ leaseDurationMs: 5 * 60 * 1000, maxAttempts: 3, concurrency: 1, batchSize: 1 }),
    )
    .build();
}

export const anomalyDetectionEventing = defineEventingModule({
  pipeline: ANOMALY_DETECTION_PIPELINE_NAME,
  build: (setup: EventingSetup<OpsRepositories, OpsApp>) => buildAnomalyDetection(setup),
});
