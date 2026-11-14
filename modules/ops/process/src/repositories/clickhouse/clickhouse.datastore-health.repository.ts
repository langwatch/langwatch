import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { clickhouseRead, param, tenantScope } from "@langwatch/clickhouse-client/builder";

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
    const statement = clickhouseRead({
      scope: tenantScope.serverMetadata({ reason: "the checkup asks whether the server answers" }),
    })
      .withoutTable()
      .select({ one: param.uint32(1) })
      .build();
    await this.clickhouse.read({ statement });
  }
}
