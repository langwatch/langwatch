import {
  ConcurrencyLimiter,
  QueueFullError,
} from "@langwatch/clickhouse-client";
import { createLogger } from "@langwatch/observability";
import { ClickHouseOverloadedError } from "~/server/app-layer/traces/errors";
import { toError } from "~/utils/posthogErrorCapture";
import {
  incrementClickHouseStatementsShed,
  observeClickHouseStatementWait,
  registerClickHouseLimiter,
} from "./metrics";

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

/**
 * The longest a statement may wait for its tenant's turn before it is refused.
 *
 * The analytics routes are served behind a proxy that drops a request after
 * 100 seconds. A statement admitted here can still wait up to
 * `STATEMENT_WAIT_TIMEOUT_MS` (20s) for a process-wide slot and then spend the
 * driver's 30s request timeout on the wire, so 45 seconds here keeps the worst
 * case under that cut. A dashboard of fifteen panels at four at a time is four
 * rounds, so on a project where a panel takes ten seconds the last one still
 * starts inside the bound. A refusal is `ClickHouseOverloadedError`, which is
 * transient, so the panel shows its retry state rather than a hung spinner.
 */
export const TENANT_ANALYTICS_WAIT_TIMEOUT_MS = 45_000;

/** The label the gate's gauges, wait histogram and shed counter carry. */
export const TENANT_ANALYTICS_METRICS_INSTANCE = "tenant-analytics";

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
 *
 * The wait is bounded by depth (`maxQueued`) and by time (`waitTimeoutMs`), and
 * both refusals surface as `ClickHouseOverloadedError`.
 */
export class TenantStatementLimiter {
  private readonly limiters = new Map<string, ConcurrencyLimiter>();
  private readonly maxConcurrent: number;
  private readonly maxQueued: number;
  private readonly waitTimeoutMs: number;
  private readonly metricsInstance: string | undefined;

  constructor({
    maxConcurrent,
    maxQueued = TENANT_ANALYTICS_MAX_QUEUED,
    waitTimeoutMs = TENANT_ANALYTICS_WAIT_TIMEOUT_MS,
    metricsInstance,
  }: {
    maxConcurrent: number;
    maxQueued?: number;
    /** Overridable so a test can prove the bound without spending it. */
    waitTimeoutMs?: number;
    /** Publishes the gate's gauges under this label when set. */
    metricsInstance?: string;
  }) {
    this.maxConcurrent = maxConcurrent;
    this.maxQueued = maxQueued;
    this.waitTimeoutMs = waitTimeoutMs;
    this.metricsInstance = metricsInstance;
    if (metricsInstance) {
      registerClickHouseLimiter(metricsInstance, () => [
        { lane: "read", ...this.totals() },
      ]);
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
    signal?: AbortSignal;
  }): Promise<T> {
    const limiter = this.limiterFor(tenantId);
    const queuedAt = performance.now();
    let isAdmitted = false;
    const wait = createWaitBound({
      signal,
      timeoutMs: this.waitTimeoutMs,
      mustWait: limiter.stats().inFlight >= this.maxConcurrent,
    });

    try {
      return await limiter.run({
        signal: wait.signal,
        task: () => {
          isAdmitted = true;
          wait.dispose();
          this.observeWait(queuedAt);
          return task();
        },
      });
    } catch (error) {
      const refusal = isAdmitted
        ? undefined
        : this.refusalFor({
            error,
            tenantId,
            queuedAt,
            hasTimedOut: wait.hasTimedOut(),
          });
      throw refusal ?? error;
    } finally {
      wait.dispose();
      const { inFlight, queued } = limiter.stats();
      if (inFlight === 0 && queued === 0) this.limiters.delete(tenantId);
    }
  }

  private observeWait(queuedAt: number): void {
    if (!this.metricsInstance) return;
    observeClickHouseStatementWait(
      this.metricsInstance,
      "query",
      (performance.now() - queuedAt) / 1000,
    );
  }

  /**
   * A full queue and a wait that ran out are the same verdict: no turn for this
   * statement. A caller cancelling its own request stays the cancellation it is.
   */
  private refusalFor({
    error,
    tenantId,
    queuedAt,
    hasTimedOut,
  }: {
    error: unknown;
    tenantId: string;
    queuedAt: number;
    hasTimedOut: boolean;
  }): ClickHouseOverloadedError | undefined {
    if (error instanceof QueueFullError) {
      logger.warn(
        { tenantId, maxQueued: error.maxQueued },
        "Refused an analytics statement: tenant wait queue full",
      );
    } else if (hasTimedOut) {
      logger.warn(
        {
          tenantId,
          waitedMs: Math.round(performance.now() - queuedAt),
          timeoutMs: this.waitTimeoutMs,
        },
        "Refused an analytics statement: waited too long for the tenant's turn",
      );
    } else {
      return undefined;
    }
    if (this.metricsInstance) {
      incrementClickHouseStatementsShed(this.metricsInstance, "query");
    }
    return new ClickHouseOverloadedError({ reasons: [toError(error)] });
  }

  /** Everything running and waiting across tenants, for the gauges. */
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

/**
 * The time bound on one statement's wait. Only a statement that has to wait
 * gets a timer, so the common uncontended path allocates neither a timer nor a
 * composed signal. `hasTimedOut` is true only when OUR timer fired, so a caller
 * cancelling its own request is never relabelled as overload.
 */
function createWaitBound({
  signal,
  timeoutMs,
  mustWait,
}: {
  signal: AbortSignal | undefined;
  timeoutMs: number;
  mustWait: boolean;
}): {
  signal: AbortSignal | undefined;
  hasTimedOut: () => boolean;
  dispose: () => void;
} {
  if (!mustWait) {
    return { signal, hasTimedOut: () => false, dispose: () => undefined };
  }
  const controller = new AbortController();
  let hasFired = false;
  const timer = setTimeout(() => {
    hasFired = true;
    controller.abort();
  }, timeoutMs);
  timer.unref?.();
  return {
    signal: signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal,
    hasTimedOut: () => hasFired,
    dispose: () => clearTimeout(timer),
  };
}

/** The process-wide gate the analytics read repositories share. */
export const tenantAnalyticsLimiter = new TenantStatementLimiter({
  maxConcurrent: getTenantAnalyticsConcurrency(),
  metricsInstance: TENANT_ANALYTICS_METRICS_INSTANCE,
});
