import type { RecentItemsRepository } from "../repositories/recent-items.repository.ts";
import {
  ACTION_TO_TYPE_MAP,
  ENTITY_ID_EXTRACTORS,
  type GetRecentItemsParams,
  type RecentItem,
  type RecentItemType,
} from "../rules/recent-items.rules.ts";

/**
 * Service for recent items functionality
 * Handles business logic for retrieving and hydrating recent user activity
 */
export class RecentItemsService {
  private constructor(private readonly repository: RecentItemsRepository) {}

  static create(options: { repository: RecentItemsRepository }): RecentItemsService {
    return new RecentItemsService(options.repository);
  }

  /**
   * Get recent items the user has interacted with
   */
  async getRecentItems(params: GetRecentItemsParams): Promise<RecentItem[]> {
    const auditLogs = await this.repository.getRecentAuditLogEntries(params);

    // Process audit logs to extract unique entity references
    const entityMap = new Map<string, { type: RecentItemType; id: string; timestamp: Date }>();

    for (const log of auditLogs) {
      const type = this.getTypeFromAction(log.action);
      if (!type) {
        continue;
      }

      const extractor = ENTITY_ID_EXTRACTORS[type];
      const entityId = extractor(log.args as Record<string, unknown>);
      if (!entityId) {
        continue;
      }

      const key = `${type}:${entityId}`;

      // Only keep the most recent touch for each entity
      if (!entityMap.has(key)) {
        entityMap.set(key, {
          type,
          id: entityId,
          timestamp: log.createdAt,
        });
      }
    }

    // Hydrate entities with their details
    const recentItems: RecentItem[] = [];
    const entries = Array.from(entityMap.values()).slice(0, params.limit);

    for (const entry of entries) {
      const item = await this.hydrateEntity(
        entry.type,
        entry.id,
        entry.timestamp,
        params.projectId,
      );
      if (item) {
        recentItems.push(item);
      }
    }

    return recentItems;
  }

  /**
   * Get entity type from audit log action
   */
  private getTypeFromAction(action: string): RecentItemType | null {
    for (const [prefix, type] of Object.entries(ACTION_TO_TYPE_MAP)) {
      if (action.startsWith(prefix)) {
        return type;
      }
    }

    return null;
  }

  /**
   * Hydrate an entity with its details
   */
  private async hydrateEntity(
    type: RecentItemType,
    id: string,
    timestamp: Date,
    projectId: string,
  ): Promise<RecentItem | null> {
    const resolved = await this.tryResolveEntity(type, id, projectId);
    if (!resolved) {
      return null;
    }

    return {
      id: resolved.id,
      type,
      name: resolved.name,
      href: resolved.href,
      updatedAt: timestamp,
    };
  }

  private async tryResolveEntity(
    type: RecentItemType,
    id: string,
    projectId: string,
  ): Promise<{ id: string; name: string; href: string } | null> {
    switch (type) {
      case "prompt": {
        const prompt = await this.repository.tryGetPromptById(id, projectId);
        if (!prompt || prompt.deletedAt) {
          return null;
        }

        const href = `/${prompt.project.slug}/prompts?prompt=${prompt.id}`;

        return { id: prompt.id, name: prompt.name, href };
      }
      case "workflow": {
        const workflow = await this.repository.tryGetWorkflowById(id, projectId);
        if (!workflow || workflow.archivedAt) {
          return null;
        }

        const href = `/${workflow.project.slug}/studio/${workflow.id}`;

        return { id: workflow.id, name: workflow.name, href };
      }
      case "dataset": {
        const dataset = await this.repository.tryGetDatasetById(id, projectId);
        if (!dataset || dataset.archivedAt) {
          return null;
        }

        const href = `/${dataset.project.slug}/datasets/${dataset.id}`;

        return { id: dataset.id, name: dataset.name, href };
      }
      case "evaluation": {
        const monitor = await this.repository.tryGetMonitorById(id, projectId);
        if (!monitor) {
          return null;
        }

        const href = `/${monitor.project.slug}/online-evaluations`;

        return { id: monitor.id, name: monitor.name, href };
      }
      case "annotation": {
        const queue = await this.repository.tryGetAnnotationQueueById(id, projectId);
        if (!queue) {
          return null;
        }

        const href = `/${queue.project.slug}/annotations/${queue.slug}`;

        return { id: queue.id, name: queue.name, href };
      }
      default:
        return null;
    }
  }
}
