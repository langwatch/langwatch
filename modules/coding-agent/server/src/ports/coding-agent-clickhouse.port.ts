/** One `JSONEachRow` result set, as this feature's reads consume it. */
export type CodingAgentClickHouseQueryResult = {
  json<Row>(): Promise<Row[]>;
};

/**
 * The ClickHouse surface this feature actually uses: one insert and one query.
 *
 * Declared structurally rather than as the driver's `ClickHouseClient` so a
 * process that resolves tenants through the Eventing substrate's own client
 * can compose the session pipeline. The driver client satisfies it too, which
 * is what keeps the App's `AppCodingAgentClickHousePort` compiling unchanged.
 */
export type CodingAgentClickHouseClient = {
  query(input: {
    query: string;
    query_params?: Record<string, unknown>;
    format: "JSONEachRow";
  }): Promise<CodingAgentClickHouseQueryResult>;
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
     * `wait_for_async_insert` here would refuse the Eventing substrate's own
     * client for describing the same knobs more generally.
     */
    clickhouse_settings?: Record<string, number>;
  }): Promise<unknown>;
};

/** Resolves the ClickHouse endpoint that owns one Coding Agent tenant. */
export abstract class CodingAgentClickHousePort {
  abstract resolve(tenantId: string): Promise<CodingAgentClickHouseClient>;
}
