import {
  topicClusteringRunHistoryEntrySchema,
  topicSchema,
  type Topic,
  type TopicClusteringRunHistoryEntry,
  type TopicNamesInput,
  type TopicProjectInput,
} from "@langwatch/topic-contract";
import type { TopicClusteringStatusRecord, TopicRepository } from "../topic.repository.ts";

/** One project's rows, as the Prisma repository would read them back. */
export type MemoryTopicProject = Readonly<{
  topics: readonly Topic[];
  clusteringStatus: TopicClusteringStatusRecord["projection"];
  clusteringRunHistory: readonly TopicClusteringRunHistoryEntry[];
}>;

/**
 * The Prisma repository's observable behaviour over a map: the same parse of
 * the same contract schemas, and the same empty answers for a project whose
 * projection rows have not been written yet.
 */
export class MemoryTopicRepository implements TopicRepository {
  static create(projects: Map<string, MemoryTopicProject> = new Map()): MemoryTopicRepository {
    return new MemoryTopicRepository(projects);
  }

  private constructor(private readonly projects: Map<string, MemoryTopicProject>) {}

  findAll(input: TopicProjectInput): Promise<Topic[]> {
    const topics = this.projects.get(input.projectId)?.topics ?? [];

    return Promise.resolve(topics.map((topic) => topicSchema.parse(topic)));
  }

  findNamesByIds(input: TopicNamesInput): Promise<Map<string, string>> {
    if (input.ids.length === 0) return Promise.resolve(new Map());

    const wanted = new Set(input.ids);
    const topics = this.projects.get(input.projectId)?.topics ?? [];

    return Promise.resolve(
      new Map(
        topics.filter((topic) => wanted.has(topic.id)).map((topic) => [topic.id, topic.name]),
      ),
    );
  }

  findClusteringStatus(input: TopicProjectInput): Promise<TopicClusteringStatusRecord> {
    return Promise.resolve({
      projection: this.projects.get(input.projectId)?.clusteringStatus ?? null,
    });
  }

  findClusteringRunHistory(input: TopicProjectInput): Promise<TopicClusteringRunHistoryEntry[]> {
    const runs = this.projects.get(input.projectId)?.clusteringRunHistory ?? [];

    return Promise.resolve(runs.map((run) => topicClusteringRunHistoryEntrySchema.parse(run)));
  }
}
