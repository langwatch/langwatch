import type {
  ClickHouseColumns,
  ClickHouseQueryClient,
  IdBoundOptions,
} from "@langwatch/clickhouse-client";

import { refuseUnlessOwnTenant } from "./clickhouse.simulation-session.store.ts";
import type { SimulationClickHouseClient } from "./simulation-clickhouse.repository.ts";

/** The process's one routing `clickhouse` member, as the simulation reads query it. */
type ScenarioReadOnlyClickHouse = Readonly<{
  query<Row>(input: {
    tenantId: string;
    tenantIds?: readonly string[];
    sql: string;
    params?: Record<string, unknown>;
    SKIP_COLD_SCAN_CHECK?: true | undefined;
    idBound?: IdBoundOptions;
  }): Promise<{ rows: Row[] }>;
  columns(input: { tenantId: string }): ClickHouseColumns;
  read: ClickHouseQueryClient["read"];
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
    SKIP_COLD_SCAN_CHECK?: true | undefined;
    idBound?: IdBoundOptions;
  }): Promise<{ json<Result>(): Promise<Result[]> }> {
    const request = {
      tenantId: this.tenantId,
      ...(input.tenantIds ? { tenantIds: input.tenantIds } : {}),
      sql: input.query,
      params: input.query_params,
      ...(input.SKIP_COLD_SCAN_CHECK === true ? { SKIP_COLD_SCAN_CHECK: true as const } : {}),
      ...(input.idBound === undefined ? {} : { idBound: input.idBound }),
    };

    return { json: async <Result>() => (await this.clickhouse.query<Result>(request)).rows };
  }

  /** Sends a built statement only when it is this session's tenant's, else refuses by name. */
  read: ClickHouseQueryClient["read"] = async (input) => {
    refuseUnlessOwnTenant({
      statement: input.statement,
      tenantId: this.tenantId,
      operation: "ClickHouseScenarioSession.read",
    });
    return this.clickhouse.read(input);
  };

  /** Which columns of a table this tenant's target holds, for `fn.heldOr`. */
  holds({ table }: { table: string }): Promise<(name: string) => boolean> {
    return this.clickhouse.columns({ tenantId: this.tenantId }).holds({ table });
  }

  /** A select list naming only the columns this tenant's target has, the rest as defaults. */
  select(input: Parameters<ClickHouseColumns["select"]>[0]): Promise<string> {
    return this.clickhouse.columns({ tenantId: this.tenantId }).select(input);
  }
}
