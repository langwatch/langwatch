/**
 * ClickHouse as ONE client that routes itself.
 *
 * A module is handed a {@link ClickHouseQueryClient} and nothing else. It never
 * resolves an endpoint, never holds a per-organization client and cannot ask
 * for an unscoped one, because there is no method that would answer: every
 * statement carries its own `tenantId`, and this driver places it. That is what
 * turns "every ClickHouse query filters TenantId first" from a rule a reader
 * has to remember into the shape of the only object they can reach.
 *
 * `@clickhouse/client` is named in exactly this one file.
 */
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import {
  ClickHouseClientFactory,
  ClickHouseConfigService,
  ClickHouseConnectionService,
  ClickHouseQueryClient,
  ClickHouseShutdownService,
  ConcurrencyLimiter,
  RetryPolicy,
  TenantGuard,
  type ClickHouseClientCreationInput,
  type ClickHouseConnection,
  type QueryDriver,
  type QueryRequest,
  type QueryResult,
  type TenantDirectory,
} from "@langwatch/clickhouse-client";
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
      ...(this.config.settings === undefined
        ? {}
        : { clickhouse_settings: this.config.settings as Record<string, never> }),
    });
  }
}

/**
 * The routed client, and the close that shuts every endpoint it opened.
 *
 * The tenant guard is outermost, so a statement that cannot name its tenant is
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
    ...(config.maxOpenConnections === undefined
      ? {}
      : { poolSizing: { override: config.maxOpenConnections } }),
  });

  const connection = ClickHouseConnectionService.create({
    directory: options.directory,
    clientFactory: new VendorClickHouseClientFactory(config),
    ...(config.maxTenantCacheEntries === undefined
      ? {}
      : { maxTenantCacheEntries: config.maxTenantCacheEntries }),
  }).connect(configuration);

  const client = new ClickHouseQueryClient({
    driver: routingDriver(connection),
    tenantGuard: new TenantGuard(),
    retries: new RetryPolicy(),
    ...(config.maxConcurrentStatements === undefined
      ? {}
      : { limiter: new ConcurrencyLimiter({ maxConcurrent: config.maxConcurrentStatements }) }),
  });

  return {
    value: client,
    close: () => ClickHouseShutdownService.create().shutdown(connection),
  };
}

/**
 * One statement, sent to the server the tenant belongs on.
 *
 * A statement that names a tenant is routed by it, whether or not it also
 * declares itself unscoped: a TTL reconciliation for a private organization
 * belongs on that organization's server, not on shared. Only a statement with
 * no tenant at all — a migration, a `system.*` read — goes to the shared
 * server, and the tenant guard has already refused it unless the author wrote
 * down why it has none.
 */
function routingDriver(connection: ClickHouseConnection<ClickHouseClient>): QueryDriver {
  return {
    async execute<Row>(request: QueryRequest): Promise<QueryResult<Row>> {
      const vendor =
        request.tenantId === ""
          ? connection.shared()
          : await connection.resolve(request.tenantId);

      const started = Date.now();
      const resultSet = await vendor.query({
        query: request.sql,
        format: "JSONEachRow",
        ...(request.params === undefined ? {} : { query_params: request.params }),
        ...(request.settings === undefined ? {} : { clickhouse_settings: request.settings }),
        ...(request.signal === undefined ? {} : { abort_signal: request.signal as AbortSignal }),
      });
      const rows = await resultSet.json<Row>();
      return { rows, stats: { durationMs: Date.now() - started } };
    },
  };
}
