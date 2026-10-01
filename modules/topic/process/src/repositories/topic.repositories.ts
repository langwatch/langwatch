import type { ProcessStore, StateProjectionStore } from "@langwatch/eventing";

import type { TopicClusteringRunHistoryData } from "../eventing/topic-clustering-run-history.projection.ts";
import type { TopicClusteringRunStatusData } from "../eventing/topic-clustering-run-status.projection.ts";
import type { TopicModelData } from "../eventing/topic-model.projection.ts";
import type { TopicClusteringClaimRepository } from "./topic-clustering-claim.repository.ts";
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
  /** The clustering wake's process-manager row, which the status panel reads. */
  readonly processStore: ProcessStore;
  /** The clustering pipeline's read models: the status panel, its audit trail, the topic model. */
  readonly runStatus: StateProjectionStore<TopicClusteringRunStatusData>;
  readonly runHistory: StateProjectionStore<TopicClusteringRunHistoryData>;
  readonly topicModel: StateProjectionStore<TopicModelData>;
  /** The bootstrap gate and the legacy seeds' claims, shared across replicas. */
  readonly claims: TopicClusteringClaimRepository;
}
