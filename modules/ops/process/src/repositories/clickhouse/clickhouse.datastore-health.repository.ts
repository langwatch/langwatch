import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { getMigrateStatus } from "@langwatch/clickhouse-migrations";

import { ClickHouseHealthRepository } from "../datastore-health.repository.ts";

/** Whether the shared ClickHouse answers, and what goose says of its migrations. */
export class ClickHouseClickHouseHealthRepository extends ClickHouseHealthRepository {
  private constructor(
    private readonly clickhouse: ClickHouseQueryClient,
    /** The process's `CLICKHOUSE_URL`, a secret: handed to goose, never logged. */
    private readonly connectionUrl: string | undefined,
  ) {
    super();
  }

  static create({
    clickhouse,
    connectionUrl,
  }: {
    clickhouse: ClickHouseQueryClient;
    connectionUrl: string | undefined;
  }): ClickHouseClickHouseHealthRepository {
    return new ClickHouseClickHouseHealthRepository(clickhouse, connectionUrl);
  }

  async ping(): Promise<void> {
    await this.clickhouse.query({
      tenantId: "",
      sql: "SELECT 1",
      unscoped: { reason: "the checkup asks whether the server answers, which no tenant owns" },
    });
  }

  readMigrationStatus(): Promise<string> {
    return getMigrateStatus({ connectionUrl: this.connectionUrl });
  }
}
