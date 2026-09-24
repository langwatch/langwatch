import { PrismaProcessStore } from "@langwatch/eventing/server";

import type { TopicRepositories } from "../topic.repositories.ts";
import {
  PrismaTopicClusteringRunHistoryProjectionRepository,
  type RunHistoryPrismaClient,
} from "./prisma.topic-clustering-run-history-projection.repository.ts";
import {
  PrismaTopicClusteringRunProjectionRepository,
  type RunProjectionPrismaClient,
} from "./prisma.topic-clustering-run-projection.repository.ts";
import {
  PrismaTopicClusteringRepository,
  type TopicClusteringDatabase,
} from "./prisma.topic-clustering.repository.ts";
import { PrismaTopicModelProjectionRepository } from "./prisma.topic-model-projection.repository.ts";
import { PrismaTopicRepository } from "./prisma.topic.repository.ts";

type TopicRepositoriesDatabase = TopicClusteringDatabase &
  RunProjectionPrismaClient &
  RunHistoryPrismaClient;

/**
 * The live tier. Both rows live in the process's Prisma connection, and
 * the tier names the delegates it reads rather than the whole client, so the
 * worker's narrowed database satisfies it as the api's full client does.
 */
export class PostgresTopicRepositories {
  static readonly requires = ["prisma"] as const;

  static create(members: Readonly<{ prisma: TopicRepositoriesDatabase }>): TopicRepositories {
    return {
      topics: PrismaTopicRepository.create({ prisma: members.prisma }),
      clustering: PrismaTopicClusteringRepository.create({ database: members.prisma }),
      processStore: PrismaProcessStore.create({ database: members.prisma }),
      runStatus: PrismaTopicClusteringRunProjectionRepository.create({ database: members.prisma }),
      runHistory: PrismaTopicClusteringRunHistoryProjectionRepository.create({
        database: members.prisma,
      }),
      topicModel: PrismaTopicModelProjectionRepository.create({ database: members.prisma }),
    };
  }
}
