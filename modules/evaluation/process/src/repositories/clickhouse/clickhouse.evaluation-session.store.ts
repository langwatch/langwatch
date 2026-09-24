import type { ProcessMembers } from "@langwatch/process-stores/members";

import type {
  EvaluationClickHouseClient,
  EvaluationClickHouseInsert,
  EvaluationClickHouseQuery,
  EvaluationClickHouseResult,
} from "./evaluation-clickhouse-client.ts";

/**
 * One tenant's view of the process's routing ClickHouse member. A read runs
 * when its rows are asked for, so each caller names the row type it decodes.
 */
export class ClickHouseEvaluationSession implements EvaluationClickHouseClient {
  constructor(
    private readonly clickhouse: ProcessMembers["clickhouse"],
    private readonly tenantId: string,
  ) {}

  async query(input: EvaluationClickHouseQuery): Promise<EvaluationClickHouseResult> {
    const request = {
      tenantId: this.tenantId,
      sql: input.query,
      params: input.query_params,
      ...(input.clickhouse_settings ? { settings: settingsOf(input.clickhouse_settings) } : {}),
    };

    return { json: async <T>() => (await this.clickhouse.query<T>(request)).rows };
  }

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
