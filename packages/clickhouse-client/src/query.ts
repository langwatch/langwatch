/**
 * The data a statement is described by, and the port the driver implements.
 * These types used to share `pipeline.ts` with a middleware `compose()`, now
 * a class in `client.ts` — this module keeps only the shared vocabulary.
 */

/** Whether a statement reads or writes, which several policies branch on. */
export type QueryKind = "read" | "write";

/**
 * The part of `AbortSignal` this package uses, declared structurally so a
 * real `AbortSignal` satisfies it without reaching for the DOM or Node lib —
 * keeps the package buildable without `@types/node`, usable from any host.
 */
export interface AbortSignalLike {
  readonly aborted: boolean;
  addEventListener(type: "abort", listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: "abort", listener: () => void): void;
}

export interface QueryRequest {
  /**
   * The tenant this statement belongs to. Required, and not optional by
   * oversight: no other identifier in this schema is unique across tenants, so
   * a request that cannot name its tenant cannot be routed or audited safely.
   */
  tenantId: string;
  /** Route an organisation-wide operation directly; tenant scope checks still apply. */
  organizationId?: string;
  sql: string;
  params?: Record<string, unknown> | undefined;
  /** The primary table, used for metrics and span attributes. */
  table?: string | undefined;
  kind?: QueryKind | undefined;
  /** Per-query ClickHouse settings, e.g. a `max_memory_usage` cap. */
  settings?: Record<string, string | number> | undefined;
  /** Cooperative cancellation. Policies should stop retrying when aborted. */
  signal?: AbortSignalLike | undefined;
  /**
   * Declares a statement with no tenant predicate (DDL, `system.*`, a
   * migration, a cross-tenant sweep). A written reason, not a boolean: it's
   * recorded on the span so an audit can list every unscoped statement and why.
   */
  unscoped?: { reason: string } | undefined;
}

/**
 * One batch of rows, written to the server their tenant is on. A batch that
 * mixes tenants is refused rather than routed by whichever row came first,
 * so "every statement scopes to one tenant" holds without a reader remembering.
 */
export interface InsertRequest {
  /**
   * The tenant these rows belong to. Required for the same reason a read's is:
   * no other identifier in this schema is unique across tenants, so a batch
   * that cannot name its tenant cannot be routed.
   */
  tenantId: string;
  /** Route to the known billing organisation without changing the rows' tenant. */
  organizationId?: string;
  /** The table the rows are written to. */
  table: string;
  /**
   * Read-only on purpose: nothing here mutates the batch it is handed, and
   * saying so lets a caller holding a `readonly` row array write without
   * copying every row.
   */
  rows: readonly Readonly<Record<string, unknown>>[];
  /** Per-insert ClickHouse settings, e.g. `async_insert`. */
  settings?: Record<string, string | number> | undefined;
  /** Cooperative cancellation. Policies should stop retrying when aborted. */
  signal?: AbortSignalLike | undefined;
}

export interface QueryResult<Row> {
  rows: Row[];
  /** Whatever the driver knows about the execution. All fields optional. */
  stats?:
    | {
        rowsRead?: number | undefined;
        bytesRead?: number | undefined;
        durationMs?: number | undefined;
      }
    | undefined;
}

/**
 * The port a real ClickHouse connection implements — one method, so a test
 * double is an object literal and the class under test needs no network.
 * The only thing in the package that actually talks to a server.
 */
export interface QueryDriver {
  execute<Row>(request: QueryRequest): Promise<QueryResult<Row>>;
  /**
   * Writes one batch. Separate from {@link execute} because an insert carries
   * rows rather than text, and because the tenant guard checks a batch by
   * reading its rows rather than by reading a predicate out of SQL.
   */
  insert(request: InsertRequest): Promise<void>;
  /**
   * Runs a statement with no rows back (`ALTER ... UPDATE`, `KILL MUTATION`,
   * `TRUNCATE`). Separate from {@link execute}: appending a result format to
   * one is a syntax error, not an empty answer.
   */
  command(request: QueryRequest): Promise<void>;
}
