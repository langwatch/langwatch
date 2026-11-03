/** One ClickHouse client that routes itself. Modules never resolve endpoints
 * because every statement carries tenantId filtering, enforced by this driver. */
import {
  createClient,
  type ClickHouseClient,
  type ClickHouseClientConfigOptions,
  type ClickHouseSettings,
} from "@clickhouse/client";
import {
  ClickHouseClientFactory,
  ClickHouseConfigService,
  ClickHouseConnectionService,
  ClickHouseManagedClientTelemetry,
  ClickHouseOverloadErrorFactory,
  ClickHouseQueryClient,
  ClickHouseShutdownService,
  ClickHouseStatementAdmission,
  ClickHouseUnavailableErrorFactory,
  detectColdScan,
  RetryPolicy,
  routingDriver,
  setIdIndexMissLogger,
  setWindowedReadMetrics,
  StatementReporter,
  TenantGuard,
  vendorLoggerClassFor,
  type StatementMetrics,
  type VendorLogSink,
  type WindowedReadMetrics,
  type ClickHouseClientCreationInput,
  type ClickHouseLaneStats,
  type ClickHouseStatementOperation,
  type TenantDirectory,
} from "@langwatch/clickhouse-client";
import { CLICKHOUSE_STATEMENT_RETRY_MESSAGE_FRAGMENTS } from "@langwatch/eventing";
import { HandledError, remediation } from "@langwatch/handled-error";
import type { LimiterStats } from "@langwatch/limiter";
import { createLogger } from "@langwatch/observability";
import { counter, histogram, observableGauge } from "@langwatch/observability/metrics";

import type { ClickHouseConfig } from "./config.ts";
import type { BuiltMember } from "./datastore-members.ts";
import { PrivateDataplaneRefusals } from "./private-dataplane-refusal.ts";

/** The vendor client, built once per physical endpoint this process reaches. */
class VendorClickHouseClientFactory extends ClickHouseClientFactory<ClickHouseClient> {
  private readonly logSink = createLogger("langwatch:clickhouse:driver");

  constructor(private readonly config: ClickHouseConfig) {
    super();
  }

  create(input: ClickHouseClientCreationInput): ClickHouseClient {
    return createClient(
      vendorClickHouseClientOptions({ config: this.config, input, logSink: this.logSink }),
    );
  }
}

/**
 * The driver logs through the process's logger, whose policy drops the driver's own error: the
 * retry wrapper warns per attempt, and only the final failure reaches the caller.
 */
export function vendorClickHouseClientOptions({
  config,
  input,
  logSink,
}: {
  config: ClickHouseConfig;
  input: Pick<ClickHouseClientCreationInput, "url" | "maxOpenConnections">;
  logSink: VendorLogSink;
}): ClickHouseClientConfigOptions {
  return {
    url: input.url,
    max_open_connections: input.maxOpenConnections,
    ...(config.requestTimeoutMs === undefined ? {} : { request_timeout: config.requestTimeoutMs }),
    clickhouse_settings: vendorClickHouseSettings(config.settings),
    log: { LoggerClass: vendorLoggerClassFor(logSink) },
  };
}

/** JS Dates travel as ISO strings, which ClickHouse parses only best-effort, as main always set. */
export function vendorClickHouseSettings(
  settings: ClickHouseConfig["settings"],
): ClickHouseSettings {
  // The id-index view dedup setting is per insert (routingDriver), since async inserts refuse it.
  return { date_time_input_format: "best_effort", ...settings };
}

/** Per-statement latency and outcome counts, under the names main's dashboards read. */
function clickHouseStatementMetrics(): StatementMetrics {
  const duration = histogram({
    name: "clickhouse_query_duration_seconds",
    description: "Duration of ClickHouse queries in seconds",
  });
  const total = counter({
    name: "clickhouse_query_total",
    description: "Total number of ClickHouse queries",
  });

  return {
    observeDuration: ({ queryType, table, durationSeconds }) =>
      duration.observe(durationSeconds, { query_type: queryType, table }),
    incrementCount: ({ queryType, outcome }) =>
      total.inc({ query_type: queryType, status: outcome }),
  };
}

/** Windowed reads by table and the path each took, under main's metric name. */
function clickHouseWindowedReadMetrics(): WindowedReadMetrics {
  const total = counter({
    name: "clickhouse_windowed_read_total",
    description: "Total number of ClickHouse windowed reads by table and outcome",
  });

  return { record: ({ table, outcome }) => total.inc({ table, outcome }) };
}

/** Every statement or batch that skipped the tenant check, counted by table and logged at debug. */
function skippedTenantChecks(): TenantGuard {
  const skipped = counter({
    name: "clickhouse_tenant_check_skipped_total",
    description: "ClickHouse statements and batches that set SKIP_TENANT_CHECK",
  });
  const logger = createLogger("langwatch:clickhouse:tenant-guard");

  return new TenantGuard({
    onUnscoped: ({ operation, table, tenantId }) => {
      skipped.inc({ operation, table });
      logger.debug({ operation, table, tenantId }, "tenant check skipped");
    },
  });
}

/** The statement bound fronts every endpoint the routed client reaches, so it reports as one. */
const STATEMENT_BOUND_INSTANCE = "routed";

/**
 * Main's refusal for a statement no slot freed for in time (origin/main traces/errors.ts). A
 * package may not import the trace contract's twin; both answer the one registered code.
 */
class ClickHouseOverloadedError extends HandledError {
  declare readonly code: "clickhouse_overloaded";

  constructor(options: { reasons?: readonly Error[] } = {}) {
    super("clickhouse_overloaded", "Too many queries in flight", {
      httpStatus: 503,
      fault: "platform",
      retryable: true,
      ...remediation("clickhouse_overloaded"),
      reasons: options.reasons,
    });
    this.name = "ClickHouseOverloadedError";
  }
}

export class OverloadedRefusal extends ClickHouseOverloadErrorFactory {
  create({ cause }: { cause: unknown }): unknown {
    return new ClickHouseOverloadedError({ reasons: cause instanceof Error ? [cause] : [] });
  }
}

/** Main's refusal for a read whose ClickHouse did not answer (analytics-contract's twin). */
class ClickHouseUnavailableError extends HandledError {
  declare readonly code: "clickhouse_unavailable";

  constructor(options: { reasons?: readonly Error[] } = {}) {
    super("clickhouse_unavailable", "Database temporarily unavailable", {
      httpStatus: 503,
      fault: "platform",
      ...remediation("clickhouse_unavailable"),
      reasons: options.reasons,
    });
    this.name = "ClickHouseUnavailableError";
  }
}

export class UnavailableRefusal extends ClickHouseUnavailableErrorFactory {
  create({ cause }: { cause: Error }): unknown {
    return new ClickHouseUnavailableError({ reasons: [cause] });
  }
}

/** One entry per lane, so a saturated insert lane cannot hide behind an idle read lane. */
const limiterProbes = new Map<string, () => readonly ClickHouseLaneStats[]>();

observableGauge(
  {
    name: "clickhouse_statements_in_flight",
    description: "ClickHouse statements this process currently has in flight",
  },
  (observer) => {
    for (const [instance, lanes] of limiterProbes) {
      for (const { lane, inFlight } of lanes()) observer.observe(inFlight, { instance, lane });
    }
  },
);

observableGauge(
  {
    name: "clickhouse_statements_queued",
    description: "ClickHouse statements waiting for a concurrency slot in this process",
  },
  (observer) => {
    for (const [instance, lanes] of limiterProbes) {
      for (const { lane, queued } of lanes()) observer.observe(queued, { instance, lane });
    }
  },
);

/** Slot waits, refusals and the queue, under main's names (origin/main clickhouse/metrics.ts). */
export class StatementBoundTelemetry extends ClickHouseManagedClientTelemetry {
  private readonly wait = histogram({
    name: "clickhouse_statement_wait_seconds",
    description: "Time a ClickHouse statement waited for a concurrency slot",
  });
  private readonly shed = counter({
    name: "clickhouse_statements_shed_total",
    description: "ClickHouse statements refused because the concurrency wait queue was full",
  });

  registerLimiter({
    instance,
    stats,
    lanes,
  }: {
    instance: string;
    stats: () => LimiterStats;
    lanes?: () => readonly ClickHouseLaneStats[];
  }): void {
    limiterProbes.set(instance, lanes ?? (() => [{ lane: "all", ...stats() }]));
  }

  unregisterLimiter(instance: string): void {
    limiterProbes.delete(instance);
  }

  observeStatementWait({
    instance,
    operation,
    seconds,
  }: {
    instance: string;
    operation: ClickHouseStatementOperation;
    seconds: number;
  }): void {
    this.wait.observe(seconds, { instance, operation });
  }

  incrementStatementsShed({
    instance,
    operation,
  }: {
    instance: string;
    operation: ClickHouseStatementOperation;
  }): void {
    this.shed.inc({ instance, operation });
  }
}

/**
 * The routed client, and the close that shuts every endpoint it opened. The
 * tenant guard is outermost, so a statement that cannot name its tenant is
 * refused before it costs a route lookup, a slot or a socket.
 */
export function buildClickHouse(options: {
  config: ClickHouseConfig;
  directory: TenantDirectory;
}): BuiltMember<ClickHouseQueryClient> {
  const { config } = options;
  const sharedUrl = config.url?.trim();
  const configuration = ClickHouseConfigService.create().resolve({
    ...(sharedUrl ? { shared: { url: sharedUrl, cluster: "shared" } } : {}),
    privateRoutes: (config.privateRoutes ?? []).map((route) => ({
      organizationId: route.organizationId,
      url: route.url,
      // A credential-free operator label. The organization's own id is the
      // only name this process knows that is safe to print.
      cluster: route.organizationId,
    })),
    malformedPrivateRoutes: config.malformedRoutes ?? [],
    ...(config.poolSizing === undefined ? {} : { poolSizing: config.poolSizing }),
  });

  const connection = ClickHouseConnectionService.create({
    directory: options.directory,
    clientFactory: new VendorClickHouseClientFactory(config),
    refusal: PrivateDataplaneRefusals.create().forClickHouse(),
    ...(config.maxTenantCacheEntries === undefined
      ? {}
      : { maxTenantCacheEntries: config.maxTenantCacheEntries }),
  }).connect(configuration);

  setWindowedReadMetrics(clickHouseWindowedReadMetrics());
  setIdIndexMissLogger(createLogger("langwatch:clickhouse:id-index"));
  const reporter = new StatementReporter({
    metrics: clickHouseStatementMetrics(),
    noticeLogger: createLogger("langwatch:clickhouse:resilient"),
    outcomeLogger: createLogger("langwatch:clickhouse:query"),
    detectColdScan,
  });

  const telemetry = new StatementBoundTelemetry();
  const admission = new ClickHouseStatementAdmission({
    instance: STATEMENT_BOUND_INSTANCE,
    maxConcurrent: config.maxConcurrentStatements ?? configuration.poolSizing.size,
    telemetry,
    overloadErrorFactory: new OverloadedRefusal(),
    logger: createLogger("langwatch:clickhouse:statement-limit"),
    reserveShare: config.statementLaneReserveShare,
  });
  telemetry.registerLimiter({
    instance: STATEMENT_BOUND_INSTANCE,
    stats: () => admission.stats(),
    lanes: () => admission.laneStats(),
  });

  const client = new ClickHouseQueryClient({
    driver: routingDriver(connection),
    tenantGuard: skippedTenantChecks(),
    retries: new RetryPolicy({
      transientMessageFragments: CLICKHOUSE_STATEMENT_RETRY_MESSAGE_FRAGMENTS,
      onRetry: ({ request, attempt, maxAttempts, delayMs, error, level }) =>
        reporter.retryNotice({
          operation: request?.kind === "write" ? "insert" : "query",
          attempt,
          maxAttempts,
          delayMs,
          error,
          level,
        }),
    }),
    reporter,
    limiter: admission,
    unavailableErrorFactory: new UnavailableRefusal(),
    overloadErrorFactory: new OverloadedRefusal(),
    privateRoutes: new Map(
      (config.privateRoutes ?? []).map((route) => [route.organizationId, route.url]),
    ),
    privateRouteVariables: [
      ...(config.privateRoutes ?? []).flatMap(({ organizationId, label, variable }) =>
        variable === undefined
          ? []
          : [{ organizationId, label: label ?? "", variable, state: "present" as const }],
      ),
      ...(config.malformedRoutes ?? []).map((route) => ({
        ...route,
        state: "malformed" as const,
      })),
    ],
    organizationOf: (tenantId) => connection.organizationOf(tenantId),
  });

  return {
    value: client,
    close: () => {
      telemetry.unregisterLimiter(STATEMENT_BOUND_INSTANCE);
      return ClickHouseShutdownService.create().shutdown(connection);
    },
    // The shared endpoint only: one organisation's private route never makes the process unready.
    ...(configuration.shared === undefined
      ? {}
      : {
          answer: async () => {
            const result = await connection.shared().ping();
            if (!result.success) throw result.error;
          },
        }),
  };
}
