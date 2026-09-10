import {
  TopicClusteringRepository,
  type TopicClusteringModelRow,
  type TopicClusteringSeedTopicRow,
  type TopicClusteringTopicIndexRow,
} from "../topic-clustering.repository.ts";
import type { MemoryClusteringProject, TopicMemoryStore } from "./topic-memory.store.ts";

/**
 * The Prisma clustering repository's observable behaviour over the shared
 * store: the same keyset paging, the same "unknown project answers nothing",
 * and a cost ledger that reads back what was recorded.
 */
export class MemoryTopicClusteringRepository extends TopicClusteringRepository {
  static create(store: TopicMemoryStore): MemoryTopicClusteringRepository {
    return new MemoryTopicClusteringRepository(store);
  }

  private constructor(private readonly store: TopicMemoryStore) {
    super();
  }

  findProject(projectId: string): Promise<{ id: string } | null> {
    const project = this.store.clustering.get(projectId);
    return Promise.resolve(project?.exists ? { id: projectId } : null);
  }

  findTopicIndexRows(projectId: string): Promise<TopicClusteringTopicIndexRow[]> {
    return Promise.resolve([...(this.store.clustering.get(projectId)?.topicIndex ?? [])]);
  }

  findModelTopics(projectId: string): Promise<TopicClusteringModelRow[]> {
    return Promise.resolve([...(this.store.clustering.get(projectId)?.modelTopics ?? [])]);
  }

  findModelSubtopics(projectId: string): Promise<TopicClusteringModelRow[]> {
    return Promise.resolve([...(this.store.clustering.get(projectId)?.modelSubtopics ?? [])]);
  }

  recordClusteringCost(params: {
    projectId: string;
    amount: number;
    currency: "USD" | "EUR";
    tracesCount: number;
    topicsCount: number;
    subtopicsCount: number;
    isIncremental: boolean;
  }): Promise<void> {
    this.store.costs.push({ ...params });
    return Promise.resolve();
  }

  findTopicModelCursor(projectId: string): Promise<{ id: string } | null> {
    const cursorId = this.store.clustering.get(projectId)?.topicModelCursorId ?? null;
    return Promise.resolve(cursorId === null ? null : { id: cursorId });
  }

  findSeedTopicRows(projectId: string): Promise<TopicClusteringSeedTopicRow[]> {
    return Promise.resolve([...(this.store.clustering.get(projectId)?.seedTopics ?? [])]);
  }

  findProjectsWithTopicsPage(params: {
    afterId: string | null;
    take: number;
  }): Promise<{ id: string }[]> {
    return Promise.resolve(
      this.page(params, (project) => project.topicIndex.length > 0 || project.seedTopics.length > 0),
    );
  }

  findEligibleProjectsPage(params: {
    afterId: string | null;
    take: number;
  }): Promise<{ id: string }[]> {
    return Promise.resolve(this.page(params, (project) => project.eligible));
  }

  findOwnedTopicModelProjectIds(projectIds: string[]): Promise<string[]> {
    return Promise.resolve(
      projectIds.filter((id) => this.store.clustering.get(id)?.topicModelCursorId != null),
    );
  }

  findAlreadyScheduledProjectIds(projectIds: string[]): Promise<string[]> {
    return Promise.resolve(
      projectIds.filter((id) => this.store.clustering.get(id)?.scheduled === true),
    );
  }

  /** Keyset paging, ascending by id and strictly after the cursor. */
  private page(
    params: { afterId: string | null; take: number },
    matches: (project: MemoryClusteringProject) => boolean,
  ): { id: string }[] {
    return [...this.store.clustering.entries()]
      .filter(([id, project]) => matches(project) && (params.afterId === null || id > params.afterId))
      .map(([id]) => id)
      .sort()
      .slice(0, params.take)
      .map((id) => ({ id }));
  }
}
