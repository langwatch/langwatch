/**
 * The routing {@link QueryDriver}: sends one statement to the server its
 * tenant belongs on, regardless of an unscoped declaration. Only a
 * statement naming no tenant (a migration, a `system.*` read) goes shared.
 */
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

export function routingDriver<Client extends RoutableStatementClient>(
  connection: ClickHouseConnection<Client>,
): QueryDriver {
  /** The server this statement's tenant belongs on, shared only when it has none. */
  const serverFor = async (tenantId: string): Promise<Client> =>
    tenantId === "" ? connection.shared() : await connection.resolve(tenantId);

  return {
    async insert(request: InsertRequest): Promise<void> {
      const vendor = await serverFor(request.tenantId);
      await vendor.insert({
        table: request.table,
        values: request.rows as Record<string, unknown>[],
        format: "JSONEachRow",
        ...(request.settings === undefined
          ? {}
          : { clickhouse_settings: request.settings as Record<string, never> }),
      });
    },

    async command(request: QueryRequest): Promise<void> {
      const vendor = await serverFor(request.tenantId);
      await vendor.command({
        query: request.sql,
        ...(request.params === undefined ? {} : { query_params: request.params }),
        ...(request.settings === undefined ? {} : { clickhouse_settings: request.settings }),
        ...(request.signal === undefined ? {} : { abort_signal: request.signal as AbortSignal }),
      });
    },

    async execute<Row>(request: QueryRequest): Promise<QueryResult<Row>> {
      const vendor = await serverFor(request.tenantId);

      const started = Date.now();
      const resultSet = await vendor.query({
        query: request.sql,
        format: "JSONEachRow",
        ...(request.params === undefined ? {} : { query_params: request.params }),
        ...(request.settings === undefined ? {} : { clickhouse_settings: request.settings }),
        ...(request.signal === undefined ? {} : { abort_signal: request.signal as AbortSignal }),
      });
      const rows = (await resultSet.json()) as Row[];
      return { rows, stats: { durationMs: Date.now() - started } };
    },
  };
}
