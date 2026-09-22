/**
 * The convergence entry points for the app-owned LangWatchQL access model: the
 * env/name resolution ({@link lwqlSelfProvisionInputs}), the whole-model
 * converge ({@link selfProvisionAll}), and the ownership probe
 * ({@link lwqlAccessModelOwner}) the server-side reconvergence watch polls.
 *
 * These live in `provisioning/` rather than in the deploy task because they have
 * two long-running callers now — the deploy task's `execute()` runs the converge
 * once at boot, and the app server's reconvergence watch (`start.ts`) polls the
 * probe and re-runs the converge once a chart-upgrade window closes. The task
 * module stays a thin entrypoint over these.
 *
 * The path is deliberately non-fatal — a default-on feature must never turn a
 * server-side provisioning failure into a boot crashloop; on a hard failure the
 * endpoint simply stays fail-closed ("unavailable") until a later converge. Where
 * the ClickHouse server already owns an LWQL entity in its own read-only config
 * store (users.xml / config.xml), that entity's statements are logged and skipped
 * and the rest is still provisioned — see {@link runClickHouseStatements}.
 *
 * @see ./selfProvisioning.ts — the pure composition this orchestrates
 * @see ./clickhouseStatementRunner.ts — the config-store-tolerant statement runner
 * @see ./reconvergence.ts — the server-side watch that re-runs the converge
 * @see ../../../../tasks/provisionLwql.ts — the deploy-task entrypoint
 * @see specs/lwql/api.feature
 */

import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { createLogger } from "@langwatch/observability";

import { parseConnectionUrl } from "../../../clickhouse/goose";
import { prisma } from "../../../db";
import { LWQL_KEY_MAP_INSERT_SETTINGS } from "../lwqlKeyMap.repository";
import { KEY_MAP_COLUMNS, type LangWatchQLNames } from "./accessModel";
import {
  type LwqlAccessModelOwner,
  probeLwqlAccessModelOwner,
} from "./accessModelOwner";
import {
  clickHouseErrorSummary,
  inventoryConfigStoreLwqlEntities,
  runClickHouseStatements,
} from "./clickhouseStatementRunner";
import {
  LWQL_POSTGRES_READER_ROLE,
  type LwqlKeyMapBackfillPlan,
  lwqlKeyMapTableQualifiedName,
  lwqlPostgresSchemaFromDatabaseUrl,
  planLwqlKeyMapBackfill,
  productionLangWatchQLNames,
  productionPostgresApprovedViewStatements,
  withTenancyOptOut,
} from "./productionProvisioning";
import {
  canProvisionAppFunctions,
  type LwqlSelfProvisionEnv,
  lwqlPostgresEndpointFromDatabaseUrl,
  lwqlSelfProvisionFromEnv,
  probeAppFunctionStore,
  selfHostedClickHouseProvisioningStatements,
  selfHostedPostgresReaderStatements,
} from "./selfProvisioning";
import { withLwqlSelfProvisionLock } from "./selfProvisionLock";

// Kept under the deploy task's logger name so operator alerting keyed on it is
// unaffected by the move out of `tasks/provisionLwql.ts`.
const logger = createLogger("langwatch:task:provisionLwql");

/**
 * The admin ClickHouse connection — `CLICKHOUSE_URL`, the app's own
 * credentials — never the restricted `LWQL_CLICKHOUSE_*` identity, which has
 * no DDL privileges by design.
 */
async function withAdminClickHouseClient<T>(
  fn: (client: ClickHouseClient) => Promise<T>,
): Promise<T> {
  const client = createClient({ url: process.env.CLICKHOUSE_URL });
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

/**
 * Every raw statement goes through the app's guarded `prisma` client, so each
 * needs the `-- @tenancy:` opt-out `guardProjectId` requires for a raw query
 * with no tenancy predicate — these statements are catalog-wide by design.
 */
async function runPostgresStatements(statements: string[]): Promise<void> {
  for (const statement of statements) {
    await prisma.$executeRawUnsafe(withTenancyOptOut(statement));
  }
}

async function planBackfillFromCurrentState({
  client,
  names,
  sourceDatabase,
}: {
  client: ClickHouseClient;
  names: LangWatchQLNames;
  sourceDatabase: string;
}): Promise<LwqlKeyMapBackfillPlan> {
  const projects = await prisma.project.findMany({
    select: { id: true, lwqlKey: true },
  });

  const table = lwqlKeyMapTableQualifiedName({ names, sourceDatabase });
  // Deliberately unfiltered: this admin scan collects key hashes across ALL
  // tenants to diff against every project's key — the one query shape the
  // "every ClickHouse query MUST filter on TenantId" rule cannot apply to.
  // `qualified()` (via lwqlKeyMapTableQualifiedName) validates the
  // interpolated database and table identifiers.
  const existingResult = await client.query({
    query: `SELECT DISTINCT ${KEY_MAP_COLUMNS.keyHash} FROM ${table}`,
    format: "JSONEachRow",
  });
  const existingRows = (await existingResult.json()) as Array<
    Record<string, string>
  >;
  // `noUncheckedIndexedAccess` types the lookup as `string | undefined` even
  // though every row genuinely carries this column (it is the only thing the
  // query selects) — filtered, not defaulted, so a row that somehow lacked it
  // is dropped rather than coerced into a bogus "" entry in the set.
  const existingHashes = new Set(
    existingRows
      .map((row) => row[KEY_MAP_COLUMNS.keyHash])
      .filter((hash): hash is string => hash !== undefined),
  );

  return planLwqlKeyMapBackfill({ projects, existingHashes });
}

async function backfillKeyMap({
  client,
  names,
  sourceDatabase,
}: {
  client: ClickHouseClient;
  names: LangWatchQLNames;
  sourceDatabase: string;
}): Promise<void> {
  const plan = await planBackfillFromCurrentState({
    client,
    names,
    sourceDatabase,
  });

  // Surfaced loudly, never silently skipped: a blank key is a project that
  // cannot authenticate to LangWatchQL at all, which is the exact class of
  // outage this backfill exists to close.
  if (plan.blankKeyProjectIds.length > 0) {
    logger.error(
      {
        count: plan.blankKeyProjectIds.length,
        projectIds: plan.blankKeyProjectIds,
      },
      "lwql key-map backfill found projects with an empty lwqlKey — these projects cannot authenticate to LangWatchQL until their key is regenerated",
    );
  }

  if (plan.rowsToInsert.length === 0) {
    logger.info("lwql key-map backfill: no missing rows");
    return;
  }

  const table = lwqlKeyMapTableQualifiedName({ names, sourceDatabase });
  await client.insert({
    table,
    values: plan.rowsToInsert,
    format: "JSONEachRow",
    clickhouse_settings: LWQL_KEY_MAP_INSERT_SETTINGS,
  });
  logger.info(
    { inserted: plan.rowsToInsert.length },
    "lwql key-map backfill: inserted missing rows",
  );
}

/**
 * Whether this server can hold the app functions on every replica. A server
 * that cannot is provisioned without them, with the setting named in the log:
 * half the replicas answering UNKNOWN_FUNCTION is worse than none of them.
 */
async function appFunctionsProvisionable(
  client: ClickHouseClient,
): Promise<boolean> {
  const probe = await probeAppFunctionStore({
    query: async (sql) =>
      (await (
        await client.query({ query: sql, format: "JSONEachRow" })
      ).json()) as Record<string, string>[],
  });
  if (canProvisionAppFunctions(probe)) return true;
  // A layout that could not be read has already been logged by the probe.
  if (probe === null) return false;
  logger.error(
    { maxTotalReplicas: probe?.maxTotalReplicas ?? null },
    "lwql self-provisioning skipped the app functions: this ClickHouse has more than one replica and no user_defined_zookeeper_path, so a CREATE FUNCTION would reach one replica only. Set user_defined_zookeeper_path in the server config and redeploy; LangWatchQL app functions stay refused until then",
  );
  return false;
}

/**
 * Converges the ClickHouse side on an admin client: inventories the config-store
 * entities, runs the access-model/bridge/view DDL (yielding to config-owned
 * entities), and backfills the key map. Split out of {@link selfProvisionAll} to
 * keep each function small; a throw here still propagates to that function's
 * non-fatal handler.
 */
async function convergeClickHouse({
  client,
  names,
  selfProvision,
  sourceDatabase,
  endpoint,
}: {
  client: ClickHouseClient;
  names: LangWatchQLNames;
  selfProvision: LwqlSelfProvisionEnv;
  sourceDatabase: string;
  endpoint: NonNullable<ReturnType<typeof lwqlPostgresEndpointFromDatabaseUrl>>;
}): Promise<void> {
  // Named first at WARN so the operator sees by name any LWQL identity the
  // ClickHouse server already owns in its read-only config store, before the
  // statements that will skip it run.
  const configStoreEntities = await inventoryConfigStoreLwqlEntities({
    client,
    names,
  });

  const includeAppFunctions = await appFunctionsProvisionable(client);
  const result = await runClickHouseStatements({
    client,
    configStoreEntities,
    statements: selfHostedClickHouseProvisioningStatements({
      names,
      restrictedPassword: selfProvision.connection.password,
      sourceDatabase,
      postgres: {
        endpoint,
        readerPassword: selfProvision.postgresReaderPassword,
      },
      includeAppFunctions,
    }),
  });
  if (result.skipped.length > 0) {
    logger.warn(
      { skippedCount: result.skipped.length },
      "lwql provisioning yielded to config-store-owned entities and provisioned the rest",
    );
  }

  // Same non-fatal contract as the explicit path: the backfill is convergent, so
  // a slow key-map table must not undo the provisioning above (already committed).
  try {
    await backfillKeyMap({ client, names, sourceDatabase });
  } catch (error) {
    logger.error(
      { error: clickHouseErrorSummary(error) },
      "lwql key-map backfill failed — continuing; project creation syncs rows inline and the next deploy retries the rest",
    );
  }
}

/**
 * Provisions the whole LangWatchQL model, and never throws. It ships default-on
 * on every distribution, so a ClickHouse server that refuses access-model DDL
 * (say, an external one without `access_management` for the admin user) must
 * degrade to a loud log and a fail-closed endpoint, not a crashlooping
 * deployment. A server that already owns an LWQL entity in its read-only config
 * store is yielded to, per statement, by {@link runClickHouseStatements}.
 *
 * The running server watches the config store separately and calls this again
 * once a chart-upgrade window closes — see {@link startLwqlReconvergenceWatch}.
 */
export async function selfProvisionAll({
  selfProvision,
  names,
}: {
  selfProvision: LwqlSelfProvisionEnv;
  names: LangWatchQLNames;
}): Promise<void> {
  const endpoint = lwqlPostgresEndpointFromDatabaseUrl(
    process.env.DATABASE_URL,
  );
  if (!endpoint) {
    logger.error(
      "lwql self-provisioning: DATABASE_URL is absent or unparseable, cannot derive the PostgreSQL endpoint for the named collection — skipping",
    );
    return;
  }

  try {
    // Inside the try so a parseable CLICKHOUSE_URL whose database is an invalid
    // identifier degrades to the non-fatal log below rather than crashing the
    // deploy task — the boot-never-crashes contract covers a misconfigured URL
    // just as it covers a server that refuses the DDL.
    const { database: sourceDatabase } = parseConnectionUrl();
    logger.info(
      { database: names.database, sourceDatabase },
      "provisioning the full LangWatchQL model — access model, PostgreSQL bridge, views",
    );

    // Serialize the destructive convergence across concurrently-booting pods:
    // the advisory lock is held for the whole transaction, so any other pod
    // running this task blocks until we release, then re-runs the (idempotent)
    // convergence itself. The PostgreSQL statements and ClickHouse DDL below
    // run on their own connections, not `tx` — that is fine, because every pod
    // gates ENTRY on the same lock, so the sequence is serialized machine-wide.
    // See selfProvisionLock.ts. A throw here (lock acquisition or body) leaves
    // the transaction and is caught by the non-fatal handler below, preserving
    // the boot-never-crashes contract.
    await withLwqlSelfProvisionLock({ prisma }, async () => {
      await runPostgresStatements([
        ...productionPostgresApprovedViewStatements({
          schema: lwqlPostgresSchemaFromDatabaseUrl(process.env.DATABASE_URL),
          // Self-provisioning always converges the dedicated lwql_ro reader
          // (LWQL_SELF_PROVISION_DEFAULTS.postgresReaderRole), never a
          // caller-named one, so the views' upgrade-path fallback can name it
          // directly.
          readerRole: LWQL_POSTGRES_READER_ROLE,
        }),
        // After the views: the reader role's grants name them. The app owns
        // the dedicated lwql_ro reader on every distribution, converging it
        // from the reader password alone.
        ...selfHostedPostgresReaderStatements({
          schema: lwqlPostgresSchemaFromDatabaseUrl(process.env.DATABASE_URL),
          readerPassword: selfProvision.postgresReaderPassword,
        }),
      ]);

      await withAdminClickHouseClient((client) =>
        convergeClickHouse({
          client,
          names,
          selfProvision,
          sourceDatabase,
          endpoint,
        }),
      );
    });
    logger.info("LangWatchQL self-provisioning complete");
  } catch (error) {
    logger.error(
      { error: clickHouseErrorSummary(error) },
      "lwql self-provisioning failed — continuing boot; LangWatchQL queries stay refused (fail-closed) until a later deploy converges",
    );
  }
}

/**
 * The provisioning inputs derived from the environment, or `null` when
 * LangWatchQL is not configured on this deployment. Shared by the deploy task's
 * `execute()`, the {@link selfProvisionAll} converge, and the
 * {@link lwqlAccessModelOwner} probe so the env/name derivation lives in exactly
 * one place.
 */
export function lwqlSelfProvisionInputs(): {
  selfProvision: LwqlSelfProvisionEnv;
  names: LangWatchQLNames;
} | null {
  const selfProvision = lwqlSelfProvisionFromEnv();
  if (!selfProvision) return null;
  return {
    selfProvision,
    names: productionLangWatchQLNames({ connection: selfProvision.connection }),
  };
}

/**
 * Which store owns the LangWatchQL access model right now, proven fresh at call
 * time, for the server-side reconvergence watch to poll. A stateless snapshot
 * rather than an inference over probe history: a transient error can never
 * fabricate a "none" (the probe throws instead, and the watch keeps polling),
 * and a pod that rolled before the first probe still reads correctly.
 *
 * The classification is the sole gate on a destructive re-provision, so the
 * decision and its I/O live in {@link probeLwqlAccessModelOwner} /
 * {@link classifyLwqlAccessModelOwner} where they are unit-tested; this only
 * resolves the inputs and hands the probe an admin client.
 */
export async function lwqlAccessModelOwner(): Promise<LwqlAccessModelOwner> {
  const inputs = lwqlSelfProvisionInputs();
  if (!inputs) return "none";
  const { names } = inputs;
  return withAdminClickHouseClient((client) =>
    probeLwqlAccessModelOwner({ client, names }),
  );
}
