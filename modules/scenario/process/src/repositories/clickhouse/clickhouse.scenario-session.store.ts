import type { SimulationClickHouseClient } from "./simulation-clickhouse.repository.ts";

/** The process's one routing `clickhouse` member, as the simulation reads query it. */
type ScenarioReadOnlyClickHouse = Readonly<{
  query<Row>(input: {
    tenantId: string;
    tenantIds?: readonly string[];
    sql: string;
    params?: Record<string, unknown>;
  }): Promise<{ rows: Row[] }>;
}>;

/** One tenant's view of the routing member, in the `.query()` shape the simulation reads use. */
export class ClickHouseScenarioSession implements SimulationClickHouseClient {
  private constructor(
    private readonly clickhouse: ScenarioReadOnlyClickHouse,
    private readonly tenantId: string,
  ) {}

  /** Resolves each tenant's session over the one routing member. */
  static resolverOver(
    clickhouse: ScenarioReadOnlyClickHouse,
  ): (tenantId: string) => Promise<ClickHouseScenarioSession> {
    return (tenantId) => Promise.resolve(new ClickHouseScenarioSession(clickhouse, tenantId));
  }

  async query(input: {
    query: string;
    query_params: Record<string, unknown>;
    format: "JSONEachRow";
    tenantIds?: readonly string[];
  }): Promise<{ json<Result>(): Promise<Result[]> }> {
    const request = {
      tenantId: this.tenantId,
      ...(input.tenantIds ? { tenantIds: input.tenantIds } : {}),
      sql: input.query,
      params: input.query_params,
    };

    return { json: async <Result>() => (await this.clickhouse.query<Result>(request)).rows };
  }
}
