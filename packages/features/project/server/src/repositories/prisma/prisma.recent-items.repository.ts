import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { GetRecentItemsParams } from "../../services/recent-items.types";
import { ACTION_TO_TYPE_MAP } from "../../services/recent-items.types";

/**
 * The audit-trail reads behind the home screen's recent strip, and the five
 * entity lookups that hydrate what it finds there.
 *
 * The client is INJECTED rather than imported: the repository moved out of the
 * web application with the service above it, and the connection it runs on
 * belongs to whichever process composed one.
 */
export class PrismaRecentItemsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Get recent audit log entries for a user and project
   * Filters to only relevant entity-related actions
   */
  async getRecentAuditLogEntries({ userId, projectId, limit }: GetRecentItemsParams) {
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
  async getPromptById(id: string, projectId: string) {
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
  async getWorkflowById(id: string, projectId: string) {
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
  async getDatasetById(id: string, projectId: string) {
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
  async getMonitorById(id: string, projectId: string) {
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
  async getAnnotationQueueById(id: string, projectId: string) {
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
