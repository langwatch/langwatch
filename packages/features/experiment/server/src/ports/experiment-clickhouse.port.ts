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

/**
 * Runtime boundary between the Experiment feature's ClickHouse persistence and
 * the tenant-scoped client the application composes. Every read and write
 * resolves its client through this port, so no persistence module reaches for a
 * connection of its own.
 */
export abstract class ExperimentClickHousePort {
  abstract resolveClient(tenantId: string): Promise<ExperimentEventingClickHouseClient>;
}
