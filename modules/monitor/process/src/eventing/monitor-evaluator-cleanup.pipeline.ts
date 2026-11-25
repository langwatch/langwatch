import {
  EVALUATOR_DELETED_EVENT_TYPE,
  evaluatorDeletedEventDataSchema,
} from "@langwatch/evaluator-contract";
/**
 * Monitor removes the monitors that ran a deleted evaluator from its own side (§9, R7), so
 * evaluator holds no monitor peer. Spec: modules/monitor/specs/monitor-evaluator-cleanup.feature
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
import type { MonitorService } from "../services/monitor.service.ts";

const MONITOR_EVALUATOR_CLEANUP_PIPELINE_NAME = "monitor_evaluator_cleanup" as const;

const deletedAtOf = evaluatorDeletedEventDataSchema.pick({ occurredAt: true });

export type MonitorEvaluatorCleanupPipeline = StaticPipelineDefinition<never>;

export function buildMonitorEvaluatorCleanupPipeline({
  monitors,
}: {
  monitors: Pick<MonitorService, "deleteByEvaluator">;
}): MonitorEvaluatorCleanupPipeline {
  return (
    definePipeline({
      name: MONITOR_EVALUATOR_CLEANUP_PIPELINE_NAME,
      // `global`: monitor appends no events of its own here; it only reacts to evaluator's.
      aggregate: defineAggregate({ type: "global" }),
    })
      .withEvents([])
      // The delete re-reads the rows still naming the evaluator, so a redelivery removes nothing.
      .withPeerSubscriber("monitorEvaluatorDeleted", {
        eventType: EVALUATOR_DELETED_EVENT_TYPE,
        data: evaluatorDeletedEventDataSchema,
        options: {
          deduplication: {
            makeId: (event) =>
              `monitor-evaluator-deleted:${event.tenantId}:${String(event.aggregateId)}:${deletedAtOf.parse(event.data).occurredAt}`,
            ttlMs: 60_000,
          },
        },
        handle: ({ projectId, evaluatorId }) =>
          monitors.deleteByEvaluator({ projectId, evaluatorId }),
      })
      .build()
  );
}

export const monitorEvaluatorCleanupEventing = defineEventingModule({
  pipeline: MONITOR_EVALUATOR_CLEANUP_PIPELINE_NAME,
  build: ({ app }: EventingSetup<MonitorRepositories, MonitorModule>) =>
    app.evaluatorCleanupPipeline(),
});
