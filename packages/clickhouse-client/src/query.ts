/**
 * The data a statement is described by, and the port the driver implements.
 *
 * These types used to live in `pipeline.ts` alongside a middleware `compose()`.
 * The composition is now a class — see `client.ts` — and what remains here is
 * only the vocabulary every layer shares, which is why the module is named for
 * the query rather than for the mechanism that runs it.
 */

/** Whether a statement reads or writes, which several policies branch on. */
export type QueryKind = "read" | "write";

/**
 * The part of `AbortSignal` this package uses, declared structurally.
 *
 * A real `AbortSignal` satisfies it. Declaring it here rather than reaching for
 * the DOM or Node lib is what keeps the package buildable without `@types/node`
 * and usable from any host.
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
   * Declares a statement that genuinely has no tenant predicate - DDL, a
   * `system.*` read, a migration, a cross-tenant maintenance sweep.
   *
   * The tenant guard refuses anything untenanted unless this is set, and it is
   * a written reason rather than a boolean on purpose: it has to be typed out
   * by a person, it shows up in review as an added string, and it is recorded
   * on the span so an audit can list every unscoped statement the system ran
   * and why. A boolean would be set to `true` and forgotten.
   */
  unscoped?: { reason: string } | undefined;
}

/**
 * One batch of rows, written to the server the tenant they belong to is on.
 *
 * A write names its tenant the way a read does, and every row carries it: a
 * batch that mixes tenants is refused rather than routed by whichever row
 * happened to be first, so "every statement is scoped to one tenant" holds on
 * the write path without a reader having to remember it.
 */
export interface InsertRequest {
  /**
   * The tenant these rows belong to. Required for the same reason a read's is:
   * no other identifier in this schema is unique across tenants, so a batch
   * that cannot name its tenant cannot be routed.
   */
  tenantId: string;
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
 * The port a real ClickHouse connection implements.
 *
 * One method, so a test double is an object literal and the class under test
 * needs no network. This is the only thing in the package that actually talks
 * to a server; everything else decides whether, when, and how loudly.
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
   * Runs a statement that answers no rows - an `ALTER ... UPDATE`, a `KILL
   * MUTATION`, a `TRUNCATE`. Separate from {@link execute} because a result
   * format may not be appended to one: asking for `JSONEachRow` back from a
   * mutation is a syntax error, not an empty answer.
   */
  command(request: QueryRequest): Promise<void>;
}
