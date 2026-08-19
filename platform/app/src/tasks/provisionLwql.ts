/**
 * Deploy-time provisioning for LangWatchQL: creates the ClickHouse views (and,
 * in full mode, the whole access model plus the PostgreSQL-mapped views), and
 * backfills the key-map table from every project's `lwqlKey`.
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

import { randomBytes } from "node:crypto";
import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { createLogger } from "@langwatch/observability";
import { lwqlConnectionFromEnv } from "../server/analytics/lwql/executor";
import {
  LWQL_POSTGRES_READER_ROLE,
  type LwqlKeyMapBackfillPlan,
  lwqlKeyMapTableQualifiedName,
  parseAppPostgresConnection,
  planLwqlKeyMapBackfill,
  productionClickHouseAccessModelStatements,
  productionClickHouseObjectStatements,
  productionLangWatchQLNames,
  productionPostgresApprovedViewStatements,
  productionPostgresReaderRoleStatements,
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
  fullMode,
}: {
  client: ClickHouseClient;
  names: LangWatchQLNames;
  sourceDatabase: string;
  fullMode: boolean;
}): Promise<LwqlKeyMapBackfillPlan> {
  const projects = await prisma.project.findMany({
    select: { id: true, lwqlKey: true },
  });

  const table = lwqlKeyMapTableQualifiedName({
    names,
    sourceDatabase,
    fullMode,
  });
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
  fullMode,
}: {
  client: ClickHouseClient;
  names: LangWatchQLNames;
  sourceDatabase: string;
  fullMode: boolean;
}): Promise<void> {
  const plan = await planBackfillFromCurrentState({
    client,
    names,
    sourceDatabase,
    fullMode,
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

  const table = lwqlKeyMapTableQualifiedName({
    names,
    sourceDatabase,
    fullMode,
  });
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

export default async function execute() {
  const connection = lwqlConnectionFromEnv();
  if (!connection) {
    logger.info("LWQL not configured, skipping");
    return;
  }

  const names = productionLangWatchQLNames({ connection });
  const { database: sourceDatabase } = parseConnectionUrl();
  const fullMode = process.env.LWQL_PROVISION_ACCESS_MODEL === "true";

  logger.info(
    { database: names.database, sourceDatabase, fullMode },
    "provisioning LangWatchQL objects",
  );

  try {
    await runPostgresStatements(productionPostgresApprovedViewStatements());
  } catch (error) {
    logger.error(
      { error },
      "lwql provisioning failed creating PostgreSQL approved views",
    );
    throw error;
  }

  let postgresReaderPassword: string | null = null;
  if (fullMode) {
    postgresReaderPassword = randomBytes(24).toString("hex");
    try {
      await runPostgresStatements(
        productionPostgresReaderRoleStatements({
          password: postgresReaderPassword,
        }),
      );
    } catch (error) {
      logger.error(
        { error },
        "lwql provisioning failed creating the PostgreSQL reader role",
      );
      throw error;
    }
  }

  await withAdminClickHouseClient(async (client) => {
    const statements = fullMode
      ? productionClickHouseAccessModelStatements({
          names,
          sourceDatabase,
          restrictedUserPassword: connection.password,
          postgresConnection: {
            collection: `lwql_${names.database}_postgres`,
            ...parseAppPostgresConnection(),
            user: LWQL_POSTGRES_READER_ROLE,
            // Non-null: only reachable when fullMode generated it above.
            password: postgresReaderPassword as string,
          },
        })
      : productionClickHouseObjectStatements({ names, sourceDatabase });

    if (!fullMode) {
      logger.info(
        "skipping LangWatchQL access-model grants/policies and PostgreSQL-mapped views — set LWQL_PROVISION_ACCESS_MODEL=true for a self-hosted deploy that owns its own ClickHouse access model",
      );
    }

    try {
      for (const statement of statements) {
        await client.command({ query: statement });
      }
    } catch (error) {
      logger.error(
        { error, fullMode },
        "lwql provisioning failed creating ClickHouse objects",
      );
      throw error;
    }

    try {
      await backfillKeyMap({ client, names, sourceDatabase, fullMode });
    } catch (error) {
      logger.error({ error }, "lwql key-map backfill failed");
      throw error;
    }
  });

  logger.info("LangWatchQL provisioning complete");
}
