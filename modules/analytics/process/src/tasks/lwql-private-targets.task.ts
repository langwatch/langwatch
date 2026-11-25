/**
 * Provisions LangWatchQL on each organisation's own ClickHouse. The route URL's admin only opens
 * the connection and is never altered; a derived per-organisation reader owns the profile, grants
 * and row policies, and is what the routed executor signs in as.
 * @see specs/lwql/api.feature
 */
import { parseConnectionUrl } from "@langwatch/clickhouse-migrations";
import { createLogger } from "@langwatch/observability";

import { LWQL_PROJECT_KEYS_VIEW } from "../features/provisioning/rules/lwql-scoped-view.rules.ts";
import { ClickHouseLangWatchQLProvisioningRepository } from "../repositories/clickhouse/clickhouse.langwatch-ql-provisioning.repository.ts";
import { clickHouseErrorSummary } from "../rules/langwatch-ql-config-store.rules.ts";
import { type LwqlPrivateReader, privateReaderOf } from "../rules/lwql-private-reader.rules.ts";
import type { LwqlConvergencePlan } from "./lwql-provision.task.ts";

const logger = createLogger("langwatch:task:lwql-private-targets");

/** A route variable's organisation and its admin URL, as the migration task reads them. */
export interface LwqlPrivateEndpoint {
  readonly organizationId?: string;
  readonly url: string;
}

/**
 * The shared plan, re-aimed at one private server: its database, the organisation's reader as the
 * restricted identity, and the same tenant setting the router sends. The admin URL only opens the
 * repository; no statement names its user.
 */
export function privatePlanOf({
  shared,
  endpoint,
  reader,
  clusterName,
}: {
  shared: LwqlConvergencePlan;
  endpoint: LwqlPrivateEndpoint;
  reader: LwqlPrivateReader;
  clusterName: string | undefined;
}): LwqlConvergencePlan {
  const { database } = parseConnectionUrl({ connectionUrl: endpoint.url, clusterName });
  return {
    ...shared,
    request: {
      ...shared.request,
      connection: {
        ...shared.request.connection,
        url: new URL(endpoint.url).origin,
        username: reader.username,
        password: reader.password,
        database,
      },
    },
    names: {
      ...shared.names,
      database,
      restrictedUser: reader.username,
      settingsProfile: reader.settingsProfile,
      // A PostgreSQL-engine table over the scoped project keys: no key row lives on this server.
      keyMapTable: LWQL_PROJECT_KEYS_VIEW,
    },
    sourceDatabase: () => database,
    openRepository: () => ClickHouseLangWatchQLProvisioningRepository.open({ url: endpoint.url }),
  };
}

/** Whether a row policy on `traces` applies to the reader: the probe passes on an empty view. */
async function hasTracesRowPolicy({
  plan,
  reader,
}: {
  plan: LwqlConvergencePlan;
  reader: LwqlPrivateReader;
}): Promise<boolean> {
  const repository = plan.openRepository();
  try {
    // Both names are validated identifiers: lower-case words, never caller text.
    const rows = await repository.queryRows(
      `SELECT count() AS n FROM system.row_policies WHERE database = '${plan.names.database}' ` +
        `AND table = 'traces' AND has(apply_to_list, '${reader.username}')`,
    );
    return Number(rows[0]?.n ?? 0) > 0;
  } finally {
    await repository.close();
  }
}

/** One private server: converge its ClickHouse half, then check the reader's row policy. */
async function provisionOne({
  plan,
  reader,
  organizationId,
  converge,
}: {
  plan: LwqlConvergencePlan;
  reader: LwqlPrivateReader;
  organizationId: string;
  converge: (plan: LwqlConvergencePlan) => Promise<void>;
}): Promise<void> {
  await converge(plan);
  if (await hasTracesRowPolicy({ plan, reader })) return;
  logger.warn(
    { organizationId },
    "LangWatchQL provisioned a private ClickHouse but no row policy on traces applies to the organisation's reader; its queries are not isolated until the server holds one",
  );
}

/** Never carries the route URL: the summary is the server's code and error type only. */
function warnNotProvisioned({
  organizationId,
  error,
}: {
  organizationId: string;
  error: unknown;
}): void {
  logger.warn(
    { organizationId, error: clickHouseErrorSummary(error) },
    "LangWatchQL provisioning on this organisation's private ClickHouse could not complete; its queries stay refused until the server is set up",
  );
}

/**
 * Converges every distinct private server and never throws: a target that cannot be set up is a
 * warning with its URL and passwords left out, and its organisation stays refused. Without a key
 * pepper there is no reader to derive, so no private server is touched.
 */
export async function provisionLwqlPrivateTargets({
  endpoints,
  sharedUrl,
  keyPepper,
  shared,
  clusterName,
  converge,
}: {
  endpoints: readonly LwqlPrivateEndpoint[];
  sharedUrl: string | undefined;
  keyPepper: string | undefined;
  shared: LwqlConvergencePlan;
  clusterName: string | undefined;
  converge: (plan: LwqlConvergencePlan) => Promise<void>;
}): Promise<void> {
  if (endpoints.length === 0) return;
  if (keyPepper === undefined) {
    logger.warn(
      { organisations: endpoints.length },
      "LangWatchQL private provisioning skipped: no key pepper (API_KEY_PEPPER, CREDENTIALS_SECRET or NEXTAUTH_SECRET) to derive the readers from; those organisations stay refused",
    );
    return;
  }
  const seen = new Set<string>(sharedUrl === undefined ? [] : [sharedUrl]);
  for (const endpoint of endpoints) {
    const { organizationId } = endpoint;
    if (seen.has(endpoint.url)) continue;
    seen.add(endpoint.url);
    if (organizationId === undefined) {
      logger.warn("LangWatchQL private provisioning skipped a route that names no organisation");
      continue;
    }
    const reader = privateReaderOf({ keyPepper, organizationId });
    try {
      const plan = privatePlanOf({ shared, endpoint, reader, clusterName });
      await provisionOne({ plan, reader, organizationId, converge });
    } catch (error) {
      warnNotProvisioned({ organizationId, error });
    }
  }
}
