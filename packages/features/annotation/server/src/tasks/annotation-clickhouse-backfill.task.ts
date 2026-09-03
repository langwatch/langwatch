import { createLogger } from "@langwatch/observability";
import { Task } from "@langwatch/task";
import {
  AnnotationBackfillSourcePort,
  type BackfillableAnnotation,
  TraceAnnotationSyncPort,
} from "../ports/annotation-backfill.port";

const logger = createLogger("langwatch:tasks:backfill-annotations-to-clickhouse");

export type AnnotationBackfillTotals = { traces: number; annotations: number; projects: number };

/**
 * Reconciliation sweep that syncs all annotations from the database to
 * ClickHouse through the event-sourcing pipeline's `bulkSyncAnnotations`
 * command. Run it whenever add/remove sync events were lost and
 * has-annotation search reads have drifted from what the database holds.
 *
 * Race-condition note: concurrent add/remove mutations are safe because the
 * bulk-synced handler merges via Set and never overwrites. The worst case is
 * a brief window where a just-removed annotation reappears until the next
 * add/remove event corrects it.
 *
 * Every comment counts, including one left on a single span: what ClickHouse
 * carries is whether a human has touched a trace, which the has-annotation
 * filter in search reads.
 *
 * One failing trace does not abort the sweep. A backfill that stopped on the
 * first failure would leave the drift it was run to remove, and give no count
 * of how much of it was closed.
 */
export class AnnotationBackfillSweep {
  private constructor(
    private readonly source: AnnotationBackfillSourcePort,
    private readonly sync: TraceAnnotationSyncPort,
    private readonly now: () => number,
  ) {}

  static create({
    source,
    sync,
    now = () => Date.now(),
  }: {
    source: AnnotationBackfillSourcePort;
    sync: TraceAnnotationSyncPort;
    now?: () => number;
  }): AnnotationBackfillSweep {
    return new AnnotationBackfillSweep(source, sync, now);
  }

  async execute(): Promise<AnnotationBackfillTotals> {
    const projectIds = await this.source.listProjectIds();
    const totals: AnnotationBackfillTotals = {
      traces: 0,
      annotations: 0,
      projects: projectIds.length,
    };

    for (const projectId of projectIds) {
      await this.backfillProject({ projectId, totals });
    }

    logger.info(
      {
        totalTraces: totals.traces,
        totalProjects: totals.projects,
        totalAnnotations: totals.annotations,
      },
      "Finished backfilling all annotations to ClickHouse",
    );
    return totals;
  }

  private async backfillProject({
    projectId,
    totals,
  }: {
    projectId: string;
    totals: AnnotationBackfillTotals;
  }): Promise<void> {
    const annotations = await this.source.listAnnotations({ projectId });
    if (annotations.length === 0) return;
    totals.annotations += annotations.length;

    let projectTraces = 0;
    for (const [traceId, annotationIds] of groupAnnotationIdsByTrace(annotations)) {
      const synced = await this.syncTraceAnnotations({ projectId, traceId, annotationIds });
      if (!synced) continue;
      projectTraces++;
      totals.traces++;
      if (totals.traces % 100 === 0) {
        logger.info({ totalTraces: totals.traces }, "Backfill progress");
      }
    }

    logger.info({ projectId, projectTraces }, "Finished backfilling project");
  }

  private async syncTraceAnnotations({
    projectId,
    traceId,
    annotationIds,
  }: {
    projectId: string;
    traceId: string;
    annotationIds: readonly string[];
  }): Promise<boolean> {
    try {
      await this.sync.bulkSyncAnnotations({
        tenantId: projectId,
        traceId,
        annotationIds,
        occurredAt: this.now(),
      });
      return true;
    } catch (error) {
      logger.error({ error, projectId, traceId }, "Failed to backfill annotations for trace");
      return false;
    }
  }
}

function groupAnnotationIdsByTrace(
  annotations: readonly BackfillableAnnotation[],
): Map<string, string[]> {
  const idsByTrace = new Map<string, string[]>();
  for (const annotation of annotations) {
    const ids = idsByTrace.get(annotation.traceId) ?? [];
    ids.push(annotation.id);
    idsByTrace.set(annotation.traceId, ids);
  }
  return idsByTrace;
}

/**
 * The task-launcher entry — `pnpm --filter @langwatch/tasks task
 * annotation-clickhouse-backfill`. Registered in `apps/tasks`' catalogue via
 * `annotation-clickhouse-backfill.composition.ts`, which registers the trace
 * feature's producer-only pipeline (`createTraceProcessingProducerPipeline`)
 * to obtain a real `bulkSyncAnnotations` dispatcher.
 *
 * `source` and `sync` are FACTORIES, not values: constructing the real `sync`
 * registers an Eventing pipeline, which needs Redis, and a missing
 * `REDIS_URL` must fail only this task at run time — not every task at
 * catalogue construction, the same reason `stalled-runs-backfill` defers.
 */
export class AnnotationClickHouseBackfillTask extends Task {
  readonly name = "annotation-clickhouse-backfill";
  readonly description =
    "Syncs every annotation from Postgres to ClickHouse through bulkSyncAnnotations.";

  private constructor(
    private readonly source: () => AnnotationBackfillSourcePort,
    private readonly sync: () => TraceAnnotationSyncPort,
  ) {
    super();
  }

  static create({
    source,
    sync,
  }: {
    source: () => AnnotationBackfillSourcePort;
    sync: () => TraceAnnotationSyncPort;
  }): AnnotationClickHouseBackfillTask {
    return new AnnotationClickHouseBackfillTask(source, sync);
  }

  async run(_input: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    const sweep = AnnotationBackfillSweep.create({ source: this.source(), sync: this.sync() });
    await sweep.execute();
  }
}
