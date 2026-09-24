/**
 * @see ../services/langwatch-ql-production-provisioning.service.ts — the pure composition
 * @see packages/clickhouse-migrations/migrations/00084_create_lwql_api_key_tenant_map.sql
 * @see specs/lwql/api.feature
 */

import { parseConnectionUrl } from "@langwatch/clickhouse-migrations";
import { createLogger } from "@langwatch/observability";
import { Task } from "@langwatch/task";

import { ClickHouseLangWatchQLProvisioningRepository } from "../repositories/clickhouse/clickhouse.langwatch-ql-provisioning.repository.ts";
import type { LangWatchQLProvisioningRepository } from "../repositories/langwatch-ql-provisioning.repository.ts";
import { canProvisionAppFunctions } from "../rules/langwatch-ql-app-function-store.rules.ts";
import { clickHouseErrorSummary } from "../rules/langwatch-ql-config-store.rules.ts";
import type { LangWatchQLNames } from "../services/langwatch-ql-access-model.service.ts";
import {
  LangWatchQLProductionProvisioningService,
  LWQL_POSTGRES_READER_ROLE,
} from "../services/langwatch-ql-production-provisioning.service.ts";
import {
  LangWatchQLSelfProvisioningService,
  type LwqlSelfProvisionRequest,
} from "../services/langwatch-ql-self-provisioning.service.ts";
import { LangWatchQLSqlModeClusterGuardService } from "../services/langwatch-ql-sql-mode-cluster-guard.service.ts";

const lwqlProvisioning = LangWatchQLProductionProvisioningService.create();
const clusterGuard = LangWatchQLSqlModeClusterGuardService.create();
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

async function withProvisioningRepository<T>({
  open,
  fn,
}: {
  open: () => LangWatchQLProvisioningRepository;
  fn: (repository: LangWatchQLProvisioningRepository) => Promise<T>;
}): Promise<T> {
  const repository = open();
  try {
    return await fn(repository);
  } finally {
    await repository.close();
  }
}

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

/** Inserts only the rows the key map lacks; a blank key is reported, never written. */
async function backfillKeyMap({
  repository,
  database,
  names,
  sourceDatabase,
}: {
  repository: LangWatchQLProvisioningRepository;
  database: LwqlProvisioningDatabase;
  names: LangWatchQLNames;
  sourceDatabase: string;
}): Promise<void> {
  const projects = await database.project.findMany({ select: { id: true, lwqlKey: true } });
  const table = lwqlProvisioning.keyMapTableQualifiedName({ names, sourceDatabase });
  const existingHashes = new Set(await repository.findKeyMapHashes({ table }));
  const plan = lwqlProvisioning.planKeyMapBackfill({ projects, existingHashes });
  if (plan.blankKeyProjectIds.length > 0) {
    logger.error(
      { count: plan.blankKeyProjectIds.length, projectIds: plan.blankKeyProjectIds },
      "lwql key-map backfill found projects with an empty lwqlKey — these projects cannot authenticate to LangWatchQL until their key is regenerated",
    );
  }
  if (plan.rowsToInsert.length === 0) {
    logger.info("lwql key-map backfill: no missing rows");
    return;
  }
  await repository.insertKeyMapRows({ table, rows: plan.rowsToInsert });
  logger.info(
    { inserted: plan.rowsToInsert.length },
    "lwql key-map backfill: inserted missing rows",
  );
}

async function appFunctionsProvisionable(
  repository: LangWatchQLProvisioningRepository,
): Promise<boolean> {
  try {
    const [replicas, setting] = await Promise.all([
      repository.queryRows(
        "SELECT toString(max(total_replicas)) AS max_total_replicas FROM system.replicas",
      ),
      repository.queryRows(
        "SELECT value FROM system.server_settings WHERE name = 'user_defined_zookeeper_path'",
      ),
    ]);
    const probe = {
      maxTotalReplicas: Number(replicas[0]?.max_total_replicas ?? "0") || 0,
      userDefinedZookeeperPath: typeof setting[0]?.value === "string" ? setting[0].value : "",
    };
    if (canProvisionAppFunctions(probe)) return true;
    logger.error(
      { maxTotalReplicas: probe.maxTotalReplicas },
      "lwql self-provisioning skipped the app functions: this ClickHouse has more than one replica and no user_defined_zookeeper_path, so a CREATE FUNCTION would reach one replica only. Set user_defined_zookeeper_path in the server config and redeploy; LangWatchQL app functions stay refused until then",
    );
    return false;
  } catch (error) {
    logger.error(
      { error: clickHouseErrorSummary(error) },
      "lwql self-provisioning could not read the replica layout from system.replicas and system.server_settings; the app functions are left out until it can",
    );
    return false;
  }
}

/**
 * The lock's transaction pins one connection for the whole run; with a pool of one the
 * convergence body can never borrow one, so refuse that up front.
 */
function assertPoolFitsSelfProvisionLock(connectionLimit: number | undefined): void {
  if (connectionLimit === 1) {
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
  connectionLimit,
  fn,
}: {
  database: LwqlProvisioningDatabase;
  connectionLimit: number | undefined;
  fn: () => Promise<T>;
}): Promise<T> {
  assertPoolFitsSelfProvisionLock(connectionLimit);
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

/** Inventory, app-function probe, SQL-mode guard, the statements, then a non-fatal backfill. */
async function convergeClickHouse({
  repository,
  database,
  source,
  request,
  names,
  sourceDatabase,
}: {
  repository: LangWatchQLProvisioningRepository;
  database: LwqlProvisioningDatabase;
  source: Readonly<Record<string, string | undefined>>;
  request: Extract<LwqlSelfProvisionRequest, { complete: true }>;
  names: LangWatchQLNames;
  sourceDatabase: string;
}): Promise<void> {
  const configStoreEntities = await repository.inventoryConfigStore({ names });
  const includeAppFunctions = await appFunctionsProvisionable(repository);
  const mode = selfProvisioning.accessModelMode({ source });
  if (mode === "sql") {
    await clusterGuard.assertSafe({ query: (sql) => repository.queryRows(sql), source });
  }
  const result = await repository.runStatements({
    configStoreEntities,
    statements: selfProvisioning.clickHouseStatements({
      names,
      restrictedPassword: request.connection.password,
      sourceDatabase,
      postgres: { endpoint: request.endpoint, readerPassword: request.postgresReaderPassword },
      includeAppFunctions,
      mode,
    }),
  });
  if (result.skipped.length > 0) {
    logger.warn(
      { skippedCount: result.skipped.length },
      "lwql provisioning yielded to config-store-owned entities and provisioned the rest",
    );
  }
  // Non-fatal here: the backfill converges, and project creation syncs rows inline.
  try {
    await backfillKeyMap({ repository, database, names, sourceDatabase });
  } catch (error) {
    logger.error(
      { error: clickHouseErrorSummary(error) },
      "lwql key-map backfill failed — continuing; project creation syncs rows inline and the next deploy retries the rest",
    );
  }
}

/** Everything one convergence needs, from the deploy task's environment or the worker's members. */
export interface LwqlConvergencePlan {
  readonly request: Extract<LwqlSelfProvisionRequest, { complete: true }>;
  readonly names: LangWatchQLNames;
  /** Resolved inside the never-throwing run: an unparsable database name must not crash boot. */
  readonly sourceDatabase: () => string;
  readonly schema: string;
  readonly connectionLimit?: number;
  /** `LWQL_ACCESS_MODEL_MODE` and `LWQL_ACCESS_MODEL_SQL_SINGLE_NODE`. */
  readonly settings: Readonly<Record<string, string | undefined>>;
  readonly openRepository: () => LangWatchQLProvisioningRepository;
}

/**
 * Every configured boot converges the whole model, and never throws: a server refusing
 * the DDL degrades to a loud log and a fail-closed endpoint, not a crashloop (ADR-159).
 */
export async function convergeLwqlAccessModel({
  database,
  plan,
}: {
  database: LwqlProvisioningDatabase;
  plan: LwqlConvergencePlan;
}): Promise<void> {
  const { request, names, schema } = plan;
  try {
    const sourceDatabase = plan.sourceDatabase();
    logger.info(
      { database: names.database, sourceDatabase },
      "self-provisioning the full LangWatchQL model — access model, PostgreSQL bridge, views",
    );
    await withSelfProvisionLock({
      database,
      connectionLimit: plan.connectionLimit,
      fn: async () => {
        await runPostgresStatements({
          database,
          statements: [
            ...lwqlProvisioning.postgresApprovedViewStatements({
              schema,
              readerRole: LWQL_POSTGRES_READER_ROLE,
            }),
            // After the views: the reader role's grants name them.
            ...selfProvisioning.postgresReaderStatements({
              readerPassword: request.postgresReaderPassword,
              schema,
            }),
          ],
        });

        await withProvisioningRepository({
          open: plan.openRepository,
          fn: (repository) =>
            convergeClickHouse({
              repository,
              database,
              source: plan.settings,
              request,
              names,
              sourceDatabase,
            }),
        });
      },
    });
    logger.info("LangWatchQL self-provisioning complete");
  } catch (error) {
    logger.error(
      { error: clickHouseErrorSummary(error) },
      "lwql self-provisioning failed — continuing boot; LangWatchQL queries stay refused (fail-closed) until a later deploy converges",
    );
  }
}

/** The pool size `DATABASE_URL` names, as plan fields: empty where it names none. */
function connectionLimitFields(databaseUrl: string | undefined): { connectionLimit?: number } {
  try {
    const limit = Number(new URL(databaseUrl ?? "").searchParams.get("connection_limit"));
    return Number.isInteger(limit) && limit > 0 ? { connectionLimit: limit } : {};
  } catch {
    return {};
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
  if (!selfProvision.requested) {
    logger.info("LWQL not configured, skipping");
    return;
  }
  if (!selfProvision.complete) {
    logger.warn(
      { missing: selfProvision.missing },
      "LangWatchQL is partially configured — skipping provisioning this boot; queries stay refused (fail-closed) until the configuration is complete",
    );
    return;
  }

  await convergeLwqlAccessModel({
    database,
    plan: {
      request: selfProvision,
      names: lwqlProvisioning.names({ connection: selfProvision.connection }),
      sourceDatabase: () =>
        parseConnectionUrl({
          connectionUrl: source.CLICKHOUSE_URL,
          clusterName: source.CLICKHOUSE_CLUSTER,
        }).database,
      schema: lwqlProvisioning.postgresSchemaFromDatabaseUrl(source.DATABASE_URL),
      ...connectionLimitFields(source.DATABASE_URL),
      settings: source,
      openRepository: () =>
        ClickHouseLangWatchQLProvisioningRepository.open({ url: source.CLICKHOUSE_URL }),
    },
  });
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
