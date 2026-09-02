/**
 * API-owned ClickHouse construction: one routed, pooled, bounded connection per
 * process, and its shutdown.
 *
 * The analytics reads, the filter pickers and every dashboard graph resolve
 * their client through here, and the resolution is TENANT-KEYED rather than
 * global: a project belonging to an organization with its own endpoint reaches
 * that endpoint, and everything else reaches the shared one. That routing is
 * `@langwatch/clickhouse-client`'s, not this module's — what this module owns
 * is the three process-shaped decisions the package deliberately does not
 * make: which vendor driver to build, how many sockets it may hold, and what a
 * refused statement becomes.
 *
 * The restricted LangWatchQL identity is NOT composed here. It is a different
 * database user with a row policy over the same cluster, it is opened by the
 * analytics collaborators from its own configuration, and keeping the two apart
 * is what stops a member's own SQL ever running on the administrative client.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { createClient } from "@clickhouse/client";
import {
  ClickHouseClientFactory,
  ClickHouseConfigService,
  ClickHouseConnectionService,
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
 * Which organization a tenant belongs to.
 *
 * Declared as the one question the router asks rather than as a Prisma client,
 * because that is all the routing needs and naming the client here would make
 * this composable only where a database exists. A process without one composes
 * no ClickHouse at all, which is the branch above this.
 */
export type ApiTenantDirectory = TenantDirectory;

export type ApiClickHouseInfrastructureOptions = {
  resources: ResourceScope;
  clickhouse: ApiClickHouseConfigResolution;
  /** Resolves a project's organization, so a private endpoint is reachable. */
  directory: ApiTenantDirectory;
};

/**
 * This process refused the statement itself: its concurrency slots were taken
 * and its wait queue was full, so the statement never reached ClickHouse.
 *
 * Raised here rather than imported because the package asks the PROCESS what a
 * shedding refusal becomes: the shape is the limiter's, the code a client
 * renders its words from is the deployment's.
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
 * The vendor driver, built once per physical endpoint.
 *
 * `@clickhouse/client` is named in exactly this one place: everything above it
 * receives a client the package has already wrapped in retries, a statement
 * limiter and the default query settings.
 */
class ApiVendorClickHouseClientFactory
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
 * Logged rather than exported as metrics for now: the API process's Prometheus
 * registry is composed after infrastructure, and a gauge registered against a
 * registry that does not exist yet is a gauge nobody scrapes. Shedding still
 * says so out loud, which is the fact an operator acts on.
 */
class LoggingClickHouseTelemetry extends ClickHouseManagedClientTelemetry {
  private readonly logger: Pick<Logger, "warn"> = createLogger("langwatch:api:clickhouse");

  registerLimiter(_input: { instance: string; stats: () => LimiterStats }): void {}
  unregisterLimiter(_instance: string): void {}
  observeStatementWait(_input: {
    instance: string;
    operation: string;
    seconds: number;
  }): void {}

  incrementStatementsShed(input: { instance: string; operation: string }): void {
    this.logger.warn(
      { instance: input.instance, operation: input.operation },
      "ClickHouse statement shed: every concurrency slot was taken and the wait queue was full",
    );
  }
}

/** The composed policy stack, built once and applied to every endpoint alike. */
const apiManagedClickHouseClientFactory: ClickHouseClientFactory<
  ClickHouseClient & ClickHouseVendorClient
> = ClickHouseManagedClientService.create({
  vendorClientFactory: new ApiVendorClickHouseClientFactory(),
  defaultQuerySettings: {},
  resilience: VendorClientResiliencePolicy.create(),
  telemetry: new LoggingClickHouseTelemetry(),
  overloadErrorFactory: new ApiOverloadErrorFactory(),
});

export class ApiClickHouseInfrastructure {
  /**
   * Composes the connection only when this process was given an endpoint.
   *
   * A deployment with no `CLICKHOUSE_URL` and no private route reads no
   * analytics, and that is a smaller process rather than a dead one: the
   * charted surfaces refuse at the call with the message they always had. What
   * it must not do is compose a connection over a blank string, whose first
   * query would be the one that discovers the problem.
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
   * The tenant-keyed resolver every analytics read runs through.
   *
   * Bound as a closure rather than handed out as the connection, so a caller
   * cannot reach `shared()` and read one organization's data on another's
   * endpoint. The one question they may ask is "the client for THIS tenant".
   */
  readonly resolveClient = (tenantId: string): Promise<ClickHouseClient> =>
    this.connection.resolve(tenantId);

  /**
   * Whether a query issued now would reach an endpoint.
   *
   * Reported rather than assumed: the connection exists as soon as one route
   * does, and a process holding only private routes has no shared client for a
   * tenant that maps to none.
   */
  get sharedEndpointConfigured(): boolean {
    try {
      this.connection.shared();
      return true;
    } catch (error) {
      if (error instanceof ClickHouseNotConfiguredError) return false;
      throw error;
    }
  }

  close(): Promise<void> {
    return ClickHouseShutdownService.create().shutdown(this.connection);
  }
}

/** The one input a `ClickHouseClientCreationInput` carries, for the tests. */
export type ApiClickHouseClientCreationInput = ClickHouseClientCreationInput;
