import {
  AnnotationClickHouseBackfillTask,
  PostgresAnnotationBackfillAdapter,
  TraceAnnotationSyncPort,
} from "@langwatch/annotation-server";
import { createTraceProcessingProducerPipeline } from "@langwatch/trace-server";
import { TASKS_PROCESS_NAME, type TasksEventingInfrastructure } from "./tasks-eventing.composition";
import type { TasksHost } from "./tasks-host.composition";

/**
 * Dispatches `bulkSyncAnnotations` onto this process's own producer-only
 * registration of the `trace_processing` pipeline. `annotationIds` arrives as
 * `readonly string[]` off the port's own contract; the command's payload
 * (derived from the event's zod schema) wants a plain mutable array, so it is
 * copied rather than cast.
 */
class TasksTraceAnnotationSync extends TraceAnnotationSyncPort {
  constructor(
    private readonly bulkSyncAnnotationsCommand: {
      send(input: {
        tenantId: string;
        traceId: string;
        annotationIds: string[];
        occurredAt: number;
      }): Promise<void>;
    },
  ) {
    super();
  }

  bulkSyncAnnotations(input: {
    tenantId: string;
    traceId: string;
    annotationIds: readonly string[];
    occurredAt: number;
  }): Promise<void> {
    return this.bulkSyncAnnotationsCommand.send({
      ...input,
      annotationIds: [...input.annotationIds],
    });
  }
}

/**
 * Builds the `annotation-clickhouse-backfill` task, deferred to `run()` — the
 * same reason `stalled-runs-backfill.composition.ts` defers: constructing the
 * real `sync` registers an Eventing pipeline, which needs Redis, and a
 * missing `REDIS_URL` must fail only THIS task, at run time, not every other
 * task at catalogue construction.
 */
export function buildAnnotationClickHouseBackfillTask({
  host,
  eventing,
}: {
  host: TasksHost;
  eventing: TasksEventingInfrastructure | undefined;
}): AnnotationClickHouseBackfillTask {
  return AnnotationClickHouseBackfillTask.create({
    source: () => PostgresAnnotationBackfillAdapter.create({ prisma: host.requirePrisma() }),
    sync: () => {
      if (!eventing) {
        throw new Error(
          "annotation-clickhouse-backfill requires REDIS_URL: bulkSyncAnnotations dispatches through a producer-only Eventing pipeline over Group Queue.",
        );
      }
      const registered = eventing.eventSourcing.register(
        createTraceProcessingProducerPipeline({ processName: TASKS_PROCESS_NAME }),
      );
      return new TasksTraceAnnotationSync(registered.commands.bulkSyncAnnotations);
    },
  });
}
