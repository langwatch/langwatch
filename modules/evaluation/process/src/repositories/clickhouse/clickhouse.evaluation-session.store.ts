import type { ClickHouseSettings } from "@clickhouse/client";
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";

export type EvaluationClickHouseInsert = {
  table: string;
  values: Record<string, unknown>[];
  format: "JSONEachRow";
  clickhouse_settings?: ClickHouseSettings;
};

export type EvaluationClickHouseClient = {
  insert(input: EvaluationClickHouseInsert): Promise<unknown>;
};

export type EvaluationClickHouseResolver = (
  tenantId: string,
) => Promise<EvaluationClickHouseClient>;

/** One tenant's view of the process's routing ClickHouse member, for the writer's inserts. */
export class ClickHouseEvaluationSession implements EvaluationClickHouseClient {
  constructor(
    private readonly clickhouse: ClickHouseQueryClient,
    private readonly tenantId: string,
  ) {}

  async insert(input: EvaluationClickHouseInsert): Promise<unknown> {
    await this.clickhouse.insert({
      tenantId: this.tenantId,
      table: input.table,
      rows: input.values,
      ...(input.clickhouse_settings ? { settings: settingsOf(input.clickhouse_settings) } : {}),
    });
    return undefined;
  }
}

/** The settings the member takes: booleans as 0/1, everything else unset dropped. */
function settingsOf(settings: Readonly<Record<string, unknown>>): Record<string, string | number> {
  const carried: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(settings)) {
    if (typeof value === "string" || typeof value === "number") carried[name] = value;
    else if (typeof value === "boolean") carried[name] = value ? 1 : 0;
  }
  return carried;
}
