export type ExperimentEventingClickHouseResult = {
  json<T>(): Promise<T[]>;
};

export type ExperimentEventingClickHouseClient = {
  insert(input: {
    table: string;
    values: unknown[];
    format: "JSONEachRow";
    clickhouse_settings?: {
      async_insert?: 0 | 1;
      wait_for_async_insert?: 0 | 1;
    };
  }): Promise<unknown>;
  query(input: {
    query: string;
    query_params: Record<string, unknown>;
    format: "JSONEachRow";
  }): Promise<ExperimentEventingClickHouseResult>;
};

export type ExperimentEventingClickHouseResolver = (
  tenantId: string,
) => Promise<ExperimentEventingClickHouseClient>;
