import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { SuiteServerConfig } from "@langwatch/suite-contract";
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
    config,
  }: Readonly<{
    prisma: PrismaClient;
    clickhouse: ClickHouseQueryClient;
    redis: Redis | Cluster;
    config: Pick<SuiteServerConfig, "foldCacheTtlSeconds">;
  }>): SuiteRepositories {
    return {
      suites: PrismaSuiteRepository.create(prisma),
      runProcessing: RedisSuiteRunProcessingRepository.create({
        clickhouse,
        redis,
        foldCacheTtlSeconds: config.foldCacheTtlSeconds,
      }),
    };
  },
};
