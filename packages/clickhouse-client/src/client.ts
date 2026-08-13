/**
 * The composition core: one class that owns its policies and runs them in a
 * fixed, stated order.
 *
 * This replaces a middleware `compose()`. The behaviours are the same and so is
 * their order; what changed is that the order is now written out as nesting in
 * one method instead of being implied by a list's index. A reader asking "does
 * a retry keep its concurrency slot?" reads {@link ClickHouseQueryClient.query}
 * and sees the answer, rather than inferring it from the position of two
 * entries in an array.
 *
 * The order is load-bearing, and each step is here for a recorded reason:
 *
 *  1. **Tenant guard** — outermost, so a statement that cannot name its tenant
 *     is refused before it costs a span, a slot, or a socket.
 *  2. **Tracing** — outside the limiter, so queue time is inside the span. Time
 *     spent waiting for a slot is latency the caller experienced; a span that
 *     started after the wait would report a fast query on a slow request.
 *  3. **Concurrency limit** — outside retry, NOT inside. A slot is held across
 *     retries. Inside, a retrying statement would release its slot, rejoin the
 *     back of the queue and compete with fresh work, which is how a queue turns
 *     a small overload into a persistent one.
 *  4. **Retry** — innermost, wrapping the driver, so it retries the statement
 *     and nothing else.
 *
 * Every collaborator is injected and every one is optional. A client with no
 * policies is a thin pass-through to the driver, which is what makes the class
 * usable in a test without standing up four dependencies to assert on one.
 */

import type { ConcurrencyLimiter } from "./rateLimit";
import type { QueryDriver, QueryRequest, QueryResult } from "./query";
import type { RetryPolicy } from "./retry";
import type { QueryTracer } from "./tracing";
import type { TenantGuard } from "./tenantGuard";

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

  constructor({
    driver,
    tenantGuard,
    tracer,
    limiter,
    retries,
  }: ClickHouseQueryClientOptions) {
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
        : this.limiter.run(withRetries, request.signal);

    return this.tracer === undefined
      ? withSlot()
      : this.tracer.trace(request, withSlot);
  }
}
