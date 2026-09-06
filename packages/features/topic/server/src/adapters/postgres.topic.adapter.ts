import type { StateProjectionStore } from "@langwatch/eventing";
import type { TopicService as TopicServiceContract } from "@langwatch/topic-contract";
import type { TopicClusteringRunHistoryData } from "../projections/topic-clustering-run-history.projection.ts";
import type { TopicClusteringRunStatusData } from "../projections/topic-clustering-run-status.projection.ts";
import type { TopicModelData } from "../projections/topic-model.projection.ts";
import {
  PrismaTopicClusteringRepository,
  type TopicClusteringDatabase,
} from "../repositories/prisma/prisma.topic-clustering.repository.ts";
import { PrismaTopicClusteringRunHistoryProjectionRepository } from "../repositories/prisma/prisma.topic-clustering-run-history-projection.repository.ts";
import { PrismaTopicClusteringRunProjectionRepository } from "../repositories/prisma/prisma.topic-clustering-run-projection.repository.ts";
import { PrismaTopicModelProjectionRepository } from "../repositories/prisma/prisma.topic-model-projection.repository.ts";
import { PrismaTopicRepository } from "../repositories/prisma/prisma.topic.repository.ts";
import type { TopicClusteringRepository } from "../repositories/topic-clustering.repository.ts";
import { TopicService } from "../services/topic.service.ts";
import type { TopicClusteringSchedulePort } from "../ports/topic-clustering-schedule.port.ts";

/** The clustering pipeline's Postgres persistence, keyed as the registry expects it. */
export interface TopicClusteringPersistence {
  topicClusteringRunStatus: StateProjectionStore<TopicClusteringRunStatusData>;
  topicClusteringRunHistory: StateProjectionStore<TopicClusteringRunHistoryData>;
  topicModel: StateProjectionStore<TopicModelData>;
  /** The runner's and boot migration's private repository. */
  repository: TopicClusteringRepository;
}

export class PostgresTopicAdapter {
  static create(options: {
    database: TopicClusteringDatabase;
    schedule: TopicClusteringSchedulePort;
    now?: () => number;
  }): TopicServiceContract {
    return TopicService.create({
      repository: PrismaTopicRepository.create(options.database),
      schedule: options.schedule,
      now: options.now,
    });
  }

  /**
   * Builds the clustering pipeline's private Prisma persistence once for the
   * composition root: the three projection stores plus the runner/migration
   * repository. The concrete classes stay private to the feature server.
   */
  static createClusteringPersistence(options: {
    database: TopicClusteringDatabase;
  }): TopicClusteringPersistence {
    return {
      topicClusteringRunStatus: PrismaTopicClusteringRunProjectionRepository.create(options),
      topicClusteringRunHistory:
        PrismaTopicClusteringRunHistoryProjectionRepository.create(options),
      topicModel: PrismaTopicModelProjectionRepository.create(options),
      repository: PrismaTopicClusteringRepository.create(options),
    };
  }
}
