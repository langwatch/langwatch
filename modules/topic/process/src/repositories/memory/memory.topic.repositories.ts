import { InMemoryProcessStore } from "@langwatch/eventing";

import type { TopicRepositories } from "../topic.repositories.ts";
import { MemoryTopicClusteringClaimRepository } from "./memory.topic-clustering-claim.repository.ts";
import { MemoryTopicClusteringRunHistoryProjectionRepository } from "./memory.topic-clustering-run-history-projection.repository.ts";
import { MemoryTopicClusteringRunProjectionRepository } from "./memory.topic-clustering-run-projection.repository.ts";
import { MemoryTopicClusteringRepository } from "./memory.topic-clustering.repository.ts";
import { MemoryTopicModelProjectionRepository } from "./memory.topic-model-projection.repository.ts";
import { MemoryTopicRepository } from "./memory.topic.repository.ts";
import { TopicMemoryStore } from "./topic-memory.store.ts";

/** The "memory" tier: every topic row the app is tested without a datastore. */
export class MemoryTopicRepositories {
  static readonly requires = [] as const;

  static create(): TopicRepositories {
    // One store behind both rows, the way one Postgres connection serves
    // them: a project seeded for clustering is the project the read surface
    // answers about, and a recorded cost is read back from the same ledger.
    const store = TopicMemoryStore.create();

    return {
      topics: MemoryTopicRepository.create(store),
      clustering: MemoryTopicClusteringRepository.create(store),
      processStore: InMemoryProcessStore.createForLocalDevelopment(),
      runStatus: MemoryTopicClusteringRunProjectionRepository.create(),
      runHistory: MemoryTopicClusteringRunHistoryProjectionRepository.create(),
      topicModel: MemoryTopicModelProjectionRepository.create(),
      claims: MemoryTopicClusteringClaimRepository.create(),
    };
  }
}
