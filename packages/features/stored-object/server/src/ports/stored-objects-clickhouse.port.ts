/**
 * The ClickHouse connection the content-addressed object table is read and
 * written through, resolved per project.
 *
 * Per project rather than once, because a private-route tenant's rows live on
 * its own cluster: an object written for one project and read back through
 * another project's client is a read that finds nothing. The process owns the
 * routing; this port is the one question the repository asks it.
 */

/** The three operations the stored-object table needs, as the driver exposes them. */
export type StoredObjectsClickHouseClient = Readonly<{
  insert(input: {
    table: string;
    values: readonly Record<string, unknown>[];
    format: "JSONEachRow";
    clickhouse_settings?: Record<string, unknown>;
  }): Promise<unknown>;
  query(input: {
    query: string;
    query_params: Record<string, unknown>;
    format: "JSONEachRow";
  }): Promise<{ json<Result>(): Promise<Result[]> }>;
  exec(input: {
    query: string;
    query_params: Record<string, unknown>;
    clickhouse_settings?: Record<string, unknown>;
  }): Promise<unknown>;
}>;

/** Resolves the client one project's stored-object rows live on. */
export abstract class StoredObjectsClickHousePort {
  abstract resolveClient(projectId: string): Promise<StoredObjectsClickHouseClient>;
}
