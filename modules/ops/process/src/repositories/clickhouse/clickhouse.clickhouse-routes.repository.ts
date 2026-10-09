import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";

import { ClickHouseRoutesRepository } from "../clickhouse.routes.repository.ts";

/** The routes the routed ClickHouse member was configured with. */
export class ClickHouseClickHouseRoutesRepository extends ClickHouseRoutesRepository {
  private constructor(private readonly clickhouse: ClickHouseQueryClient) {
    super();
  }

  static create({
    clickhouse,
  }: {
    clickhouse: ClickHouseQueryClient;
  }): ClickHouseClickHouseRoutesRepository {
    return new ClickHouseClickHouseRoutesRepository(clickhouse);
  }

  findPrivateRoutes(): ReadonlyMap<string, string> {
    return this.clickhouse.privateRoutes();
  }
}
