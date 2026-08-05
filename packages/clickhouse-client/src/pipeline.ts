/**
 * The composition core.
 *
 * Everything this package does to a query - tenant checks, rate limiting,
 * retries, tracing, logging - is a middleware over one function type. There is
 * no base class and nothing to extend: behaviour is added by wrapping, and the
 * order of the wrapping is the order of the behaviour, visible at the call site
 * rather than buried in an inheritance chain.
 *
 *     const execute = compose([
 *       tenantGuard({ ... }),   // outermost: refuse before spending anything
 *       trace({ ... }),
 *       rateLimit({ ... }),     // hold the slot across retries, not per attempt
 *       retry({ ... }),
 *     ])(driver);
 *
 * A middleware may inspect the request, refuse it, alter it, call `next` zero,
 * one or many times, and inspect or replace the result. That is the whole
 * contract, and it is why retry (calls `next` many times) and rate limiting
 * (calls it once, holding a slot) compose without knowing about each other.
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
  addEventListener(
    type: "abort",
    listener: () => void,
    options?: { once?: boolean },
  ): void;
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
  settings?: Record<string, string> | undefined;
  /** Cooperative cancellation. Middleware should stop retrying when aborted. */
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

export interface QueryResult<Row> {
  rows: Row[];
  /** Whatever the driver knows about the execution. All fields optional. */
  stats?: {
    rowsRead?: number | undefined;
    bytesRead?: number | undefined;
    durationMs?: number | undefined;
  };
}

/** The one function type every layer of this package speaks. */
export type QueryExecutor = <Row>(
  request: QueryRequest,
) => Promise<QueryResult<Row>>;

/** Wraps an executor to add one behaviour. */
export type QueryMiddleware = (next: QueryExecutor) => QueryExecutor;

/**
 * Compose middleware into a single wrapper, applied left to right: the first
 * entry is the outermost layer and sees the request first.
 *
 * An empty list composes to the identity, so a caller can build a pipeline from
 * a filtered array without special-casing the empty case.
 */
export function compose(
  middleware: readonly QueryMiddleware[],
): QueryMiddleware {
  return (executor) =>
    middleware.reduceRight((next, wrap) => wrap(next), executor);
}
