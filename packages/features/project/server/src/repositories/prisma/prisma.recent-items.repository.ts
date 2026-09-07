import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { fromDate } from "@langwatch/time";
import type { GetRecentItemsParams } from "../../rules/recent-items.rules.ts";
import { ACTION_TO_TYPE_MAP } from "../../rules/recent-items.rules.ts";
import {
  RecentItemsRepository,
  type AuditLog,
  type RecentArchivableRow,
  type RecentPromptRow,
  type RecentSluggedRow,
} from "../recent-items.repository.ts";

/**
 * The audit-trail reads behind the home screen's recent strip, and the five entity lookups that
 * hydrate what it finds there.
 */
export class PrismaRecentItemsRepository extends RecentItemsRepository {
  private constructor(private readonly prisma: PrismaClient) {
    super();
  }

  static create(options: { prisma: PrismaClient }): PrismaRecentItemsRepository {
    return new PrismaRecentItemsRepository(options.prisma);
  }

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

    return entries.map((entry) => ({ ...entry, createdAt: fromDate(entry.createdAt) }));
  }

  /**
   * Get prompt by ID and projectId (required for multi-tenancy)
   */
  async tryGetPromptById(id: string, projectId: string): Promise<RecentPromptRow | null> {
    const row = await this.prisma.llmPromptConfig.findFirst({
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
    if (row === null) return null;

    return {
      ...row,
      updatedAt: fromDate(row.updatedAt),
      deletedAt: row.deletedAt === null ? null : fromDate(row.deletedAt),
    };
  }

  /**
   * Get workflow by ID and projectId (required for multi-tenancy)
   */
  async tryGetWorkflowById(id: string, projectId: string): Promise<RecentArchivableRow | null> {
    const row = await this.prisma.workflow.findFirst({
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
    if (row === null) return null;

    return {
      ...row,
      updatedAt: fromDate(row.updatedAt),
      archivedAt: row.archivedAt === null ? null : fromDate(row.archivedAt),
    };
  }

  /**
   * Get dataset by ID and projectId (required for multi-tenancy)
   */
  async tryGetDatasetById(id: string, projectId: string): Promise<RecentArchivableRow | null> {
    const row = await this.prisma.dataset.findFirst({
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
    if (row === null) return null;

    return {
      ...row,
      updatedAt: fromDate(row.updatedAt),
      archivedAt: row.archivedAt === null ? null : fromDate(row.archivedAt),
    };
  }

  /**
   * Get monitor (evaluation) by ID and projectId (required for multi-tenancy)
   */
  async tryGetMonitorById(id: string, projectId: string): Promise<RecentSluggedRow | null> {
    const row = await this.prisma.monitor.findFirst({
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
    if (row === null) return null;

    return { ...row, updatedAt: fromDate(row.updatedAt) };
  }

  /**
   * Get annotation queue by ID and projectId (required for multi-tenancy)
   */
  async tryGetAnnotationQueueById(id: string, projectId: string): Promise<RecentSluggedRow | null> {
    const row = await this.prisma.annotationQueue.findFirst({
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
    if (row === null) return null;

    return { ...row, updatedAt: fromDate(row.updatedAt) };
  }
}
