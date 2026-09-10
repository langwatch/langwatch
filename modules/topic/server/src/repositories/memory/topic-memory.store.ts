import type {
  Topic,
  TopicClusteringRunHistoryEntry,
} from "@langwatch/topic-contract";
import type { TopicClusteringStatusRecord } from "../topic.repository.ts";
import type {
  TopicClusteringModelRow,
  TopicClusteringSeedTopicRow,
  TopicClusteringTopicIndexRow,
} from "../topic-clustering.repository.ts";

/** One project's read rows, as the Prisma repository would read them back. */
export type MemoryTopicProject = Readonly<{
  topics: readonly Topic[];
  clusteringStatus: TopicClusteringStatusRecord["projection"];
  clusteringRunHistory: readonly TopicClusteringRunHistoryEntry[];
}>;

/** One recorded clustering cost row, as the ledger keeps it. */
export type MemoryClusteringCost = Readonly<{
  projectId: string;
  amount: number;
  currency: "USD" | "EUR";
  tracesCount: number;
  topicsCount: number;
  subtopicsCount: number;
  isIncremental: boolean;
}>;

/** One project's clustering rows: the model the runner pages against. */
export type MemoryClusteringProject = {
  exists: boolean;
  eligible: boolean;
  scheduled: boolean;
  topicModelCursorId: string | null;
  topicIndex: TopicClusteringTopicIndexRow[];
  modelTopics: TopicClusteringModelRow[];
  modelSubtopics: TopicClusteringModelRow[];
  seedTopics: TopicClusteringSeedTopicRow[];
};

/** The clustering defaults for a project nothing has been seeded for. */
export function emptyClusteringProject(): MemoryClusteringProject {
  return {
    exists: true,
    eligible: false,
    scheduled: false,
    topicModelCursorId: null,
    topicIndex: [],
    modelTopics: [],
    modelSubtopics: [],
    seedTopics: [],
  };
}

/**
 * The one store behind every memory-tier topic row, the way one Postgres
 * connection serves them: a cost recorded through the clustering repository is
 * the cost the same store answers with, and a project seeded once is the
 * project both repositories read.
 */
export class TopicMemoryStore {
  static create(projects: Map<string, MemoryTopicProject> = new Map()): TopicMemoryStore {
    return new TopicMemoryStore(projects);
  }

  readonly clustering = new Map<string, MemoryClusteringProject>();
  readonly costs: MemoryClusteringCost[] = [];

  private constructor(readonly projects: Map<string, MemoryTopicProject>) {}

  /** The project's clustering rows, created empty on first touch. */
  clusteringProject(projectId: string): MemoryClusteringProject {
    const existing = this.clustering.get(projectId);
    if (existing) return existing;

    const created = emptyClusteringProject();
    this.clustering.set(projectId, created);
    return created;
  }
}
