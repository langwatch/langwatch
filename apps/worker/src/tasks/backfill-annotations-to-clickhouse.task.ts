import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:tasks:backfill-annotations-to-clickhouse");

/** One annotation, as the backfill needs to read it. */
export type BackfillableAnnotation = Readonly<{ id: string; traceId: string }>;

/**
 * Where the annotations of record are read from.
 *
 * Annotations are listed one project at a time because the multitenancy guard
 * rejects any Annotation query that does not name its project — so the
 * project list is part of this port rather than something the caller is
 * trusted to remember.
 */
export abstract class AnnotationBackfillSourcePort {
  abstract listProjectIds(): Promise<readonly string[]>;
  abstract listAnnotations(input: { projectId: string }): Promise<readonly BackfillableAnnotation[]>;
}

/** The one write the backfill makes, as the Trace aggregate's own command. */
export abstract class TraceAnnotationSyncPort {
  abstract bulkSyncAnnotations(input: {
    tenantId: string;
    traceId: string;
    annotationIds: readonly string[];
    occurredAt: number;
  }): Promise<void>;
}

export type AnnotationBackfillTotals = { traces: number; annotations: number; projects: number };

/**
 * Reconciliation task that syncs all annotations from the database to
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
export class AnnotationClickHouseBackfillTask {
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
  }): AnnotationClickHouseBackfillTask {
    return new AnnotationClickHouseBackfillTask(source, sync, now);
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
