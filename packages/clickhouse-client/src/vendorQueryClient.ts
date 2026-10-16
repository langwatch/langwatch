/**
 * The process's client over a suite's plain connection: `{{idBound}}` expands as in production,
 * so the server never sees a marker. Readiness checks never reach it: every declared index reads
 * as not filled and each read takes today's path, as `idIndexedClientDouble` does.
 */
import { ClickHouseQueryClient } from "./client.ts";
import type { IdIndexDeclaration } from "./idIndexFill.ts";
import { isIdIndexReadinessStatement } from "./idIndexReadiness.ts";
import type { QueryDriver, QueryResult } from "./query.ts";
import { TenantGuard } from "./tenantGuard.ts";

type Settings = Record<string, string | number>;

/** The calls a suite's connection answers; a plain `ClickHouseClient` has them all. */
export interface VendorStatements {
  query(params: {
    query: string;
    format: "JSONEachRow";
    query_params?: Record<string, unknown>;
    clickhouse_settings?: Settings;
  }): Promise<{ json(): Promise<unknown> }>;
  insert(params: {
    table: string;
    values: readonly Readonly<Record<string, unknown>>[];
    format: "JSONEachRow";
    clickhouse_settings?: Settings;
  }): Promise<unknown>;
  command(params: {
    query: string;
    query_params?: Record<string, unknown>;
    clickhouse_settings?: Settings;
  }): Promise<unknown>;
}

/** The suite's rows as the reader asked for them: the server answered the statement it was sent. */
const asRows = <Row>(rows: unknown): Row[] =>
  Array.isArray(rows) ? rows.filter((_row): _row is Row => true) : [];

/** A client over `vendor` with `indexes` declared, each read as not filled. */
export function vendorQueryClient({
  vendor,
  indexes,
}: {
  vendor: VendorStatements;
  indexes: readonly IdIndexDeclaration[];
}): ClickHouseQueryClient {
  const driver: QueryDriver = {
    async execute<Row>(request: Parameters<QueryDriver["execute"]>[0]): Promise<QueryResult<Row>> {
      if (isIdIndexReadinessStatement(request)) {
        throw new Error("A suite's connection never reads an id index as filled.");
      }
      const result = await vendor.query({
        query: request.sql,
        format: "JSONEachRow",
        ...(request.params === undefined ? {} : { query_params: request.params }),
        ...(request.settings === undefined ? {} : { clickhouse_settings: request.settings }),
      });
      return { rows: asRows<Row>(await result.json()) };
    },
    async insert(request) {
      await vendor.insert({
        table: request.table,
        values: request.rows,
        format: "JSONEachRow",
        ...(request.settings === undefined ? {} : { clickhouse_settings: request.settings }),
      });
    },
    async command(request) {
      await vendor.command({
        query: request.sql,
        ...(request.params === undefined ? {} : { query_params: request.params }),
        ...(request.settings === undefined ? {} : { clickhouse_settings: request.settings }),
      });
    },
  };
  const client = new ClickHouseQueryClient({ driver, tenantGuard: new TenantGuard() });
  client.declareIdIndexes({ indexes });
  return client;
}
