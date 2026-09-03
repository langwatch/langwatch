export type StoredObjectOwnerClickHouseClient = Readonly<{
  query(input: {
    query: string;
    query_params: Record<string, string>;
    format: "JSONEachRow";
  }): Promise<{
    json<Result>(): Promise<Result[]>;
  }>;
}>;

export type StoredObjectOwnerClickHouseInstance = Readonly<{
  target: string;
  client: StoredObjectOwnerClickHouseClient;
}>;

/** Process-composed directory of every ClickHouse instance eligible for legacy owner lookup. */
export abstract class StoredObjectOwnerInstanceDirectoryPort {
  abstract listInstances(): Promise<ReadonlyArray<StoredObjectOwnerClickHouseInstance>>;
}
