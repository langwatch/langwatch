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

/** One socket: the shadow sampler re-runs one read at a time. */
const ENFORCING_READER_POOL = { override: 1 };

/**
 * The shadow sampler's enforcing reader (ADR-202 Rollout 3): the shared server only, and only
 * when sampling is on. Every private organisation is refused, never re-run on the shared server.
 */
export function enforcingReaderIdentityOf({
  config,
}: {
  config: ClickHouseConfig;
}): ClickHouseConfiguration | undefined {
  const url = config.enforcingReaderUrl?.trim();
  if (!url || !((config.shadowSampleRate ?? 0) > 0)) return undefined;
  const privateOrganizations = [
    ...(config.privateRoutes ?? []),
    ...(config.malformedRoutes ?? []),
    ...(config.readerPrivateRoutes ?? []),
    ...(config.malformedReaderRoutes ?? []),
  ];
  return ClickHouseConfigService.create().resolve({
    shared: { url, cluster: "shared" },
    privateRoutes: [],
    missingPrivateRoutes: privateOrganizations.map(({ organizationId }) => ({
      organizationId,
      variable: ENFORCING_READER_SHARED_ONLY,
    })),
    poolSizing: ENFORCING_READER_POOL,
  });
}

/** What a private organisation's refusal names: the enforcing reader has no route family. */
const ENFORCING_READER_SHARED_ONLY = "CLICKHOUSE_ENFORCING_READER_URL (shared server only)";

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
