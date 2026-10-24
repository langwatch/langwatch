import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";

import { BillableEventsMeterClickHouseRepository } from "../clickhouse/clickhouse.billable-events-meter.repository.ts";
import { TraceCountClickHouseRepository } from "../clickhouse/clickhouse.trace-count.repository.ts";
import type { EntitlementRepositories } from "../entitlement.repositories.ts";
import { MemoryUsageCacheRepository } from "../memory/memory.usage-cache.repository.ts";
import { PostgresEntitlementRepositories } from "../prisma/prisma.entitlement.repositories.ts";

/** Membership and spend over Postgres; the meter and trace count over one ClickHouse client. */
export class LiveEntitlementRepositories {
  static readonly requires = ["prisma", "clickhouse"] as const;

  static create({
    prisma,
    clickhouse,
  }: Readonly<{
    prisma: Parameters<typeof PostgresEntitlementRepositories.create>[0]["prisma"];
    clickhouse: ClickHouseQueryClient;
  }>): EntitlementRepositories {
    return {
      ...PostgresEntitlementRepositories.create({ prisma }),
      billableEvents: BillableEventsMeterClickHouseRepository.create(clickhouse),
      traces: TraceCountClickHouseRepository.create(clickhouse),
      usageCounts: MemoryUsageCacheRepository.create(),
      usageDecisions: MemoryUsageCacheRepository.create(),
    };
  }
}
