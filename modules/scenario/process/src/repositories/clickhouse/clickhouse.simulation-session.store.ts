import type { ClickHouseSettings } from "@clickhouse/client";
import type { ProcessMembers } from "@langwatch/process-stores/members";

export type SimulationEventingClickHouseClient = {
  query(input: {
    query: string;
    query_params: Record<string, unknown>;
    format: "JSONEachRow";
    clickhouse_settings?: ClickHouseSettings;
  }): Promise<{ json<Row>(): Promise<Row[]> }>;
  insert(input: {
    table: string;
    values: readonly Readonly<Record<string, unknown>>[];
    format: "JSONEachRow";
    clickhouse_settings?: ClickHouseSettings;
  }): Promise<unknown>;
};

export type SimulationEventingClickHouseResolver = (
  tenantId: string,
) => Promise<SimulationEventingClickHouseClient>;

/** One tenant's view of the routing ClickHouse member, as evaluation's session reads it. */
export class ClickHouseSimulationSession implements SimulationEventingClickHouseClient {
  constructor(
    private readonly clickhouse: ProcessMembers["clickhouse"],
    private readonly tenantId: string,
  ) {}

  static resolver(clickhouse: ProcessMembers["clickhouse"]): SimulationEventingClickHouseResolver {
    return (tenantId) => Promise.resolve(new ClickHouseSimulationSession(clickhouse, tenantId));
  }

  async query(
    input: Parameters<SimulationEventingClickHouseClient["query"]>[0],
  ): Promise<{ json<Row>(): Promise<Row[]> }> {
    const request = {
      tenantId: this.tenantId,
      sql: input.query,
      params: input.query_params,
      ...(input.clickhouse_settings ? { settings: settingsOf(input.clickhouse_settings) } : {}),
    };

    return { json: async <Row>() => (await this.clickhouse.query<Row>(request)).rows };
  }

  async insert(input: Parameters<SimulationEventingClickHouseClient["insert"]>[0]): Promise<void> {
    await this.clickhouse.insert({
      tenantId: this.tenantId,
      table: input.table,
      rows: input.values,
      ...(input.clickhouse_settings ? { settings: settingsOf(input.clickhouse_settings) } : {}),
    });
  }
}

function settingsOf(settings: Readonly<Record<string, unknown>>): Record<string, string | number> {
  const carried: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(settings)) {
    if (typeof value === "string" || typeof value === "number") carried[name] = value;
    else if (typeof value === "boolean") carried[name] = value ? 1 : 0;
  }
  return carried;
}
