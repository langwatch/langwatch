/**
 * Deploy-time provisioning for LangWatchQL: creates the ClickHouse-native
 * views and the PostgreSQL approved views, and backfills the key-map table
 * from every project's `lwqlKey`. The ClickHouse access model (restricted
 * user, settings profile, grants, row policies) and the PostgreSQL-mapped
 * views are infra's job — terraform provisions both out of band, and this
 * task never touches either.
 *
 * Runs after `clickhouse-migrate` (migration 00084 creates the key-map table
 * this task writes into) as `pnpm --filter @langwatch/tasks task
 * lwql-provision`. A deploy with no `LWQL_*` environment configured is
 * unaffected: {@link lwqlConnectionFromEnv} returns `null` and this task
 * exits immediately. Idempotent every run — every generator emits
 * `IF NOT EXISTS`/`OR REPLACE`/`CREATE OR REPLACE` DDL, and the key-map
 * backfill only inserts rows missing from the table.
 *
 * @see ../langwatch-ql/production-provisioning.ts — the pure composition
 *   this orchestrates
 * @see ../../../../../clickhouse-client/migrations/00084_create_lwql_api_key_tenant_map.sql
 * @see specs/analytics/lwql-api.feature
 */

import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { createLogger } from "@langwatch/observability";

import { parseConnectionUrl } from "@langwatch/clickhouse-client";
import { Task } from "@langwatch/task";
import { lwqlConnectionFromEnv } from "../langwatch-ql/executor";
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
} from "../langwatch-ql/production-provisioning";
import { KEY_MAP_COLUMNS, type LangWatchQLNames } from "../langwatch-ql/provisioning";
import { LWQL_KEY_MAP_INSERT_SETTINGS } from "../repositories/clickhouse/clickhouse.langwatch-ql-key-map.repository";

const logger = createLogger("langwatch:task:lwql-provision");

/**
 * Exactly the two Postgres operations this task performs.
 *
 * A narrow shape rather than the whole client: the statements are catalog-wide
 * DDL and one unfiltered project scan, and naming that much makes it plain
 * that nothing here reads a tenant's rows.
 */
export type LwqlProvisioningDatabase = {
  $executeRawUnsafe(statement: string): Promise<number>;
  project: {
    findMany(args: {
      select: { id: true; lwqlKey: true };
    }): Promise<{ id: string; lwqlKey: string }[]>;
  };
};

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
async function runPostgresStatements({
  database,
  statements,
}: {
  database: LwqlProvisioningDatabase;
  statements: string[];
}): Promise<void> {
  for (const statement of statements) {
    await database.$executeRawUnsafe(withTenancyOptOut(statement));
  }
}

async function planBackfillFromCurrentState({
  client,
  database,
  names,
  sourceDatabase,
}: {
  client: ClickHouseClient;
  database: LwqlProvisioningDatabase;
  names: LangWatchQLNames;
  sourceDatabase: string;
}): Promise<LwqlKeyMapBackfillPlan> {
  const projects = await database.project.findMany({
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
  const existingRows = (await existingResult.json()) as Array<Record<string, string>>;
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
  database,
  names,
  sourceDatabase,
}: {
  client: ClickHouseClient;
  database: LwqlProvisioningDatabase;
  names: LangWatchQLNames;
  sourceDatabase: string;
}): Promise<void> {
  const plan = await planBackfillFromCurrentState({
    client,
    database,
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

export async function runLwqlProvisioningTask({
  database,
}: {
  database: LwqlProvisioningDatabase;
}): Promise<void> {
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

  // The schema the tables actually live in (Prisma's `?schema=` URL
  // parameter), not a hardcoded `public` — the SaaS cloud deploys with
  // `schema=langwatch_db`, where `public."Annotation"` does not exist.
  const postgresSchema = lwqlPostgresSchemaFromDatabaseUrl(process.env.DATABASE_URL);

  try {
    await runPostgresStatements({
      database,
      statements: productionPostgresApprovedViewStatements({ schema: postgresSchema }),
    });
    // Immediately after creation, in the same step: the reader role is
    // provisioned out of band and its grants were issued against whatever
    // views existed then, so a view added by this deploy would otherwise have
    // no grant on it and every query touching it would fail ACCESS_DENIED
    // until someone re-ran the out-of-band job by hand. A no-op where the
    // role does not exist.
    await runPostgresStatements({
      database,
      statements: productionPostgresReaderGrantStatements({
        schema: postgresSchema,
        role: process.env.LWQL_POSTGRES_READER_ROLE,
      }),
    });
  } catch (error) {
    logger.error({ error }, "lwql provisioning failed creating PostgreSQL approved views");
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
    await backfillKeyMap({ client, database, names, sourceDatabase });
  });

  logger.info("LangWatchQL provisioning complete");
}

/**
 * The task-launcher entry — `pnpm --filter @langwatch/tasks task
 * lwql-provision`. A thin wrapper over {@link runLwqlProvisioningTask}: the
 * body above is the whole contract, and this class is only the seam the
 * catalogue resolves by name. `database` is composed by the catalogue from
 * the process's real Prisma handle (`TaskHostPort.requirePrisma()`), which
 * satisfies {@link LwqlProvisioningDatabase} structurally.
 */
export class LwqlProvisionTask extends Task {
  readonly name = "lwql-provision";
  readonly description =
    "Provisions LangWatchQL's ClickHouse and PostgreSQL objects and backfills the key-map table.";

  private constructor(private readonly database: () => LwqlProvisioningDatabase) {
    super();
  }

  /**
   * `database` is a thunk rather than a resolved value: the launcher builds
   * the whole catalogue before it knows which task was asked for, and a
   * process with no `DATABASE_URL` must still be able to list its task names
   * or run a task that needs no database. Resolving (and so possibly
   * throwing `TaskInfrastructureUnavailableError`) is deferred to `run()`,
   * which only happens once this task was actually the one selected by name.
   */
  static create({ database }: { database: () => LwqlProvisioningDatabase }): LwqlProvisionTask {
    return new LwqlProvisionTask(database);
  }

  async run(_input: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    await runLwqlProvisioningTask({ database: this.database() });
  }
}
