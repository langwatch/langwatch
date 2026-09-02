export type SuiteClickHouseQueryResult = {
  json<T>(): Promise<T[]>;
};

/** The narrow ClickHouse capability required by Suite run projections. */
export type SuiteClickHouseClient = {
  query(input: {
    query: string;
    query_params: Record<string, unknown>;
    format: "JSONEachRow";
  }): Promise<SuiteClickHouseQueryResult>;
  insert(input: {
    table: string;
    /**
     * Read-only on purpose: nothing here mutates the batch it is handed, and
     * saying so is what lets a caller holding a `readonly` row array — the
     * Eventing ClickHouse client a background worker composes from — satisfy
     * this port without copying every insert.
     */
    values: readonly unknown[];
    format: "JSONEachRow";
    /**
     * The settings map as a driver takes it, rather than the two keys this
     * feature happens to send. A client that accepts every setting is still a
     * client this port can use; spelling only `async_insert` and
     * `wait_for_async_insert` here refused the Eventing substrate's own client
     * for describing the same knobs more generally.
     */
    clickhouse_settings?: Record<string, number>;
  }): Promise<unknown>;
};
