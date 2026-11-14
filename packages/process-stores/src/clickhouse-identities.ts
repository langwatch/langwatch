/**
 * The two ClickHouse identities a process may hold (ADR-202 Decided 2, 6). A private route one
 * identity has and the other lacks is refused for the other by the variable to set, never shared.
 * Spec: specs/clickhouse/app-reader-identity.feature
 */
import {
  type ClickHouseConfiguration,
  ClickHouseConfigService,
  PRIVATE_ROUTE_ENV_PREFIX,
} from "@langwatch/clickhouse-client";

import { READER_ROUTE_ENV_PREFIX } from "./clickhouse-routes.ts";
import type {
  ClickHouseConfig,
  ClickHousePrivateRoute,
  MalformedPrivateVariable,
} from "./config.ts";

export interface ClickHouseIdentityConfigurations {
  /** `CLICKHOUSE_URL` and its routes: inserts, commands, skip-check statements. */
  readonly system: ClickHouseConfiguration | undefined;
  /** `CLICKHOUSE_READER_URL` and its routes: tenant reads. Absent keeps one identity. */
  readonly reader: ClickHouseConfiguration | undefined;
}

interface IdentityEndpoints {
  readonly url: string | undefined;
  readonly routes: readonly ClickHousePrivateRoute[];
  readonly malformed: readonly MalformedPrivateVariable[];
  readonly prefix: string;
}

/** Resolves each identity this process holds; neither is resolved when it names no endpoint. */
export function clickhouseIdentitiesOf({
  config,
}: {
  config: ClickHouseConfig;
}): ClickHouseIdentityConfigurations {
  const system: IdentityEndpoints = {
    url: config.url?.trim() || undefined,
    routes: config.privateRoutes ?? [],
    malformed: config.malformedRoutes ?? [],
    prefix: PRIVATE_ROUTE_ENV_PREFIX,
  };
  const reader: IdentityEndpoints = {
    url: config.readerUrl?.trim() || undefined,
    routes: config.readerPrivateRoutes ?? [],
    malformed: config.malformedReaderRoutes ?? [],
    prefix: READER_ROUTE_ENV_PREFIX,
  };
  const resolve = (own: IdentityEndpoints, other: IdentityEndpoints) =>
    holdsEndpoint(own) ? resolveIdentity({ own, other, poolSizing: config.poolSizing }) : undefined;
  return { system: resolve(system, reader), reader: resolve(reader, system) };
}

function holdsEndpoint(identity: IdentityEndpoints): boolean {
  return identity.url !== undefined || identity.routes.length > 0;
}

function resolveIdentity({
  own,
  other,
  poolSizing,
}: {
  own: IdentityEndpoints;
  other: IdentityEndpoints;
  poolSizing: ClickHouseConfig["poolSizing"];
}): ClickHouseConfiguration {
  return ClickHouseConfigService.create().resolve({
    ...(own.url === undefined ? {} : { shared: { url: own.url, cluster: "shared" } }),
    // The organization's own id is the only credential-free name this process knows for it.
    privateRoutes: own.routes.map(({ organizationId, url }) => ({
      organizationId,
      url,
      cluster: organizationId,
    })),
    malformedPrivateRoutes: own.malformed,
    missingPrivateRoutes: [...other.routes, ...other.malformed].map(
      ({ organizationId, label }) => ({
        organizationId,
        variable: `${own.prefix}${label ?? "<label>"}__${organizationId}`,
      }),
    ),
    ...(poolSizing === undefined ? {} : { poolSizing }),
  });
}
