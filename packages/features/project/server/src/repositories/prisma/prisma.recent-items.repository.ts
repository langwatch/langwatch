import type { AuditLog, PrismaClient } from "@langwatch/prisma-client/generated";
import type { GetRecentItemsParams } from "../../services/recent-items.types";
import { ACTION_TO_TYPE_MAP } from "../../services/recent-items.types";

/** The columns the strip needs to render one row and link it. */
type RecentEntityRow = {
  id: string;
  name: string;
  updatedAt: Date;
  projectId: string;
  project: { slug: string };
};

/** A prompt is hidden once it is soft-deleted rather than removed. */
export type RecentPromptRow = RecentEntityRow & { deletedAt: Date | null };

/** Workflows and datasets are hidden once archived. */
export type RecentArchivableRow = RecentEntityRow & { archivedAt: Date | null };

/** Monitors and annotation queues are addressed by slug, not id. */
export type RecentSluggedRow = RecentEntityRow & { slug: string };

/**
 * The audit-trail reads behind the home screen's recent strip, and the five
 * entity lookups that hydrate what it finds there.
 *
 * The client is INJECTED rather than imported: the repository moved out of the
 * web application with the service above it, and the connection it runs on
 * belongs to whichever process composed one.
 *
 * Every entity lookup is a `try*`: the strip reads an audit trail, so it names
 * rows that may since have been deleted, and absence is the ordinary answer
 * rather than a failure.
 */
export class PrismaRecentItemsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Get recent audit log entries for a user and project
   * Filters to only relevant entity-related actions
   */
  async getRecentAuditLogEntries({
    userId,
    projectId,
    limit,
  }: GetRecentItemsParams): Promise<AuditLog[]> {
    const actionPrefixes = Object.keys(ACTION_TO_TYPE_MAP);

    // Build OR conditions for action prefixes
    const actionConditions = actionPrefixes.map((prefix) => ({
      action: { startsWith: prefix },
    }));

    const entries = await this.prisma.auditLog.findMany({
      where: {
        userId,
        projectId,
        OR: actionConditions,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: limit * 3, // Get more to account for deduplication and deleted entities
    });

    return entries;
  }

  /**
   * Get prompt by ID and projectId (required for multi-tenancy)
   */
  async tryGetPromptById(id: string, projectId: string): Promise<RecentPromptRow | null> {
    return this.prisma.llmPromptConfig.findFirst({
      where: { id, projectId },
      select: {
        id: true,
        name: true,
        deletedAt: true,
        updatedAt: true,
        projectId: true,
        project: {
          select: { slug: true },
        },
      },
    });
  }

  /**
   * Get workflow by ID and projectId (required for multi-tenancy)
   */
  async tryGetWorkflowById(id: string, projectId: string): Promise<RecentArchivableRow | null> {
    return this.prisma.workflow.findFirst({
      where: { id, projectId },
      select: {
        id: true,
        name: true,
        archivedAt: true,
        updatedAt: true,
        projectId: true,
        project: {
          select: { slug: true },
        },
      },
    });
  }

  /**
   * Get dataset by ID and projectId (required for multi-tenancy)
   */
  async tryGetDatasetById(id: string, projectId: string): Promise<RecentArchivableRow | null> {
    return this.prisma.dataset.findFirst({
      where: { id, projectId },
      select: {
        id: true,
        name: true,
        archivedAt: true,
        updatedAt: true,
        projectId: true,
        project: {
          select: { slug: true },
        },
      },
    });
  }

  /**
   * Get monitor (evaluation) by ID and projectId (required for multi-tenancy)
   */
  async tryGetMonitorById(id: string, projectId: string): Promise<RecentSluggedRow | null> {
    return this.prisma.monitor.findFirst({
      where: { id, projectId },
      select: {
        id: true,
        name: true,
        slug: true,
        updatedAt: true,
        projectId: true,
        project: {
          select: { slug: true },
        },
      },
    });
  }

  /**
   * Get annotation queue by ID and projectId (required for multi-tenancy)
   */
  async tryGetAnnotationQueueById(
    id: string,
    projectId: string,
  ): Promise<RecentSluggedRow | null> {
    return this.prisma.annotationQueue.findFirst({
      where: { id, projectId },
      select: {
        id: true,
        name: true,
        slug: true,
        updatedAt: true,
        projectId: true,
        project: {
          select: { slug: true },
        },
      },
    });
  }
}
