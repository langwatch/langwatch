import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";

import { ClickHouseHealthRepository } from "../datastore-health.repository.ts";

/** Whether the shared ClickHouse answers. */
export class ClickHouseClickHouseHealthRepository extends ClickHouseHealthRepository {
  private constructor(private readonly clickhouse: ClickHouseQueryClient) {
    super();
  }

  static create({
    clickhouse,
  }: {
    clickhouse: ClickHouseQueryClient;
  }): ClickHouseClickHouseHealthRepository {
    return new ClickHouseClickHouseHealthRepository(clickhouse);
  }

  async ping(): Promise<void> {
    await this.clickhouse.query({
      tenantId: "",
      sql: "SELECT 1",
      unscoped: { reason: "the checkup asks whether the server answers, which no tenant owns" },
    });
  }
}
