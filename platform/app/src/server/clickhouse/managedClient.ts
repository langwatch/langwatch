import { type ClickHouseClient, createClient } from "@clickhouse/client";
import {
  ClickHouseManagedClientLogger,
  ClickHouseManagedClientService,
  ClickHouseManagedClientTelemetry,
  ClickHouseOverloadErrorFactory,
  ClickHouseVendorClientFactory,
  VendorClientPolicy,
  VendorClientResiliencePolicy,
  createResilientVendorClient,
  type StatementLogSink,
  type StatementMetrics,
  type VendorStatementClient,
} from "@langwatch/clickhouse-client";
import { CLICKHOUSE_TRANSIENT_MESSAGE_FRAGMENTS } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import { detectColdScan } from "~/server/app-layer/clients/clickhouse/cold-scan-detector";
import { translateClickHouseQueryError } from "~/server/app-layer/clients/clickhouse/translate-query-error";
import { queryWindowed } from "~/server/app-layer/clients/clickhouse/windowed-read";
import { toError } from "~/utils/posthogErrorCapture";
import { ClickHouseOverloadedError } from "../app-layer/traces/errors";
import { ClickHouseLogger } from "./clickhouseLogger";
import { getClickHouseMaxOpenConnections } from "./connectionPool";
import {
  incrementClickHouseQueryCount,
  incrementClickHouseStatementsShed,
  observeClickHouseQueryDuration,
  observeClickHouseStatementWait,
  registerClickHouseLimiter,
  unregisterClickHouseLimiter,
} from "./metrics";
import { DEFAULT_CLICKHOUSE_SETTINGS } from "./queryDefaults";

const logger = createLogger("langwatch:clickhouse:managed-client");

export type ResilientClickHouseClient = ClickHouseClient & {
  queryWindowed: typeof queryWindowed;
};

export const SHARED_INSTANCE = "shared";
export const CLICKHOUSE_REQUEST_TIMEOUT_MS = 30_000;

class PlatformVendorClientFactory extends ClickHouseVendorClientFactory<ClickHouseClient> {
  create(input: {
    url: string;
    instance: string;
    cluster: string;
    maxOpenConnections: number;
    requestTimeoutMs: number;
    idleSocketTtlMs: number;
    driverSettings: Readonly<Record<string, string | number | boolean | undefined>>;
    vendorLoggerClass?: unknown;
  }): ClickHouseClient {
    let url: URL | string = input.url;
    try {
      url = new URL(input.url);
    } catch {
      logger.warn(
        { instance: input.instance },
        "ClickHouse URL was not a valid URL, it will still be set, but may not work as expected.",
      );
    }

    return createClient({
      url,
      clickhouse_settings: input.driverSettings,
      max_open_connections: input.maxOpenConnections,
      request_timeout: input.requestTimeoutMs,
      keep_alive: {
        enabled: true,
        idle_socket_ttl: input.idleSocketTtlMs,
      },
      ...(input.vendorLoggerClass === ClickHouseLogger
        ? { log: { LoggerClass: ClickHouseLogger } }
        : {}),
    });
  }
}

export class PlatformManagedClientLogger extends ClickHouseManagedClientLogger {
  info(fields: Record<string, unknown>, message: string): void {
    logger.info(fields, message);
  }

  warn(fields: Record<string, unknown>, message: string): void {
    logger.warn(fields, message);
  }
}

export class PlatformManagedClientTelemetry extends ClickHouseManagedClientTelemetry {
  registerLimiter(input: {
    instance: string;
    stats: () => { inFlight: number; queued: number };
  }): void {
    registerClickHouseLimiter(input.instance, input.stats);
  }

  unregisterLimiter(instance: string): void {
    unregisterClickHouseLimiter(instance);
  }

  observeStatementWait(input: {
    instance: string;
    operation: "query" | "insert" | "command" | "exec";
    seconds: number;
  }): void {
    observeClickHouseStatementWait(input.instance, input.operation, input.seconds);
  }

  incrementStatementsShed(input: {
    instance: string;
    operation: "query" | "insert" | "command" | "exec";
  }): void {
    incrementClickHouseStatementsShed(input.instance, input.operation);
  }
}

export class PlatformOverloadErrorFactory extends ClickHouseOverloadErrorFactory {
  create({ cause }: { cause: unknown }): ClickHouseOverloadedError {
    return new ClickHouseOverloadedError({ reasons: [toError(cause)] });
  }
}

class PlatformStatementMetrics implements StatementMetrics {
  observeDuration({
    queryType,
    table,
    durationSeconds,
  }: {
    queryType: "SELECT" | "INSERT" | "OTHER";
    table: string;
    durationSeconds: number;
  }): void {
    observeClickHouseQueryDuration(queryType, table, durationSeconds);
  }

  incrementCount({
    queryType,
    outcome,
  }: {
    queryType: "SELECT" | "INSERT" | "OTHER";
    outcome: "success" | "error" | "inband_error";
  }): void {
    incrementClickHouseQueryCount(queryType, outcome);
  }
}

class PlatformStatementLogger implements StatementLogSink {
  private readonly logger: StatementLogSink;

  static create(name: string): PlatformStatementLogger {
    return new PlatformStatementLogger(createLogger(name));
  }

  private constructor(logger: StatementLogSink) {
    this.logger = logger;
  }

  debug(fields: Record<string, unknown>, message: string): void {
    this.logger.debug(fields, message);
  }

  warn(fields: Record<string, unknown>, message: string): void {
    this.logger.warn(fields, message);
  }

  error(fields: Record<string, unknown>, message: string): void {
    this.logger.error(fields, message);
  }
}

class PlatformQueryErrorTranslator {
  static translate({ error, durationMs }: { error: unknown; durationMs: number }): unknown {
    return translateClickHouseQueryError(error, durationMs);
  }
}

class PlatformVendorClientResiliencePolicy extends VendorClientPolicy {
  static create({
    maxRetries = 3,
    baseDelayMs = 500,
    maxDelayMs = 10_000,
  }: {
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
  } = {}): PlatformVendorClientResiliencePolicy {
    const policy = VendorClientResiliencePolicy.create({
      maxRetries,
      baseDelayMs,
      maxDelayMs,
      transientMessageFragments: CLICKHOUSE_TRANSIENT_MESSAGE_FRAGMENTS,
      metrics: new PlatformStatementMetrics(),
      noticeLogger: PlatformStatementLogger.create("langwatch:clickhouse:resilient"),
      outcomeLogger: PlatformStatementLogger.create("langwatch:clickhouse:query"),
      translateQueryError: PlatformQueryErrorTranslator.translate,
      detectColdScan,
    });
    return new PlatformVendorClientResiliencePolicy(policy);
  }

  private constructor(private readonly policy: VendorClientPolicy) {
    super();
  }

  wrap<Client extends VendorStatementClient>(client: Client, cluster: string): Client {
    return this.policy.wrap(client, cluster);
  }
}

export const platformManagedClickHouseClientFactory = ClickHouseManagedClientService.create({
  vendorClientFactory: new PlatformVendorClientFactory(),
  defaultQuerySettings: DEFAULT_CLICKHOUSE_SETTINGS,
  resilience: PlatformVendorClientResiliencePolicy.create(),
  telemetry: new PlatformManagedClientTelemetry(),
  overloadErrorFactory: new PlatformOverloadErrorFactory(),
  logger: new PlatformManagedClientLogger(),
  vendorLoggerClass: ClickHouseLogger,
});

/** Compatibility construction adapter while API and worker compose physical graphs. */
export function createManagedClickHouseClient({
  url,
  instance,
  cluster = instance,
}: {
  url: string;
  instance: string;
  cluster?: string;
}): ResilientClickHouseClient {
  const client = platformManagedClickHouseClientFactory.create({
    url,
    instance,
    cluster,
    maxOpenConnections: getClickHouseMaxOpenConnections(),
  });
  return Object.assign(client, { queryWindowed });
}

/** Test-only compatibility wrapper for legacy resilience/error-mapping coverage. */
export function createResilientClickHouseClientForTest({
  client,
  cluster = "shared",
  maxRetries,
  baseDelayMs,
  maxDelayMs,
}: {
  client: ClickHouseClient;
  cluster?: string;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}): ResilientClickHouseClient {
  return Object.assign(
    createResilientVendorClient({
      client,
      cluster,
      policy: PlatformVendorClientResiliencePolicy.create({ maxRetries, baseDelayMs, maxDelayMs }),
    }),
    { queryWindowed },
  );
}
