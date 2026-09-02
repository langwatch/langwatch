/**
 * Deploy-time provisioning for LangWatchQL: creates the ClickHouse-native
 * views and the PostgreSQL approved views, and backfills the key-map table
 * from every project's `lwqlKey`. Outside SaaS it also reconciles the
 * ClickHouse access model (restricted user, settings profile, grants, row
 * policies) by default — see {@link shouldSelfProvisionLwqlAccessModel}. In
 * SaaS that access model, and the PostgreSQL-mapped reader role, stay
 * Terraform's job: Terraform provisions them out of band so it remains the
 * single writer to that security boundary, and the unprivileged Cloud runtime
 * never issues `CREATE USER`/`GRANT`.
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
  shouldSelfProvisionLwqlAccessModel,
  withTenancyOptOut,
} from "../server/analytics/lwql/productionProvisioning";
import {
  KEY_MAP_COLUMNS,
  type LangWatchQLNames,
  lwqlClickHouseSetupStatements,
} from "../server/analytics/lwql/provisioning";
import {
  lwqlSourceTables,
  lwqlViewSetupStatements,
  SHIPPED_LWQL_DEDUP,
} from "../server/analytics/lwql/views";
import { parseConnectionUrl } from "../server/clickhouse/goose";
import { prisma } from "../server/db";
import { env } from "~/env.mjs";

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
    "provisioning LangWatchQL objects — outside SaaS the ClickHouse access model is reconciled here by default; in SaaS it and the PostgreSQL-mapped reader role are provisioned by Terraform, out of band",
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
    await backfillKeyMap({ client, names, sourceDatabase });

    // Default outside SaaS, the exception being SaaS itself: there the
    // ClickHouse access model (restricted user, settings profile, GRANTs, row
    // policies) stays Terraform's job, out of band — Terraform is the single
    // writer to that security boundary during incidents, the Cloud runtime
    // identity is unprivileged by design, and issuing CREATE USER/GRANT here
    // would be rejected against that server-managed identity (see
    // productionProvisioning.ts). A self-hosted/dev deployment has no such
    // Terraform job, so the app reconciles the model itself — closing the exact
    // gap that leaves a newly-catalogued view (e.g. trace_metrics_by_minute)
    // created but ungranted, failing ACCESS_DENIED, until someone re-runs the
    // out-of-band job by hand. `LWQL_SELF_PROVISION_ACCESS_MODEL` overrides in
    // both directions (see shouldSelfProvisionLwqlAccessModel).
    if (
      shouldSelfProvisionLwqlAccessModel({
        override: process.env.LWQL_SELF_PROVISION_ACCESS_MODEL,
        isSaas: env.IS_SAAS,
      })
    ) {
      try {
        const password = process.env.LWQL_CLICKHOUSE_PASSWORD;
        if (!password) {
          throw new Error(
            "LWQL_SELF_PROVISION_ACCESS_MODEL=true but LWQL_CLICKHOUSE_PASSWORD is unset",
          );
        }
        const lwqlTables = lwqlSourceTables({ names, sourceDatabase });
        const accessStatements = lwqlClickHouseSetupStatements({
          names,
          password,
          lwqlTables,
          sourceDatabase,
        });
        for (const statement of accessStatements) {
          await client.command({ query: statement });
        }
        // Must run *after* accessStatements above: the per-view GRANTs point
        // at the restricted user accessStatements just (re)created, so a
        // grant issued before the user still points at the replaced access
        // entity (see views.ts's lwqlViewSetupStatements doc comment).
        const viewStatements = lwqlViewSetupStatements({
          names,
          sourceDatabase,
          dedup: SHIPPED_LWQL_DEDUP,
        });
        for (const statement of viewStatements) {
          await client.command({ query: statement });
        }
        logger.info(
          "lwql self-provisioning: ClickHouse access model (user, profile, grants, row policies) and view grants reconciled",
        );
      } catch (error) {
        // Log-and-continue, never crash boot: queries already fail closed via
        // lwql_provisioning_incomplete when the access model is missing, so a
        // ClickHouse hiccup here costs nothing extra in availability terms.
        logger.error(
          { error: errorMessage(error) },
          "lwql self-provisioning: failed to reconcile ClickHouse access model",
        );
      }
    }
  });

  logger.info("LangWatchQL provisioning complete");
}
