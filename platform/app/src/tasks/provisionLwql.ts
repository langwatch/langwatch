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

/**
 * Driver and Prisma errors commonly embed the failing statement text, and in
 * full mode the statement text carries the two live secrets this run holds
 * (the restricted ClickHouse user's password and the PostgreSQL reader's).
 * Everything logged or rethrown out of a statement loop goes through here
 * first, so a DDL failure cannot write either credential into the deploy logs.
 */
function redactSecrets(text: string, secrets: Array<string | null>): string {
  let redacted = text;
  for (const secret of secrets) {
    if (secret) redacted = redacted.replaceAll(secret, "[REDACTED]");
  }
  return redacted;
}

function redactedFailure(error: unknown, secrets: Array<string | null>): Error {
  return new Error(
    redactSecrets(
      error instanceof Error ? error.message : String(error),
      secrets,
    ),
  );
}

async function planBackfillFromCurrentState({
  client,
  names,
  sourceDatabase,
  isFullMode,
}: {
  client: ClickHouseClient;
  names: LangWatchQLNames;
  sourceDatabase: string;
  isFullMode: boolean;
}): Promise<LwqlKeyMapBackfillPlan> {
  const projects = await prisma.project.findMany({
    select: { id: true, lwqlKey: true },
  });

  const table = lwqlKeyMapTableQualifiedName({
    names,
    sourceDatabase,
    isFullMode,
  });
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
  isFullMode,
}: {
  client: ClickHouseClient;
  names: LangWatchQLNames;
  sourceDatabase: string;
  isFullMode: boolean;
}): Promise<void> {
  const plan = await planBackfillFromCurrentState({
    client,
    names,
    sourceDatabase,
    isFullMode,
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
    isFullMode,
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
  const isFullMode = process.env.LWQL_PROVISION_ACCESS_MODEL === "true";

  logger.info(
    { database: names.database, sourceDatabase, isFullMode },
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
  if (isFullMode) {
    // A stable secret from the environment when the deploy provides one:
    // the reader-role write (here) and the matching ClickHouse named
    // collection (later, in the statement loop) are two halves of one
    // credential, and a run that fails between them would leave a freshly
    // generated password on the role with the previous one still in the
    // collection — breaking every PostgreSQL-mapped view until a later run
    // completes both halves. With the env var set, both halves converge on
    // the same value on every run, partial or not. Generation is the
    // first-run fallback only.
    postgresReaderPassword =
      process.env.LWQL_POSTGRES_READER_PASSWORD ??
      randomBytes(24).toString("hex");
    if (!process.env.LWQL_POSTGRES_READER_PASSWORD) {
      logger.warn(
        "LWQL_POSTGRES_READER_PASSWORD is not set — generating a one-run reader password; a run that fails between the PostgreSQL role write and the ClickHouse named-collection write will desynchronize the two until a later run completes. Set the env var to make the credential stable across runs.",
      );
    }
    try {
      await runPostgresStatements(
        productionPostgresReaderRoleStatements({
          password: postgresReaderPassword,
        }),
      );
    } catch (error) {
      const failure = redactedFailure(error, [postgresReaderPassword]);
      logger.error(
        { error: failure.message },
        "lwql provisioning failed creating the PostgreSQL reader role",
      );
      throw failure;
    }
  }

  await withAdminClickHouseClient((client) =>
    provisionClickHouse({
      client,
      names,
      sourceDatabase,
      isFullMode,
      restrictedUserPassword: connection.password,
      postgresReaderPassword,
    }),
  );

  logger.info("LangWatchQL provisioning complete");
}

async function provisionClickHouse({
  client,
  names,
  sourceDatabase,
  isFullMode,
  restrictedUserPassword,
  postgresReaderPassword,
}: {
  client: ClickHouseClient;
  names: LangWatchQLNames;
  sourceDatabase: string;
  isFullMode: boolean;
  restrictedUserPassword: string;
  postgresReaderPassword: string | null;
}): Promise<void> {
  const statements = isFullMode
    ? productionClickHouseAccessModelStatements({
        names,
        sourceDatabase,
        restrictedUserPassword,
        postgresConnection: {
          collection: `lwql_${names.database}_postgres`,
          ...parseAppPostgresConnection(),
          user: LWQL_POSTGRES_READER_ROLE,
          // Non-null: only reachable when full mode resolved it in execute().
          password: postgresReaderPassword as string,
        },
      })
    : productionClickHouseObjectStatements({ names, sourceDatabase });

  if (!isFullMode) {
    logger.info(
      "skipping LangWatchQL access-model grants/policies and PostgreSQL-mapped views — set LWQL_PROVISION_ACCESS_MODEL=true for a self-hosted deploy that owns its own ClickHouse access model",
    );
  }

  const secrets = [restrictedUserPassword, postgresReaderPassword];
  for (const [index, statement] of statements.entries()) {
    try {
      await client.command({ query: statement });
    } catch (error) {
      const failure = redactedFailure(error, secrets);
      logger.error(
        {
          error: failure.message,
          statement: `${index + 1}/${statements.length}`,
          isFullMode,
        },
        "lwql provisioning failed creating ClickHouse objects",
      );
      throw failure;
    }
  }

  // Non-fatal by design: the backfill is convergent — project creation
  // writes new rows inline (`project.service.ts`) and the next run of this
  // task picks up anything missed — so a slow or briefly unavailable
  // key-map table must not block the whole deploy. The views above ARE
  // fatal: without them every LangWatchQL query fails.
  try {
    await backfillKeyMap({ client, names, sourceDatabase, isFullMode });
  } catch (error) {
    logger.error(
      { error: redactedFailure(error, secrets).message },
      "lwql key-map backfill failed — continuing; project creation syncs rows inline and the next deploy retries the rest",
    );
  }
}
