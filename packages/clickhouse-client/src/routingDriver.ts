/**
 * The routing {@link QueryDriver}: sends one statement to the server its
 * tenant or explicit organisation belongs on, regardless of an unscoped
 * declaration. Statements naming neither route to the shared instance.
 */
import { nowInstant } from "@langwatch/time";

import type { ClickHouseCloseableClient, ClickHouseConnection } from "./connection.ts";
import type { InsertRequest, QueryDriver, QueryRequest, QueryResult } from "./query.ts";

/**
 * Anything a routed connection can run a statement against. Method shorthand
 * on purpose: it compares bivariantly, so the real driver client — whose
 * params are narrower than `unknown` — satisfies it structurally.
 */
export interface RoutableStatementClient extends ClickHouseCloseableClient {
  insert(params: unknown): Promise<unknown>;
  command(params: unknown): Promise<unknown>;
  query(params: unknown): Promise<{ json(): Promise<unknown> }>;
}

async function serverFor<Client extends RoutableStatementClient>(
  connection: ClickHouseConnection<Client>,
  request: Pick<QueryRequest, "tenantId" | "organizationId">,
): Promise<Client> {
  if (request.organizationId !== void 0) {
    return connection.resolveOrganization(request.organizationId);
  }

  return request.tenantId === "" ? connection.shared() : connection.resolve(request.tenantId);
}

function insertParams(request: InsertRequest): Record<string, unknown> {
  const params: Record<string, unknown> = {
    table: request.table,
    values: request.rows,
    format: "JSONEachRow",
  };

  if (request.settings !== undefined) {
    params.clickhouse_settings = request.settings;
  }

  return params;
}

function queryParams(request: QueryRequest): Record<string, unknown> {
  const params: Record<string, unknown> = {
    query: request.sql,
  };

  if (request.params !== undefined) {
    params.query_params = request.params;
  }

  if (request.settings !== undefined) {
    params.clickhouse_settings = request.settings;
  }

  if (request.signal !== undefined) {
    params.abort_signal = request.signal;
  }

  return params;
}

export function routingDriver<Client extends RoutableStatementClient>(
  connection: ClickHouseConnection<Client>,
): QueryDriver {
  return {
    async insert(request: InsertRequest): Promise<void> {
      const vendor = await serverFor(connection, request);
      await vendor.insert(insertParams(request));
    },

    async command(request: QueryRequest): Promise<void> {
      const vendor = await serverFor(connection, request);
      await vendor.command(queryParams(request));
    },

    async execute<Row>(request: QueryRequest): Promise<QueryResult<Row>> {
      const vendor = await serverFor(connection, request);

      const started = nowInstant().epochMilliseconds;
      const resultSet = await vendor.query({ ...queryParams(request), format: "JSONEachRow" });
      const rows = (await resultSet.json()) as Row[];
      return { rows, stats: { durationMs: nowInstant().epochMilliseconds - started } };
    },
  };
}
