import type { TopicRepositories } from "../topic.repositories.ts";
import {
  PrismaTopicClusteringRepository,
  type TopicClusteringDatabase,
} from "./prisma.topic-clustering.repository.ts";
import { PrismaTopicRepository } from "./prisma.topic.repository.ts";

/**
 * The live tier. Both rows live in the process's Prisma connection, and
 * the tier names the delegates it reads rather than the whole client, so the
 * worker's narrowed database satisfies it as the api's full client does.
 */
export class PostgresTopicRepositories {
  static readonly requires = ["prisma"] as const;

  static create(infrastructure: Readonly<{ prisma: TopicClusteringDatabase }>): TopicRepositories {
    return {
      topics: PrismaTopicRepository.create({ prisma: infrastructure.prisma }),
      clustering: PrismaTopicClusteringRepository.create({ database: infrastructure.prisma }),
    };
  }
}
