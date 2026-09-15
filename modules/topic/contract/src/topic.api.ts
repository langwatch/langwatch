import { moduleApi } from "@langwatch/runtime-composition";
import type {
  Topic,
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
}

export const TopicApi = moduleApi<TopicApi>("topic");
