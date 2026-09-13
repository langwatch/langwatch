/**
 * The routing {@link QueryDriver}: one statement, sent to the server the
 * tenant belongs on.
 *
 * A statement that names a tenant is routed by it, whether or not it also
 * declares itself unscoped: a TTL reconciliation for a private organization
 * belongs on that organization's server, not on shared. Only a statement with
 * no tenant at all — a migration, a `system.*` read — goes to the shared
 * server, and the tenant guard has already refused it unless the author wrote
 * down why it has none.
 *
 * `@clickhouse/client` is deliberately not named here — see the
 * {@link RoutableStatementClient} docblock, the same idiom as
 * `VendorStatementClient` in ./vendorClient.ts and for the same reason.
 */
import type { ClickHouseCloseableClient, ClickHouseConnection } from "./connection.ts";
import type { InsertRequest, QueryDriver, QueryRequest, QueryResult } from "./query.ts";

/**
 * Anything a routed connection can run a statement against. Method shorthand
 * on purpose: it compares bivariantly, so the real driver client — whose
 * params are narrower than `unknown` — satisfies it structurally.
 *
 * `query`'s result is typed by its `json()` returning `unknown` rather than a
 * generic `Row[]`: the real client's `query` is itself generic over a result
 * format, and comparing that generic method against a fixed `Row[]` return
 * widens to the union of every format's JSON shape and fails to satisfy this
 * interface. `execute` below reads the one row shape it asked for
 * (`JSONEachRow`) out of the `unknown` and asserts it there, the same way
 * `VendorStatementClient` in ./vendorClient.ts leaves its own result
 * untyped and lets its caller narrow it.
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
