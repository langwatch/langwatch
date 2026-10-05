import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import type { RedisConnection } from "@langwatch/redis-client";

import { GatewayBudgetClickHouseRepository } from "../clickhouse/clickhouse.gateway-budget.repository.ts";
import {
  ClickHouseGatewayOpenAdmissionsSweepRepository,
  type GatewayClickHouseInstance,
} from "../clickhouse/clickhouse.gateway-open-admissions-sweep.repository.ts";
import { ClickHouseGatewayPrincipalSpendRepository } from "../clickhouse/clickhouse.gateway-principal-spend.repository.ts";
import {
  ClickHouseGatewaySession,
  type GatewayClickHouseResolver,
} from "../clickhouse/clickhouse.gateway-session.store.ts";
import { ClickHouseGatewaySpendEventsRepository } from "../clickhouse/clickhouse.gateway-spend-events.repository.ts";
import type { GatewayRepositories } from "../gateway.repositories.ts";
import { PostgresGatewayRepositories } from "../prisma/prisma.gateway.repositories.ts";
import { RedisGatewayAgentCacheEntryRepository } from "../redis/redis.gateway-agent-cache.repository.ts";
import { RedisGatewayBudgetChangeDedupeRepository } from "../redis/redis.gateway-budget-change-dedupe.repository.ts";
import { RedisGatewaySpendFoldCacheRepository } from "../redis/redis.gateway-spend-fold-cache.repository.ts";

/**
 * The shared server, then one routed organization per distinct private server,
 * as main's `getAllClickHouseInstances` listed them: two organizations on one
 * private server are swept once. Read per sweep, never at boot.
 */
function everyClickHouseServer(clickhouse: ClickHouseQueryClient): GatewayClickHouseInstance[] {
  const organizationByServer = new Map<string, string>();
  for (const [organizationId, url] of clickhouse.privateRoutes()) {
    if (!organizationByServer.has(url)) organizationByServer.set(url, organizationId);
  }
  return [
    { target: "shared", client: ClickHouseGatewaySession.create({ clickhouse, tenantId: "" }) },
    ...[...organizationByServer.values()].map((organizationId) => ({
      target: organizationId,
      client: ClickHouseGatewaySession.create({ clickhouse, tenantId: "", organizationId }),
    })),
  ];
}

/** The gateway's live stores: rows in Postgres, spend in ClickHouse, warm state in Redis. */
export class LiveGatewayRepositories {
  static readonly requires = ["prisma", "clickhouse", "redis"] as const;

  static create({
    prisma,
    clickhouse,
    redis,
  }: Readonly<{
    prisma: Parameters<typeof PostgresGatewayRepositories.create>[0]["prisma"];
    /** The process's ONE routing client, resolved per tenant rather than a second pool. */
    clickhouse: ClickHouseQueryClient;
    redis: RedisConnection;
  }>): GatewayRepositories {
    // `Promise.resolve`: there is nothing to open, the routing client already exists.
    const resolveClickHouse: GatewayClickHouseResolver = (tenantId) =>
      Promise.resolve(ClickHouseGatewaySession.create({ clickhouse, tenantId }));
    const budgetSpend = GatewayBudgetClickHouseRepository.create(resolveClickHouse);

    return {
      ...PostgresGatewayRepositories.create({ prisma, budgetSpend }),
      budgetSpend,
      principalSpend: ClickHouseGatewayPrincipalSpendRepository.create(resolveClickHouse),
      spendEvents: ClickHouseGatewaySpendEventsRepository.create(resolveClickHouse),
      openAdmissions: ClickHouseGatewayOpenAdmissionsSweepRepository.create(() =>
        Promise.resolve(everyClickHouseServer(clickhouse)),
      ),
      agentCache: RedisGatewayAgentCacheEntryRepository.create(redis),
      spendFoldCache: RedisGatewaySpendFoldCacheRepository.create(redis),
      budgetChangeDedupe: RedisGatewayBudgetChangeDedupeRepository.create(redis),
    };
  }
}
