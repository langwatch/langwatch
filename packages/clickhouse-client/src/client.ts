/**
 * The composition core: one class running its policies in a fixed, load-
 * bearing order (tenant guard, tracing, concurrency limit, retry), written
 * as nesting in {@link ClickHouseQueryClient.query} rather than an array's
 * index. Concurrency sits outside retry deliberately — a slot must survive
 * a retry, or a retrying statement rejoins the queue and turns a small
 * overload into a persistent one.
 */

import type { ConcurrencyLimiter } from "./rateLimit.ts";
import type { InsertRequest, QueryDriver, QueryRequest, QueryResult } from "./query.ts";
import type { RetryPolicy } from "./retry.ts";
import type { QueryTracer } from "./tracing.ts";
import type { TenantGuard } from "./tenantGuard.ts";

export interface ClickHouseQueryClientOptions {
  /** The only collaborator that talks to a server. */
  driver: QueryDriver;
  /** Refuses statements with no tenant predicate. Omit to allow everything. */
  tenantGuard?: TenantGuard | undefined;
  /** Records a span per statement. Omit to record none. */
  tracer?: QueryTracer | undefined;
  /** Bounds statements in flight and sheds when the wait queue is full. */
  limiter?: ConcurrencyLimiter | undefined;
  /** Retries transient failures. Omit to try exactly once. */
  retries?: RetryPolicy | undefined;
}

export class ClickHouseQueryClient {
  private readonly driver: QueryDriver;
  private readonly tenantGuard: TenantGuard | undefined;
  private readonly tracer: QueryTracer | undefined;
  private readonly limiter: ConcurrencyLimiter | undefined;
  private readonly retries: RetryPolicy | undefined;

  constructor({ driver, tenantGuard, tracer, limiter, retries }: ClickHouseQueryClientOptions) {
    this.driver = driver;
    this.tenantGuard = tenantGuard;
    this.tracer = tracer;
    this.limiter = limiter;
    this.retries = retries;
  }

  /**
   * Run one statement under every policy this client was given.
   *
   * Reads top to bottom as the order described on the class. Each step is a
   * plain call rather than a wrap, so an absent policy is a skipped line and
   * not a hole in a chain.
   */
  async query<Row>(request: QueryRequest): Promise<QueryResult<Row>> {
    this.tenantGuard?.assert(request);

    const runOnce = () => this.driver.execute<Row>(request);
    const withRetries = () =>
      this.retries === undefined
        ? runOnce()
        : this.retries.run(runOnce, { signal: request.signal, request });

    // The slot wraps the retries, so it is held for the whole statement.
    const withSlot = () =>
      this.limiter === undefined
        ? withRetries()
        : this.limiter.run({ task: withRetries, signal: request.signal });

    return this.tracer === undefined ? withSlot() : this.tracer.trace({ request, task: withSlot });
  }

  /**
   * Run a statement that answers no rows, under every policy this client was
   * given. Same order, same reasons as {@link query}.
   */
  async command(request: QueryRequest): Promise<void> {
    this.tenantGuard?.assert(request);

    const runOnce = () => this.driver.command(request);
    const withRetries = () =>
      this.retries === undefined
        ? runOnce()
        : this.retries.run(runOnce, { signal: request.signal, request });

    if (this.limiter === undefined) return withRetries();
    await this.limiter.run({ task: withRetries, signal: request.signal });
  }

  /**
   * Write one batch under every policy this client was given.
   *
   * The same order as {@link query}, for the same reasons: the guard refuses a
   * batch that is not one tenant's before it costs a slot or a socket, and a
   * retrying insert keeps its slot rather than rejoining the queue.
   */
  async insert(request: InsertRequest): Promise<void> {
    this.tenantGuard?.assertInsert(request);
    if (request.rows.length === 0) return;

    const runOnce = () => this.driver.insert(request);
    const withRetries = () =>
      this.retries === undefined
        ? runOnce()
        : this.retries.run(runOnce, {
            signal: request.signal,
            request: {
              tenantId: request.tenantId,
              sql: `INSERT INTO ${request.table}`,
              table: request.table,
              kind: "write",
            },
          });

    if (this.limiter === undefined) return withRetries();
    await this.limiter.run({ task: withRetries, signal: request.signal });
  }
}
