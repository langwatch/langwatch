import type { PrismaClient } from "@prisma/client";

export interface OrphanCleanupResult {
  model: string;
  count: number;
}

/**
 * Per-source `id` watermark for candidate pagination. Each referencing table
 * advances independently — a source that returns a short page is drained while
 * others keep paging. Cursoring by the immutable `id` PK is stable under the
 * deletes the sweep performs (we only delete rows at `id <= cursor`, so the
 * `id > cursor` window never shifts).
 */
export interface OrphanCandidateCursor {
  annotationId?: string;
  annotationQueueItemId?: string;
  publicShareId?: string;
  triggerSentId?: string;
  pinnedTraceId?: string;
}

export interface OrphanCandidatePage {
  traceIds: string[];
  /** Cursor for the next page, or null once every source is drained. */
  nextCursor: OrphanCandidateCursor | null;
}

export class OrphanSweepRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * One page of trace ids referenced by PG records, advancing past `cursor`.
   * Returns a `nextCursor` so callers can walk the whole project across pages
   * rather than re-scanning the same prefix every sweep (which would starve
   * any record beyond the first page when that page stays live).
   */
  async findCandidateTraceIds({
    projectId,
    limit = 1000,
    cursor,
  }: {
    projectId: string;
    limit?: number;
    cursor?: OrphanCandidateCursor;
  }): Promise<OrphanCandidatePage> {
    const after = (id: string | undefined) => (id ? { id: { gt: id } } : {});

    const [annotations, queueItems, publicShares, triggerSents, pinnedTraces] =
      await Promise.all([
        this.prisma.annotation.findMany({
          where: { projectId, ...after(cursor?.annotationId) },
          select: { id: true, traceId: true },
          orderBy: { id: "asc" },
          take: limit,
        }),
        this.prisma.annotationQueueItem.findMany({
          where: { projectId, ...after(cursor?.annotationQueueItemId) },
          select: { id: true, traceId: true },
          orderBy: { id: "asc" },
          take: limit,
        }),
        this.prisma.publicShare.findMany({
          where: {
            projectId,
            resourceType: "TRACE",
            ...after(cursor?.publicShareId),
          },
          select: { id: true, resourceId: true },
          orderBy: { id: "asc" },
          take: limit,
        }),
        this.prisma.triggerSent.findMany({
          where: {
            projectId,
            traceId: { not: null },
            ...after(cursor?.triggerSentId),
          },
          select: { id: true, traceId: true },
          orderBy: { id: "asc" },
          take: limit,
        }),
        this.prisma.pinnedTrace.findMany({
          where: { projectId, ...after(cursor?.pinnedTraceId) },
          select: { id: true, traceId: true },
          orderBy: { id: "asc" },
          take: limit,
        }),
      ]);

    const traceIds = new Set<string>();
    for (const row of annotations) traceIds.add(row.traceId);
    for (const row of queueItems) traceIds.add(row.traceId);
    for (const row of publicShares) traceIds.add(row.resourceId);
    for (const row of triggerSents) {
      if (row.traceId) traceIds.add(row.traceId);
    }
    for (const row of pinnedTraces) traceIds.add(row.traceId);

    // A full page means a source may have more rows; a short page drains it.
    // We keep paging until every source is drained.
    const hasMore =
      annotations.length === limit ||
      queueItems.length === limit ||
      publicShares.length === limit ||
      triggerSents.length === limit ||
      pinnedTraces.length === limit;

    const lastId = (rows: { id: string }[], previous: string | undefined) =>
      rows.length > 0 ? rows[rows.length - 1]!.id : previous;

    const nextCursor: OrphanCandidateCursor | null = hasMore
      ? {
          annotationId: lastId(annotations, cursor?.annotationId),
          annotationQueueItemId: lastId(
            queueItems,
            cursor?.annotationQueueItemId,
          ),
          publicShareId: lastId(publicShares, cursor?.publicShareId),
          triggerSentId: lastId(triggerSents, cursor?.triggerSentId),
          pinnedTraceId: lastId(pinnedTraces, cursor?.pinnedTraceId),
        }
      : null;

    return { traceIds: [...traceIds], nextCursor };
  }

  async deleteAnnotations({
    projectId,
    traceIds,
  }: {
    projectId: string;
    traceIds: string[];
  }): Promise<number> {
    const result = await this.prisma.annotation.deleteMany({
      where: { projectId, traceId: { in: traceIds } },
    });
    return result.count;
  }

  async deleteAnnotationQueueItems({
    projectId,
    traceIds,
  }: {
    projectId: string;
    traceIds: string[];
  }): Promise<number> {
    const result = await this.prisma.annotationQueueItem.deleteMany({
      where: { projectId, traceId: { in: traceIds } },
    });
    return result.count;
  }

  async deletePublicShares({
    projectId,
    traceIds,
  }: {
    projectId: string;
    traceIds: string[];
  }): Promise<number> {
    const result = await this.prisma.publicShare.deleteMany({
      where: {
        projectId,
        resourceType: "TRACE",
        resourceId: { in: traceIds },
      },
    });
    return result.count;
  }

  async nullifyTriggerSentTraceIds({
    projectId,
    traceIds,
  }: {
    projectId: string;
    traceIds: string[];
  }): Promise<number> {
    const result = await this.prisma.triggerSent.updateMany({
      where: { projectId, traceId: { in: traceIds } },
      data: { traceId: null },
    });
    return result.count;
  }

  async deletePinnedTraces({
    projectId,
    traceIds,
  }: {
    projectId: string;
    traceIds: string[];
  }): Promise<number> {
    const result = await this.prisma.pinnedTrace.deleteMany({
      where: { projectId, traceId: { in: traceIds } },
    });
    return result.count;
  }
}
