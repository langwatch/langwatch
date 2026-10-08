import {
  ConcurrencyLimiter,
  QueueFullError,
} from "@langwatch/clickhouse-client";
import { createLogger } from "@langwatch/observability";
import { ClickHouseOverloadedError } from "~/server/app-layer/traces/errors";
import { toError } from "~/utils/posthogErrorCapture";

const logger = createLogger("langwatch:clickhouse:tenant-statement-limit");

/**
 * Heavy analytics statements one tenant may run at once in this process.
 *
 * A dashboard load fires every panel at the same moment, about fifteen of them,
 * and each panel's query scans the whole date range. Run together they share
 * one tenant's data and the server's memory, and on a high-volume project they
 * push each other over the per-query memory cap. Four at a time keeps the
 * dashboard moving while the rest wait their turn.
 */
export const DEFAULT_TENANT_ANALYTICS_CONCURRENCY = 4;

/**
 * How many statements one tenant may have waiting. A dashboard holds a few
 * dozen panels at most, so this only refuses a tenant that is flooding the
 * process, and a refusal is transient (`ClickHouseOverloadedError`).
 */
export const TENANT_ANALYTICS_MAX_QUEUED = 64;

const ENV_VAR = "CLICKHOUSE_TENANT_ANALYTICS_CONCURRENCY";

/**
 * Read from `CLICKHOUSE_TENANT_ANALYTICS_CONCURRENCY`. A positive integer
 * overrides the default; a blank value is unset; anything else is a typo, so
 * it warns and keeps the default.
 */
export function getTenantAnalyticsConcurrency(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env[ENV_VAR];
  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_TENANT_ANALYTICS_CONCURRENCY;
  }
  const parsed = Number(raw);
  if (Number.isInteger(parsed) && parsed > 0) return parsed;
  logger.warn(
    { raw, using: DEFAULT_TENANT_ANALYTICS_CONCURRENCY },
    `Invalid ${ENV_VAR}; using default`,
  );
  return DEFAULT_TENANT_ANALYTICS_CONCURRENCY;
}

/**
 * One concurrency limiter per tenant, created on first use and dropped as soon
 * as the tenant has nothing running or waiting, so the map holds only the
 * tenants with work in flight.
 *
 * Callers wrap the whole read (`client.query` plus draining the result), which
 * puts this gate OUTSIDE the process-wide statement limit in
 * `./statementLimit.ts`: a panel waiting for its tenant's turn holds no shared
 * statement slot, so one tenant's dashboard queue never blocks other tenants'
 * statements. The slot is held for one statement's whole run, the resilient
 * client's in-place retries included, so a retry does not go to the back of its
 * tenant's queue. A statement over the memory limit is not retried in place,
 * so it releases its slot as soon as ClickHouse refuses it.
 */
export class TenantStatementLimiter {
  private readonly limiters = new Map<string, ConcurrencyLimiter>();
  private readonly maxConcurrent: number;
  private readonly maxQueued: number;

  constructor({
    maxConcurrent,
    maxQueued = TENANT_ANALYTICS_MAX_QUEUED,
  }: {
    maxConcurrent: number;
    maxQueued?: number;
  }) {
    this.maxConcurrent = maxConcurrent;
    this.maxQueued = maxQueued;
  }

  async run<T>({
    tenantId,
    task,
  }: {
    tenantId: string;
    task: () => Promise<T>;
  }): Promise<T> {
    const limiter = this.limiterFor(tenantId);
    let isAdmitted = false;
    try {
      return await limiter.run({
        task: () => {
          isAdmitted = true;
          return task();
        },
      });
    } catch (error) {
      if (!isAdmitted && error instanceof QueueFullError) {
        logger.warn(
          { tenantId, maxQueued: error.maxQueued },
          "Refused an analytics statement: tenant wait queue full",
        );
        throw new ClickHouseOverloadedError({ reasons: [toError(error)] });
      }
      throw error;
    } finally {
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

/** The process-wide gate the analytics read repositories share. */
export const tenantAnalyticsLimiter = new TenantStatementLimiter({
  maxConcurrent: getTenantAnalyticsConcurrency(),
});
