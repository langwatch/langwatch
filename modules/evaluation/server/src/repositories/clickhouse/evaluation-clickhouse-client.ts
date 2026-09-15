import type { ClickHouseSettings } from "@clickhouse/client";

export type EvaluationClickHouseResult = {
  json<T>(): Promise<T[]>;
};

export type EvaluationClickHouseInsert = {
  table: string;
  values: Record<string, unknown>[];
  format: "JSONEachRow";
  clickhouse_settings?: ClickHouseSettings;
};

export type EvaluationClickHouseQuery = {
  query: string;
  query_params: Record<string, unknown>;
  format: "JSONEachRow";
  clickhouse_settings?: ClickHouseSettings;
};

export type EvaluationClickHouseClient = {
  insert(input: EvaluationClickHouseInsert): Promise<unknown>;
  query(input: EvaluationClickHouseQuery): Promise<EvaluationClickHouseResult>;
};

export type EvaluationClickHouseResolver = (
  tenantId: string,
) => Promise<EvaluationClickHouseClient>;
