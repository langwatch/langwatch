import { type AbortSignalLike, ConcurrencyLimiter, type LimiterStats } from "./rateLimit.ts";
import { StatementWait, statementRefusal } from "./statementWait.ts";

declare const performance: { now(): number };

/** Where a limiter reports load, waits and sheds; the statement-bound telemetry is one. */
export interface LimiterTelemetry {
  registerLimiter(input: {
    instance: string;
    stats: () => LimiterStats;
    lanes?: () => readonly (LimiterStats & { lane: "read" })[];
  }): void;
  observeStatementWait(input: { instance: string; operation: "query"; seconds: number }): void;
  incrementStatementsShed(input: { instance: string; operation: "query" }): void;
}

/** Maps a refusal to the process's public overload error. */
type OverloadErrorFactory = { create(input: { cause: unknown }): unknown };
type LimiterLogger = { warn(fields: Record<string, unknown>, message: string): void };

/** Runs a tenant's work under that tenant's own concurrency bound; past it, refuses as overload. */
export interface TenantStatementLimiter {
  run<T>(input: { tenantId: string; task: () => Promise<T>; signal?: AbortSignalLike }): Promise<T>;
}

/**
 * One limiter per tenant, in this process's memory, made on first use and dropped once idle.
 * Callers wrap the whole read, so a statement waiting its tenant's turn holds no shared slot of
 * the process-wide statement limit. A full queue or a timed-out wait refuses as overload.
 */
export class InProcessTenantStatementLimiter implements TenantStatementLimiter {
  private readonly limiters = new Map<string, ConcurrencyLimiter>();
  private readonly maxConcurrent: number;
  private readonly maxQueued: number;
  private readonly waitTimeoutMs: number;
  private readonly metricsInstance: string;
  private readonly telemetry: LimiterTelemetry | undefined;
  private readonly overloadErrorFactory: OverloadErrorFactory;
  private readonly logger: LimiterLogger | undefined;

  constructor({
    maxConcurrent,
    maxQueued,
    waitTimeoutMs,
    metricsInstance,
    telemetry,
    overloadErrorFactory,
    logger,
  }: {
    maxConcurrent: number;
    maxQueued: number;
    waitTimeoutMs: number;
    metricsInstance: string;
    telemetry?: LimiterTelemetry;
    overloadErrorFactory: OverloadErrorFactory;
    logger?: LimiterLogger;
  }) {
    this.maxConcurrent = maxConcurrent;
    this.maxQueued = maxQueued;
    this.waitTimeoutMs = waitTimeoutMs;
    this.metricsInstance = metricsInstance;
    this.telemetry = telemetry;
    this.overloadErrorFactory = overloadErrorFactory;
    this.logger = logger;
    telemetry?.registerLimiter({
      instance: metricsInstance,
      stats: () => this.totals(),
      lanes: () => [{ lane: "read", ...this.totals() }],
    });
  }

  async run<T>({
    tenantId,
    task,
    signal,
  }: {
    tenantId: string;
    task: () => Promise<T>;
    signal?: AbortSignalLike;
  }): Promise<T> {
    const instance = this.metricsInstance;
    const limiter = this.limiterFor(tenantId);
    const startedAt = performance.now();
    let admitted = false;
    const wait = new StatementWait({ signal, timeoutMs: this.waitTimeoutMs });
    wait.armIf(limiter.stats().inFlight >= this.maxConcurrent);
    try {
      return await limiter.run({
        signal: wait.signal,
        task: () => {
          admitted = true;
          wait.dispose();
          this.telemetry?.observeStatementWait({
            instance,
            operation: "query",
            seconds: (performance.now() - startedAt) / 1_000,
          });
          return task();
        },
      });
    } catch (error) {
      if (admitted) throw error;
      throw statementRefusal({
        error,
        timedOut: wait.hasTimedOut(),
        startedAt,
        timeoutMs: this.waitTimeoutMs,
        subject: "a statement for its tenant",
        logFields: { tenantId },
        logger: this.logger,
        onShed: () => this.telemetry?.incrementStatementsShed({ instance, operation: "query" }),
        createOverload: (input) => this.overloadErrorFactory.create(input),
      });
    } finally {
      wait.dispose();
      const { inFlight, queued } = limiter.stats();
      if (inFlight === 0 && queued === 0) this.limiters.delete(tenantId);
    }
  }

  /** What one tenant is running and has waiting; zeros for an idle tenant. */
  stats(tenantId: string): { inFlight: number; queued: number } {
    return this.limiters.get(tenantId)?.stats() ?? { inFlight: 0, queued: 0 };
  }

  /** How many tenants currently have work in flight or waiting. */
  activeTenantCount(): number {
    return this.limiters.size;
  }

  private totals(): { inFlight: number; queued: number } {
    let inFlight = 0;
    let queued = 0;
    for (const limiter of this.limiters.values()) {
      const stats = limiter.stats();
      inFlight += stats.inFlight;
      queued += stats.queued;
    }
    return { inFlight, queued };
  }

  private limiterFor(tenantId: string): ConcurrencyLimiter {
    let limiter = this.limiters.get(tenantId);
    if (!limiter) {
      limiter = new ConcurrencyLimiter({
        maxConcurrent: this.maxConcurrent,
        maxQueued: this.maxQueued,
      });
      this.limiters.set(tenantId, limiter);
    }
    return limiter;
  }
}
