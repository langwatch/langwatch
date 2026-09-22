/**
 * Deploy-time provisioning for LangWatchQL: the application owns the whole
 * access model on every distribution (issue #8258) and converges it on every
 * boot. Whenever `LWQL_CLICKHOUSE_PASSWORD` (+ `LWQL_POSTGRES_READER_PASSWORD`)
 * is set, this task provisions the PostgreSQL reader role, the ClickHouse
 * restricted identity, its settings profile, grants and row policies, the
 * named collection, the PostgreSQL-engine tables, the views, and backfills the
 * key-map table from every project's `lwqlKey` — from
 * `../server/analytics/lwql/provisioning/selfProvisioning.ts`'s composition.
 *
 * The path is deliberately non-fatal — a default-on feature must never turn a
 * server-side provisioning failure into a boot crashloop; on a hard failure the
 * endpoint simply stays fail-closed ("unavailable") until the next boot
 * converges. Where the ClickHouse server already owns an LWQL entity in its own
 * read-only config store (users.xml / config.xml), that entity's statements are
 * logged and skipped and the rest is still provisioned — see
 * `runClickHouseStatements`. Such a skip can be transient rather than permanent
 * — a helm upgrade boots the app against the OLD ClickHouse pod, which still
 * serves `users.d/lwql.yaml`, before the pod rolls to a chart that renders no
 * access model. This deploy task is a short-lived process, so it cannot wait out
 * that window itself; instead the long-running app server watches the config
 * store and re-provisions once the old pod's rendered model is gone, using this
 * task's exported {@link lwqlAccessModelOwner} probe and
 * {@link selfProvisionAll} converge (see `startLwqlReconvergenceWatch`).
 *
 * Runs after `clickhouseMigrate` (migration 00084 creates the key-map table
 * this task writes into) in `start:prepare:db`. A deploy with no
 * `LWQL_CLICKHOUSE_PASSWORD` is unaffected: {@link lwqlSelfProvisionFromEnv}
 * returns `null` and this task exits immediately. Idempotent every run — every
 * generator emits `IF NOT EXISTS`/`OR REPLACE`/`CREATE OR REPLACE` DDL, and
 * the key-map backfill only inserts rows missing from the table.
 *
 * @see ../server/analytics/lwql/provisioning/selfProvisioning.ts — the pure
 *   composition this orchestrates
 * @see ../server/analytics/lwql/provisioning/clickhouseStatementRunner.ts — the
 *   config-store-tolerant statement runner
 * @see ../server/clickhouse/migrations/00084_create_lwql_api_key_tenant_map.sql
 * @see specs/lwql/api.feature
 */

import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { createLogger } from "@langwatch/observability";
import { LWQL_KEY_MAP_INSERT_SETTINGS } from "../server/analytics/lwql/lwqlKeyMap.repository";
import {
  canProvisionAppFunctions,
  inventoryConfigStoreLwqlEntities,
  KEY_MAP_COLUMNS,
  type LangWatchQLNames,
  LWQL_POSTGRES_READER_ROLE,
  type LwqlKeyMapBackfillPlan,
  type LwqlSelfProvisionEnv,
  lwqlKeyMapTableQualifiedName,
  lwqlPostgresEndpointFromDatabaseUrl,
  lwqlPostgresSchemaFromDatabaseUrl,
  lwqlSelfProvisionFromEnv,
  planLwqlKeyMapBackfill,
  probeAppFunctionStore,
  productionLangWatchQLNames,
  productionPostgresApprovedViewStatements,
  redactSecrets,
  runClickHouseStatements,
  selfHostedClickHouseProvisioningStatements,
  selfHostedPostgresReaderStatements,
  withLwqlSelfProvisionLock,
  withTenancyOptOut,
} from "../server/analytics/lwql/provisioning";
import { parseConnectionUrl } from "../server/clickhouse/goose";
import { prisma } from "../server/db";

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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
  secrets,
}: {
  client: ClickHouseClient;
  names: LangWatchQLNames;
  selfProvision: LwqlSelfProvisionEnv;
  sourceDatabase: string;
  endpoint: NonNullable<ReturnType<typeof lwqlPostgresEndpointFromDatabaseUrl>>;
  secrets: readonly (string | undefined)[];
}): Promise<void> {
  // Named first at WARN so the operator sees by name any LWQL identity the
  // ClickHouse server already owns in its read-only config store, before the
  // statements that will skip it run.
  const configStoreEntities = await inventoryConfigStoreLwqlEntities({
    client,
    names,
    secrets,
  });

  const includeAppFunctions = await appFunctionsProvisionable(client);
  const result = await runClickHouseStatements({
    client,
    secrets,
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
      { error: redactSecrets(errorMessage(error), secrets) },
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
  // Everything this path can log carries one of these somewhere: the access
  // model DDL embeds the restricted password, the named collection embeds the
  // PostgreSQL reader password, and a connection failure quotes the URL it
  // dialled.
  const secrets = [
    selfProvision.connection.password,
    selfProvision.postgresReaderPassword,
    process.env.CLICKHOUSE_URL,
    process.env.DATABASE_URL,
  ];

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
          secrets,
        }),
      );
    });
    logger.info("LangWatchQL self-provisioning complete");
  } catch (error) {
    logger.error(
      { error: redactSecrets(errorMessage(error), secrets) },
      "lwql self-provisioning failed — continuing boot; LangWatchQL queries stay refused (fail-closed) until a later deploy converges",
    );
  }
}
/**
 * The provisioning inputs derived from the environment, or `null` when
 * LangWatchQL is not configured on this deployment. Shared by {@link execute},
 * the {@link selfProvisionAll} converge, and the
 * {@link lwqlAccessModelOwner} probe so the env/name derivation lives
 * in exactly one place.
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

/** Which store currently owns the LangWatchQL access model, if any. */
export type LwqlAccessModelOwner = "config_store" | "sql_store" | "none";

/**
 * Which store owns the LangWatchQL access model right now, proven fresh at call
 * time, for the server-side reconvergence watch to poll:
 *
 * - `"config_store"` — the read-only users.xml identities are still rendered
 *   (the previous ClickHouse pod, mid-upgrade). The app must keep waiting.
 * - `"sql_store"` — the app-owned SQL-store user is present: the model is live,
 *   nothing to do.
 * - `"none"` — neither is present, so the app must (re-)provision.
 *
 * A stateless snapshot rather than an inference over probe history: a transient
 * error can never fabricate a "none" (it throws instead), and a pod that rolled
 * before the first probe still reads correctly. {@link inventoryConfigStoreLwqlEntities}
 * swallows read errors and returns `[]`, so this probe first proves connectivity
 * with a trivial query — an unreachable ClickHouse *throws* (the watch keeps
 * polling) instead of reporting a spurious "none".
 */
export async function lwqlAccessModelOwner(): Promise<LwqlAccessModelOwner> {
  const inputs = lwqlSelfProvisionInputs();
  if (!inputs) return "none";
  const { selfProvision, names } = inputs;
  const secrets = [
    selfProvision.connection.password,
    selfProvision.postgresReaderPassword,
    process.env.CLICKHOUSE_URL,
    process.env.DATABASE_URL,
  ];
  return withAdminClickHouseClient(async (client) => {
    // Connectivity check: throws on an unreachable server, so the caller can
    // distinguish "cannot read yet" from an authoritative ownership answer.
    await (
      await client.query({ query: "SELECT 1", format: "JSONEachRow" })
    ).text();

    const configStoreEntities = await inventoryConfigStoreLwqlEntities({
      client,
      names,
      secrets,
    });
    if (configStoreEntities.length > 0) return "config_store";

    // The config store owns nothing; is the app-owned user present in any SQL
    // access store? Excluding `users_xml` (the config store, already checked
    // above and the same literal `inventoryConfigStoreLwqlEntities` filters on)
    // rather than pinning `local_directory` keeps this correct on ClickHouse
    // deployments whose SQL storage is `replicated`, `memory`, etc.
    const result = await client.query({
      query:
        "SELECT count() AS n FROM system.users " +
        "WHERE name = {user:String} AND storage != 'users_xml'",
      query_params: { user: names.restrictedUser },
      format: "JSONEachRow",
    });
    const rows = (await result.json()) as Array<{ n: number | string }>;
    return Number(rows[0]?.n ?? 0) > 0 ? "sql_store" : "none";
  });
}

export default async function execute() {
  // The app owns the model on every distribution, so there is one path and no
  // switch. `lwqlSelfProvisionInputs` returns the derived inputs when both
  // LangWatchQL passwords are set, or null when they are not.
  const inputs = lwqlSelfProvisionInputs();
  if (!inputs) {
    // A password present but the inputs incomplete (both are `optional: true`
    // in the chart) is a misconfiguration to surface, not a crash: declining
    // loudly keeps the boot-never-crashes contract. No password at all is
    // simply a deployment not running LangWatchQL.
    if (process.env.LWQL_CLICKHOUSE_PASSWORD) {
      logger.warn(
        "LangWatchQL is partially configured — skipping provisioning this boot; queries stay refused (fail-closed) until the configuration is complete",
      );
    } else {
      logger.info("LWQL not configured, skipping");
    }
    return;
  }

  // `sourceDatabase` is parsed inside selfProvisionAll's try, so a CLICKHOUSE_URL
  // that parses but names an invalid database identifier degrades non-fatally
  // instead of throwing out of this task.
  await selfProvisionAll(inputs);
}
