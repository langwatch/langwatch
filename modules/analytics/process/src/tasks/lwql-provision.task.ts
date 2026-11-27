/**
 * @see ../services/langwatch-ql-production-provisioning.service.ts — the pure composition
 * @see packages/clickhouse-migrations/migrations/00084_create_lwql_api_key_tenant_map.sql
 * @see specs/lwql/api.feature
 */

import {
  parseConnectionUrl,
  resolveClickHouseMigrationTaskConfig,
} from "@langwatch/clickhouse-migrations";
import { createLogger } from "@langwatch/observability";
import { PROJECT_ID_PAGE_LIMIT, type ProjectApi } from "@langwatch/project-contract";
import { Task } from "@langwatch/task";

import { lwqlAppFunctionNames } from "../features/app-functions/rules/langwatch-ql-app-function-catalog.rules.ts";
import {
  APP_FUNCTION_KEEPER_STORE_PATH,
  canProvisionAppFunctions,
  readAppFunctionStoreProbe,
} from "../features/app-functions/rules/langwatch-ql-app-function-store.rules.ts";
import {
  LWQL_PROJECT_KEYS_VIEW,
  LWQL_SCOPED_READER_GROUP,
  LWQL_SCOPED_SCHEMA,
} from "../features/provisioning/rules/lwql-scoped-view.rules.ts";
import {
  LangWatchQLCollectionBindingService,
  LWQL_RENDERED_NAMED_COLLECTION,
  type LwqlAccessModelMode,
  type LwqlCollectionProbe,
} from "../features/provisioning/services/langwatch-ql-collection-binding.service.ts";
import {
  LangWatchQLPostgresGapsService,
  type LwqlPostgresGap,
} from "../features/provisioning/services/langwatch-ql-postgres-gaps.service.ts";
import {
  LangWatchQLProductionProvisioningService,
  LWQL_POSTGRES_READER_ROLE,
} from "../features/provisioning/services/langwatch-ql-production-provisioning.service.ts";
import {
  LangWatchQLSelfProvisioningService,
  type LwqlAppOwnedDrift,
  type LwqlSelfProvisionRequest,
  LwqlPrivateCollectionAbsentError,
} from "../features/provisioning/services/langwatch-ql-self-provisioning.service.ts";
import { ClickHouseLangWatchQLProvisioningRepository } from "../repositories/clickhouse/clickhouse.langwatch-ql-provisioning.repository.ts";
import type { LwqlProvisioningDatabase } from "../repositories/langwatch-ql-postgres.repository.ts";
import type {
  LangWatchQLProvisioningRepository,
  LwqlCollectionState,
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
import {
  classifyLwqlSetupFailure,
  findKeyPeppers,
  type LwqlSecretFamilyLookup,
  type LwqlSecretLookup,
  resolveLwqlSource,
  withChainedSecrets,
} from "../rules/lwql-default-credentials.rules.ts";
import { parsePrivateReaderPasswords } from "../rules/lwql-private-reader.rules.ts";
import type { LangWatchQLNames } from "../services/langwatch-ql-access-model.service.ts";
import { LangWatchQLSqlModeClusterGuardService } from "../services/langwatch-ql-sql-mode-cluster-guard.service.ts";
import {
  assertRenderedPrivateServer,
  type LwqlPrivateEndpoint,
  provisionLwqlPrivateTargets,
} from "./lwql-private-targets.task.ts";

const lwqlProvisioning = LangWatchQLProductionProvisioningService.create();
const clusterGuard = LangWatchQLSqlModeClusterGuardService.create();
const selfProvisioning = LangWatchQLSelfProvisioningService.create();
const collectionBinding = LangWatchQLCollectionBindingService.create();
const postgresGaps = LangWatchQLPostgresGapsService.create();

/** One global key: the self-provision convergence is a singleton, not per tenant. */
const LWQL_SELF_PROVISION_LOCK_KEY = "lwql:self-provision";
/** Bounds one pod's wait plus run; a tail pod that times out finds the model converged. */
const LWQL_SELF_PROVISION_TXN_TIMEOUT_MS = 300_000;
const LWQL_SELF_PROVISION_TXN_MAX_WAIT_MS = 30_000;

const logger = createLogger("langwatch:task:lwql-provision");

/** The one project read the key-map backfill makes (PO-1). */
type LwqlProjectKeys = Pick<ProjectApi, "listLwqlKeys">;

/** Every project's LangWatchQL key, read from the project module a page at a time. */
async function allLwqlKeys({
  projects,
}: {
  projects: LwqlProjectKeys;
}): Promise<{ id: string; lwqlKey: string }[]> {
  const keys: { id: string; lwqlKey: string }[] = [];
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

/** The replicas and the Keeper store that decide whether a `CREATE FUNCTION` reaches every one. */
function readAppFunctionLayout(repository: LangWatchQLProvisioningRepository) {
  return readAppFunctionStoreProbe({ queryRows: (sql) => repository.queryRows(sql) });
}

async function appFunctionsProvisionable(
  repository: LangWatchQLProvisioningRepository,
): Promise<boolean> {
  try {
    const probe = await readAppFunctionLayout(repository);
    if (canProvisionAppFunctions(probe)) return true;
    logger.error(
      { maxTotalReplicas: probe.maxTotalReplicas },
      `lwql self-provisioning skipped the app functions: this ClickHouse has more than one replica and Keeper holds no SQL function store at ${APP_FUNCTION_KEEPER_STORE_PATH}, so a CREATE FUNCTION would reach one replica only. Set user_defined_zookeeper_path to ${APP_FUNCTION_KEEPER_STORE_PATH} in the server config of every replica and restart; LangWatchQL app functions stay refused until then`,
    );
    return false;
  } catch (error) {
    logger.error(
      { error: clickHouseErrorSummary(error) },
      "lwql self-provisioning could not read the replica layout from system.replicas or the function store from system.zookeeper; the app functions are left out until it can",
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
        schema: probe.schema,
        cluster,
      }),
    appCredentials: () =>
      repository.probePostgresCredentials({
        credentials: probe.connection,
        relation: probe.relation,
        schema: probe.schema,
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

/** Every collection the engine tables bind to must hold the app's values. */
async function probeCollections({
  repository,
  probes,
  cluster,
}: {
  repository: LangWatchQLProvisioningRepository;
  probes: readonly LwqlCollectionProbe[];
  cluster: string | undefined;
}): Promise<LwqlCollectionProbeResult> {
  for (const probe of probes) {
    const result = await probeCollection({ repository, probe, cluster });
    if (!result.shown) return result;
  }
  return { shown: true };
}

/** What the gate decided, and the present engine tables it left (with their views) as they are. */
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
  schema,
  mode,
  server,
  only,
  cluster,
}: {
  repository: LangWatchQLProvisioningRepository;
  request: Extract<LwqlSelfProvisionRequest, { complete: true }>;
  names: LangWatchQLNames;
  schema: string;
  mode: LwqlAccessModelMode;
  server: LwqlCollectionState;
  only: readonly string[] | undefined;
  /** `CLICKHOUSE_CLUSTER`: set, both reads must pass on every replica. */
  cluster: string | undefined;
}): Promise<LwqlEngineTableGate> {
  const engineTables = selfProvisioning.engineTablesIn({ only });
  if (engineTables.length === 0) return { collectionLoaded: false, only };
  const probes = collectionBinding.collectionProbes({
    names,
    postgres: { endpoint: request.endpoint, readerPassword: request.postgresReaderPassword },
    schema,
    mode,
    server,
    engineTables,
  });
  const result = await probeCollections({ repository, probes, cluster });
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
  // A view replaced over a table left in place could select a column that table lacks.
  const held = new Set([
    ...left,
    ...selfProvisioning.viewsOverEngineTables({ engineTables: left }),
  ]);
  return {
    collectionLoaded: false,
    only: only.filter((name) => !held.has(name)),
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
  schema,
  sourceDatabase,
  failureLevel,
  only,
}: {
  repository: LangWatchQLProvisioningRepository;
  source: Readonly<Record<string, string | undefined>>;
  request: Extract<LwqlSelfProvisionRequest, { complete: true }>;
  names: LangWatchQLNames;
  schema: string;
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
  // Both modes read it: sql mode never writes a collection a config file defines.
  const server = await repository.readCollectionState({
    database: names.database,
    candidates:
      mode === "rendered"
        ? collectionBinding.renderedCollectionCandidates({ names })
        : [collectionBinding.namedCollection({ names, mode })],
  });
  const render = ({ collectionLoaded, only: drifted }: LwqlEngineTableGate) =>
    selfProvisioning.clickHouseStatements({
      names,
      restrictedPassword: request.connection.password,
      sourceDatabase,
      postgres: { endpoint: request.endpoint, readerPassword: request.postgresReaderPassword },
      schema,
      includeAppFunctions,
      mode,
      server,
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
      schema,
      mode,
      server,
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
    // No collection statement ran (a config file owns it), or one was skipped: probe first.
    const unwritten = split === 0 || head.some((s) => isNamedCollectionKind(s.kind));
    gate = unwritten ? await gateByProbe() : unprobed;
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

/** A converge's PostgreSQL statements: the shared batch, then the scoped batch run apart. */
interface LwqlPostgresBatches {
  readonly shared: readonly string[];
  readonly scoped: readonly string[];
}

/**
 * Both start with the scoped-reader group's revokes. A deploy: every view and the reader role, then
 * the scoped schema, every copy and the group's guarded grants. A check: the absent views and the
 * gap grants, then only the copies it found absent or unscoped, and the guarded grants.
 */
function postgresStatements({
  plan,
  gaps,
}: {
  plan: LwqlConvergencePlan;
  gaps: readonly LwqlPostgresGap[] | undefined;
}): LwqlPostgresBatches {
  const schema = plan.schema;
  const readerRole = LWQL_POSTGRES_READER_ROLE;
  const revokeFirst = lwqlProvisioning.postgresScopedReaderRevokeFirstStatements({ schema });
  const scopedGrants = lwqlProvisioning.postgresScopedReaderGrantStatements({ schema });
  if (gaps === undefined) {
    return {
      shared: [
        ...revokeFirst,
        ...lwqlProvisioning.postgresApprovedViewStatements({ schema, readerRole }),
        // After the views: the reader role's grants name them.
        ...selfProvisioning.postgresReaderStatements({
          readerPassword: plan.request.postgresReaderPassword,
          schema,
        }),
      ],
      scoped: [
        ...lwqlProvisioning.postgresScopedViewStatements({ schema }),
        ...scopedGrants,
        // After the group's grants: a failure in the new view must not skip them.
        ...lwqlProvisioning.postgresProjectKeysStatements({ schema }),
      ],
    };
  }
  const shared = postgresGaps.sharedGaps({ gaps });
  const absent = shared.filter((gap) => gap.absent).map((gap) => gap.view);
  const views = (approvedViews: string[]) => selfProvisioning.postgresDatasets({ approvedViews });
  return {
    shared: [
      ...revokeFirst,
      ...lwqlProvisioning.postgresApprovedViewStatements({
        schema,
        readerRole,
        views: views(absent),
      }),
      ...lwqlProvisioning.postgresReaderGrantStatements({
        schema,
        role: readerRole,
        views: views(shared.map((gap) => gap.view)),
      }),
    ],
    scoped: [
      ...lwqlProvisioning.postgresScopedViewStatements({
        schema,
        views: views(postgresGaps.scopedCopiesToRebuild({ gaps })),
      }),
      ...scopedGrants,
      ...(postgresGaps.needsProjectKeys({ gaps })
        ? lwqlProvisioning.postgresProjectKeysStatements({ schema })
        : []),
    ],
  };
}

/**
 * Names what still keeps the scoped-reader group from its copies: an absent scoped schema, one
 * another installation owns, or copies it cannot select. Best-effort: a failed read logs only.
 */
async function warnScopedReaderGaps({
  database,
  schema,
}: {
  database: LwqlProvisioningDatabase;
  schema: string;
}): Promise<void> {
  try {
    const state = await PrismaLangWatchQLPostgresRepository.create(database).findScopedViewState({
      appSchema: schema,
      group: LWQL_SCOPED_READER_GROUP,
      views: [...selfProvisioning.approvedPostgresViews(), LWQL_PROJECT_KEYS_VIEW],
    });
    if (!state.groupExists) return;
    if (state.scopedSchema === "absent") {
      logger.warn(
        { scopedSchema: LWQL_SCOPED_SCHEMA },
        "the scoped-reader schema lwql_scoped is absent and the app role could not create it, so the scoped-reader group reads nothing: grant the app role CREATE on the database, or pre-create the schema as the upgrade runbook says",
      );
      return;
    }
    if (state.scopedSchema === "foreign") {
      logger.warn(
        { scopedSchema: LWQL_SCOPED_SCHEMA, appSchema: schema },
        "the scoped-reader schema lwql_scoped is not marked as this installation's, so no copy was written and the scoped-reader group was granted nothing: set its comment as the upgrade runbook says",
      );
      return;
    }
    const unreadable = state.copies
      .filter((copy) => !(copy.exists && copy.passesGuard && copy.granted))
      .map((copy) => copy.view);
    if (unreadable.length > 0) {
      logger.warn(
        { views: unreadable },
        "the scoped-reader group has no SELECT on these copies: they are absent or fail the scoped-view check",
      );
    }
  } catch (error) {
    logger.warn(
      { error: clickHouseErrorSummary(error), ...postgresErrorCodeFields(error) },
      "lwql could not read the scoped-reader group's grants",
    );
  }
}

/**
 * The scoped batch, after the shared one and apart from it: a failure logs at warn and never
 * fails the converge. The revokes already ran, so a copy left behind is ungranted (fail closed).
 */
async function convergeScopedCopies({
  database,
  plan,
  statements,
}: {
  database: LwqlProvisioningDatabase;
  plan: LwqlConvergencePlan;
  statements: readonly string[];
}): Promise<void> {
  try {
    await runPostgresStatements({ database, statements: [...statements] });
  } catch (error) {
    logger.warn(
      postgresFailureFields({ error, secret: plan.request.postgresReaderPassword }),
      "lwql could not write the scoped-reader copies; the shared views converged and the group keeps no grant on a copy that fails the scoped-view check",
    );
  }
  await warnScopedReaderGaps({ database, schema: plan.schema });
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
  let scoped: readonly string[];
  try {
    const batches = postgresStatements({ plan, gaps });
    await runPostgresStatements({ database, statements: [...batches.shared] });
    scoped = batches.scoped;
  } catch (error) {
    logger[failureLevel](
      postgresFailureFields({ error, secret: plan.request.postgresReaderPassword }),
      POSTGRES_FAILED_MESSAGES[failureLevel],
    );
    return error;
  }
  await convergeScopedCopies({ database, plan, statements: scoped });
  return undefined;
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
          schema: plan.schema,
          sourceDatabase,
          failureLevel,
          only: only?.clickHouse,
        }),
    });
  }
  if (postgresFailure !== undefined) throw postgresFailure;
}

/**
 * Derived passwords mean the operator never asked for LangWatchQL, so a failure says why and
 * never fails the upgrade (analytics-lwql-default-credentials.feature).
 */
function warnDerivedSetupFailure({ error }: { error: unknown }): void {
  const summary = clickHouseErrorSummary(error);
  const failure = classifyLwqlSetupFailure({
    error,
    summary: `code ${summary.code ?? "none"}, ${summary.type}`,
  });
  logger.warn(
    { kind: failure.kind, store: failure.store, error: summary },
    `LangWatchQL could not provision its restricted identity: ${failure.reason}. Dashboards, the SQL workbench and Instant Evals stay unavailable until that is fixed, or until LWQL_CLICKHOUSE_PASSWORD and LWQL_POSTGRES_READER_PASSWORD are set with an identity provisioned as the self-hosting docs describe. Continuing.`,
  );
}

/**
 * Converges the whole model and never throws: a refusal is a loud log and a fail-closed endpoint
 * (ADR-159). `failOnError` rethrows so the upgrade run fails (Alex, 2026-10-09), except under
 * derived passwords, which only warn; `only`, the reconvergence check's drift, logs at warn.
 */
export async function convergeLwqlAccessModel(input: LwqlConvergenceInput): Promise<void> {
  await attemptLwqlConvergence(input);
}

export interface LwqlConvergenceInput {
  database: LwqlProvisioningDatabase;
  plan: LwqlConvergencePlan;
  failOnError?: boolean;
  /** The passwords came from the key pepper, not from the operator: a failure only warns. */
  isDerived?: boolean;
  only?: LwqlAppOwnedDrift;
}

/** {@link convergeLwqlAccessModel}, saying whether the model converged (false: it was logged). */
async function attemptLwqlConvergence({
  database,
  plan,
  failOnError = false,
  isDerived = false,
  only,
}: LwqlConvergenceInput): Promise<boolean> {
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
    return true;
  } catch (error) {
    if (isDerived) {
      warnDerivedSetupFailure({ error });
      return false;
    }
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
    return false;
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
    const repository = PrismaLangWatchQLPostgresRepository.create(database);
    const views = selfProvisioning.approvedPostgresViews();
    const found = await repository.findApprovedViews({
      schema,
      role: LWQL_POSTGRES_READER_ROLE,
      views,
    });
    const scoped = await repository.findScopedViewState({
      appSchema: schema,
      group: LWQL_SCOPED_READER_GROUP,
      views: [...views, LWQL_PROJECT_KEYS_VIEW],
    });
    return postgresGaps.findGaps({ found, scoped });
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
 * Which app-owned objects are absent, from catalog reads only. An engine table not stamped with the
 * current credentials counts as absent, and so does a view lacking a catalog column (an extra
 * column is never drift). Throws when ClickHouse is unreadable.
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
  const credentialFingerprint = collectionBinding.credentialFingerprint({
    postgres: { endpoint: request.endpoint, readerPassword: request.postgresReaderPassword },
    schema: plan.schema,
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

/** The private routes, or none: a malformed route variable warns and never fails the upgrade. */
function privateEndpointsOf({
  source,
}: {
  source: Record<string, string | undefined>;
}): readonly LwqlPrivateEndpoint[] {
  try {
    return resolveClickHouseMigrationTaskConfig({ ...source }).privateEndpoints;
  } catch (error) {
    // The error name only: a route's text can carry its credentials.
    logger.warn(
      { error: error instanceof Error ? error.name : typeof error },
      "LangWatchQL private provisioning skipped: the ClickHouse route variables could not be read",
    );
    return [];
  }
}

async function runLwqlProvisioningTask({
  database,
  source: environment,
  lookup,
  lookupFamily,
  failOnError,
}: {
  database: LwqlProvisioningDatabase;
  failOnError: boolean;
  /** The environment the launching process was configured with. */
  source: Record<string, string | undefined>;
  lookup: LwqlSecretLookup | undefined;
  lookupFamily: LwqlSecretFamilyLookup | undefined;
}): Promise<void> {
  const { source, isDerived } = resolveLwqlSource(
    await withChainedSecrets({ environment, lookup, lookupFamily }),
  );
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

  const plan: LwqlConvergencePlan = {
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
  };
  const isConverged = await attemptLwqlConvergence({ database, failOnError, isDerived, plan });
  if (!isConverged) {
    logger.warn("LangWatchQL private provisioning skipped: the shared converge did not complete");
    return;
  }
  await provisionLwqlPrivateTargets({
    endpoints: privateEndpointsOf({ source }),
    sharedUrl: source.CLICKHOUSE_URL,
    keyPepper: findKeyPeppers(source)[0],
    readerPasswords: parsePrivateReaderPasswords(source),
    shared: plan,
    converge: (privatePlan) => convergeLwqlPrivateClickHouse({ database, plan: privatePlan }),
  });
}

/**
 * One private server's ClickHouse half, after the shared converge and under its lock, so two
 * replicas never interleave; no PostgreSQL work. Config's `lwql_postgres` holds the login, and
 * a server without it stays refused. The access model follows the shared run's mode (ADR-200).
 */
export async function convergeLwqlPrivateClickHouse({
  database,
  plan,
}: {
  database: LwqlProvisioningDatabase;
  plan: LwqlConvergencePlan;
}): Promise<void> {
  await withSelfProvisionLock({
    database,
    connectionLimit: plan.connectionLimit,
    fn: () =>
      withProvisioningRepository({
        open: plan.openRepository,
        fn: (repository) => convergeLwqlPrivateRepository({ repository, plan }),
      }),
  });
}

export async function convergeLwqlPrivateRepository({
  repository,
  plan,
}: {
  repository: LangWatchQLProvisioningRepository;
  plan: LwqlConvergencePlan;
}): Promise<void> {
  const { names, request } = plan;
  const server = await repository.readCollectionState({
    database: names.database,
    candidates: [LWQL_RENDERED_NAMED_COLLECTION],
  });
  if (!server.available.includes(LWQL_RENDERED_NAMED_COLLECTION)) {
    throw new LwqlPrivateCollectionAbsentError({ collection: LWQL_RENDERED_NAMED_COLLECTION });
  }
  const configStoreEntities = await repository.inventoryConfigStore({ names });
  const includeAppFunctions = await appFunctionsProvisionable(repository);
  // Rendered: the reader comes from the server's users.d, so no access entity is written here.
  const mode = selfProvisioning.accessModelMode({ source: plan.settings });
  if (mode === "sql") {
    await clusterGuard.assertSafe({
      query: (sql) => repository.queryRows(sql),
      source: plan.settings,
    });
  } else {
    await assertRenderedPrivateServer({ repository, names });
  }
  const statements = selfProvisioning.clickHouseStatements({
    names,
    restrictedPassword: request.connection.password,
    sourceDatabase: plan.sourceDatabase(),
    postgres: { endpoint: request.endpoint, readerPassword: "" },
    // The scoped copies are the only relation the per-customer login reads.
    schema: LWQL_SCOPED_SCHEMA,
    includeAppFunctions,
    mode,
    externalCollection: LWQL_RENDERED_NAMED_COLLECTION,
    postgresKeyMap: true,
  });
  await repository.runStatements({ configStoreEntities, failureLevel: "error", statements });
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
      lookup: LwqlSecretLookup | undefined;
      lookupFamily: LwqlSecretFamilyLookup | undefined;
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
    lookup,
    lookupFamily,
    skipped = false,
    failOnError = false,
  }: {
    database: () => LwqlProvisioningDatabase;
    /** The environment the launching process was configured with. */
    source: Record<string, string | undefined>;
    /** The runner's secrets chain, so the passwords match what the api and worker derive. */
    lookup?: LwqlSecretLookup;
    /** The same chain's families, so each private reader's own password is the api's. */
    lookupFamily?: LwqlSecretFamilyLookup;
    skipped?: boolean;
    /** The upgrade's reconciler fails its run on a refusal; boot keeps the default. */
    failOnError?: boolean;
  }): LwqlProvisionTask {
    return new LwqlProvisionTask({
      database,
      source,
      lookup,
      lookupFamily,
      skipped,
      failOnError,
    });
  }

  async run(_input: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    if (this.inputs.skipped) {
      logger.info("SKIP_LWQL_PROVISION=true — skipping LangWatchQL provisioning");
      return;
    }
    await runLwqlProvisioningTask({
      database: this.inputs.database(),
      source: this.inputs.source,
      lookup: this.inputs.lookup,
      lookupFamily: this.inputs.lookupFamily,
      failOnError: this.inputs.failOnError,
    });
  }
}
