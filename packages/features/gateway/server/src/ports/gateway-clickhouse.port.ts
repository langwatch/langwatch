export type GatewayClickHouseClient = {
  query(input: {
    query: string;
    query_params?: Record<string, unknown>;
    format: "JSONEachRow";
    clickhouse_settings?: Record<
      string,
      string | number | boolean | Record<string, string | number | boolean> | undefined
    >;
  }): Promise<{ json<T = unknown>(): Promise<T[]> }>;
  insert(input: {
    table: string;
    values: Record<string, unknown>[];
    format?: "JSONEachRow";
    clickhouse_settings?: Record<
      string,
      string | number | boolean | Record<string, string | number | boolean> | undefined
    >;
  }): Promise<void>;
};

export type GatewayClickHouseResolver = (
  tenantId: string,
) => Promise<GatewayClickHouseClient>;

/** Resolves the tenant-scoped ClickHouse client at the Gateway boundary. */
export abstract class GatewayClickHousePort {
  abstract resolve(tenantId: string): Promise<GatewayClickHouseClient>;
}
