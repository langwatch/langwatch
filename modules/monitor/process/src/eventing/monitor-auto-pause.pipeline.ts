import {
  EVALUATION_MONITOR_ERROR_RATE_EXCEEDED_EVENT_TYPE,
  evaluationMonitorErrorRateExceededEventDataSchema,
} from "@langwatch/evaluation-contract";
/**
 * Monitor pauses a monitor whose evaluations mostly errored from its own side (§9), so
 * evaluation never writes a monitor. Spec: modules/monitor/specs/monitor-auto-pause.feature
 */
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";

import type { MonitorModule } from "../app/monitor.app.ts";
import type { MonitorRepositories } from "../repositories/monitor.repositories.ts";
import type { MonitorAutoPauseService } from "../services/monitor-auto-pause.service.ts";

const MONITOR_AUTO_PAUSE_PIPELINE_NAME = "monitor_auto_pause" as const;

export type MonitorAutoPausePipeline = StaticPipelineDefinition<never>;

export function buildMonitorAutoPausePipeline({
  autoPause,
}: {
  autoPause: Pick<MonitorAutoPauseService, "pauseFailing">;
}): MonitorAutoPausePipeline {
  return (
    definePipeline({
      name: MONITOR_AUTO_PAUSE_PIPELINE_NAME,
      // `global`: monitor appends no events of its own here; it only reacts to evaluation's.
      aggregate: defineAggregate({ type: "global" }),
    })
      .withEvents([])
      // A conditional update on the revision pauses; only the delivery that applied it emails.
      .withPeerSubscriber("monitorErrorRateExceeded", {
        eventType: EVALUATION_MONITOR_ERROR_RATE_EXCEEDED_EVENT_TYPE,
        data: evaluationMonitorErrorRateExceededEventDataSchema,
        options: {
          deduplication: {
            makeId: (event) =>
              `monitor-error-rate-exceeded:${event.tenantId}:${String(event.aggregateId)}`,
            ttlMs: 60 * 60 * 1000,
          },
        },
        handle: (fact) => autoPause.pauseFailing(fact),
      })
      .build()
  );
}

export const monitorAutoPauseEventing = defineEventingModule({
  pipeline: MONITOR_AUTO_PAUSE_PIPELINE_NAME,
  build: ({ app }: EventingSetup<MonitorRepositories, MonitorModule>) => app.autoPausePipeline(),
});
