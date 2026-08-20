/**
 * Deploy-time provisioning for LangWatchQL: creates the ClickHouse-native
 * views and the PostgreSQL approved views, and backfills the key-map table
 * from every project's `lwqlKey`. In the explicit five-`LWQL_*`-variables
 * deployment (the SaaS cloud), the ClickHouse access model (restricted user,
 * settings profile, grants, row policies) and the PostgreSQL-mapped views are
 * infra's job — terraform provisions both out of band, and this task touches
 * neither.
 *
 * Under `LWQL_SELF_PROVISION=true` (issue #6635 — the Helm chart and other
 * self-hosted distributions) there is no terraform, and this task owns the
 * whole model: it additionally converges the PostgreSQL reader role, the
 * restricted identity, the named collection, and the PostgreSQL-engine
 * tables, from `../server/analytics/lwql/selfProvisioning.ts`'s composition.
 * That path is deliberately non-fatal — a default-on feature must never turn
 * a server-side provisioning failure into a boot crashloop; the endpoint
 * simply stays fail-closed ("unavailable") until the next boot converges.
 *
 * Runs after `clickhouseMigrate` (migration 00084 creates the key-map table
 * this task writes into) in `start:prepare:db`. A deploy with no `LWQL_*`
 * environment configured is unaffected: {@link lwqlConnectionFromEnv} returns
 * `null` and this task exits immediately. Idempotent every run — every
 * generator emits `IF NOT EXISTS`/`OR REPLACE`/`CREATE OR REPLACE` DDL, and
 * the key-map backfill only inserts rows missing from the table.
 *
 * @see ../server/analytics/lwql/productionProvisioning.ts — the pure
 *   composition this orchestrates
 * @see ../server/analytics/lwql/selfProvisioning.ts — the self-hosted extras
 * @see ../server/clickhouse/migrations/00084_create_lwql_api_key_tenant_map.sql
 * @see specs/analytics/lwql-api.feature
 */

import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { createLogger } from "@langwatch/observability";
import { lwqlConnectionFromEnv } from "../server/analytics/lwql/executor";
import { LWQL_KEY_MAP_INSERT_SETTINGS } from "../server/analytics/lwql/lwqlKeyMap.repository";
import {
  type LwqlKeyMapBackfillPlan,
  lwqlKeyMapTableQualifiedName,
  lwqlPostgresSchemaFromDatabaseUrl,
  planLwqlKeyMapBackfill,
  productionClickHouseObjectStatements,
  productionLangWatchQLNames,
  productionPostgresApprovedViewStatements,
  productionPostgresReaderGrantStatements,
  withTenancyOptOut,
} from "../server/analytics/lwql/productionProvisioning";
import {
  KEY_MAP_COLUMNS,
  type LangWatchQLNames,
} from "../server/analytics/lwql/provisioning";
import {
  type LwqlSelfProvisionEnv,
  lwqlPostgresEndpointFromDatabaseUrl,
  lwqlSelfProvisionFromEnv,
  selfHostedClickHouseProvisioningStatements,
  selfHostedPostgresReaderStatements,
} from "../server/analytics/lwql/selfProvisioning";
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
 * One statement per round trip rather than a single batched command: a failure
 * here is an operator's problem to fix, and ClickHouse reports only that *the*
 * command failed. Sending them individually is what lets the log name which
 * one, which is the difference between an actionable error and "provisioning
 * failed".
 */
async function runClickHouseStatements({
  client,
  statements,
}: {
  client: ClickHouseClient;
  statements: string[];
}): Promise<void> {
  for (const [index, statement] of statements.entries()) {
    try {
      await client.command({ query: statement });
    } catch (error) {
      logger.error(
        {
          error: errorMessage(error),
          statement: `${index + 1}/${statements.length}`,
        },
        "lwql provisioning failed creating ClickHouse objects",
      );
      throw error;
    }
  }
}

/**
 * The `LWQL_SELF_PROVISION=true` path: the whole model, and never a thrown
 * error. This mode ships default-on in the Helm chart, so a ClickHouse server
 * that refuses access-model DDL (say, an external one without
 * `access_management` for the admin user) must degrade to a loud log and a
 * fail-closed endpoint, not a crashlooping deployment.
 */
async function selfProvisionAll({
  selfProvision,
  names,
  sourceDatabase,
}: {
  selfProvision: LwqlSelfProvisionEnv;
  names: LangWatchQLNames;
  sourceDatabase: string;
}): Promise<void> {
  logger.info(
    { database: names.database, sourceDatabase },
    "self-provisioning the full LangWatchQL model — access model, PostgreSQL bridge, views (LWQL_SELF_PROVISION)",
  );

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
    await runPostgresStatements([
      ...productionPostgresApprovedViewStatements({
        schema: lwqlPostgresSchemaFromDatabaseUrl(process.env.DATABASE_URL),
      }),
      // After the views: the reader role's grants name them.
      ...selfHostedPostgresReaderStatements({
        schema: lwqlPostgresSchemaFromDatabaseUrl(process.env.DATABASE_URL),
        readerPassword: selfProvision.postgresReaderPassword,
      }),
    ]);

    await withAdminClickHouseClient(async (client) => {
      await runClickHouseStatements({
        client,
        statements: selfHostedClickHouseProvisioningStatements({
          names,
          restrictedPassword: selfProvision.connection.password,
          sourceDatabase,
          postgres: {
            endpoint,
            readerPassword: selfProvision.postgresReaderPassword,
          },
        }),
      });

      // Same non-fatal contract as the explicit path: the backfill is
      // convergent, so a slow key-map table must not undo the provisioning
      // above (which this run already committed).
      try {
        await backfillKeyMap({ client, names, sourceDatabase });
      } catch (error) {
        logger.error(
          { error: errorMessage(error) },
          "lwql key-map backfill failed — continuing; project creation syncs rows inline and the next deploy retries the rest",
        );
      }
    });
    logger.info("LangWatchQL self-provisioning complete");
  } catch (error) {
    logger.error(
      { error: errorMessage(error) },
      "lwql self-provisioning failed — continuing boot; LangWatchQL queries stay refused (fail-closed) until a later deploy converges",
    );
  }
}

export default async function execute() {
  // The mode is whichever one the operator asked for, never whichever one's
  // inputs happen to have arrived. `LWQL_SELF_PROVISION=true` with an
  // incomplete Secret (both passwords are `optional: true` in the chart) used
  // to fall through to the explicit path below — which is fatal on error,
  // rethrown by the task runner into `start.sh`'s `set -e`, i.e. a
  // CrashLoopBackOff for a feature the chart promises will "degrade, not brick
  // an upgrade". Self-provisioning declines loudly and lets the pod boot.
  const selfProvisionRequested = process.env.LWQL_SELF_PROVISION === "true";
  const selfProvision = lwqlSelfProvisionFromEnv();
  if (selfProvisionRequested && !selfProvision) {
    logger.warn(
      "LWQL_SELF_PROVISION is true but its inputs are incomplete — skipping provisioning this boot; LangWatchQL queries stay refused (fail-closed) until the configuration is complete",
    );
    return;
  }

  const connection = selfProvision?.connection ?? lwqlConnectionFromEnv();
  if (!connection) {
    logger.info("LWQL not configured, skipping");
    return;
  }

  const names = productionLangWatchQLNames({ connection });
  const { database: sourceDatabase } = parseConnectionUrl();

  if (selfProvision) {
    await selfProvisionAll({ selfProvision, names, sourceDatabase });
    return;
  }

  logger.info(
    { database: names.database, sourceDatabase },
    "provisioning LangWatchQL objects — the ClickHouse access model and PostgreSQL-mapped views are provisioned by infra, out of band",
  );

  // The schema the tables actually live in (Prisma's `?schema=` URL
  // parameter), not a hardcoded `public` — the SaaS cloud deploys with
  // `schema=langwatch_db`, where `public."Annotation"` does not exist.
  const postgresSchema = lwqlPostgresSchemaFromDatabaseUrl(
    process.env.DATABASE_URL,
  );

  try {
    await runPostgresStatements(
      productionPostgresApprovedViewStatements({ schema: postgresSchema }),
    );
    // Immediately after creation, in the same step: the reader role is
    // provisioned out of band and its grants were issued against whatever
    // views existed then, so a view added by this deploy would otherwise have
    // no grant on it and every query touching it would fail ACCESS_DENIED
    // until someone re-ran the out-of-band job by hand. A no-op where the
    // role does not exist.
    await runPostgresStatements(
      productionPostgresReaderGrantStatements({
        schema: postgresSchema,
        role: process.env.LWQL_POSTGRES_READER_ROLE,
      }),
    );
  } catch (error) {
    logger.error(
      { error },
      "lwql provisioning failed creating PostgreSQL approved views",
    );
    throw error;
  }

  await withAdminClickHouseClient(async (client) => {
    await runClickHouseStatements({
      client,
      statements: productionClickHouseObjectStatements({ names, sourceDatabase }),
    });

    // Fatal, exactly like the views above. The inline sync on project
    // creation only ever covers projects created *after* a failure, so a
    // backfill that fails on the first deploy leaves every pre-existing
    // project without a key-map row until some later deploy happens to
    // re-run this task. That state is not a degraded LangWatchQL, it is a
    // silently wrong one: the row policies resolve an absent hash to an
    // empty tenant set, so queries return zero rows with HTTP 200 rather
    // than `lwql_unavailable`, and nothing in the request path detects it.
    //
    // Failing the deploy costs nothing extra in availability terms: this
    // runs on the same admin client as the ClickHouse objects above, so any
    // outage able to fail the backfill has already failed those and aborted
    // the deploy one step earlier.
    await backfillKeyMap({ client, names, sourceDatabase });
  });

  logger.info("LangWatchQL provisioning complete");
}
