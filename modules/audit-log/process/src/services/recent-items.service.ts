import type { AnnotationApi } from "@langwatch/annotation-contract";
import type { RecentItem } from "@langwatch/audit-log-contract";
import type { DatasetApi } from "@langwatch/dataset-contract";
import type { MonitorApi } from "@langwatch/monitor-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { PromptApi } from "@langwatch/prompt-contract";
import { toDate } from "@langwatch/time";
import type { WorkflowApi } from "@langwatch/workflow-contract";

import type { RecentTouchRepository } from "../repositories/recent-touch.repository.ts";
import {
  deriveRecentItemHref,
  deriveTouchFetchLimit,
  pickRecentEntities,
  RECENT_ACTION_PREFIXES,
  type RecentEntity,
} from "../rules/recent-items.rules.ts";

/** The owners' existing reads that name and link each touched entity. */
export type RecentItemsOwners = Readonly<{
  projects: Pick<ProjectApi, "findSummaryById" | "findOrganizationId">;
  prompts: Pick<PromptApi, "getExistingIds" | "getNamesByIds">;
  workflows: Pick<WorkflowApi, "getById">;
  datasets: Pick<DatasetApi, "getByIds">;
  monitors: Pick<MonitorApi, "getAllByIds">;
  annotations: Pick<AnnotationApi, "getQueue">;
}>;

type ProjectPlace = Readonly<{ projectId: string; projectSlug: string }>;
type NamedEntity = Readonly<{ id: string; name: string; queueSlug?: string }>;

export class RecentItemsService {
  readonly #touches: RecentTouchRepository;
  readonly #owners: RecentItemsOwners;

  private constructor({
    touches,
    owners,
  }: {
    touches: RecentTouchRepository;
    owners: RecentItemsOwners;
  }) {
    this.#touches = touches;
    this.#owners = owners;
  }

  static create(options: {
    touches: RecentTouchRepository;
    owners: RecentItemsOwners;
  }): RecentItemsService {
    return new RecentItemsService(options);
  }

  async getRecentItems(input: {
    userId: string;
    projectId: string;
    limit: number;
  }): Promise<RecentItem[]> {
    const touches = await this.#touches.findRecentTouches({
      userId: input.userId,
      projectId: input.projectId,
      actionPrefixes: RECENT_ACTION_PREFIXES,
      limit: deriveTouchFetchLimit(input.limit),
    });
    const entities = pickRecentEntities({ touches, limit: input.limit });
    if (entities.length === 0) return [];

    const project = await this.#owners.projects.findSummaryById(input.projectId);
    if (project === null) return [];

    const place = { projectId: input.projectId, projectSlug: project.slug };
    const items: RecentItem[] = [];
    for (const entity of entities) {
      const item = await this.#hydrate(entity, place);
      if (item !== undefined) items.push(item);
    }

    return items;
  }

  async #hydrate(entity: RecentEntity, place: ProjectPlace): Promise<RecentItem | undefined> {
    if (entity.type === "simulation") return undefined;

    const named = await this.#name(entity, place.projectId);
    if (named === undefined) return undefined;

    return {
      id: named.id,
      type: entity.type,
      name: named.name,
      href: deriveRecentItemHref({
        type: entity.type,
        projectSlug: place.projectSlug,
        id: named.id,
        queueSlug: named.queueSlug,
      }),
      updatedAt: toDate(entity.touchedAt),
    };
  }

  async #name(entity: RecentEntity, projectId: string): Promise<NamedEntity | undefined> {
    switch (entity.type) {
      case "prompt":
        return this.#livePrompt(entity.id, projectId);
      case "workflow":
        return this.#liveWorkflow(entity.id, projectId);
      case "dataset": {
        const [dataset] = await this.#owners.datasets.getByIds({
          projectId,
          datasetIds: [entity.id],
        });
        return dataset && !dataset.archivedAt ? dataset : undefined;
      }
      case "evaluation": {
        const [monitor] = await this.#owners.monitors.getAllByIds({
          monitorIds: [entity.id],
          projectId,
        });
        return monitor;
      }
      case "annotation":
        return this.#queue(entity.id, projectId);
      case "simulation":
        return undefined;
    }
  }

  async #livePrompt(id: string, projectId: string): Promise<NamedEntity | undefined> {
    const organizationId = await this.#owners.projects.findOrganizationId(projectId);
    if (organizationId === undefined) return undefined;

    const scope = { ids: [id], projectId, organizationId };
    const live = await this.#owners.prompts.getExistingIds(scope);
    if (!live.includes(id)) return undefined;

    const names = await this.#owners.prompts.getNamesByIds(scope);

    return names.find((prompt) => prompt.id === id);
  }

  async #liveWorkflow(id: string, projectId: string): Promise<NamedEntity | undefined> {
    try {
      const workflow = await this.#owners.workflows.getById({ id, projectId });
      return workflow.archivedAt ? undefined : workflow;
    } catch (error) {
      if (hasCode(error, "workflow_not_found")) return undefined;
      throw error;
    }
  }

  async #queue(queueId: string, projectId: string): Promise<NamedEntity | undefined> {
    try {
      const queue = await this.#owners.annotations.getQueue({ projectId, queueId });
      return { id: queue.id, name: queue.name, queueSlug: queue.slug };
    } catch (error) {
      if (hasCode(error, "annotation_queue_not_found")) return undefined;
      throw error;
    }
  }
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
