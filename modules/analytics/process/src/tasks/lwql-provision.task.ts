/**
 * @see ../services/langwatch-ql-production-provisioning.service.ts — the pure composition
 * @see packages/clickhouse-migrations/migrations/00084_create_lwql_api_key_tenant_map.sql
 * @see specs/lwql/api.feature
 */

import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { parseConnectionUrl } from "@langwatch/clickhouse-migrations";
import { createLogger } from "@langwatch/observability";
import { Task } from "@langwatch/task";

import { LWQL_KEY_MAP_INSERT_SETTINGS } from "../repositories/clickhouse/clickhouse.langwatch-ql-key-map.repository.ts";
import { canProvisionAppFunctions } from "../rules/langwatch-ql-app-function-store.rules.ts";
import {
  KEY_MAP_COLUMNS,
  type LangWatchQLNames,
} from "../services/langwatch-ql-access-model.service.ts";
import { LangWatchQLExecutorService } from "../services/langwatch-ql-executor.service.ts";
import {
  LangWatchQLProductionProvisioningService,
  LWQL_POSTGRES_READER_ROLE,
  type LwqlKeyMapBackfillPlan,
} from "../services/langwatch-ql-production-provisioning.service.ts";
import {
  LangWatchQLSelfProvisioningService,
  type LwqlSelfProvisionRequest,
} from "../services/langwatch-ql-self-provisioning.service.ts";

const lwqlProvisioning = LangWatchQLProductionProvisioningService.create();
const lwqlExecutors = LangWatchQLExecutorService.create();
const selfProvisioning = LangWatchQLSelfProvisioningService.create();

/** One global key: the self-provision convergence is a singleton, not per tenant. */
const LWQL_SELF_PROVISION_LOCK_KEY = "lwql:self-provision";
/** Bounds one pod's wait plus run; a tail pod that times out finds the model converged. */
const LWQL_SELF_PROVISION_TXN_TIMEOUT_MS = 300_000;
const LWQL_SELF_PROVISION_TXN_MAX_WAIT_MS = 30_000;

const logger = createLogger("langwatch:task:lwql-provision");

/**
 * Exactly the Postgres operations this task performs.
 */
export type LwqlProvisioningDatabase = {
  $executeRawUnsafe: (statement: string) => Promise<number>;
  $transaction: <T>(
    fn: (tx: { $executeRawUnsafe: (statement: string) => Promise<number> }) => Promise<T>,
    options: { timeout: number; maxWait: number },
  ) => Promise<T>;
  project: {
    findMany: (args: {
      select: { id: true; lwqlKey: true };
    }) => Promise<{ id: string; lwqlKey: string }[]>;
  };
};

/**
 * The admin ClickHouse connection — `CLICKHOUSE_URL`, the app's own
 * credentials — never the restricted `LWQL_CLICKHOUSE_*` identity, which has
 * no DDL privileges by design.
 */
async function withAdminClickHouseClient<T>({
  url,
  fn,
}: {
  url: string | undefined;
  fn: (client: ClickHouseClient) => Promise<T>;
}): Promise<T> {
  const client = createClient({ url });
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
    await database.$executeRawUnsafe(lwqlProvisioning.withTenancyOptOut(statement));
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

  const table = lwqlProvisioning.keyMapTableQualifiedName({ names, sourceDatabase });
  // Deliberately unfiltered: this admin scan collects key hashes across ALL
  // tenants to diff against every project's key — the one query shape the
  // "every ClickHouse query MUST filter on TenantId" rule cannot apply to.
  // `qualified()` (via lwqlProvisioning.keyMapTableQualifiedName) validates the
  // interpolated database and table identifiers.
  const existingResult = await client.query({
    query: `SELECT DISTINCT ${KEY_MAP_COLUMNS.keyHash} FROM ${table}`,
    format: "JSONEachRow",
  });
  const existingRows = (await existingResult.json()) as Record<string, string>[];
  // `noUncheckedIndexedAccess` types the lookup as `string | undefined` even
  // though every row genuinely carries this column (it is the only thing the
  // query selects) — filtered, not defaulted, so a row that somehow lacked it
  // is dropped rather than coerced into a bogus "" entry in the set.
  const existingHashes = new Set(
    existingRows
      .map((row) => row[KEY_MAP_COLUMNS.keyHash])
      .filter((hash): hash is string => hash !== undefined),
  );

  return lwqlProvisioning.planKeyMapBackfill({ projects, existingHashes });
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

  const table = lwqlProvisioning.keyMapTableQualifiedName({ names, sourceDatabase });
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
 * One statement per round trip, so a failure names which one. The error is
 * redacted first: a ClickHouse error echoes the DDL, which embeds passwords.
 */
async function runClickHouseStatements({
  client,
  statements,
  secrets = [],
}: {
  client: ClickHouseClient;
  statements: string[];
  secrets?: readonly (string | undefined)[];
}): Promise<void> {
  for (const [index, statement] of statements.entries()) {
    try {
      await client.command({ query: statement });
    } catch (error) {
      logger.error(
        {
          error: selfProvisioning.redactSecrets({ text: errorMessage(error), secrets }),
          statement: `${index + 1}/${statements.length}`,
        },
        "lwql provisioning failed creating ClickHouse objects",
      );
      throw error;
    }
  }
}

/**
 * Whether this server holds the app functions on every replica. A server that
 * cannot say, or would hold them on one replica only, is provisioned without
 * them: half the replicas answering UNKNOWN_FUNCTION is worse than none.
 */
async function appFunctionsProvisionable(client: ClickHouseClient): Promise<boolean> {
  try {
    const [replicas, setting] = await Promise.all([
      client
        .query({
          query: "SELECT toString(max(total_replicas)) AS max_total_replicas FROM system.replicas",
          format: "JSONEachRow",
        })
        .then((result) => result.json<{ max_total_replicas: string }>()),
      client
        .query({
          query:
            "SELECT value FROM system.server_settings WHERE name = 'user_defined_zookeeper_path'",
          format: "JSONEachRow",
        })
        .then((result) => result.json<{ value: string }>()),
    ]);
    const probe = {
      maxTotalReplicas: Number(replicas[0]?.max_total_replicas ?? "0") || 0,
      userDefinedZookeeperPath: setting[0]?.value ?? "",
    };
    if (canProvisionAppFunctions(probe)) return true;
    logger.error(
      { maxTotalReplicas: probe.maxTotalReplicas },
      "lwql self-provisioning skipped the app functions: this ClickHouse has more than one replica and no user_defined_zookeeper_path, so a CREATE FUNCTION would reach one replica only. Set user_defined_zookeeper_path in the server config and redeploy; LangWatchQL app functions stay refused until then",
    );
    return false;
  } catch (error) {
    logger.error(
      { error: errorMessage(error) },
      "lwql self-provisioning could not read the replica layout from system.replicas and system.server_settings; the app functions are left out until it can",
    );
    return false;
  }
}

/**
 * With `connection_limit=1` the lock's transaction pins the only connection
 * and the convergence body can never borrow one, so refuse that up front.
 */
function assertPoolFitsSelfProvisionLock(databaseUrl: string | undefined): void {
  if (!databaseUrl) return;
  let connectionLimit: string | null;
  try {
    connectionLimit = new URL(databaseUrl).searchParams.get("connection_limit");
  } catch {
    return;
  }
  if (connectionLimit === "1") {
    throw new Error(
      "LWQL self-provision lock requires a connection pool of at least 2 (DATABASE_URL has connection_limit=1): the lock's transaction would pin the only connection and the convergence could never acquire one. Raise connection_limit to 2 or more.",
    );
  }
}

/**
 * Serialises the destructive convergence across pods booting together: a blocking,
 * transaction-scoped advisory lock gates entry and a waiting pod re-runs the idempotent
 * convergence. The body runs on other connections, so the lock session must not idle out.
 */
async function withSelfProvisionLock<T>({
  database,
  databaseUrl,
  fn,
}: {
  database: LwqlProvisioningDatabase;
  databaseUrl: string | undefined;
  fn: () => Promise<T>;
}): Promise<T> {
  assertPoolFitsSelfProvisionLock(databaseUrl);
  return database.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(
        `-- @tenancy: global self-provision boot lock, no tenant scope\nSELECT pg_advisory_xact_lock(hashtextextended('${LWQL_SELF_PROVISION_LOCK_KEY}', 0))`,
      );
      await tx.$executeRawUnsafe(
        "-- @tenancy: global self-provision boot lock session setting, no tenant scope\nSET LOCAL idle_in_transaction_session_timeout = 0",
      );
      return fn();
    },
    { timeout: LWQL_SELF_PROVISION_TXN_TIMEOUT_MS, maxWait: LWQL_SELF_PROVISION_TXN_MAX_WAIT_MS },
  );
}

/**
 * The `LWQL_SELF_PROVISION=true` path: the whole model, and never a thrown
 * error. It ships default-on for external ClickHouse, so a server refusing
 * the DDL degrades to a loud log and a fail-closed endpoint, not a crashloop.
 */
async function selfProvisionAll({
  database,
  source,
  request,
  names,
  sourceDatabase,
}: {
  database: LwqlProvisioningDatabase;
  source: Record<string, string | undefined>;
  request: Extract<LwqlSelfProvisionRequest, { complete: true }>;
  names: LangWatchQLNames;
  sourceDatabase: string;
}): Promise<void> {
  logger.info(
    { database: names.database, sourceDatabase },
    "self-provisioning the full LangWatchQL model — access model, PostgreSQL bridge, views (LWQL_SELF_PROVISION)",
  );
  const secrets = [
    request.connection.password,
    request.postgresReaderPassword,
    source.CLICKHOUSE_URL,
    source.DATABASE_URL,
  ];

  try {
    await withSelfProvisionLock({
      database,
      databaseUrl: source.DATABASE_URL,
      fn: async () => {
        const schema = lwqlProvisioning.postgresSchemaFromDatabaseUrl(source.DATABASE_URL);
        await runPostgresStatements({
          database,
          statements: [
            ...lwqlProvisioning.postgresApprovedViewStatements({
              schema,
              readerRole: LWQL_POSTGRES_READER_ROLE,
            }),
            // After the views: the reader role's grants name them.
            ...selfProvisioning.postgresReaderStatements({
              mode: "manage-role",
              readerPassword: request.postgresReaderPassword,
              schema,
            }).statements,
          ],
        });

        await withAdminClickHouseClient({
          url: source.CLICKHOUSE_URL,
          fn: async (client) => {
            const includeAppFunctions = await appFunctionsProvisionable(client);
            await runClickHouseStatements({
              client,
              secrets,
              statements: selfProvisioning.clickHouseStatements({
                names,
                restrictedPassword: request.connection.password,
                sourceDatabase,
                postgres: {
                  endpoint: request.endpoint,
                  readerPassword: request.postgresReaderPassword,
                },
                includeAppFunctions,
              }),
            });
            // Non-fatal here: the backfill converges, and project creation syncs rows inline.
            try {
              await backfillKeyMap({ client, database, names, sourceDatabase });
            } catch (error) {
              logger.error(
                { error: selfProvisioning.redactSecrets({ text: errorMessage(error), secrets }) },
                "lwql key-map backfill failed — continuing; project creation syncs rows inline and the next deploy retries the rest",
              );
            }
          },
        });
      },
    });
    logger.info("LangWatchQL self-provisioning complete");
  } catch (error) {
    logger.error(
      { error: selfProvisioning.redactSecrets({ text: errorMessage(error), secrets }) },
      "lwql self-provisioning failed — continuing boot; LangWatchQL queries stay refused (fail-closed) until a later deploy converges",
    );
  }
}

export async function runLwqlProvisioningTask({
  database,
  source,
}: {
  database: LwqlProvisioningDatabase;
  /** The environment the launching process was configured with. */
  source: Record<string, string | undefined>;
}): Promise<void> {
  const selfProvision = selfProvisioning.request({ source });
  if (selfProvision.requested && !selfProvision.complete) {
    logger.warn(
      { missing: selfProvision.missing },
      "LWQL_SELF_PROVISION is true but its inputs are incomplete — skipping provisioning this boot; LangWatchQL queries stay refused (fail-closed) until the configuration is complete",
    );
    return;
  }

  const connection = selfProvision.requested
    ? selfProvision.connection
    : lwqlExecutors.parseConnectionFromEnvironment(source);
  if (!connection) {
    logger.info("LWQL not configured, skipping");
    return;
  }

  const names = lwqlProvisioning.names({ connection });
  const { database: sourceDatabase } = parseConnectionUrl({
    connectionUrl: source.CLICKHOUSE_URL,
    clusterName: source.CLICKHOUSE_CLUSTER,
  });

  if (selfProvision.requested) {
    await selfProvisionAll({ database, source, request: selfProvision, names, sourceDatabase });
    return;
  }

  logger.info(
    { database: names.database, sourceDatabase },
    "provisioning LangWatchQL objects — the ClickHouse access model and PostgreSQL-mapped views are provisioned by infra, out of band",
  );

  // The schema the tables actually live in (Prisma's `?schema=` URL
  // parameter), not a hardcoded `public` — the SaaS cloud deploys with
  // `schema=langwatch_db`, where `public."Annotation"` does not exist.
  const postgresSchema = lwqlProvisioning.postgresSchemaFromDatabaseUrl(source.DATABASE_URL);

  // Chart-managed ClickHouse paired with chart-managed PostgreSQL converges
  // lwql_ro itself (manage-role); anything else owns the role out of band and
  // only has the approved views re-granted. Read before the views, whose
  // fallback path re-grants this same role.
  const readerMode = selfProvisioning.readerMode({ source });
  const readerRole =
    readerMode === "manage-role"
      ? LWQL_POSTGRES_READER_ROLE
      : source.LWQL_POSTGRES_READER_ROLE || LWQL_POSTGRES_READER_ROLE;

  try {
    await runPostgresStatements({
      database,
      statements: lwqlProvisioning.postgresApprovedViewStatements({
        schema: postgresSchema,
        readerRole,
      }),
    });
    // Straight after creation: a view added by this deploy otherwise has no
    // grant until someone re-runs the out-of-band job. A no-op where the role is absent.
    const reader =
      readerMode === "manage-role"
        ? selfProvisioning.postgresReaderStatements({
            mode: "manage-role",
            readerPassword: source.LWQL_POSTGRES_READER_PASSWORD,
            schema: postgresSchema,
          })
        : selfProvisioning.postgresReaderStatements({
            mode: "grants-only",
            role: source.LWQL_POSTGRES_READER_ROLE,
            schema: postgresSchema,
          });
    if (reader.warning) logger.warn(reader.warning);
    await runPostgresStatements({ database, statements: reader.statements });
  } catch (error) {
    logger.error({ error }, "lwql provisioning failed creating PostgreSQL approved views");
    throw error;
  }

  await withAdminClickHouseClient({
    url: source.CLICKHOUSE_URL,
    fn: async (client) => {
      await runClickHouseStatements({
        client,
        statements: lwqlProvisioning.clickHouseObjectStatements({ names, sourceDatabase }),
      });

      // Fatal: a failed backfill leaves pre-existing projects without a key-map row (inline sync
      // only covers projects created after the failure) — silently WRONG, not degraded: row
      // policies resolve an absent hash to an empty tenant set, so queries return zero rows with
      // HTTP 200 rather than `lwql_unavailable`, undetected by the request path.
      await backfillKeyMap({ client, database, names, sourceDatabase });
    },
  });

  logger.info("LangWatchQL provisioning complete");
}

/**
 * The task-launcher entry (`pnpm --filter @langwatch/tasks task lwql-provision`) — a thin
 * wrapper over {@link runLwqlProvisioningTask}, the whole contract; this class is only the
 * seam the catalogue resolves by name, with `database` from `TaskHost.requirePrisma()`.
 */
export class LwqlProvisionTask extends Task {
  readonly name = "lwql-provision";
  readonly description =
    "Provisions LangWatchQL's ClickHouse and PostgreSQL objects and backfills the key-map table.";

  private constructor(
    private readonly database: () => LwqlProvisioningDatabase,
    private readonly source: Record<string, string | undefined>,
    private readonly skipped: boolean,
  ) {
    super();
  }

  /**
   * `database` is a thunk, not a resolved value, since resolving it (which
   * can throw) is deferred to `run()`. `skipped` is the boot chain's
   * `SKIP_LWQL_PROVISION=true` opt-out.
   */
  static create({
    database,
    source,
    skipped = false,
  }: {
    database: () => LwqlProvisioningDatabase;
    /** The environment the launching process was configured with. */
    source: Record<string, string | undefined>;
    skipped?: boolean;
  }): LwqlProvisionTask {
    return new LwqlProvisionTask(database, source, skipped);
  }

  async run(_input: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    if (this.skipped) {
      logger.info("SKIP_LWQL_PROVISION=true — skipping LangWatchQL provisioning");
      return;
    }
    await runLwqlProvisioningTask({ database: this.database(), source: this.source });
  }
}
