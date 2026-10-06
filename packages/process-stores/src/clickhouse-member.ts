/** One ClickHouse client that routes itself. Modules never resolve endpoints
 * because every statement carries tenantId filtering, enforced by this driver. */
import { createClient, type ClickHouseClient, type ClickHouseSettings } from "@clickhouse/client";
import {
  ClickHouseClientFactory,
  ClickHouseConfigService,
  ClickHouseConnectionService,
  ClickHouseManagedClientTelemetry,
  ClickHouseOverloadErrorFactory,
  ClickHouseQueryClient,
  ClickHouseShutdownService,
  ClickHouseStatementAdmission,
  detectColdScan,
  RetryPolicy,
  routingDriver,
  setWindowedReadMetrics,
  StatementReporter,
  TenantGuard,
  type StatementMetrics,
  type WindowedReadMetrics,
  type ClickHouseClientCreationInput,
  type ClickHouseStatementOperation,
  type LimiterStats,
  type TenantDirectory,
} from "@langwatch/clickhouse-client";
import { CLICKHOUSE_TRANSIENT_MESSAGE_FRAGMENTS } from "@langwatch/eventing";
import { HandledError, remediation } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import { counter, histogram, observableGauge } from "@langwatch/observability/metrics";

import type { ClickHouseConfig } from "./config.ts";
import type { BuiltMember } from "./datastore-members.ts";

/** The vendor client, built once per physical endpoint this process reaches. */
class VendorClickHouseClientFactory extends ClickHouseClientFactory<ClickHouseClient> {
  constructor(private readonly config: ClickHouseConfig) {
    super();
  }

  create(input: ClickHouseClientCreationInput): ClickHouseClient {
    return createClient({
      url: input.url,
      max_open_connections: input.maxOpenConnections,
      ...(this.config.requestTimeoutMs === undefined
        ? {}
        : { request_timeout: this.config.requestTimeoutMs }),
      clickhouse_settings: vendorClickHouseSettings(this.config.settings),
    });
  }
}

/** JS Dates travel as ISO strings, which ClickHouse parses only best-effort, as main always set. */
export function vendorClickHouseSettings(
  settings: ClickHouseConfig["settings"],
): ClickHouseSettings {
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

class OverloadedRefusal extends ClickHouseOverloadErrorFactory {
  create({ cause }: { cause: unknown }): unknown {
    return new ClickHouseOverloadedError({ reasons: cause instanceof Error ? [cause] : [] });
  }
}

const limiterProbes = new Map<string, () => LimiterStats>();

observableGauge(
  {
    name: "clickhouse_statements_in_flight",
    description: "ClickHouse statements this process currently has in flight",
  },
  (observer) => {
    for (const [instance, stats] of limiterProbes) observer.observe(stats().inFlight, { instance });
  },
);

observableGauge(
  {
    name: "clickhouse_statements_queued",
    description: "ClickHouse statements waiting for a concurrency slot in this process",
  },
  (observer) => {
    for (const [instance, stats] of limiterProbes) observer.observe(stats().queued, { instance });
  },
);

/** Slot waits, refusals and the queue, under main's names (origin/main clickhouse/metrics.ts). */
class StatementBoundTelemetry extends ClickHouseManagedClientTelemetry {
  private readonly wait = histogram({
    name: "clickhouse_statement_wait_seconds",
    description: "Time a ClickHouse statement waited for a concurrency slot",
  });
  private readonly shed = counter({
    name: "clickhouse_statements_shed_total",
    description: "ClickHouse statements refused because the concurrency wait queue was full",
  });

  registerLimiter({ instance, stats }: { instance: string; stats: () => LimiterStats }): void {
    limiterProbes.set(instance, stats);
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
    ...(config.poolSizing === undefined ? {} : { poolSizing: config.poolSizing }),
  });

  const connection = ClickHouseConnectionService.create({
    directory: options.directory,
    clientFactory: new VendorClickHouseClientFactory(config),
    ...(config.maxTenantCacheEntries === undefined
      ? {}
      : { maxTenantCacheEntries: config.maxTenantCacheEntries }),
  }).connect(configuration);

  setWindowedReadMetrics(clickHouseWindowedReadMetrics());
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
  });
  telemetry.registerLimiter({ instance: STATEMENT_BOUND_INSTANCE, stats: () => admission.stats() });

  const client = new ClickHouseQueryClient({
    driver: routingDriver(connection),
    tenantGuard: new TenantGuard(),
    retries: new RetryPolicy({
      transientMessageFragments: CLICKHOUSE_TRANSIENT_MESSAGE_FRAGMENTS,
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
    privateRoutes: new Map(
      (config.privateRoutes ?? []).map((route) => [route.organizationId, route.url]),
    ),
  });

  return {
    value: client,
    close: () => {
      telemetry.unregisterLimiter(STATEMENT_BOUND_INSTANCE);
      return ClickHouseShutdownService.create().shutdown(connection);
    },
  };
}
