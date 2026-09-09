export type StorageMeterQueryParams = Record<string, string | number | string[]>;

export type StorageMeterQuery = {
  query: string;
  query_params: StorageMeterQueryParams;
  format: "JSONEachRow";
  clickhouse_settings?: Record<string, number>;
};

export abstract class StorageMeterClickHousePort {
  abstract query(input: StorageMeterQuery): Promise<{ json(): Promise<unknown> }>;
}

export type StorageMeterClickHouseClient = StorageMeterClickHousePort;

export type StorageMeterClickHouseResolver = (
  tenantId: string,
) => Promise<StorageMeterClickHouseClient>;
