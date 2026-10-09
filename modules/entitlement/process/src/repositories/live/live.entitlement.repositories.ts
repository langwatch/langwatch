import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";

import { BillableEventsMeterClickHouseRepository } from "../clickhouse/clickhouse.billable-events-meter.repository.ts";
import { TraceMeterClickHouseRepository } from "../clickhouse/clickhouse.trace-meter.repository.ts";
import type { EntitlementRepositories } from "../entitlement.repositories.ts";
import { PostgresEntitlementRepositories } from "../prisma/prisma.entitlement.repositories.ts";

/** Membership and spend over Postgres, both meters over the process's one ClickHouse client. */
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
      traces: TraceMeterClickHouseRepository.create(clickhouse),
    };
  }
}
