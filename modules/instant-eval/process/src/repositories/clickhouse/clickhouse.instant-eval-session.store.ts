import type {
  InstantEvalClickHouseClient,
  InstantEvalClickHouseMember,
} from "../../app/instant-eval.members.ts";

/** One tenant's view of the process member, as a repository reads it. */
export class ClickHouseInstantEvalSession implements InstantEvalClickHouseClient {
  constructor(
    private readonly clickhouse: InstantEvalClickHouseMember,
    private readonly tenantId: string,
  ) {}

  async query<T>(input: {
    query: string;
    query_params?: Record<string, unknown>;
    format: "JSONEachRow";
    clickhouse_settings?: Record<string, string | number | boolean | undefined>;
  }): Promise<{ json(): Promise<T[]> }> {
    const { rows } = await this.clickhouse.query<T>({
      tenantId: this.tenantId,
      sql: input.query,
      ...(input.query_params ? { params: input.query_params } : {}),
      ...(input.clickhouse_settings ? { settings: settingsOf(input.clickhouse_settings) } : {}),
    });
    return { json: () => Promise.resolve(rows) };
  }

  async insert(input: {
    table: string;
    values: Record<string, unknown>[];
    clickhouse_settings?: Record<string, string | number | boolean | undefined>;
  }): Promise<unknown> {
    await this.clickhouse.insert({
      tenantId: this.tenantId,
      table: input.table,
      rows: input.values,
      ...(input.clickhouse_settings ? { settings: settingsOf(input.clickhouse_settings) } : {}),
    });
    return undefined;
  }
}

/** The settings the member takes: booleans and absences dropped. */
function settingsOf(
  settings: Record<string, string | number | boolean | undefined>,
): Record<string, string | number> {
  const carried: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(settings)) {
    if (typeof value === "string" || typeof value === "number") carried[name] = value;
    else if (typeof value === "boolean") carried[name] = value ? 1 : 0;
  }
  return carried;
}
