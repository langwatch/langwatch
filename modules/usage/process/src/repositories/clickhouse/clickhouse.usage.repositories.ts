import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";

import type { UsageRepositories } from "../usage.repositories.ts";
import { BillableEventsMeterClickHouseRepository } from "./clickhouse.billable-events-meter.repository.ts";
import { TraceMeterClickHouseRepository } from "./clickhouse.trace-meter.repository.ts";

/** The live tier: both meters in the process's one ClickHouse client. */
export class ClickHouseUsageRepositories {
  static readonly requires = ["clickhouse"] as const;

  static create({
    clickhouse,
  }: Readonly<{ clickhouse: ClickHouseQueryClient }>): UsageRepositories {
    return {
      billableEvents: BillableEventsMeterClickHouseRepository.create(clickhouse),
      traces: TraceMeterClickHouseRepository.create(clickhouse),
    };
  }
}
