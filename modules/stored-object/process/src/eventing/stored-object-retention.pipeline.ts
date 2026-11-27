/**
 * stored_object_retention: the hourly sweep of ended owner links, and data-retention's
 * retroactive fact re-timing a project's links (ADR-002 §4, §5). No events of its own.
 * Spec: modules/stored-object/specs/stored-object-reuse-and-retention.feature
 */
import {
  RETENTION_APPLIED_TO_EXISTING_DATA_EVENT_TYPE,
  retentionAppliedToExistingDataEventDataSchema,
} from "@langwatch/data-retention-contract";
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import { nowInstant } from "@langwatch/time";

import type { StoredObjectModule } from "../app/stored-object.app.ts";
import type { StoredObjectRepositories } from "../repositories/stored-object.repositories.ts";
import type { StoredObjectRetentionService } from "../services/stored-object-retention.service.ts";
import {
  STORED_OBJECT_RETENTION_SWEEP_INTERVAL_MS,
  STORED_OBJECT_RETENTION_SWEEP_PROCESS_NAME,
  runStoredObjectRetentionSweep,
  storedObjectRetentionSweepSchema,
  storedObjectRetentionSweepStateSchema,
  storedObjectRetentionSweepWake,
  type StoredObjectRetentionSweepRunDeps,
} from "./stored-object-retention-sweep.process.ts";

export const STORED_OBJECT_RETENTION_PIPELINE_NAME = "stored_object_retention";

export type StoredObjectRetentionPipeline = StaticPipelineDefinition<never>;

export function buildStoredObjectRetentionPipeline({
  retention,
  deleteDispatchedBefore,
}: {
  retention: Pick<StoredObjectRetentionService, "sweep" | "followsCategory" | "followRetention">;
  deleteDispatchedBefore: StoredObjectRetentionSweepRunDeps["deleteDispatchedBefore"];
}): StoredObjectRetentionPipeline {
  return definePipeline({
    name: STORED_OBJECT_RETENTION_PIPELINE_NAME,
    aggregate: defineAggregate({ type: "global" }),
  })
    .withEvents([])
    .withProcessManager(STORED_OBJECT_RETENTION_SWEEP_PROCESS_NAME, (pm) =>
      pm
        .state(storedObjectRetentionSweepStateSchema, { lastSweepAt: null })
        .schedule({ everyMs: STORED_OBJECT_RETENTION_SWEEP_INTERVAL_MS })
        .onWake(storedObjectRetentionSweepWake)
        .intent(
          "sweep",
          storedObjectRetentionSweepSchema,
          runStoredObjectRetentionSweep({
            sweep: () => retention.sweep(),
            deleteDispatchedBefore,
            now: () => nowInstant().epochMilliseconds,
          }),
        )
        // A failed sweep dead-letters for an operator; the next hour's wake asks for a fresh one.
        .outbox({ maxAttempts: 1, concurrency: 1, batchSize: 1, leaseDurationMs: 30 * 60 * 1000 }),
    )
    .withPeerSubscriber("storedObjectRetentionFollow", {
      eventType: RETENTION_APPLIED_TO_EXISTING_DATA_EVENT_TYPE,
      data: retentionAppliedToExistingDataEventDataSchema,
      options: { enqueue: { filter: (data) => retention.followsCategory(data) } },
      handle: async (fact) => {
        await retention.followRetention({
          projectId: fact.projectId,
          category: fact.category,
          retentionDays: fact.retentionDays,
          isRaise: fact.mode === "raise",
        });
      },
    })
    .build();
}

export const storedObjectRetentionEventing = defineEventingModule({
  pipeline: STORED_OBJECT_RETENTION_PIPELINE_NAME,
  build: ({ app, processStore }: EventingSetup<StoredObjectRepositories, StoredObjectModule>) =>
    app.retentionPipeline({
      deleteDispatchedBefore: (params) => processStore.deleteDispatchedBefore(params),
    }),
});
