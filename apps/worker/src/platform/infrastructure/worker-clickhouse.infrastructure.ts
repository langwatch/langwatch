/**
 * Worker-owned ClickHouse construction: one routed, pooled, bounded connection
 * per process, and its shutdown.
 *
 * The event store, every fold and every projection resolve their client
 * through here, and the resolution is TENANT-KEYED rather than global: a
 * project belonging to an organization with its own endpoint reaches that
 * endpoint, and everything else reaches the shared one. That routing is
 * `@langwatch/clickhouse-client`'s, not this module's — what this module owns
 * is the three process-shaped decisions the package deliberately does not
 * make: which vendor driver to build, how many sockets it may hold, and what a
 * refused statement becomes.
 *
 * UNLIKE THE API, THERE IS NO ABSENCE ARM. A worker without an event store
 * cannot fold anything; the packaged consumer refusal already says so, and a
 * process that composed a connection over a blank string would discover the
 * problem on its first append instead of at boot.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { createClient } from "@clickhouse/client";
import {
  ClickHouseClientFactory,
  ClickHouseConfigService,
  ClickHouseConnectionService,
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
} from "@langwatch/clickhouse-client";
import { HandledError } from "@langwatch/handled-error";
import { createLogger, type Logger } from "@langwatch/observability";
import type { ResourceScope } from "@langwatch/runtime-composition";
import type { WorkerClickHouseConfig } from "../config/worker.config";

/**
 * Which organization a tenant belongs to.
 *
 * Declared as the one question the router asks rather than as a Prisma client,
 * because that is all the routing needs. A worker composes it over the client
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
 * This process refused the statement itself: its concurrency slots were taken
 * and its wait queue was full, so the statement never reached ClickHouse.
 *
 * Raised here rather than imported because the package asks the PROCESS what a
 * shedding refusal becomes.
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
 * The vendor driver, built once per physical endpoint.
 *
 * `@clickhouse/client` is named in exactly this one place: everything above it
 * receives a client the package has already wrapped in retries, a statement
 * limiter and the default query settings.
 */
class WorkerVendorClickHouseClientFactory
  implements ClickHouseVendorClientFactory<ClickHouseClient & ClickHouseVendorClient>
{
  create(options: ClickHouseVendorClientOptions): ClickHouseClient & ClickHouseVendorClient {
    return createClient({
      url: options.url,
      max_open_connections: options.maxOpenConnections,
      request_timeout: options.requestTimeoutMs,
      keep_alive: { enabled: true, idle_socket_ttl: options.idleSocketTtlMs },
      clickhouse_settings: options.driverSettings as Record<string, never>,
    }) as ClickHouseClient & ClickHouseVendorClient;
  }
}

/**
 * The statement limiter's counters, as this process reports them.
 *
 * Logged rather than exported as metrics: this process has no prom-client
 * registry to register a gauge against, and shedding still says so out loud,
 * which is the fact an operator acts on.
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

/** The composed policy stack, built once and applied to every endpoint alike. */
const workerManagedClickHouseClientFactory: ClickHouseClientFactory<
  ClickHouseClient & ClickHouseVendorClient
> = ClickHouseManagedClientService.create({
  vendorClientFactory: new WorkerVendorClickHouseClientFactory(),
  defaultQuerySettings: {},
  resilience: VendorClientResiliencePolicy.create(),
  telemetry: new LoggingClickHouseTelemetry(),
  overloadErrorFactory: new WorkerOverloadErrorFactory(),
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
   * The tenant-keyed resolver every fold and every append runs through.
   *
   * Bound as a closure rather than handed out as the connection, so a caller
   * cannot reach `shared()` and write one organization's rows on another's
   * endpoint. The one question they may ask is "the client for THIS tenant".
   */
  readonly resolveClient = (tenantId: string): Promise<ClickHouseClient> =>
    this.connection.resolve(tenantId);

  close(): Promise<void> {
    return ClickHouseShutdownService.create().shutdown(this.connection);
  }
}
