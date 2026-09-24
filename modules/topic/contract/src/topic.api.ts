import { moduleApi } from "@langwatch/kernel/module-api";

import type {
  Topic,
  TopicClusteringRequestInput,
  TopicClusteringRunHistoryEntry,
  TopicClusteringStatus,
  TopicNamesInput,
  TopicProjectInput,
} from "./topic.ts";

/** The project's conversation topics, and what the last clustering run did. */
export interface TopicApi {
  getAll(input: TopicProjectInput): Promise<Topic[]>;
  getNamesByIds(input: TopicNamesInput): Promise<Map<string, string>>;
  getClusteringStatus(input: TopicProjectInput): Promise<TopicClusteringStatus>;
  getClusteringRunHistory(input: TopicProjectInput): Promise<TopicClusteringRunHistoryEntry[]>;
  /** Asks the project's clustering process for a run; ports main's `requestClustering`. */
  requestClustering(input: TopicClusteringRequestInput): Promise<void>;
  /** Re-asserts the project's clustering schedule, at most once per project per hour. */
  bootstrapClustering(input: TopicProjectInput): Promise<void>;
}

export const TopicApi = moduleApi<TopicApi>()("topic");
