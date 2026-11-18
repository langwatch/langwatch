/**
 * The ClickHouse identities a process may hold (ADR-202 Decided 2, 6, 12). A private route one
 * identity has and another lacks is refused for that other by the variable to set, never shared.
 * Spec: specs/clickhouse/app-reader-identity.feature · specs/clickhouse/app-writer-identity.feature
 */
import {
  type ClickHouseConfiguration,
  ClickHouseConfigService,
  PRIVATE_ROUTE_ENV_PREFIX,
} from "@langwatch/clickhouse-client";

import { READER_ROUTE_ENV_PREFIX, WRITER_ROUTE_ENV_PREFIX } from "./clickhouse-routes.ts";
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
  /** `CLICKHOUSE_WRITER_URL` and its routes: inserts where the system is absent (Decided 12). */
  readonly writer: ClickHouseConfiguration | undefined;
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
  const writer: IdentityEndpoints = {
    url: config.writerUrl?.trim() || undefined,
    routes: config.writerPrivateRoutes ?? [],
    malformed: config.malformedWriterRoutes ?? [],
    prefix: WRITER_ROUTE_ENV_PREFIX,
  };
  const resolve = (own: IdentityEndpoints, others: readonly IdentityEndpoints[]) =>
    holdsEndpoint(own)
      ? resolveIdentity({ own, others, poolSizing: config.poolSizing })
      : undefined;
  return {
    system: resolve(system, [reader, writer]),
    reader: resolve(reader, [system, writer]),
    writer: resolve(writer, [system, reader]),
  };
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

/**
 * The system credential's variables a process holds beside both the reader and the writer, by
 * name only (ADR-202 Decided 14: the api must hold none). Empty unless reader and writer are set.
 */
export function systemVariablesBesideReaderAndWriter({
  config,
}: {
  config: ClickHouseConfig;
}): string[] {
  const holds = (url: string | undefined, routes: readonly unknown[] | undefined) =>
    Boolean(url?.trim()) || (routes?.length ?? 0) > 0;
  if (!holds(config.readerUrl, config.readerPrivateRoutes)) return [];
  if (!holds(config.writerUrl, config.writerPrivateRoutes)) return [];
  return [
    ...(config.url?.trim() ? ["CLICKHOUSE_URL"] : []),
    ...(config.passwordFile?.trim() ? ["CLICKHOUSE_PASSWORD_FILE"] : []),
    ...[...(config.privateRoutes ?? []), ...(config.malformedRoutes ?? [])].map(
      ({ organizationId, label, variable }) =>
        variable ?? `${PRIVATE_ROUTE_ENV_PREFIX}${label ?? "<label>"}__${organizationId}`,
    ),
  ];
}

/** What a private organisation's refusal names: the enforcing reader has no route family. */
const ENFORCING_READER_SHARED_ONLY = "CLICKHOUSE_ENFORCING_READER_URL (shared server only)";

function holdsEndpoint(identity: IdentityEndpoints): boolean {
  return identity.url !== undefined || identity.routes.length > 0;
}

function resolveIdentity({
  own,
  others,
  poolSizing,
}: {
  own: IdentityEndpoints;
  others: readonly IdentityEndpoints[];
  poolSizing: ClickHouseConfig["poolSizing"];
}): ClickHouseConfiguration {
  const missing = new Map<string, string | undefined>();
  for (const { organizationId, label } of others.flatMap((other) => [
    ...other.routes,
    ...other.malformed,
  ])) {
    if (!missing.has(organizationId)) missing.set(organizationId, label);
  }
  return ClickHouseConfigService.create().resolve({
    ...(own.url === undefined ? {} : { shared: { url: own.url, cluster: "shared" } }),
    // The organization's own id is the only credential-free name this process knows for it.
    privateRoutes: own.routes.map(({ organizationId, url }) => ({
      organizationId,
      url,
      cluster: organizationId,
    })),
    malformedPrivateRoutes: own.malformed,
    missingPrivateRoutes: [...missing].map(([organizationId, label]) => ({
      organizationId,
      variable: `${own.prefix}${label ?? "<label>"}__${organizationId}`,
    })),
    ...(poolSizing === undefined ? {} : { poolSizing }),
  });
}
