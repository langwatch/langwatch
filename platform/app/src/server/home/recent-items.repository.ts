import { prisma } from "../db";
import type { GetRecentItemsParams } from "./types";
import { ACTION_TO_TYPE_MAP } from "./types";

/**
 * Repository for recent items database operations
 */
export class RecentItemsRepository {
  /**
   * Get recent audit log entries for a user and project
   * Filters to only relevant entity-related actions
   */
  async getRecentAuditLogEntries({
    userId,
    projectId,
    limit,
  }: GetRecentItemsParams) {
    const actionPrefixes = Object.keys(ACTION_TO_TYPE_MAP);

    // Build OR conditions for action prefixes
    const actionConditions = actionPrefixes.map((prefix) => ({
      action: { startsWith: prefix },
    }));

    const entries = await prisma.auditLog.findMany({
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
  async getPromptById(id: string, projectId: string) {
    return prisma.llmPromptConfig.findFirst({
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
  async getWorkflowById(id: string, projectId: string) {
    return prisma.workflow.findFirst({
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
  async getDatasetById(id: string, projectId: string) {
    return prisma.dataset.findFirst({
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
  async getMonitorById(id: string, projectId: string) {
    return prisma.monitor.findFirst({
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
  async getAnnotationQueueById(id: string, projectId: string) {
    return prisma.annotationQueue.findFirst({
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
