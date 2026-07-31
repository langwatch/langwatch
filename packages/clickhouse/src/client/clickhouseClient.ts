/**
 * The one ClickHouse client construction path (ADR-104).
 *
 * Today the application has 7 `createClient(...)` call sites and 5 wrapper
 * layers built on top of them, none of which agree on pool size, retry
 * policy, default settings or observability. This module replaces all of
 * them: pool size, retry safety, buffering, the per-tenant bulkhead, async
 * insert and observability are properties of this constructor, not of
 * whichever call site happened to build a client.
 *
 * The wire transport sits behind {@link ClickHouseTransport} rather than
 * being called directly, for two independent reasons. First, `RowBinary` and
 * `Native` are not supported by `@clickhouse/client` today — they are absent
 * from its `SupportedJSONFormats` and `SupportedRawFormats` — so the codec
 * needs a seam to grow a second implementation without reshaping this file.
 * Second, and the reason the tests in this package rely on it: this file has
 * no live ClickHouse to test against, so unit tests inject a fake transport
 * instead. `ClickHouseClientConfig.transport` is that seam; the default,
 * used whenever it is omitted, talks to `@clickhouse/client`.
 */

import { randomUUID } from "node:crypto";
import {
  createClient,
  type DataFormat,
  type ClickHouseClient as DriverClient,
} from "@clickhouse/client";
import { INVALID_TRACE_ID } from "@langwatch/observability";
import { type Span, SpanStatusCode, trace } from "@opentelemetry/api";
import { decideRetry, type Operation, type WriteTarget } from "./retryPolicy";

export type { WriteTarget } from "./retryPolicy";

// ---------------------------------------------------------------------------
// Metrics port
// ---------------------------------------------------------------------------

/**
 * A minimal metrics port, declared locally rather than imported from
 * `@langwatch/event-sourcing` even though the shape is identical.
 *
 * Not because the import would not resolve — `src/stores/` does import that
 * package, since implementing a contract means naming it. It is because of who
 * calls *this* module. ADR-102 keeps `defineTable` and the client here precisely
 * so the consumers that read ClickHouse without touching a projection — the
 * analytics query builders, the governance services under `ee/`, the ops explain
 * paths — can use them without taking an event-sourcing dependency, and a client
 * that imported the core's port would hand every one of them exactly that. So
 * the port is duplicated deliberately, at the layer where the duplication buys
 * the boundary; the store adapters, which exist only to implement the core's
 * contracts, import them directly.
 *
 * There is no shared metrics package to import instead — the application
 * registers `prom-client` collectors against its own registry — so, as in the
 * core, the package declares the small interface it needs and the composition
 * root supplies an implementation.
 */
export type MetricLabels = Readonly<Record<string, string>>;

export interface CounterHandle {
  inc(labels?: MetricLabels, value?: number): void;
}

export interface HistogramHandle {
  observe(value: number, labels?: MetricLabels): void;
}

export interface Metrics {
  counter(spec: {
    readonly name: string;
    readonly help: string;
  }): CounterHandle;
  histogram(spec: {
    readonly name: string;
    readonly help: string;
  }): HistogramHandle;
}

/** A metrics implementation that records nothing, so an unwired client still runs. */
const noopMetrics: Metrics = {
  counter: () => ({ inc: () => undefined }),
  histogram: () => ({ observe: () => undefined }),
};

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * The context a failed ClickHouse operation carries out of this client.
 *
 * Deliberately a plain `Error` subclass, never a `HandledError`
 * (`dev/docs/best_practices/error-handling.md`). The callers of this client
 * are workers and repositories, not an HTTP boundary, and an infrastructure
 * failure at this layer has no customer-actionable remedy for *this* client
 * to name — that translation (memory limit → narrow the query, timeout →
 * same, connection failure → platform incident) belongs to the caller that
 * knows what query it ran and who is waiting on it.
 */
export class ClickHouseOperationError extends Error {
  readonly operation: "query" | "insert" | "stream" | "command";
  readonly tenantId: string;
  readonly queryId: string;
  readonly table?: string;
  override readonly cause: unknown;

  constructor(
    message: string,
    context: {
      operation: "query" | "insert" | "stream" | "command";
      tenantId: string;
      queryId: string;
      table?: string;
      cause: unknown;
    },
  ) {
    super(message);
    this.name = "ClickHouseOperationError";
    this.operation = context.operation;
    this.tenantId = context.tenantId;
    this.queryId = context.queryId;
    this.table = context.table;
    this.cause = context.cause;
  }
}

// ---------------------------------------------------------------------------
// Wire transport seam
// ---------------------------------------------------------------------------

export interface ClickHouseRawQuery {
  readonly sql: string;
  readonly params?: Record<string, unknown>;
  readonly format?: string;
  readonly settings?: Record<string, string | number>;
  readonly queryId: string;
}

export interface ClickHouseRawInsert {
  readonly table: string;
  readonly rows: unknown[][];
  readonly columns: readonly string[];
  readonly settings: Record<string, string | number>;
  readonly queryId: string;
}

export interface ClickHouseRawCommand {
  readonly sql: string;
  readonly params?: Record<string, unknown>;
  readonly settings?: Record<string, string | number>;
  readonly queryId: string;
}

export interface ClickHouseQueryResult {
  readonly rows: unknown[][];
  readonly header?: { readonly names: string[]; readonly types: string[] };
}

/**
 * The wire boundary this client depends on, so tests can supply a fake and
 * the real ClickHouse driver is one interchangeable implementation of it.
 *
 * `query` and `insert` return once the response is fully read — see
 * {@link createNodeTransport} for why `JSONCompactEachRowWithNamesAndTypes` /
 * `JSONCompactEachRow` are the formats used, and ADR-099 for the wider codec
 * decision this client is one adopter of.
 */
export interface ClickHouseTransport {
  query(request: ClickHouseRawQuery): Promise<ClickHouseQueryResult>;
  stream(request: ClickHouseRawQuery): AsyncIterable<unknown[][]>;
  insert(request: ClickHouseRawInsert): Promise<void>;
  /**
   * A statement that returns no rows — `ALTER`, `OPTIMIZE`, `KILL MUTATION`.
   *
   * Separate from {@link query} rather than folded into it, because the two
   * differ in what they may send as much as in what they return: `query`
   * attaches `READ_SETTINGS` to govern how result cells are encoded, and a
   * statement with no result set has no such encoding to govern. Sending them
   * anyway is not merely redundant — a ClickHouse user under a `readonly`
   * profile rejects any client-supplied setting outright.
   */
  command(request: ClickHouseRawCommand): Promise<void>;
  close(): Promise<void>;
}

const DEFAULT_READ_FORMAT: DataFormat = "JSONCompactEachRowWithNamesAndTypes";
const INSERT_FORMAT: DataFormat = "JSONCompactEachRow";

/**
 * Every read carries this, with no override point.
 *
 * `ch.uint64()`/`ch.int64()` decode assuming the wire cell is a quoted JSON
 * string (ADR-099) — the whole reason those columns decode to `bigint`
 * instead of `number` is that a 64-bit value does not fit a JS double past
 * 2^53. That assumption depends on `output_format_json_quote_64bit_integers`,
 * and ClickHouse does **not** default it on: a stock server ships it `0`,
 * which hands back a raw JSON number and silently rounds any value above
 * 2^53 before the codec ever sees it. Unit tests never catch this — a fake
 * transport supplies whichever cell shape the test wrote — only a real
 * server's own JSON encoder can prove the assumption holds.
 */
const READ_SETTINGS = {
  output_format_json_quote_64bit_integers: 1,
} as const;

/**
 * Async-insert settings every write carries, with no override point.
 *
 * `wait_for_async_insert: 0` is prohibited outright (ADR-098, ADR-104 §6):
 * it acknowledges before the data is durable, which breaks the
 * durable-store-first write ordering the fold store depends on, and it
 * surfaces insert errors only in server logs with no backpressure to the
 * writer. Applied once, in {@link createClickHouseClient} rather than inside
 * one transport implementation, so the guarantee holds for every
 * {@link ClickHouseTransport} — including the fake this package's tests use
 * — and not only for the one that happens to talk to `@clickhouse/client`.
 *
 * `input_format_skip_unknown_fields: 0` rides along for the same reason
 * ADR-104 §6 gives it: the server defaults it on, which would silently drop
 * a column the table does not have yet instead of failing the insert so the
 * job retries once the migration lands.
 */
const DURABLE_INSERT_SETTINGS = {
  async_insert: 1,
  wait_for_async_insert: 1,
  input_format_skip_unknown_fields: 0,
} as const;

/**
 * Splits a `JSONCompactEachRowWithNamesAndTypes` result into its header and
 * data rows.
 *
 * That format's NDJSON body is, in order: one line holding the column names
 * as a JSON array, one line holding the column types, then one line per data
 * row — all shaped identically as arrays, so the client cannot tell them
 * apart from a single row's shape alone. `@clickhouse/client`'s `.json()`
 * simply concatenates every line's parse into one array (ADR-099's "codec is
 * positional" section), so the first two entries are always the header when
 * this format was requested.
 */
function splitHeaderRows(parsed: readonly unknown[]): ClickHouseQueryResult {
  const [names, types, ...rows] = parsed as [
    string[] | undefined,
    string[] | undefined,
    ...unknown[][],
  ];
  return {
    rows,
    header: { names: names ?? [], types: types ?? [] },
  };
}

/**
 * The default {@link ClickHouseTransport}, backed by `@clickhouse/client`.
 *
 * Kept to exactly what the transport interface needs — retry, the bulkhead,
 * spans and metrics all live one layer up in {@link createClickHouseClient},
 * so this stays a thin, replaceable translation to the driver's own
 * `query` / `insert` / `stream` calls.
 */
function createNodeTransport(config: {
  url: string;
  database?: string;
  maxOpenConnections: number;
  requestTimeoutMs: number;
}): ClickHouseTransport {
  const driver: DriverClient = createClient({
    url: config.url,
    database: config.database,
    max_open_connections: config.maxOpenConnections,
    request_timeout: config.requestTimeoutMs,
  });

  return {
    async query(request) {
      const format =
        (request.format as DataFormat | undefined) ?? DEFAULT_READ_FORMAT;
      const resultSet = await driver.query({
        query: request.sql,
        query_params: request.params,
        format,
        query_id: request.queryId,
        clickhouse_settings: { ...request.settings, ...READ_SETTINGS },
      });
      const parsed = await resultSet.json<unknown[]>();
      const rows = parsed as unknown as unknown[];
      return format === DEFAULT_READ_FORMAT
        ? splitHeaderRows(rows)
        : { rows: rows as unknown[][] };
    },

    async *stream(request) {
      const format =
        (request.format as DataFormat | undefined) ?? DEFAULT_READ_FORMAT;
      const resultSet = await driver.query({
        query: request.sql,
        query_params: request.params,
        format,
        query_id: request.queryId,
        clickhouse_settings: { ...request.settings, ...READ_SETTINGS },
      });
      // The two header rows arrive as ordinary rows in the stream when this
      // format is used, so they are skipped once, across the whole stream —
      // not once per chunk, since a chunk boundary does not line up with row
      // boundaries.
      let headerRowsToSkip = format === DEFAULT_READ_FORMAT ? 2 : 0;
      for await (const chunk of resultSet.stream<unknown[]>()) {
        const batch: unknown[][] = [];
        for (const row of chunk) {
          const value = row.json<unknown[]>();
          if (headerRowsToSkip > 0) {
            headerRowsToSkip--;
            continue;
          }
          batch.push(value);
        }
        if (batch.length > 0) yield batch;
      }
    },

    async insert(request) {
      await driver.insert({
        table: request.table,
        values: request.rows,
        format: INSERT_FORMAT,
        columns: request.columns as unknown as [string, ...string[]],
        clickhouse_settings: request.settings,
        query_id: request.queryId,
      });
    },

    async command(request) {
      await driver.command({
        query: request.sql,
        query_params: request.params,
        // Only what the caller asked for. No `READ_SETTINGS` — see the
        // transport interface for why a statement with no result set must not
        // carry output-format settings.
        clickhouse_settings: request.settings,
        query_id: request.queryId,
      });
    },

    async close() {
      await driver.close();
    },
  };
}

// ---------------------------------------------------------------------------
// Tracing
// ---------------------------------------------------------------------------

const TRACER_NAME = "langwatch:clickhouse:client";

async function withSpan<T>(
  name: string,
  attributes: Record<string, string | number>,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const tracer = trace.getTracer(TRACER_NAME);
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(
        error instanceof Error ? error : new Error(String(error)),
      );
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * The `query_id` family for one operation: `<traceId>-<uuid>`, or just `<uuid>`
 * outside any trace context — a migration script or a cron job, for instance.
 *
 * The trace id is a *prefix*, not the id itself, so a slow query found in
 * `system.query_log` still joins back to its trace by a `LIKE` on the prefix
 * (ADR-104 §8) while every id stays unique. A `query_id` must be: ClickHouse
 * refuses a query carrying an id that is already running
 * (`QUERY_WITH_SAME_ID_IS_ALREADY_RUNNING`), so a bare trace id would make any
 * two concurrent queries under one trace — a request that reads two tables, a
 * `Promise.all` over three tenants — fail each other.
 *
 * Each attempt then appends its own number ({@link attemptQueryId}), because a
 * retry can be issued while the server is still executing the attempt that
 * timed out from this side; reusing that attempt's id would turn a transient
 * failure into a hard rejection instead of a retry.
 */
function deriveQueryIdFamily(): string {
  const traceId = trace.getActiveSpan()?.spanContext().traceId;
  const unique = randomUUID();
  return traceId && traceId !== INVALID_TRACE_ID
    ? `${traceId}-${unique}`
    : unique;
}

function attemptQueryId(family: string, attempt: number): string {
  return `${family}-${attempt}`;
}

// ---------------------------------------------------------------------------
// Per-tenant concurrency bulkhead
// ---------------------------------------------------------------------------

/**
 * Bounds how many operations one tenant may have in flight against this
 * client at once, strictly below the pool size (ADR-104 §4).
 *
 * Without it, a single tenant issuing several concurrent unpruned scans
 * occupies the whole connection pool and every other tenant's point read
 * queues behind work that has up to `requestTimeoutMs` to fail in. This is a
 * fair (FIFO) queue rather than a hard rejection: over the limit, the next
 * caller waits for a slot in arrival order instead of being admitted out of
 * turn or dropped.
 */
class TenantBulkhead {
  private readonly limit: number;
  private readonly active = new Map<string, number>();
  private readonly waiters = new Map<string, Array<() => void>>();
  private readonly waitTime: HistogramHandle;

  constructor(limit: number, metrics: Metrics) {
    this.limit = limit;
    this.waitTime = metrics.histogram({
      name: "clickhouse_bulkhead_wait_seconds",
      help: "Time an operation spent queued behind this client's per-tenant concurrency limit.",
    });
  }

  async run<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire(tenantId);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  /**
   * Waits for a slot and returns a function that gives it back.
   *
   * Public (rather than folded into {@link run}) so a caller that cannot
   * express its critical section as a single `Promise` — an async generator
   * whose body spans a `for await` loop, in {@link createClickHouseClient}'s
   * `stream` — can still hold the slot for exactly its own lifetime,
   * releasing it from a `finally` around the generator instead.
   */
  async acquire(tenantId: string): Promise<() => void> {
    const start = performance.now();
    await this.waitForSlot(tenantId);
    this.waitTime.observe((performance.now() - start) / 1000);

    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.release(tenantId);
    };
  }

  private waitForSlot(tenantId: string): Promise<void> {
    const current = this.active.get(tenantId) ?? 0;
    if (current < this.limit) {
      this.active.set(tenantId, current + 1);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const queue = this.waiters.get(tenantId) ?? [];
      queue.push(resolve);
      this.waiters.set(tenantId, queue);
    });
  }

  private release(tenantId: string): void {
    const queue = this.waiters.get(tenantId);
    const next = queue?.shift();
    if (next) {
      // Hand the slot directly to the next waiter (FIFO) rather than
      // decrementing and letting a fresh caller race it for the same slot.
      if (queue !== undefined && queue.length === 0)
        this.waiters.delete(tenantId);
      next();
      return;
    }
    if (queue !== undefined) this.waiters.delete(tenantId);
    const remaining = (this.active.get(tenantId) ?? 0) - 1;
    // A tenant with nothing in flight is forgotten rather than left as a zero
    // entry. These maps are keyed by tenant id, and every tenant that has ever
    // issued one query would otherwise hold an entry for the life of the
    // process — a slow leak proportional to tenant count, in a long-lived
    // worker, for state that means "nothing is happening".
    if (remaining <= 0) {
      this.active.delete(tenantId);
      return;
    }
    this.active.set(tenantId, remaining);
  }
}

// ---------------------------------------------------------------------------
// Public client
// ---------------------------------------------------------------------------

export interface ClickHouseClientConfig {
  readonly url: string;
  readonly database?: string;
  /** @default 10 — `@clickhouse/client`'s own default. */
  readonly maxOpenConnections?: number;
  /** @default 30_000 */
  readonly requestTimeoutMs?: number;
  readonly maxConcurrentPerTenant?: number;
  readonly observability?: { metrics?: Metrics };
  /**
   * Injection seam for the wire transport. Unit tests in this package supply
   * a fake here so they never require a live ClickHouse; omitted in
   * production, where a transport talking to `@clickhouse/client` is built
   * from the rest of this config.
   */
  readonly transport?: ClickHouseTransport;
}

export interface QueryOptions {
  readonly tenantId: string;
  readonly sql: string;
  readonly params?: Record<string, unknown>;
  readonly format?: string;
  readonly settings?: Record<string, string | number>;
}

export interface ClickHouseClient {
  query(options: QueryOptions): Promise<{
    rows: unknown[][];
    header?: { names: string[]; types: string[] };
  }>;
  stream(options: QueryOptions): AsyncIterable<unknown[][]>;
  insert(options: {
    tenantId: string;
    table: string;
    rows: unknown[][];
    columns: readonly string[];
    target: WriteTarget;
    /**
     * Additional server settings for this write, applied *beneath*
     * {@link DURABLE_INSERT_SETTINGS} — the three durability settings are
     * merged last and always win, so this cannot be used to reach
     * `wait_for_async_insert: 0` or to re-enable `input_format_skip_unknown_fields`
     * (ADR-098, ADR-104 §6). It exists for settings that govern how the wire
     * cells are *parsed* rather than whether the write is durable, the live
     * case being `date_time_input_format: "best_effort"` for a caller that
     * sends an ISO-8601 timestamp string a stock server's `basic` parser
     * rejects.
     */
    settings?: Record<string, string | number>;
  }): Promise<void>;
  /**
   * A statement that returns no rows — `ALTER … DELETE`, `ALTER … UPDATE`,
   * `OPTIMIZE`, `KILL MUTATION`, `MODIFY TTL`.
   *
   * Never retried, and that is the whole reason it is its own method rather
   * than a `query` whose result is discarded. Retry safety for a write is
   * decided by the destination table's merge strategy, and a statement like
   * this has no destination row to reason about: re-sending an
   * `ALTER … UPDATE` that timed out starts a *second* mutation over the same
   * range while the first is still running. `Operation`'s `ddl` kind carries
   * that refusal (`retryPolicy.ts`), so a caller cannot opt into a retry here
   * by mistake.
   *
   * `tenantId` routes and bulkheads the statement exactly as it does for a
   * read, and does not scope it — a mutation still needs its own `WHERE
   * TenantId = …`, and needs it more than a read does, because the failure
   * mode is deleting another tenant's rows rather than showing them.
   */
  command(options: {
    tenantId: string;
    sql: string;
    params?: Record<string, unknown>;
    settings?: Record<string, string | number>;
  }): Promise<void>;
  close(): Promise<void>;
}

const DEFAULT_MAX_OPEN_CONNECTIONS = 10;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/**
 * A per-table counter/histogram pair, registered once per metric name so a
 * hot path never re-registers a collector (`Metrics`'s contract).
 */
function createOperationMetrics(metrics: Metrics) {
  const duration = metrics.histogram({
    name: "clickhouse_operation_duration_seconds",
    help: "Duration of a ClickHouse client operation, labelled by table and outcome.",
  });
  const total = metrics.counter({
    name: "clickhouse_operation_total",
    help: "Count of ClickHouse client operations, labelled by table and outcome.",
  });
  return { duration, total };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createClickHouseClient(
  config: ClickHouseClientConfig,
): ClickHouseClient {
  const maxOpenConnections =
    config.maxOpenConnections ?? DEFAULT_MAX_OPEN_CONNECTIONS;
  const requestTimeoutMs =
    config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  // Half the pool, and never zero, so the bulkhead is meaningfully below the
  // pool size (ADR-104 §4) even for a caller who never tunes it.
  const maxConcurrentPerTenant =
    config.maxConcurrentPerTenant ??
    Math.max(1, Math.floor(maxOpenConnections / 2));
  const metrics = config.observability?.metrics ?? noopMetrics;

  const transport =
    config.transport ??
    createNodeTransport({
      url: config.url,
      database: config.database,
      maxOpenConnections,
      requestTimeoutMs,
    });

  const bulkhead = new TenantBulkhead(maxConcurrentPerTenant, metrics);
  const operationMetrics = createOperationMetrics(metrics);

  async function runWithRetry<T>(args: {
    operation: Operation;
    label: "query" | "insert" | "stream" | "command";
    tenantId: string;
    table?: string;
    attempt: (queryId: string) => Promise<T>;
  }): Promise<T> {
    const queryIdFamily = deriveQueryIdFamily();
    return withSpan(
      `clickhouse.${args.label}`,
      {
        "clickhouse.tenant_id": args.tenantId,
        "clickhouse.query_id_family": queryIdFamily,
      },
      async () => {
        const start = performance.now();
        let attempt = 1;
        for (;;) {
          const queryId = attemptQueryId(queryIdFamily, attempt);
          try {
            const result = await args.attempt(queryId);
            recordOutcome({
              label: args.label,
              table: args.table,
              start,
              outcome: "success",
            });
            return result;
          } catch (error) {
            const decision = decideRetry({
              operation: args.operation,
              error,
              attempt,
            });
            if (!decision.retry) {
              recordOutcome({
                label: args.label,
                table: args.table,
                start,
                outcome: "error",
              });
              throw new ClickHouseOperationError(
                `ClickHouse ${args.label} failed: ${decision.reason}`,
                {
                  operation: args.label,
                  tenantId: args.tenantId,
                  queryId,
                  table: args.table,
                  cause: error,
                },
              );
            }
            attempt = decision.attempt;
            await sleep(decision.afterMs);
          }
        }
      },
    );
  }

  function recordOutcome(args: {
    label: string;
    table?: string;
    start: number;
    outcome: "success" | "error";
  }): void {
    const labels = {
      operation: args.label,
      table: args.table ?? "unknown",
      outcome: args.outcome,
    };
    operationMetrics.duration.observe(
      (performance.now() - args.start) / 1000,
      labels,
    );
    operationMetrics.total.inc(labels);
  }

  return {
    async query(options) {
      return bulkhead.run(options.tenantId, () =>
        runWithRetry({
          operation: { kind: "select" },
          label: "query",
          tenantId: options.tenantId,
          attempt: (queryId) =>
            transport.query({
              sql: options.sql,
              params: options.params,
              format: options.format,
              settings: options.settings,
              queryId,
            }),
        }),
      );
    },

    stream(options) {
      // Streaming holds a connection open for as long as the caller takes to
      // consume it (ADR-104 §5), so unlike `query` it is not retried
      // transparently: a partial failure has already yielded rows to the
      // caller, and re-issuing the request would either duplicate them or
      // require buffering everything already streamed — which is exactly the
      // pool-exhaustion cost streaming exists to avoid. The bulkhead slot is
      // held for the lifetime of the returned iterable, released whether the
      // caller consumes it fully, breaks early, or throws.
      const tenantId = options.tenantId;
      async function* run(): AsyncIterable<unknown[][]> {
        // A stream is never retried, so its family has exactly one attempt.
        const queryId = attemptQueryId(deriveQueryIdFamily(), 1);
        const release = await bulkhead.acquire(tenantId);
        const start = performance.now();
        try {
          for await (const batch of transport.stream({
            sql: options.sql,
            params: options.params,
            format: options.format,
            settings: options.settings,
            queryId,
          })) {
            yield batch;
          }
          recordOutcome({ label: "stream", start, outcome: "success" });
        } catch (error) {
          recordOutcome({ label: "stream", start, outcome: "error" });
          throw new ClickHouseOperationError(`ClickHouse stream failed`, {
            operation: "stream",
            tenantId,
            queryId,
            cause: error,
          });
        } finally {
          release();
        }
      }
      return run();
    },

    async insert(options) {
      // Nothing to send, so nothing to route through the bulkhead, the
      // retry loop or the driver — an empty batch is a no-op, not a query
      // against zero rows.
      if (options.rows.length === 0) return;
      return bulkhead.run(options.tenantId, () =>
        runWithRetry({
          operation: { kind: "insert", target: options.target },
          label: "insert",
          tenantId: options.tenantId,
          table: options.table,
          attempt: (queryId) =>
            transport.insert({
              table: options.table,
              rows: options.rows,
              columns: options.columns,
              // Durability last: a caller's settings may add to the write but
              // may never weaken it.
              settings: { ...options.settings, ...DURABLE_INSERT_SETTINGS },
              queryId,
            }),
        }),
      );
    },

    async command(options) {
      return bulkhead.run(options.tenantId, () =>
        runWithRetry({
          operation: { kind: "ddl" },
          label: "command",
          tenantId: options.tenantId,
          attempt: (queryId) =>
            transport.command({
              sql: options.sql,
              params: options.params,
              settings: options.settings,
              queryId,
            }),
        }),
      );
    },

    async close() {
      await transport.close();
    },
  };
}
