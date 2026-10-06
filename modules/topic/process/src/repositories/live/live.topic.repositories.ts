import type { RedisConnection } from "@langwatch/redis-client";

import {
  PostgresTopicRepositories,
  type TopicRepositoriesDatabase,
} from "../prisma/prisma.topic.repositories.ts";
import { RedisTopicClusteringClaimRepository } from "../redis/redis.topic-clustering-claim.repository.ts";
import type { TopicRepositories } from "../topic.repositories.ts";

/** Topic's live stores: its rows and read models in Prisma, clustering coordination in Redis. */
export class LiveTopicRepositories {
  static readonly requires = ["prisma", "redis"] as const;

  static create({
    prisma,
    redis,
  }: {
    prisma: TopicRepositoriesDatabase;
    redis: RedisConnection;
  }): TopicRepositories {
    return {
      ...PostgresTopicRepositories.create({ prisma }),
      claims: RedisTopicClusteringClaimRepository.create(redis),
    };
  }
}
