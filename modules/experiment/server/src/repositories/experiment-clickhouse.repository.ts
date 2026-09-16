export type ExperimentEventingClickHouseResult = {
  json<T>(): Promise<T[]>;
};

export type ExperimentEventingClickHouseClient = {
  insert(input: {
    table: string;
    /**
     * Read-only on purpose: nothing mutates the batch it is handed, so a
     * caller holding a `readonly` row array can satisfy this contract without
     * copying every insert.
     */
    values: readonly unknown[];
    format: "JSONEachRow";
    /**
     * The settings map as a driver takes it, not the two keys this feature
     * sends. Spelling only `async_insert`/`wait_for_async_insert` would refuse
     * the Eventing substrate's own client describing the same knobs generally.
     */
    clickhouse_settings?: Record<string, number>;
  }): Promise<unknown>;
  query(input: {
    query: string;
    query_params?: Record<string, unknown>;
    format: "JSONEachRow";
  }): Promise<ExperimentEventingClickHouseResult>;
};

/**
 * How the Experiment feature's ClickHouse persistence reaches the
 * tenant-scoped client the application composes. Every read and write
 * resolves through here, stated once for every repository that shares it.
 */
export abstract class ExperimentClickHouseRepository {
  abstract resolveClient(tenantId: string): Promise<ExperimentEventingClickHouseClient>;
}
