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
  type ClickHouseConfiguration,
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
  ShadowSampler,
  StatementReporter,
  SystemIdentityAbsentErrorFactory,
  TenantGuard,
  vendorLoggerClassFor,
  type StatementMetrics,
  type VendorLogSink,
  type WindowedReadMetrics,
  type ClickHouseClientCreationInput,
  type ClickHouseLaneStats,
  type ClickHouseStatementOperation,
  type IdentityOperation,
  type TenantDirectory,
} from "@langwatch/clickhouse-client";
import { CLICKHOUSE_STATEMENT_RETRY_MESSAGE_FRAGMENTS } from "@langwatch/eventing";
import { HandledError, remediation } from "@langwatch/handled-error";
import type { LimiterStats } from "@langwatch/limiter";
import { createLogger } from "@langwatch/observability";
import { counter, histogram, observableGauge } from "@langwatch/observability/metrics";

import { clickhouseIdentitiesOf, enforcingReaderIdentityOf } from "./clickhouse-identities.ts";
import {
  authenticatedFromFile,
  ClickHousePasswordFile,
  usernameOf,
} from "./clickhouse-password-file.ts";
import type { ClickHouseConfig } from "./config.ts";
import type { BuiltMember } from "./datastore-members.ts";
import { PrivateDataplaneRefusals } from "./private-dataplane-refusal.ts";

/** The vendor client, built once per physical endpoint this process reaches. */
class VendorClickHouseClientFactory extends ClickHouseClientFactory<ClickHouseClient> {
  private readonly logSink = createLogger("langwatch:clickhouse:driver");

  private readonly config: ClickHouseConfig;
  private readonly sharedPasswordFile: ClickHousePasswordFile | undefined;

  constructor({
    config,
    sharedPasswordFile,
  }: {
    config: ClickHouseConfig;
    sharedPasswordFile: ClickHousePasswordFile | undefined;
  }) {
    super();
    this.config = config;
    this.sharedPasswordFile = sharedPasswordFile;
  }

  create(input: ClickHouseClientCreationInput): ClickHouseClient {
    const client = createClient(
      vendorClickHouseClientOptions({ config: this.config, input, logSink: this.logSink }),
    );
    // Only the shared endpoint: a private route carries its own credentials in its URL.
    if (input.instance !== "shared" || this.sharedPasswordFile === undefined) return client;
    return authenticatedFromFile({
      client,
      username: usernameOf(input.url),
      passwordFile: this.sharedPasswordFile,
    });
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

/** A reader-only process asked for a statement only the system identity sends (ADR-202). */
class ClickHouseSystemIdentityAbsentError extends HandledError {
  declare readonly code: "clickhouse_system_identity_absent";

  constructor(
    readonly operation: IdentityOperation,
    readonly table: string | undefined,
  ) {
    super("clickhouse_system_identity_absent", "This process cannot write analytics data", {
      httpStatus: 500,
      fault: "platform",
      ...remediation("clickhouse_system_identity_absent"),
    });
    this.name = "ClickHouseSystemIdentityAbsentError";
  }
}

export class SystemIdentityAbsentRefusal extends SystemIdentityAbsentErrorFactory {
  create({
    operation,
    table,
  }: {
    operation: IdentityOperation;
    table: string | undefined;
  }): unknown {
    return new ClickHouseSystemIdentityAbsentError(operation, table);
  }
}

/**
 * ADR-202 Rollout 3: sampled reader reads re-run on the enforcing identity, counted by table when
 * the policy would hide rows. A private organisation is never sampled: its refusal is no failure.
 */
function shadowSamplerOf({
  driver,
  rate,
}: {
  driver: ReturnType<typeof routingDriver>;
  rate: number;
}): ShadowSampler {
  const diverged = counter({
    name: "clickhouse_shadow_divergence_total",
    description: "Sampled ClickHouse reads whose enforced count differs from the rows returned",
  });
  const failed = counter({
    name: "clickhouse_shadow_rerun_failed_total",
    description: "Sampled ClickHouse reads whose enforcing re-run failed",
  });
  const logger = createLogger("langwatch:clickhouse:shadow");
  return new ShadowSampler({
    driver,
    rate,
    onDivergence: ({ table, returned, enforced }) => {
      diverged.inc({ table });
      logger.warn({ table, returned, enforced }, "the reader's policy would hide rows");
    },
    onFailure: ({ table, error }) => {
      if (HandledError.isHandled(error) && error.code === "private_dataplane_unavailable") return;
      failed.inc({ table });
      logger.warn({ table, error }, "the enforcing re-run failed");
    },
  });
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

/** One connection per identity this process holds (ADR-202); the system's comes first. */
function connectIdentities({
  config,
  directory,
}: {
  config: ClickHouseConfig;
  directory: TenantDirectory;
}) {
  const identities = clickhouseIdentitiesOf({ config });
  // Read before anything opens, so an unreadable file stops the boot by name.
  const sharedPasswordFile =
    identities.system?.shared !== undefined && config.passwordFile
      ? ClickHousePasswordFile.open({ path: config.passwordFile })
      : undefined;
  const connect = (
    configuration: ClickHouseConfiguration,
    passwordFile: ClickHousePasswordFile | undefined,
  ) =>
    ClickHouseConnectionService.create({
      directory,
      clientFactory: new VendorClickHouseClientFactory({
        config,
        sharedPasswordFile: passwordFile,
      }),
      refusal: PrivateDataplaneRefusals.create().forClickHouse(),
      ...(config.maxTenantCacheEntries === undefined
        ? {}
        : { maxTenantCacheEntries: config.maxTenantCacheEntries }),
    }).connect(configuration);
  // The password file is the system user's; the reader's credential is in its URL.
  const system = identities.system && connect(identities.system, sharedPasswordFile);
  const reader = identities.reader && connect(identities.reader, undefined);
  // The writer only where the system is absent: beside it, every insert goes as the system.
  const writer =
    identities.system === undefined && identities.writer
      ? connect(identities.writer, undefined)
      : undefined;
  const enforcingIdentity = enforcingReaderIdentityOf({ config });
  const enforcing = enforcingIdentity && connect(enforcingIdentity, undefined);
  const connections = [system, reader, writer, enforcing].filter((each) => each !== undefined);
  const [connection] = connections;
  const configuration = identities.system ?? identities.reader;
  if (connection === undefined || configuration === undefined) {
    throw new Error("ClickHouse names no endpoint for the system or the reader identity.");
  }
  return { system, reader, writer, enforcing, connections, connection, configuration };
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
  const { system, reader, writer, enforcing, connections, connection, configuration } =
    connectIdentities(options);
  const routes = system === undefined ? config.readerPrivateRoutes : config.privateRoutes;
  const malformedRoutes =
    system === undefined ? config.malformedReaderRoutes : config.malformedRoutes;

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
    driver: system && routingDriver(system),
    readerDriver: reader && routingDriver(reader),
    writerDriver: writer && routingDriver(writer),
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
    systemIdentityAbsentErrorFactory: new SystemIdentityAbsentRefusal(),
    ...(enforcing === undefined || reader === undefined
      ? {}
      : {
          shadowSampler: shadowSamplerOf({
            driver: routingDriver(enforcing),
            rate: config.shadowSampleRate ?? 0,
          }),
        }),
    privateRoutes: new Map((routes ?? []).map((route) => [route.organizationId, route.url])),
    privateRouteVariables: [
      ...(routes ?? []).flatMap(({ organizationId, label, variable }) =>
        variable === undefined
          ? []
          : [{ organizationId, label: label ?? "", variable, state: "present" as const }],
      ),
      ...(malformedRoutes ?? []).map((route) => ({
        ...route,
        state: "malformed" as const,
      })),
    ],
    organizationOf: (tenantId) => connection.organizationOf(tenantId),
    placementOf: (tenantId) => connection.placementOf(tenantId),
  });

  return {
    value: client,
    close: () => {
      telemetry.unregisterLimiter(STATEMENT_BOUND_INSTANCE);
      return Promise.all(
        connections.map((each) => ClickHouseShutdownService.create().shutdown(each)),
      ).then(() => undefined);
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
