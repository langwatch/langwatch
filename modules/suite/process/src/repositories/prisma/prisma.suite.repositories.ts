import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { Cluster, Redis } from "ioredis";

import { RedisSuiteRunProcessingRepository } from "../redis/redis.suite-run-processing.repository.ts";
import type { SuiteRepositories } from "../suite.repositories.ts";
import { PrismaSuiteRepository } from "./prisma.suite.repository.ts";

/** The live backend: Postgres for the suites, ClickHouse and Redis for the run fold. */
export const PostgresSuiteRepositories = {
  requires: ["prisma", "clickhouse", "redis"] as const,

  create({
    prisma,
    clickhouse,
    redis,
  }: Readonly<{
    prisma: PrismaClient;
    clickhouse: ClickHouseQueryClient;
    redis: Redis | Cluster;
  }>): SuiteRepositories {
    return {
      suites: PrismaSuiteRepository.create(prisma),
      runProcessing: RedisSuiteRunProcessingRepository.create({ clickhouse, redis }),
    };
  },
};
