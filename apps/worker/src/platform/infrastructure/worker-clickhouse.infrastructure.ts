/**
 * Worker-owned ClickHouse construction: one routed, pooled, bounded connection per process, and its
 * shutdown.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { createClient } from "@clickhouse/client";
import {
  ClickHouseClientFactory,
  ClickHouseConfigService,
  ClickHouseConnectionService,
  ClickHouseManagedClientLogger,
  ClickHouseManagedClientService,
  ClickHouseManagedClientTelemetry,
  ClickHouseOverloadErrorFactory,
  ClickHouseShutdownService,
  VendorClientResiliencePolicy,
  type ClickHouseConnection,
  type ClickHouseVendorClient,
  type ClickHouseVendorClientFactory,
  type ClickHouseVendorClientOptions,
  type LimiterStats,
  type TenantDirectory,
  vendorLoggerClassFor,
} from "@langwatch/clickhouse-client";
import { HandledError } from "@langwatch/handled-error";
import { createLogger, type Logger } from "@langwatch/observability";
import type { ResourceScope } from "@langwatch/runtime-composition";
import type { WorkerClickHouseConfig } from "../config/worker.config";

/**
 * Which organization a tenant belongs to. Declared as the one question the router asks rather than
 * as a Prisma client, because that is all the routing needs. A worker composes it over the client
 * it has already opened.
 */
export type WorkerTenantDirectory = TenantDirectory;

export type WorkerClickHouseInfrastructureOptions = {
  resources: ResourceScope;
  clickhouse: WorkerClickHouseConfig;
  /** Resolves a project's organization, so a private endpoint is reachable. */
  directory: WorkerTenantDirectory;
};

/**
 * This process refused the statement itself: its concurrency slots were taken and its wait queue
 * was full, so the statement never reached ClickHouse. Raised here rather than imported because the
 * package asks the PROCESS what a shedding refusal becomes.
 */
class ClickHouseOverloadedError extends HandledError {
  declare readonly code: "clickhouse_overloaded";

  constructor(options: { reasons?: readonly Error[] } = {}) {
    super("clickhouse_overloaded", "Too many queries in flight", {
      httpStatus: 503,
      fault: "platform",
      reasons: options.reasons,
    });
    this.name = "ClickHouseOverloadedError";
  }
}

class WorkerOverloadErrorFactory extends ClickHouseOverloadErrorFactory {
  create(input: { cause: unknown }): unknown {
    return new ClickHouseOverloadedError({
      reasons: input.cause instanceof Error ? [input.cause] : [],
    });
  }
}

/**
 * The vendor driver, built once per physical endpoint. `@clickhouse/client` is named in exactly
 * this one place: everything above it receives a client the package has already wrapped in retries,
 * a statement limiter and the default query settings.
 */
class WorkerVendorClickHouseClientFactory implements ClickHouseVendorClientFactory<
  ClickHouseClient & ClickHouseVendorClient
> {
  create(options: ClickHouseVendorClientOptions): ClickHouseClient & ClickHouseVendorClient {
    return createClient({
      url: options.url,
      max_open_connections: options.maxOpenConnections,
      request_timeout: options.requestTimeoutMs,
      keep_alive: { enabled: true, idle_socket_ttl: options.idleSocketTtlMs },
      clickhouse_settings: options.driverSettings as Record<string, never>,
      // Without this the driver writes its own console lines —
      // `[2026-09-03T10:58:28Z][ERROR][@clickhouse/client][Connection] …` — a
      // shape nothing else in this lane prints.
      ...(options.vendorLoggerClass === undefined
        ? {}
        : { log: { LoggerClass: options.vendorLoggerClass as never } }),
    }) as ClickHouseClient & ClickHouseVendorClient;
  }
}

/**
 * The statement limiter's counters, as this process reports them. Logged rather than exported as
 * metrics: this process has no prom-client registry to register a gauge against, and shedding still
 * says so out loud, which is the fact an operator acts on.
 */
class LoggingClickHouseTelemetry extends ClickHouseManagedClientTelemetry {
  private readonly logger: Pick<Logger, "warn"> = createLogger("langwatch:worker:clickhouse");

  registerLimiter(_input: { instance: string; stats: () => LimiterStats }): void {}
  unregisterLimiter(_instance: string): void {}
  observeStatementWait(_input: { instance: string; operation: string; seconds: number }): void {}

  incrementStatementsShed(input: { instance: string; operation: string }): void {
    this.logger.warn(
      { instance: input.instance, operation: input.operation },
      "ClickHouse statement shed: every concurrency slot was taken and the wait queue was full",
    );
  }
}

/**
 * Where the client's own decisions are written, the tenant-scope refusal
 * included. Passing it is what turns that refusal from a thrown error nobody
 * sees into a line naming the table and the head of the statement.
 */
class WorkerManagedClickHouseLogger extends ClickHouseManagedClientLogger {
  private readonly logger: Logger = createLogger("langwatch:worker:clickhouse");

  info(fields: Record<string, unknown>, message: string): void {
    this.logger.info(fields, message);
  }

  warn(fields: Record<string, unknown>, message: string): void {
    this.logger.warn(fields, message);
  }

  error(fields: Record<string, unknown>, message: string): void {
    this.logger.error(fields, message);
  }
}

/** The composed policy stack, built once and applied to every endpoint alike. */
const workerManagedClickHouseClientFactory: ClickHouseClientFactory<
  ClickHouseClient & ClickHouseVendorClient
> = ClickHouseManagedClientService.create({
  vendorClientFactory: new WorkerVendorClickHouseClientFactory(),
  vendorLoggerClass: vendorLoggerClassFor(createLogger("langwatch:worker:clickhouse")),
  defaultQuerySettings: {},
  resilience: VendorClientResiliencePolicy.create(),
  telemetry: new LoggingClickHouseTelemetry(),
  overloadErrorFactory: new WorkerOverloadErrorFactory(),
  logger: new WorkerManagedClickHouseLogger(),
});

export class WorkerClickHouseInfrastructure {
  static create(options: WorkerClickHouseInfrastructureOptions): WorkerClickHouseInfrastructure {
    const sharedUrl = options.clickhouse.url?.trim();
    if (!sharedUrl && options.clickhouse.privateRoutes.length === 0) {
      throw new Error(
        "Worker ClickHouse infrastructure requires a configured endpoint: set CLICKHOUSE_URL, or a CLICKHOUSE_URL__<label>__<organizationId> route.",
      );
    }
    const connection = ClickHouseConnectionService.create({
      directory: options.directory,
      clientFactory: workerManagedClickHouseClientFactory,
    }).connect(
      ClickHouseConfigService.create().resolve({
        ...(sharedUrl === undefined ? {} : { shared: { url: sharedUrl, cluster: "shared" } }),
        privateRoutes: options.clickhouse.privateRoutes,
        poolSizing: options.clickhouse.poolSizing,
      }),
    );

    const infrastructure = new WorkerClickHouseInfrastructure(connection);
    options.resources.own("worker ClickHouse infrastructure", () => infrastructure.close());
    return infrastructure;
  }

  private constructor(
    private readonly connection: ClickHouseConnection<ClickHouseClient & ClickHouseVendorClient>,
  ) {}

  /**
   * The tenant-keyed resolver every fold and every append runs through. Bound as a closure rather
   * than handed out as the connection, so a caller cannot reach `shared()` and write one
   * organization's rows on another's endpoint.
   */
  readonly resolveClient = (tenantId: string): Promise<ClickHouseClient> =>
    this.connection.resolve(tenantId);

  /**
   * Every physical endpoint this deployment configured, the shared one and each private route, each
   * labelled with the target it serves. The one question above deliberately answers "the client for
   * THIS tenant", and every fold and append must keep asking only that.
   */
  readonly resolveOrganizationClient = (organizationId: string): ClickHouseClient =>
    this.connection.resolveOrganization(organizationId);

  readonly resolveInstances = async (): Promise<{ target: string; client: ClickHouseClient }[]> => [
    ...this.connection.instances(),
  ];

  close(): Promise<void> {
    return ClickHouseShutdownService.create().shutdown(this.connection);
  }
}
