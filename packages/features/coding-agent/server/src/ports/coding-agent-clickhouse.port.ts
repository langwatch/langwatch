import type { ClickHouseClient } from "@clickhouse/client";

/** Resolves the ClickHouse endpoint that owns one Coding Agent tenant. */
export abstract class CodingAgentClickHousePort {
  abstract resolve(tenantId: string): Promise<ClickHouseClient>;
}
