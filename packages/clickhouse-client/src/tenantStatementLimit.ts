/**
 * A per-tenant gate in front of the process-wide statement limit: each tenant gets its own
 * concurrency limiter, created on first use and dropped once the tenant has nothing running or
 * waiting, so one tenant's burst queues behind itself and never holds other tenants' slots.
 */

import type { ClickHouseManagedClientTelemetry } from "./managed-client.ts";
import type { AbortSignalLike } from "./query.ts";
import { ConcurrencyLimiter, type LimiterStats } from "./rateLimit.ts";
import {
  createStatementWait,
  statementRefusal,
  type StatementRefusalLogger,
} from "./statementWait.ts";

declare const performance: { now(): number };

export interface TenantStatementLimiterOptions {
  /** Statements one tenant may run at once. */
  maxConcurrent: number;
  /** Statements one tenant may have waiting; past it a statement is refused. */
  maxQueued: number;
  /** The longest a statement may wait for its tenant's turn before it is refused. */
  waitTimeoutMs: number;
  /** Maps a refusal to the process's transient overload error. */
  createOverloadError: (cause: unknown) => unknown;
  /** Publishes the gate's gauges, wait histogram and shed counter under `metricsInstance`. */
  telemetry?: ClickHouseManagedClientTelemetry | undefined;
  metricsInstance?: string | undefined;
  logger?: StatementRefusalLogger | undefined;
}

/**
 * Callers wrap the whole read (the query plus draining its rows), so the slot is held for one
 * statement's run, in-place retries included. Waiting is bounded by depth and by time, and both
 * refusals surface as the overload error the caller's factory builds.
 */
export class TenantStatementLimiter {
  private readonly limiters = new Map<string, ConcurrencyLimiter>();
  private readonly options: TenantStatementLimiterOptions;

  constructor(options: TenantStatementLimiterOptions) {
    if (!Number.isInteger(options.maxConcurrent) || options.maxConcurrent < 1) {
      throw new RangeError("maxConcurrent must be a positive integer");
    }
    this.options = options;
    const { telemetry, metricsInstance } = options;
    if (telemetry !== undefined && metricsInstance !== undefined) {
      telemetry.registerLimiter({ instance: metricsInstance, stats: () => this.totals() });
    }
  }

  async run<T>({
    tenantId,
    task,
    signal,
  }: {
    tenantId: string;
    task: () => Promise<T>;
    /** The caller's cancellation; aborting it while waiting gives up the turn. */
    signal?: AbortSignalLike | undefined;
  }): Promise<T> {
    const { maxConcurrent, waitTimeoutMs } = this.options;
    const limiter = this.limiterFor(tenantId);
    const startedAt = performance.now();
    let isAdmitted = false;
    const wait = createStatementWait({ signal, waitTimeoutMs });
    wait.armIfSaturated(limiter.stats().inFlight >= maxConcurrent);

    try {
      return await limiter.run({
        signal: wait.signal,
        task: () => {
          isAdmitted = true;
          wait.dispose();
          this.observeWait(startedAt);
          return task();
        },
      });
    } catch (error) {
      const refused = statementRefusal({
        error,
        isAdmitted,
        hasTimedOut: wait.hasTimedOut(),
        startedAt,
        waitTimeoutMs,
        logger: this.options.logger,
        subject: "a statement for its tenant",
        logFields: { tenantId },
        createOverloadError: this.options.createOverloadError,
        onShed: () => this.recordShed(),
      });
      throw refused === undefined ? error : refused.refusal;
    } finally {
      wait.dispose();
      const { inFlight, queued } = limiter.stats();
      if (inFlight === 0 && queued === 0) this.limiters.delete(tenantId);
    }
  }

  /** What one tenant is running and has waiting; zeros for an idle tenant. */
  stats(tenantId: string): LimiterStats {
    return this.limiters.get(tenantId)?.stats() ?? { inFlight: 0, queued: 0 };
  }

  /** How many tenants currently have work in flight or waiting. */
  activeTenantCount(): number {
    return this.limiters.size;
  }

  /** Everything running and waiting across tenants, for the gauges. */
  private totals(): LimiterStats {
    let inFlight = 0;
    let queued = 0;
    for (const limiter of this.limiters.values()) {
      const stats = limiter.stats();
      inFlight += stats.inFlight;
      queued += stats.queued;
    }
    return { inFlight, queued };
  }

  private observeWait(startedAt: number): void {
    const { telemetry, metricsInstance } = this.options;
    if (telemetry === undefined || metricsInstance === undefined) return;
    telemetry.observeStatementWait({
      instance: metricsInstance,
      operation: "query",
      seconds: (performance.now() - startedAt) / 1_000,
    });
  }

  private recordShed(): void {
    const { telemetry, metricsInstance } = this.options;
    if (telemetry === undefined || metricsInstance === undefined) return;
    telemetry.incrementStatementsShed({ instance: metricsInstance, operation: "query" });
  }

  private limiterFor(tenantId: string): ConcurrencyLimiter {
    let limiter = this.limiters.get(tenantId);
    if (!limiter) {
      limiter = new ConcurrencyLimiter({
        maxConcurrent: this.options.maxConcurrent,
        maxQueued: this.options.maxQueued,
      });
      this.limiters.set(tenantId, limiter);
    }
    return limiter;
  }
}
