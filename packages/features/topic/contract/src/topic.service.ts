import type {
  Topic,
  TopicClusteringRunHistoryEntry,
  TopicClusteringStatus,
  TopicNamesInput,
  TopicProjectInput,
} from "./topic";

export abstract class TopicService {
  abstract getAll(input: TopicProjectInput): Promise<Topic[]>;
  abstract getNamesByIds(input: TopicNamesInput): Promise<Map<string, string>>;
  abstract getClusteringStatus(
    input: TopicProjectInput,
  ): Promise<TopicClusteringStatus>;
  abstract getClusteringRunHistory(
    input: TopicProjectInput,
  ): Promise<TopicClusteringRunHistoryEntry[]>;
}
