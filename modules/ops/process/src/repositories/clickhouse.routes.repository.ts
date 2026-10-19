import type { PrivateRouteVariable } from "@langwatch/clickhouse-client";

/** The ClickHouse store's private routes (§7), organization id to URL, read when a pass asks. */
export abstract class ClickHouseRoutesRepository {
  abstract findPrivateRoutes(): ReadonlyMap<string, string>;
  /** Each private route variable by name and label, and whether it parsed; never its value. */
  abstract findPrivateRouteVariables(): readonly PrivateRouteVariable[];
}
