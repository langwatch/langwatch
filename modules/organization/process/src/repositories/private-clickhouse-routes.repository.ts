import type { PrivateRouteVariable } from "@langwatch/clickhouse-client";

/** The private ClickHouse route variables this process parsed at boot, by name and label. */
export abstract class PrivateClickHouseRoutesRepository {
  abstract findRouteVariables(): readonly PrivateRouteVariable[];
}
