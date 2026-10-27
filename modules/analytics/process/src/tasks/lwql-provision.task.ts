/**
 * @see ../services/langwatch-ql-production-provisioning.service.ts — the pure composition
 * @see packages/clickhouse-migrations/migrations/00084_create_lwql_api_key_tenant_map.sql
 * @see specs/lwql/api.feature
 */

import { parseConnectionUrl } from "@langwatch/clickhouse-migrations";
import { createLogger } from "@langwatch/observability";
import { PROJECT_ID_PAGE_LIMIT, type ProjectApi } from "@langwatch/project-contract";
import { Task } from "@langwatch/task";

import { lwqlAppFunctionNames } from "../features/app-functions/rules/langwatch-ql-app-function-catalog.rules.ts";
import { canProvisionAppFunctions } from "../features/app-functions/rules/langwatch-ql-app-function-store.rules.ts";
import {
  LangWatchQLProductionProvisioningService,
  LWQL_POSTGRES_READER_ROLE,
} from "../features/provisioning/services/langwatch-ql-production-provisioning.service.ts";
import {
  LangWatchQLSelfProvisioningService,
  type LwqlAppOwnedDrift,
  type LwqlCollectionProbe,
  type LwqlPostgresGap,
  type LwqlSelfProvisionRequest,
} from "../features/provisioning/services/langwatch-ql-self-provisioning.service.ts";
import { ClickHouseLangWatchQLProvisioningRepository } from "../repositories/clickhouse/clickhouse.langwatch-ql-provisioning.repository.ts";
import type { LwqlProvisioningDatabase } from "../repositories/langwatch-ql-postgres.repository.ts";
import type {
  LangWatchQLProvisioningRepository,
  ProvisioningFailureLevel,
  SkippedProvisioningStatement,
} from "../repositories/langwatch-ql-provisioning.repository.ts";
import { PrismaLangWatchQLPostgresRepository } from "../repositories/prisma/prisma.langwatch-ql-postgres.repository.ts";
import { collectionUnconfirmedError } from "../rules/langwatch-ql-collection-probe.rules.ts";
import {
  clickHouseErrorCodeFields,
  clickHouseErrorSummary,
  postgresErrorCodeFields,
  statementKind,
} from "../rules/langwatch-ql-config-store.rules.ts";
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
  await PrismaLangWatchQLPostgresRepository.create(database).runStatements(statements);
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

/** The replica layout that decides whether a `CREATE FUNCTION` reaches every replica. */
async function readAppFunctionLayout(repository: LangWatchQLProvisioningRepository) {
  const [replicas, setting] = await Promise.all([
    repository.queryRows(
      "SELECT toString(max(total_replicas)) AS max_total_replicas FROM system.replicas",
    ),
    repository.queryRows(
      "SELECT value FROM system.server_settings WHERE name = 'user_defined_zookeeper_path'",
    ),
  ]);
  return {
    maxTotalReplicas: Number(replicas[0]?.max_total_replicas ?? "0") || 0,
    userDefinedZookeeperPath: typeof setting[0]?.value === "string" ? setting[0].value : "",
  };
}

async function appFunctionsProvisionable(
  repository: LangWatchQLProvisioningRepository,
): Promise<boolean> {
  try {
    const probe = await readAppFunctionLayout(repository);
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
  return PrismaLangWatchQLPostgresRepository.create(database).withAdvisoryLock({
    key: LWQL_SELF_PROVISION_LOCK_KEY,
    timeoutMs: LWQL_SELF_PROVISION_TXN_TIMEOUT_MS,
    maxWaitMs: LWQL_SELF_PROVISION_TXN_MAX_WAIT_MS,
    fn,
  });
}

/** Whether both reads succeeded; when one failed, which read and its error. */
type LwqlCollectionProbeResult =
  | { readonly shown: true }
  | { readonly shown: false; readonly read: string; readonly error: unknown };

async function probeCollection({
  repository,
  probe,
  cluster,
}: {
  repository: LangWatchQLProvisioningRepository;
  probe: LwqlCollectionProbe;
  cluster: string | undefined;
}): Promise<LwqlCollectionProbeResult> {
  const reads = {
    collection: () =>
      repository.probePostgresCollection({
        collection: probe.collection,
        relation: probe.relation,
        cluster,
      }),
    appCredentials: () =>
      repository.probePostgresCredentials({
        credentials: probe.connection,
        relation: probe.relation,
        cluster,
      }),
  };
  for (const [read, run] of Object.entries(reads)) {
    try {
      await run();
    } catch (error) {
      return { shown: false, read, error };
    }
  }
  return { shown: true };
}

/** What the gate decided, and the present engine tables it left on their current pool. */
interface LwqlEngineTableGate {
  readonly collectionLoaded: boolean;
  readonly only: readonly string[] | undefined;
  readonly left?: { readonly read: string; readonly error: unknown; readonly tables: number };
}

/**
 * Stamps the engine tables only once ClickHouse is shown to hold the app's collection values.
 * Unshown, a check leaves each present engine table on its pool and a deploy replaces them
 * unstamped, so a later check rebuilds them once the values load (#8858).
 */
async function gateEngineTables({
  repository,
  request,
  names,
  only,
  cluster,
}: {
  repository: LangWatchQLProvisioningRepository;
  request: Extract<LwqlSelfProvisionRequest, { complete: true }>;
  names: LangWatchQLNames;
  only: readonly string[] | undefined;
  /** `CLICKHOUSE_CLUSTER`: set, both reads must pass on every replica. */
  cluster: string | undefined;
}): Promise<LwqlEngineTableGate> {
  const engineTables = selfProvisioning.engineTablesIn({ only });
  if (engineTables.length === 0) return { collectionLoaded: false, only };
  const probe = selfProvisioning.collectionProbe({
    names,
    postgres: { endpoint: request.endpoint, readerPassword: request.postgresReaderPassword },
  });
  const result = await probeCollection({ repository, probe, cluster });
  if (result.shown) return { collectionLoaded: true, only };
  const { read, error } = result;
  logger.warn(
    { read, error: clickHouseErrorSummary(error), ...clickHouseErrorCodeFields(error) },
    "lwql could not show that ClickHouse holds the app's PostgreSQL credentials in the named collection, so no engine table is rebuilt on them yet; the next check retries",
  );
  if (only === undefined) return { collectionLoaded: false, only };
  const present = await repository.readInventory({
    database: names.database,
    relations: engineTables,
    functions: [],
  });
  const left = only.filter((name) => present.relations.includes(name));
  return {
    collectionLoaded: false,
    only: only.filter((name) => !left.includes(name)),
    ...(left.length === 0 ? {} : { left: { read, error, tables: left.length } }),
  };
}

function isNamedCollectionKind(kind: string): boolean {
  return kind.endsWith("NAMED COLLECTION");
}

/** The position just past a batch's last named-collection statement; 0 when it has none. */
function afterNamedCollection(statements: readonly string[]): number {
  return statements.reduce(
    (split, statement, index) =>
      isNamedCollectionKind(statementKind(statement)) ? index + 1 : split,
    0,
  );
}

/** Inventory, app-function probe, SQL-mode guard, then the statements; the key map is a step's. */
async function convergeClickHouse({
  repository,
  source,
  request,
  names,
  sourceDatabase,
  failureLevel,
  only,
}: {
  repository: LangWatchQLProvisioningRepository;
  source: Readonly<Record<string, string | undefined>>;
  request: Extract<LwqlSelfProvisionRequest, { complete: true }>;
  names: LangWatchQLNames;
  sourceDatabase: string;
  failureLevel: ProvisioningFailureLevel;
  /** The drifted objects alone; absent, the whole ClickHouse half. */
  only: readonly string[] | undefined;
}): Promise<void> {
  const configStoreEntities = await repository.inventoryConfigStore({ names });
  const includeAppFunctions = await appFunctionsProvisionable(repository);
  const mode = selfProvisioning.accessModelMode({ source });
  if (mode === "sql") {
    await clusterGuard.assertSafe({ query: (sql) => repository.queryRows(sql), source });
  }
  const render = ({ collectionLoaded, only: drifted }: LwqlEngineTableGate) =>
    selfProvisioning.clickHouseStatements({
      names,
      restrictedPassword: request.connection.password,
      sourceDatabase,
      postgres: { endpoint: request.endpoint, readerPassword: request.postgresReaderPassword },
      includeAppFunctions,
      mode,
      collectionLoaded,
      ...(drifted === undefined ? {} : { only: drifted }),
    });
  const run = async (statements: readonly string[]) =>
    (await repository.runStatements({ configStoreEntities, failureLevel, statements })).skipped;
  const gateByProbe = () =>
    gateEngineTables({
      repository,
      request,
      names,
      only,
      cluster: source.CLICKHOUSE_CLUSTER || undefined,
    });
  let gate: LwqlEngineTableGate;
  let skipped: SkippedProvisioningStatement[];
  if (mode === "sql" && only === undefined) {
    // A sql-mode deploy rewrites the collection before its engine tables: they stamp unprobed only
    // once that ran. A check probes in either mode: it never rewrites the collection.
    const unprobed: LwqlEngineTableGate = { collectionLoaded: true, only };
    const statements = render(unprobed);
    const split = afterNamedCollection(statements);
    const head = await run(statements.slice(0, split));
    gate = head.some((s) => isNamedCollectionKind(s.kind)) ? await gateByProbe() : unprobed;
    skipped = [...head, ...(await run(render(gate).slice(split)))];
  } else {
    gate = await gateByProbe();
    skipped = await run(render(gate));
  }
  if (skipped.length > 0) {
    logger.warn(
      { skippedCount: skipped.length },
      "lwql provisioning yielded to config-store-owned entities and provisioned the rest",
    );
  }
  // Raised after the rest converged, so the check's alerting sees tables left on old credentials.
  if (gate.left) {
    const { read, error, tables } = gate.left;
    throw collectionUnconfirmedError({ read, engineTables: tables, cause: error });
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
  /** `LWQL_ACCESS_MODEL_MODE`, `LWQL_ACCESS_MODEL_SQL_SINGLE_NODE` and `CLICKHOUSE_CLUSTER`. */
  readonly settings: Readonly<Record<string, string | undefined>>;
  readonly openRepository: () => LangWatchQLProvisioningRepository;
}

/** The PostgreSQL failure as log fields: Prisma's code and the server's SQLSTATE, redacted. */
function postgresFailureFields({ error, secret }: { error: unknown; secret: string }) {
  return {
    ...postgresErrorCodeFields(error),
    error: selfProvisioning.redactSecrets({
      text: error instanceof Error ? error.message : String(error),
      secrets: [secret],
    }),
  };
}

/** At warn the check logs its own alert, so a text-only alert must not match this line too. */
const POSTGRES_FAILED_MESSAGES: Record<ProvisioningFailureLevel, string> = {
  error: "lwql provisioning failed creating PostgreSQL objects",
  warn: "lwql reconvergence statement failed",
};

/**
 * A deploy's whole half: every approved view, then the reader role with its revokes and grants.
 * A check's gaps: only the absent views, then additive grants on each gap, never a revoke.
 */
function postgresStatements({
  plan,
  gaps,
}: {
  plan: LwqlConvergencePlan;
  gaps: readonly LwqlPostgresGap[] | undefined;
}): string[] {
  const schema = plan.schema;
  const readerRole = LWQL_POSTGRES_READER_ROLE;
  if (gaps === undefined) {
    return [
      ...lwqlProvisioning.postgresApprovedViewStatements({ schema, readerRole }),
      // After the views: the reader role's grants name them.
      ...selfProvisioning.postgresReaderStatements({
        readerPassword: plan.request.postgresReaderPassword,
        schema,
      }),
    ];
  }
  const absent = gaps.filter((gap) => gap.absent).map((gap) => gap.view);
  const views = (approvedViews: string[]) => selfProvisioning.postgresDatasets({ approvedViews });
  return [
    ...lwqlProvisioning.postgresApprovedViewStatements({
      schema,
      readerRole,
      views: views(absent),
    }),
    ...lwqlProvisioning.postgresReaderGrantStatements({
      schema,
      role: readerRole,
      views: views(gaps.map((gap) => gap.view)),
    }),
  ];
}

async function convergePostgres({
  database,
  plan,
  failureLevel,
  gaps,
}: {
  database: LwqlProvisioningDatabase;
  plan: LwqlConvergencePlan;
  failureLevel: ProvisioningFailureLevel;
  gaps: readonly LwqlPostgresGap[] | undefined;
}): Promise<unknown> {
  try {
    await runPostgresStatements({ database, statements: postgresStatements({ plan, gaps }) });
    return undefined;
  } catch (error) {
    logger[failureLevel](
      postgresFailureFields({ error, secret: plan.request.postgresReaderPassword }),
      POSTGRES_FAILED_MESSAGES[failureLevel],
    );
    return error;
  }
}

/** Both halves under the lock; a PostgreSQL failure is raised only once ClickHouse has run. */
async function convergeLocked({
  database,
  plan,
  only,
  sourceDatabase,
}: {
  database: LwqlProvisioningDatabase;
  plan: LwqlConvergencePlan;
  only: LwqlAppOwnedDrift | undefined;
  sourceDatabase: string;
}): Promise<void> {
  const failureLevel: ProvisioningFailureLevel = only ? "warn" : "error";
  const gaps = only?.postgres === "unknown" ? [] : only?.postgres;
  const postgresFailure =
    gaps?.length === 0 ? undefined : await convergePostgres({ database, plan, failureLevel, gaps });
  if (!only || only.clickHouse.length > 0) {
    await withProvisioningRepository({
      open: plan.openRepository,
      fn: (repository) =>
        convergeClickHouse({
          repository,
          source: plan.settings,
          request: plan.request,
          names: plan.names,
          sourceDatabase,
          failureLevel,
          only: only?.clickHouse,
        }),
    });
  }
  if (postgresFailure !== undefined) throw postgresFailure;
}

/**
 * Converges the whole model and never throws: a refusal is a loud log and a fail-closed endpoint
 * (ADR-159). `failOnError` rethrows so the upgrade run fails (Alex, 2026-10-09); `only`, the
 * reconvergence check's drift, converges just the objects it names and logs at warn.
 */
export async function convergeLwqlAccessModel({
  database,
  plan,
  failOnError = false,
  only,
}: {
  database: LwqlProvisioningDatabase;
  plan: LwqlConvergencePlan;
  failOnError?: boolean;
  only?: LwqlAppOwnedDrift;
}): Promise<void> {
  const { names } = plan;
  try {
    const sourceDatabase = plan.sourceDatabase();
    logger.info(
      { database: names.database, sourceDatabase },
      "self-provisioning the full LangWatchQL model — access model, PostgreSQL bridge, views",
    );
    await withSelfProvisionLock({
      database,
      connectionLimit: plan.connectionLimit,
      fn: () => convergeLocked({ database, plan, only, sourceDatabase }),
    });
    logger.info("LangWatchQL self-provisioning complete");
  } catch (error) {
    if (only) {
      logger.warn(
        { error: clickHouseErrorSummary(error) },
        "lwql self-provisioning failed; the reconvergence check retries in 5 minutes",
      );
    } else {
      logger.error(
        { error: clickHouseErrorSummary(error) },
        "lwql self-provisioning failed — continuing boot; LangWatchQL queries stay refused (fail-closed) until a later deploy converges",
      );
    }
    if (failOnError) throw error;
  }
}

/** A PostgreSQL that cannot be read is `unknown`: never mistaken for a gap or for converged. */
async function readPostgresGaps({
  database,
  schema,
}: {
  database: LwqlProvisioningDatabase;
  schema: string;
}): Promise<LwqlAppOwnedDrift["postgres"]> {
  try {
    const found = await PrismaLangWatchQLPostgresRepository.create(database).findApprovedViews({
      schema,
      role: LWQL_POSTGRES_READER_ROLE,
      views: selfProvisioning.approvedPostgresViews(),
    });
    return selfProvisioning.findPostgresGaps({ found });
  } catch (error) {
    logger.warn(
      { error: clickHouseErrorSummary(error), ...postgresErrorCodeFields(error) },
      "lwql reconvergence check could not read the PostgreSQL catalog; it checks again in 5 minutes",
    );
    return "unknown";
  }
}

/** App functions are expected only where a `CREATE FUNCTION` reaches every replica. */
async function expectedAppFunctions({
  repository,
  held,
}: {
  repository: LangWatchQLProvisioningRepository;
  held: readonly string[];
}): Promise<readonly string[]> {
  const declared = lwqlAppFunctionNames();
  if (declared.every((name) => held.includes(name))) return declared;
  return canProvisionAppFunctions(await readAppFunctionLayout(repository)) ? declared : [];
}

/**
 * Which app-owned objects are absent, from catalog reads only (key map, engine tables, views,
 * app functions; approved views and their grant). An engine table not stamped with the current
 * credentials counts as absent; columns are never compared. Throws when ClickHouse is unreadable.
 */
export async function findLwqlAppOwnedDrift({
  database,
  plan,
}: {
  database: LwqlProvisioningDatabase;
  plan: Pick<LwqlConvergencePlan, "request" | "names" | "schema" | "openRepository">;
}): Promise<LwqlAppOwnedDrift> {
  const { names, request } = plan;
  const relations = selfProvisioning.appOwnedRelations({ names });
  const credentialFingerprint = selfProvisioning.credentialFingerprint({
    names,
    postgres: { endpoint: request.endpoint, readerPassword: request.postgresReaderPassword },
  });
  const clickHouse = await withProvisioningRepository({
    open: plan.openRepository,
    fn: async (repository) => {
      const found = await repository.readInventory({
        database: names.database,
        relations,
        functions: lwqlAppFunctionNames(),
      });
      const functions = await expectedAppFunctions({ repository, held: found.functions });
      return selfProvisioning.findDrift({
        names,
        relations,
        functions,
        found,
        credentialFingerprint,
      });
    },
  });
  const postgres = await readPostgresGaps({ database, schema: plan.schema });
  return { clickHouse: clickHouse.objects, postgres, isKeyMapMissing: clickHouse.isKeyMapMissing };
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
