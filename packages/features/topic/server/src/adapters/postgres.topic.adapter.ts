import type { StateProjectionStore } from "@langwatch/eventing";
import type { TopicService as TopicServiceContract } from "@langwatch/topic-contract";
import type { TopicClusteringRunHistoryData } from "../projections/topic-clustering-run-history.projection";
import type { TopicClusteringRunStatusData } from "../projections/topic-clustering-run-status.projection";
import type { TopicModelData } from "../projections/topic-model.projection";
import {
  PrismaTopicClusteringRepository,
  type TopicClusteringDatabase,
} from "../repositories/prisma/prisma.topic-clustering.repository";
import { PrismaTopicClusteringRunHistoryProjectionRepository } from "../repositories/prisma/prisma.topic-clustering-run-history-projection.repository";
import { PrismaTopicClusteringRunProjectionRepository } from "../repositories/prisma/prisma.topic-clustering-run-projection.repository";
import { PrismaTopicModelProjectionRepository } from "../repositories/prisma/prisma.topic-model-projection.repository";
import { PrismaTopicRepository } from "../repositories/prisma/prisma.topic.repository";
import type { TopicClusteringRepository } from "../repositories/topic-clustering.repository";
import { TopicService } from "../services/topic.service";
import type { TopicClusteringSchedulePort } from "../ports/topic-clustering-schedule.port";

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
