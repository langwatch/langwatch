/**
 * Records every annotation on its trace again, an organization page at a time, so has-annotation
 * search agrees with Postgres. Resumes after the last page saved; a failing trace is logged and
 * skipped, as main did. Spec: modules/annotation/specs/annotation-service.feature
 */
import type { AnnotationApi } from "@langwatch/annotation-contract";
import { createLogger } from "@langwatch/observability";
import { ORGANIZATION_ID_PAGE_LIMIT, type OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { nowInstant } from "@langwatch/time";
import type { TraceApi } from "@langwatch/trace-contract";

const logger = createLogger("langwatch:annotation:trace-backfill");

export type AnnotationTraceBackfillPeers = Readonly<{
  annotations: Pick<AnnotationApi, "list">;
  traces: Pick<TraceApi, "recordAnnotation">;
  projects: Pick<ProjectApi, "listIdsByOrganization">;
  organizations: Pick<OrganizationApi, "listAllIds">;
}>;

type Totals = { organizations: number; projects: number; traces: number; annotations: number };

export type AnnotationTraceBackfillReport = Totals & { afterOrganizationId: string | null };

export class AnnotationTraceBackfillService {
  private constructor(private readonly peers: AnnotationTraceBackfillPeers) {}

  static create({
    peers,
  }: {
    peers: AnnotationTraceBackfillPeers;
  }): AnnotationTraceBackfillService {
    return new AnnotationTraceBackfillService(peers);
  }

  /**
   * Each organization after `after`, a page at a time; `onPage` hears the last organization of
   * each completed page, never on a dry run. A dry run counts annotations and records none.
   */
  async backfill({
    after,
    dryRun,
    signal,
    onPage,
  }: {
    after: string | undefined;
    dryRun: boolean;
    signal: AbortSignal;
    onPage: (page: { afterOrganizationId: string }) => Promise<void>;
  }): Promise<AnnotationTraceBackfillReport> {
    const totals: Totals = { organizations: 0, projects: 0, traces: 0, annotations: 0 };
    let cursor = after;
    let hasMore = true;
    while (hasMore && !signal.aborted) {
      const page = await this.peers.organizations.listAllIds({
        after: cursor,
        limit: ORGANIZATION_ID_PAGE_LIMIT,
      });
      const completed = await this.backfillPage({ ids: page.ids, dryRun, signal, totals });
      const last = page.ids.at(-1);
      if (completed && last !== undefined) {
        cursor = last;
        if (!dryRun) await onPage({ afterOrganizationId: last });
      }
      hasMore = completed && page.next !== null;
    }
    logger.info({ dryRun, ...totals }, "annotation trace backfill finished");
    return { afterOrganizationId: cursor ?? null, ...totals };
  }

  /** One page's organizations; false when the signal stopped it part way. */
  private async backfillPage({
    ids,
    dryRun,
    signal,
    totals,
  }: {
    ids: readonly string[];
    dryRun: boolean;
    signal: AbortSignal;
    totals: Totals;
  }): Promise<boolean> {
    for (const organizationId of ids) {
      const projectIds = await this.peers.projects.listIdsByOrganization({ organizationId });
      for (const projectId of projectIds) {
        if (signal.aborted) return false;
        await this.backfillProject({ projectId, dryRun, totals });
        totals.projects += 1;
      }
      totals.organizations += 1;
    }
    return true;
  }

  private async backfillProject({
    projectId,
    dryRun,
    totals,
  }: {
    projectId: string;
    dryRun: boolean;
    totals: Totals;
  }): Promise<void> {
    const annotations = await this.peers.annotations.list({ projectId, anchor: "all" });
    totals.annotations += annotations.length;
    for (const [traceId, annotationIds] of groupIdsByTrace(annotations)) {
      if (dryRun || (await this.recordTrace({ projectId, traceId, annotationIds }))) {
        totals.traces += 1;
      }
    }
  }

  /** One trace's annotations; a failure is logged and the trace skipped. */
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
