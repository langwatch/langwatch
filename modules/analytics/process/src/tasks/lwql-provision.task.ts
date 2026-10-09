/**
 * @see ../services/langwatch-ql-production-provisioning.service.ts — the pure composition
 * @see packages/clickhouse-migrations/migrations/00084_create_lwql_api_key_tenant_map.sql
 * @see specs/lwql/api.feature
 */

import { parseConnectionUrl } from "@langwatch/clickhouse-migrations";
import { createLogger } from "@langwatch/observability";
import { PROJECT_ID_PAGE_LIMIT, type ProjectApi } from "@langwatch/project-contract";
import { Task } from "@langwatch/task";

import { canProvisionAppFunctions } from "../features/app-functions/rules/langwatch-ql-app-function-store.rules.ts";
import {
  LangWatchQLProductionProvisioningService,
  LWQL_POSTGRES_READER_ROLE,
} from "../features/provisioning/services/langwatch-ql-production-provisioning.service.ts";
import {
  LangWatchQLSelfProvisioningService,
  type LwqlSelfProvisionRequest,
} from "../features/provisioning/services/langwatch-ql-self-provisioning.service.ts";
import { ClickHouseLangWatchQLProvisioningRepository } from "../repositories/clickhouse/clickhouse.langwatch-ql-provisioning.repository.ts";
import type { LangWatchQLProvisioningRepository } from "../repositories/langwatch-ql-provisioning.repository.ts";
import { clickHouseErrorSummary } from "../rules/langwatch-ql-config-store.rules.ts";
import type { LangWatchQLNames } from "../services/langwatch-ql-access-model.service.ts";
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
};

/** The one project read the key-map backfill makes (PO-1). */
type LwqlProjectKeys = Pick<ProjectApi, "listLwqlKeys">;

/** Every project's LangWatchQL key, read from the project module a page at a time. */
async function allLwqlKeys({ projects }: { projects: LwqlProjectKeys }) {
  const keys = [];
  let after: string | undefined;
  do {
    const page = await projects.listLwqlKeys({ after, limit: PROJECT_ID_PAGE_LIMIT });
    keys.push(...page.projects);
    after = page.next ?? undefined;
  } while (after !== undefined);
  return keys;
}

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

/** Tenants read per round of the backfill: each read is one tenant-scoped query. */
const KEY_MAP_READ_BATCH = 20;

/** The key-map hashes already written for these projects, read one tenant at a time. */
async function existingKeyMapHashes({
  repository,
  table,
  projects,
}: {
  repository: LangWatchQLProvisioningRepository;
  table: string;
  projects: readonly { id: string }[];
}): Promise<Set<string>> {
  const hashes = new Set<string>();
  for (let start = 0; start < projects.length; start += KEY_MAP_READ_BATCH) {
    const batch = projects.slice(start, start + KEY_MAP_READ_BATCH);
    const found = await Promise.all(
      batch.map((project) => repository.findKeyMapHashes({ table, tenantId: project.id })),
    );
    for (const hash of found.flat()) hashes.add(hash);
  }
  return hashes;
}

/** What one fill of the key map found and wrote. */
export type LwqlProjectKeyFillReport = { inserted: number; blankKeys: number };

/** Inserts only the rows the key map lacks; a blank key is reported, never written. */
async function backfillKeyMap({
  repository,
  projectKeys,
  names,
  sourceDatabase,
  dryRun,
}: {
  repository: LangWatchQLProvisioningRepository;
  projectKeys: LwqlProjectKeys;
  names: LangWatchQLNames;
  sourceDatabase: string;
  dryRun: boolean;
}): Promise<LwqlProjectKeyFillReport> {
  const projects = await allLwqlKeys({ projects: projectKeys });
  const table = lwqlProvisioning.keyMapTableQualifiedName({ names, sourceDatabase });
  const existingHashes = await existingKeyMapHashes({ repository, table, projects });
  const plan = lwqlProvisioning.planKeyMapBackfill({ projects, existingHashes });
  if (plan.blankKeyProjectIds.length > 0) {
    logger.error(
      { count: plan.blankKeyProjectIds.length, projectIds: plan.blankKeyProjectIds },
      "lwql key-map backfill found projects with an empty lwqlKey — these projects cannot authenticate to LangWatchQL until their key is regenerated",
    );
  }
  const report = { inserted: plan.rowsToInsert.length, blankKeys: plan.blankKeyProjectIds.length };
  if (plan.rowsToInsert.length === 0 || dryRun) return report;
  await repository.insertKeyMapRows({ table, rows: plan.rowsToInsert });
  logger.info(report, "lwql key-map backfill: inserted missing rows");
  return report;
}

/** The `analytics:fill-lwql-project-keys` step's body: each project's missing key-map row. */
export function fillLwqlProjectKeys({
  openRepository,
  ...input
}: {
  openRepository: () => LangWatchQLProvisioningRepository;
  projectKeys: LwqlProjectKeys;
  names: LangWatchQLNames;
  sourceDatabase: string;
  dryRun: boolean;
}): Promise<LwqlProjectKeyFillReport> {
  return withProvisioningRepository({
    open: openRepository,
    fn: (repository) => backfillKeyMap({ repository, ...input }),
  });
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

/** Inventory, app-function probe, SQL-mode guard, then the statements; the key map is a step's. */
async function convergeClickHouse({
  repository,
  source,
  request,
  names,
  sourceDatabase,
}: {
  repository: LangWatchQLProvisioningRepository;
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
 * `failOnError` rethrows instead, so the upgrade run fails naming it (Alex, 2026-10-09).
 */
export async function convergeLwqlAccessModel({
  database,
  plan,
  failOnError = false,
}: {
  database: LwqlProvisioningDatabase;
  plan: LwqlConvergencePlan;
  failOnError?: boolean;
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
    if (failOnError) throw error;
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

async function runLwqlProvisioningTask({
  database,
  source,
  failOnError,
}: {
  database: LwqlProvisioningDatabase;
  failOnError: boolean;
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
    failOnError,
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
  readonly description = "Provisions LangWatchQL's ClickHouse and PostgreSQL objects.";

  private constructor(
    private readonly inputs: {
      database: () => LwqlProvisioningDatabase;
      source: Record<string, string | undefined>;
      skipped: boolean;
      failOnError: boolean;
    },
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
    failOnError = false,
  }: {
    database: () => LwqlProvisioningDatabase;
    /** The environment the launching process was configured with. */
    source: Record<string, string | undefined>;
    skipped?: boolean;
    /** The upgrade's reconciler fails its run on a refusal; boot keeps the default. */
    failOnError?: boolean;
  }): LwqlProvisionTask {
    return new LwqlProvisionTask({ database, source, skipped, failOnError });
  }

  async run(_input: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    if (this.inputs.skipped) {
      logger.info("SKIP_LWQL_PROVISION=true — skipping LangWatchQL provisioning");
      return;
    }
    await runLwqlProvisioningTask({
      database: this.inputs.database(),
      source: this.inputs.source,
      failOnError: this.inputs.failOnError,
    });
  }
}
