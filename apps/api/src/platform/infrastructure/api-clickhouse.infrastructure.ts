/**
 * API-owned ClickHouse construction: one routed, pooled, bounded connection per process,
 * and its shutdown.
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
  ClickHouseNotConfiguredError,
  ClickHouseOverloadErrorFactory,
  ClickHouseShutdownService,
  VendorClientResiliencePolicy,
  type ClickHouseClientCreationInput,
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
import type { ApiClickHouseConfigResolution } from "../config/api.config";

/** Reports the composition decision an unconfigured ClickHouse would otherwise hide. */
export abstract class ApiClickHouseAbsenceReportPort {
  abstract absent(): void;
}

/**
 * Which organization a tenant belongs to. Declared as the one question the router asks
 * rather than as a Prisma client, because that is all the routing needs and naming the
 * client here would make this composable only where a database exists.
 */
export type ApiTenantDirectory = TenantDirectory;

export type ApiClickHouseInfrastructureOptions = {
  resources: ResourceScope;
  clickhouse: ApiClickHouseConfigResolution;
  /** Resolves a project's organization, so a private endpoint is reachable. */
  directory: ApiTenantDirectory;
};

/**
 * This process refused the statement itself: its concurrency slots were taken and its
 * wait queue was full, so the statement never reached ClickHouse.
 */
class ClickHouseOverloadedError extends HandledError {
  declare readonly code: "clickhouse_overloaded";

  constructor(options: { reasons?: readonly Error[] } = {}) {
    super("clickhouse_overloaded", "Too many queries in flight", {
      httpStatus: 503,
      // Shedding is the platform protecting itself, not a bad request.
      fault: "platform",
      reasons: options.reasons,
    });
    this.name = "ClickHouseOverloadedError";
  }
}

class ApiOverloadErrorFactory extends ClickHouseOverloadErrorFactory {
  create(input: { cause: unknown }): unknown {
    return new ClickHouseOverloadedError({
      reasons: input.cause instanceof Error ? [input.cause] : [],
    });
  }
}

/**
 * The vendor driver, built once per physical endpoint. `@clickhouse/client` is named in
 * exactly this one place: everything above it receives a client the package has already
 * wrapped in retries, a statement limiter and the default query settings.
 */
class ApiVendorClickHouseClientFactory implements ClickHouseVendorClientFactory<
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
 * The statement limiter's counters, as this process reports them.
 */
class LoggingClickHouseTelemetry extends ClickHouseManagedClientTelemetry {
  private readonly logger: Pick<Logger, "warn"> = createLogger("langwatch:api:clickhouse");

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
class ApiManagedClickHouseLogger extends ClickHouseManagedClientLogger {
  private readonly logger: Logger = createLogger("langwatch:api:clickhouse");

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
const apiManagedClickHouseClientFactory: ClickHouseClientFactory<
  ClickHouseClient & ClickHouseVendorClient
> = ClickHouseManagedClientService.create({
  vendorClientFactory: new ApiVendorClickHouseClientFactory(),
  vendorLoggerClass: vendorLoggerClassFor(createLogger("langwatch:api:clickhouse")),
  defaultQuerySettings: {},
  resilience: VendorClientResiliencePolicy.create(),
  telemetry: new LoggingClickHouseTelemetry(),
  overloadErrorFactory: new ApiOverloadErrorFactory(),
  logger: new ApiManagedClickHouseLogger(),
});

export class ApiClickHouseInfrastructure {
  /**
   * Composes the connection only when this process was given an endpoint.
   */
  static tryCreate(
    options: ApiClickHouseInfrastructureOptions & { report?: ApiClickHouseAbsenceReportPort },
  ): ApiClickHouseInfrastructure | undefined {
    const configured =
      Boolean(options.clickhouse.url?.trim()) || options.clickhouse.privateRoutes.length > 0;
    if (!configured) {
      options.report?.absent();
      return undefined;
    }
    return ApiClickHouseInfrastructure.create(options);
  }

  static create(options: ApiClickHouseInfrastructureOptions): ApiClickHouseInfrastructure {
    const sharedUrl = options.clickhouse.url?.trim();
    const connection = ClickHouseConnectionService.create({
      directory: options.directory,
      clientFactory: apiManagedClickHouseClientFactory,
    }).connect(
      ClickHouseConfigService.create().resolve({
        ...(sharedUrl === undefined ? {} : { shared: { url: sharedUrl, cluster: "shared" } }),
        privateRoutes: options.clickhouse.privateRoutes,
        poolSizing: options.clickhouse.poolSizing,
      }),
    );

    const infrastructure = new ApiClickHouseInfrastructure(connection);
    options.resources.own("API ClickHouse infrastructure", () => infrastructure.close());
    return infrastructure;
  }

  private constructor(
    private readonly connection: ClickHouseConnection<ClickHouseClient & ClickHouseVendorClient>,
  ) {}

  /**
   * The tenant-keyed resolver every analytics read runs through. Bound as a closure
   * rather than handed out as the connection, so a caller cannot reach `shared()` and
   * read one organization's data on another's endpoint.
   */
  readonly resolveClient = (tenantId: string): Promise<ClickHouseClient> =>
    this.connection.resolve(tenantId);

  /**
   * One ORGANIZATION's endpoint, keyed by the organization itself.
   */
  readonly resolveOrganizationClient = async (organizationId: string): Promise<ClickHouseClient> =>
    this.connection.resolveOrganization(organizationId);

  /**
   * The install's own shared endpoint, or none when this deployment has only private
   * routes.
   */
  readonly resolveSharedClient = (): ClickHouseClient | null => {
    try {
      return this.connection.shared();
    } catch (error) {
      if (error instanceof ClickHouseNotConfiguredError) return null;
      throw error;
    }
  };

  /**
   * Whether a query issued now would reach an endpoint. Reported rather than assumed: the
   * connection exists as soon as one route does, and a process holding only private
   * routes has no shared client for a tenant that maps to none.
   */
  get sharedEndpointConfigured(): boolean {
    return this.resolveSharedClient() !== null;
  }

  close(): Promise<void> {
    return ClickHouseShutdownService.create().shutdown(this.connection);
  }
}

/** The one input a `ClickHouseClientCreationInput` carries, for the tests. */
export type ApiClickHouseClientCreationInput = ClickHouseClientCreationInput;
