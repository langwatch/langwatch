import {
  ClickHouseManagedClientTelemetry,
  TenantStatementLimiter,
  type ClickHouseStatementOperation,
  type LimiterStats,
} from "@langwatch/clickhouse-client";
import { createLogger } from "@langwatch/observability";
import { counter, histogram, observableGauge } from "@langwatch/observability/metrics";
import { ClickHouseOverloadedError } from "@langwatch/trace-contract";

/** A dashboard holds a few dozen panels at most; this refuses only a tenant flooding a process. */
export const TENANT_ANALYTICS_MAX_QUEUED = 64;

/**
 * The proxy drops a request after 100s. An admitted statement can still wait 20s for a process
 * slot and spend the driver's 30s timeout, so 45s here keeps the worst case under that cut.
 */
export const TENANT_ANALYTICS_WAIT_TIMEOUT_MS = 45_000;

/** The label the gate's gauges, wait histogram and shed counter carry. */
export const TENANT_ANALYTICS_METRICS_INSTANCE = "tenant-analytics";

/** Read on each export; one probe per limiter instance, replaced when a process rebuilds it. */
const limiterProbes = new Map<string, () => LimiterStats>();
let gaugesRegistered = false;

function registerLimiterGauges(): void {
  if (gaugesRegistered) return;
  gaugesRegistered = true;
  observableGauge(
    {
      name: "clickhouse_statements_in_flight",
      description: "ClickHouse statements this process currently has in flight",
    },
    (observer) => {
      for (const [instance, probe] of limiterProbes) {
        observer.observe(probe().inFlight, { instance, lane: "read" });
      }
    },
  );
  observableGauge(
    {
      name: "clickhouse_statements_queued",
      description: "ClickHouse statements waiting for a concurrency slot in this process",
    },
    (observer) => {
      for (const [instance, probe] of limiterProbes) {
        observer.observe(probe().queued, { instance, lane: "read" });
      }
    },
  );
}

/** The statement limiter's metric port, under the names main's dashboards read. */
class ClickHouseStatementTelemetry extends ClickHouseManagedClientTelemetry {
  static create(): ClickHouseStatementTelemetry {
    return new ClickHouseStatementTelemetry();
  }

  private readonly shed = counter({
    name: "clickhouse_statements_shed_total",
    description: "ClickHouse statements refused because the concurrency wait queue was full",
  });
  private readonly wait = histogram({
    name: "clickhouse_statement_wait_seconds",
    description: "Time a ClickHouse statement waited for a concurrency slot",
  });

  private constructor() {
    super();
  }

  registerLimiter(input: { instance: string; stats: () => LimiterStats }): void {
    limiterProbes.set(input.instance, input.stats);
    registerLimiterGauges();
  }

  unregisterLimiter(instance: string): void {
    limiterProbes.delete(instance);
  }

  observeStatementWait(input: {
    instance: string;
    operation: ClickHouseStatementOperation;
    seconds: number;
  }): void {
    this.wait.observe(input.seconds, { instance: input.instance, operation: input.operation });
  }

  incrementStatementsShed(input: {
    instance: string;
    operation: ClickHouseStatementOperation;
  }): void {
    this.shed.inc({ instance: input.instance, operation: input.operation });
  }
}

/**
 * The per-project gate the analytics panel reads share: a dashboard fires every panel at once,
 * and on a high-volume project they push each other over the ClickHouse memory cap. A refusal is
 * `ClickHouseOverloadedError`, which is transient, so the panel offers a retry.
 */
export class ClickHouseAnalyticsStatementLimitRepository {
  static create({
    maxConcurrent,
    telemetry = ClickHouseStatementTelemetry.create(),
  }: {
    maxConcurrent: number;
    telemetry?: ClickHouseManagedClientTelemetry;
  }): ClickHouseAnalyticsStatementLimitRepository {
    return new ClickHouseAnalyticsStatementLimitRepository(
      new TenantStatementLimiter({
        maxConcurrent,
        maxQueued: TENANT_ANALYTICS_MAX_QUEUED,
        waitTimeoutMs: TENANT_ANALYTICS_WAIT_TIMEOUT_MS,
        metricsInstance: TENANT_ANALYTICS_METRICS_INSTANCE,
        createOverloadError: (cause) =>
          new ClickHouseOverloadedError({
            reasons: [cause instanceof Error ? cause : new Error(String(cause))],
          }),
        telemetry,
        logger: createLogger("langwatch:analytics:tenant-statement-limit"),
      }),
    );
  }

  private constructor(private readonly limiter: TenantStatementLimiter) {}

  /** Runs one read (the query plus draining its rows) once its project has a free slot. */
  run<T>(input: { tenantId: string; task: () => Promise<T> }): Promise<T> {
    return this.limiter.run(input);
  }

  /** How many projects currently have reads in flight or waiting. */
  activeTenantCount(): number {
    return this.limiter.activeTenantCount();
  }
}
