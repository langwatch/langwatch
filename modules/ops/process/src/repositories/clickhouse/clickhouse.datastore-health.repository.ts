import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { getMigrateStatus } from "@langwatch/clickhouse-migrations";

import { ClickHouseHealthRepository } from "../datastore-health.repository.ts";

/** Whether the shared ClickHouse answers at all. */
export class ClickHouseClickHouseHealthRepository extends ClickHouseHealthRepository {
  private constructor(private readonly clickhouse: ClickHouseQueryClient) {
    super();
  }

  static create(clickhouse: ClickHouseQueryClient): ClickHouseClickHouseHealthRepository {
    return new ClickHouseClickHouseHealthRepository(clickhouse);
  }

  async ping(): Promise<void> {
    await this.clickhouse.query({
      tenantId: "",
      sql: "SELECT 1",
      unscoped: { reason: "the checkup asks whether the server answers, which no tenant owns" },
    });
  }

  readMigrationStatus(): Promise<string> {
    return getMigrateStatus();
  }
}
