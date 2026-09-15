import {
  topicClusteringRunHistoryEntrySchema,
  topicSchema,
  type Topic,
  type TopicClusteringRunHistoryEntry,
  type TopicNamesInput,
  type TopicProjectInput,
} from "@langwatch/topic-contract";
import type { TopicClusteringStatusRecord, TopicRepository } from "../topic.repository.ts";
import type { TopicMemoryStore } from "./topic-memory.store.ts";

/**
 * The Prisma repository's observable behaviour over a map: the same parse of
 * the same contract schemas, and the same empty answers for a project whose
 * projection rows have not been written yet.
 */
export class MemoryTopicRepository implements TopicRepository {
  static create(store: TopicMemoryStore): MemoryTopicRepository {
    return new MemoryTopicRepository(store);
  }

  private constructor(private readonly store: TopicMemoryStore) {}

  findAll(input: TopicProjectInput): Promise<Topic[]> {
    const topics = this.store.projects.get(input.projectId)?.topics ?? [];

    return Promise.resolve(topics.map((topic) => topicSchema.parse(topic)));
  }

  findNamesByIds(input: TopicNamesInput): Promise<Map<string, string>> {
    if (input.ids.length === 0) return Promise.resolve(new Map());

    const wanted = new Set(input.ids);
    const topics = this.store.projects.get(input.projectId)?.topics ?? [];

    return Promise.resolve(
      new Map(
        topics.filter((topic) => wanted.has(topic.id)).map((topic) => [topic.id, topic.name]),
      ),
    );
  }

  findClusteringStatus(input: TopicProjectInput): Promise<TopicClusteringStatusRecord> {
    return Promise.resolve({
      projection: this.store.projects.get(input.projectId)?.clusteringStatus ?? null,
    });
  }

  findClusteringRunHistory(input: TopicProjectInput): Promise<TopicClusteringRunHistoryEntry[]> {
    const runs = this.store.projects.get(input.projectId)?.clusteringRunHistory ?? [];

    return Promise.resolve(runs.map((run) => topicClusteringRunHistoryEntrySchema.parse(run)));
  }
}
