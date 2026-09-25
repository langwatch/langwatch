/** One ClickHouse client that routes itself. Modules never resolve endpoints
 * because every statement carries tenantId filtering, enforced by this driver. */
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import {
  ClickHouseClientFactory,
  ClickHouseConfigService,
  ClickHouseConnectionService,
  ClickHouseQueryClient,
  ClickHouseShutdownService,
  ConcurrencyLimiter,
  RetryPolicy,
  routingDriver,
  TenantGuard,
  type ClickHouseClientCreationInput,
  type TenantDirectory,
} from "@langwatch/clickhouse-client";
import { CLICKHOUSE_TRANSIENT_MESSAGE_FRAGMENTS } from "@langwatch/eventing";

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

  const client = new ClickHouseQueryClient({
    driver: routingDriver(connection),
    tenantGuard: new TenantGuard(),
    retries: new RetryPolicy({ transientMessageFragments: CLICKHOUSE_TRANSIENT_MESSAGE_FRAGMENTS }),
    limiter: new ConcurrencyLimiter({
      maxConcurrent: config.maxConcurrentStatements ?? configuration.poolSizing.size,
    }),
  });

  return {
    value: client,
    close: () => ClickHouseShutdownService.create().shutdown(connection),
  };
}
