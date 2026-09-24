import type { AnnotationApi } from "@langwatch/annotation-contract";
import { createLogger } from "@langwatch/observability";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { Task } from "@langwatch/task";
import { nowInstant } from "@langwatch/time";
import type { TraceApi } from "@langwatch/trace-contract";

const logger = createLogger("langwatch:tasks:backfillAnnotationsToClickhouse");

type BackfillPeers = Readonly<{
  annotations: Pick<AnnotationApi, "list">;
  traces: Pick<TraceApi, "recordAnnotation">;
  projects: Pick<ProjectApi, "listIdsByOrganization">;
  organizations: Pick<OrganizationApi, "findAllIds">;
}>;

type BackfillTotals = { projects: number; traces: number; annotations: number };

/**
 * Port of main's backfillAnnotationsToClickhouse: every annotation is recorded on its trace again,
 * project by project and trace by trace, so has-annotation search agrees with Postgres.
 */
export class AnnotationTraceBackfillTask extends Task {
  readonly name = "backfill-annotations-to-clickhouse";
  readonly description = "Records every annotation on its trace again, so search agrees with them.";

  private constructor(private readonly peers: BackfillPeers) {
    super();
  }

  static create(peers: BackfillPeers): AnnotationTraceBackfillTask {
    return new AnnotationTraceBackfillTask(peers);
  }

  async run({ signal }: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    const totals: BackfillTotals = { projects: 0, traces: 0, annotations: 0 };
    for (const organizationId of await this.peers.organizations.findAllIds()) {
      const projectIds = await this.peers.projects.listIdsByOrganization({ organizationId });
      for (const projectId of projectIds) {
        signal.throwIfAborted();
        await this.backfillProject({ projectId, totals, signal });
        totals.projects += 1;
      }
    }
    logger.info(
      {
        totalTraces: totals.traces,
        totalProjects: totals.projects,
        totalAnnotations: totals.annotations,
      },
      "Finished backfilling all annotations to ClickHouse",
    );
  }

  private async backfillProject({
    projectId,
    totals,
    signal,
  }: {
    projectId: string;
    totals: BackfillTotals;
    signal: AbortSignal;
  }): Promise<void> {
    const annotations = await this.peers.annotations.list({ projectId, anchor: "all" });
    if (annotations.length === 0) return;
    totals.annotations += annotations.length;

    let projectTraces = 0;
    for (const [traceId, annotationIds] of groupIdsByTrace(annotations)) {
      signal.throwIfAborted();
      if (!(await this.recordTrace({ projectId, traceId, annotationIds }))) continue;
      projectTraces += 1;
      totals.traces += 1;
      if (totals.traces % 100 === 0) {
        logger.info({ totalTraces: totals.traces }, "Backfill progress");
      }
    }
    logger.info({ projectId, projectTraces }, "Finished backfilling project");
  }

  /** One trace's annotations; a failure is logged and the trace skipped, as main did. */
  private async recordTrace({
    projectId,
    traceId,
    annotationIds,
  }: {
    projectId: string;
    traceId: string;
    annotationIds: readonly string[];
  }): Promise<boolean> {
    try {
      for (const annotationId of annotationIds) {
        await this.peers.traces.recordAnnotation({
          tenantId: projectId,
          traceId,
          annotationId,
          occurredAt: nowInstant().epochMilliseconds,
        });
      }
      return true;
    } catch (error) {
      logger.error({ error, projectId, traceId }, "Failed to backfill annotations for trace");
      return false;
    }
  }
}

function groupIdsByTrace(
  annotations: readonly Readonly<{ id: string; traceId: string }>[],
): Map<string, string[]> {
  const idsByTrace = new Map<string, string[]>();
  for (const annotation of annotations) {
    const ids = idsByTrace.get(annotation.traceId) ?? [];
    ids.push(annotation.id);
    idsByTrace.set(annotation.traceId, ids);
  }
  return idsByTrace;
}
