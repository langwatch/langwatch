/**
 * The routing {@link QueryDriver}: sends one statement to the server its
 * tenant or explicit organisation belongs on, whether or not it skipped the
 * tenant check. Statements naming neither route to the shared instance.
 */
import { nowInstant } from "@langwatch/time";

import type { ClickHouseCloseableClient, ClickHouseConnection } from "./connection.ts";
import type { InsertRequest, QueryDriver, QueryRequest, QueryResult } from "./query.ts";
import { inbandExceptionOf } from "./statementShape.ts";

/**
 * Anything a routed connection can run a statement against. Method shorthand
 * on purpose: it compares bivariantly, so the real driver client — whose
 * params are narrower than `unknown` — satisfies it structurally.
 */
export interface RoutableStatementClient extends ClickHouseCloseableClient {
  insert(params: unknown): Promise<unknown>;
  command(params: unknown): Promise<unknown>;
  query(params: unknown): Promise<{
    json(): Promise<unknown>;
    stream<Row>(): AsyncIterable<readonly { json<Value = Row>(): Value }[]>;
  }>;
}

async function serverFor<Client extends RoutableStatementClient>(
  connection: ClickHouseConnection<Client>,
  request: Pick<QueryRequest, "tenantId" | "organizationId" | "tenantIds">,
): Promise<Client> {
  if (request.tenantIds !== void 0) {
    return connection.resolveTenantSet({
      tenantId: request.tenantId,
      tenantIds: request.tenantIds,
      organizationId: request.organizationId,
    });
  }
  if (request.organizationId !== void 0) {
    return connection.resolveOrganization(request.organizationId);
  }

  return request.tenantId === "" ? connection.shared() : connection.resolve(request.tenantId);
}

/** Whether an insert's `async_insert` turns async off: the one rule both insert paths use. */
export function turnsAsyncInsertOff(value: unknown): boolean {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
    return false;
  }
  const text = String(value).trim().toLowerCase();
  return text === "0" || text === "false";
}

export const VIEW_DEDUP = { deduplicate_blocks_in_dependent_materialized_views: 1 } as const;

/**
 * Only a statement that turns `async_insert` off keeps its view blocks with its dedup: a server
 * profile may make any other insert async, and ClickHouse refuses this setting there (Code 344).
 */
export function insertSettings(
  settings: Record<string, string | number> | undefined,
): Record<string, string | number> {
  if (!turnsAsyncInsertOff(settings?.async_insert)) return { ...settings };
  return { ...VIEW_DEDUP, ...settings };
}

function insertParams(request: InsertRequest): Record<string, unknown> {
  return {
    table: request.table,
    values: request.rows,
    format: "JSONEachRow",
    clickhouse_settings: insertSettings(request.settings),
  };
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

/**
 * The largest result a buffered read may receive, in ClickHouse's uncompressed bytes. The
 * server's memory cap protects the server, not this process, and parsed rows take several
 * times their size in the heap. See specs/clickhouse/bounded-reads.feature, "The result ceiling".
 */
export const BUFFERED_READ_MAX_RESULT_BYTES = 256 * 1024 * 1024;

/**
 * Adds the default ceiling with `throw`, since `break` would pass a partial result off as whole.
 * A read naming its own `max_result_bytes`, or asking for `break`, keeps exactly what it sent;
 * one naming only a row limit keeps it and gains the ceiling.
 */
function bufferedReadSettings(
  settings: Record<string, string | number> | undefined,
): Record<string, string | number> | undefined {
  const overflowMode = settings?.result_overflow_mode;
  if (settings?.max_result_bytes !== undefined) return settings;
  if (overflowMode !== undefined && overflowMode !== "throw") return settings;
  return {
    ...settings,
    max_result_bytes: String(BUFFERED_READ_MAX_RESULT_BYTES),
    result_overflow_mode: "throw",
  };
}

/**
 * A server before 25.11 that fails after its 200 writes the failure as a last `{"exception"}`
 * row, which the vendor client hands over as data; read it as the failure it is, with the
 * server's code, as VendorClientResilience does (specs/clickhouse/single-client-access.feature).
 */
function refuseInbandException(rows: readonly unknown[]): void {
  const exception = inbandExceptionOf(rows[rows.length - 1]);
  if (exception === undefined) return;
  const error = new Error(exception);
  const code = /Code:\s*(\d+)/.exec(exception)?.[1];
  if (code) Object.assign(error, { code });
  throw error;
}

/** UNKNOWN_TABLE (60) and NO_SUCH_COLUMN_IN_TABLE (16): a target whose migrations are behind. */
const SCHEMA_BEHIND_TYPES: readonly unknown[] = ["UNKNOWN_TABLE", "NO_SUCH_COLUMN_IN_TABLE"];
const SCHEMA_BEHIND_CODES: readonly unknown[] = ["60", "16", 60, 16];

/**
 * A schema-behind failure from a private target, named by its organisation, so the boundary
 * answers upgrade_in_progress while that target catches up (T7-F18). Keeps the code and cause.
 */
export class PrivateTargetSchemaError extends Error {
  readonly privateTarget: string;
  readonly code: unknown;
  readonly type: unknown;

  constructor({ privateTarget, cause }: { privateTarget: string; cause: Error }) {
    super(cause.message, { cause });
    this.name = "PrivateTargetSchemaError";
    this.privateTarget = privateTarget;
    this.code = "code" in cause ? cause.code : undefined;
    this.type = "type" in cause ? cause.type : undefined;
  }
}

function isSchemaBehind(error: Error): boolean {
  return (
    ("type" in error && SCHEMA_BEHIND_TYPES.includes(error.type)) ||
    ("code" in error && SCHEMA_BEHIND_CODES.includes(error.code))
  );
}

/** Runs one statement on `vendor`, naming its private target on a schema-behind failure. */
async function onTarget<Client extends RoutableStatementClient, Result>(
  connection: ClickHouseConnection<Client>,
  vendor: Client,
  run: () => Promise<Result>,
): Promise<Result> {
  try {
    return await run();
  } catch (error) {
    throw targetTagged(connection, vendor, error);
  }
}

function targetTagged<Client extends RoutableStatementClient>(
  connection: ClickHouseConnection<Client>,
  vendor: Client,
  error: unknown,
): unknown {
  if (!(error instanceof Error) || !isSchemaBehind(error)) return error;
  const privateTarget = connection.privateTargetOf(vendor);
  return privateTarget === undefined
    ? error
    : new PrivateTargetSchemaError({ privateTarget, cause: error });
}

export function routingDriver<Client extends RoutableStatementClient>(
  connection: ClickHouseConnection<Client>,
): QueryDriver {
  return {
    async insert(request: InsertRequest): Promise<void> {
      const vendor = await serverFor(connection, request);
      await onTarget(connection, vendor, () => vendor.insert(insertParams(request)));
    },

    async command(request: QueryRequest): Promise<void> {
      const vendor = await serverFor(connection, request);
      await onTarget(connection, vendor, () => vendor.command(queryParams(request)));
    },

    async execute<Row>(request: QueryRequest): Promise<QueryResult<Row>> {
      const vendor = await serverFor(connection, request);

      const started = nowInstant().epochMilliseconds;
      const rows = await onTarget(connection, vendor, async () => {
        const resultSet = await vendor.query({
          ...queryParams({ ...request, settings: bufferedReadSettings(request.settings) }),
          format: "JSONEachRow",
        });
        const read = (await resultSet.json()) as Row[];
        refuseInbandException(read);
        return read;
      });
      return { rows, stats: { durationMs: nowInstant().epochMilliseconds - started } };
    },

    async *stream<Row>(request: QueryRequest): AsyncGenerator<Row[]> {
      const vendor = await serverFor(connection, request);
      try {
        const resultSet = await vendor.query({ ...queryParams(request), format: "JSONEachRow" });
        for await (const batch of resultSet.stream<Row>()) {
          const rows = batch.map((row) => row.json());
          refuseInbandException(rows);
          yield rows;
        }
      } catch (error) {
        throw targetTagged(connection, vendor, error);
      }
    },
  };
}
