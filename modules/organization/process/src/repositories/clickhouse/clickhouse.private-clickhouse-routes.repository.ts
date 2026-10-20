import type { ClickHouseQueryClient, PrivateRouteVariable } from "@langwatch/clickhouse-client";

import { PrivateClickHouseRoutesRepository } from "../private-clickhouse-routes.repository.ts";

/** The route variables the routed ClickHouse member was configured with. */
export class ClickHousePrivateClickHouseRoutesRepository extends PrivateClickHouseRoutesRepository {
  private constructor(private readonly clickhouse: ClickHouseQueryClient) {
    super();
  }

  static create({
    clickhouse,
  }: {
    clickhouse: ClickHouseQueryClient;
  }): ClickHousePrivateClickHouseRoutesRepository {
    return new ClickHousePrivateClickHouseRoutesRepository(clickhouse);
  }

  findRouteVariables(): readonly PrivateRouteVariable[] {
    return this.clickhouse.privateRouteVariables();
  }
}
