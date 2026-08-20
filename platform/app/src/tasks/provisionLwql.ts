/**
 * Deploy-time provisioning for LangWatchQL: creates the ClickHouse-native
 * views and the PostgreSQL approved views, and backfills the key-map table
 * from every project's `lwqlKey`. The ClickHouse access model (restricted
 * user, settings profile, grants, row policies) and the PostgreSQL-mapped
 * views are infra's job — terraform provisions both out of band, and this
 * task never touches either.
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
 * @see ../server/clickhouse/migrations/00084_create_lwql_api_key_tenant_map.sql
 * @see specs/analytics/lwql-api.feature
 */

import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { createLogger } from "@langwatch/observability";
import { lwqlConnectionFromEnv } from "../server/analytics/lwql/executor";
import {
  type LwqlKeyMapBackfillPlan,
  lwqlKeyMapTableQualifiedName,
  lwqlPostgresSchemaFromDatabaseUrl,
  planLwqlKeyMapBackfill,
  productionClickHouseObjectStatements,
  productionLangWatchQLNames,
  productionPostgresApprovedViewStatements,
  withTenancyOptOut,
} from "../server/analytics/lwql/productionProvisioning";
import {
  KEY_MAP_COLUMNS,
  type LangWatchQLNames,
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
    clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
  });
  logger.info(
    { inserted: plan.rowsToInsert.length },
    "lwql key-map backfill: inserted missing rows",
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default async function execute() {
  const connection = lwqlConnectionFromEnv();
  if (!connection) {
    logger.info("LWQL not configured, skipping");
    return;
  }

  const names = productionLangWatchQLNames({ connection });
  const { database: sourceDatabase } = parseConnectionUrl();

  logger.info(
    { database: names.database, sourceDatabase },
    "provisioning LangWatchQL objects — the ClickHouse access model and PostgreSQL-mapped views are provisioned by infra, out of band",
  );

  try {
    await runPostgresStatements(
      productionPostgresApprovedViewStatements({
        // The schema the tables actually live in (Prisma's `?schema=` URL
        // parameter), not a hardcoded `public` — the SaaS cloud deploys with
        // `schema=langwatch_db`, where `public."Annotation"` does not exist.
        schema: lwqlPostgresSchemaFromDatabaseUrl(process.env.DATABASE_URL),
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
    const statements = productionClickHouseObjectStatements({
      names,
      sourceDatabase,
    });

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

    // Non-fatal by design: the backfill is convergent — project creation
    // writes new rows inline (`project.service.ts`) and the next run of this
    // task picks up anything missed — so a slow or briefly unavailable
    // key-map table must not block the whole deploy. The views above ARE
    // fatal: without them every LangWatchQL query fails.
    try {
      await backfillKeyMap({ client, names, sourceDatabase });
    } catch (error) {
      logger.error(
        { error: errorMessage(error) },
        "lwql key-map backfill failed — continuing; project creation syncs rows inline and the next deploy retries the rest",
      );
    }
  });

  logger.info("LangWatchQL provisioning complete");
}
