import type { TopicClusteringRepository } from "./topic-clustering.repository.ts";
import type { TopicRepository } from "./topic.repository.ts";

/**
 * The rows the topic module keeps outside its own event log, chosen once at
 * boot: the read surface the status panel and the trace grid page against, and
 * the clustering model the runner and the boot seeds read and cost against.
 */
export interface TopicRepositories {
  readonly topics: TopicRepository;
  readonly clustering: TopicClusteringRepository;
}
