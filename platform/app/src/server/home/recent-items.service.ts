import { RecentItemsRepository } from "./recent-items.repository";
import {
  ACTION_TO_TYPE_MAP,
  ENTITY_ID_EXTRACTORS,
  type GetRecentItemsParams,
  type RecentItem,
  type RecentItemType,
} from "./types";

/**
 * Service for recent items functionality
 * Handles business logic for retrieving and hydrating recent user activity
 */
export class RecentItemsService {
  private repository: RecentItemsRepository;

  constructor() {
    this.repository = new RecentItemsRepository();
  }

  /**
   * Get recent items the user has interacted with
   */
  async getRecentItems(params: GetRecentItemsParams): Promise<RecentItem[]> {
    const auditLogs = await this.repository.getRecentAuditLogEntries(params);

    // Process audit logs to extract unique entity references
    const entityMap = new Map<
      string,
      { type: RecentItemType; id: string; timestamp: Date }
    >();

    for (const log of auditLogs) {
      const type = this.getTypeFromAction(log.action);
      if (!type) continue;

      const extractor = ENTITY_ID_EXTRACTORS[type];
      const entityId = extractor(log.args as Record<string, unknown>);
      if (!entityId) continue;

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
    switch (type) {
      case "prompt": {
        const prompt = await this.repository.getPromptById(id, projectId);
        if (!prompt || prompt.deletedAt) return null;
        return {
          id: prompt.id,
          type: "prompt",
          name: prompt.name,
          href: `/${prompt.project.slug}/prompts?prompt=${prompt.id}`,
          updatedAt: timestamp,
        };
      }
      case "workflow": {
        const workflow = await this.repository.getWorkflowById(id, projectId);
        if (!workflow || workflow.archivedAt) return null;
        return {
          id: workflow.id,
          type: "workflow",
          name: workflow.name,
          href: `/${workflow.project.slug}/studio/${workflow.id}`,
          updatedAt: timestamp,
        };
      }
      case "dataset": {
        const dataset = await this.repository.getDatasetById(id, projectId);
        if (!dataset || dataset.archivedAt) return null;
        return {
          id: dataset.id,
          type: "dataset",
          name: dataset.name,
          href: `/${dataset.project.slug}/datasets/${dataset.id}`,
          updatedAt: timestamp,
        };
      }
      case "evaluation": {
        const monitor = await this.repository.getMonitorById(id, projectId);
        if (!monitor) return null;
        return {
          id: monitor.id,
          type: "evaluation",
          name: monitor.name,
          href: `/${monitor.project.slug}/evaluations`,
          updatedAt: timestamp,
        };
      }
      case "annotation": {
        const queue = await this.repository.getAnnotationQueueById(
          id,
          projectId,
        );
        if (!queue) return null;
        return {
          id: queue.id,
          type: "annotation",
          name: queue.name,
          href: `/${queue.project.slug}/annotations/${queue.slug}`,
          updatedAt: timestamp,
        };
      }
      case "simulation": {
        // Simulations are stored in ClickHouse, not Prisma
        // For now, we don't hydrate them but return a placeholder
        return null; // TODO: Implement when scenario set details are needed
      }
      default:
        return null;
    }
  }
}
