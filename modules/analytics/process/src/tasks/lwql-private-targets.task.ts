/**
 * Provisions LangWatchQL on each organisation's own ClickHouse. The route URL's admin only opens
 * the connection and is never altered; a derived per-organisation reader owns the profile, grants
 * and row policies, and is what the routed executor signs in as.
 * @see specs/lwql/api.feature
 */
import { createLogger } from "@langwatch/observability";

import { LWQL_PROJECT_KEYS_VIEW } from "../features/provisioning/rules/lwql-scoped-view.rules.ts";
import {
  LangWatchQLSelfProvisioningService,
  LwqlPrivateCollectionAbsentError,
} from "../features/provisioning/services/langwatch-ql-self-provisioning.service.ts";
import { ClickHouseLangWatchQLProvisioningRepository } from "../repositories/clickhouse/clickhouse.langwatch-ql-provisioning.repository.ts";
import type { LangWatchQLProvisioningRepository } from "../repositories/langwatch-ql-provisioning.repository.ts";
import { clickHouseErrorSummary } from "../rules/langwatch-ql-config-store.rules.ts";
import { clickHouseLiteral } from "../rules/langwatch-ql-sql-literal.rules.ts";
import { unguardedTables } from "../rules/lwql-private-policies.rules.ts";
import { type LwqlPrivateReader, privateReaderOf } from "../rules/lwql-private-reader.rules.ts";
import {
  type LwqlServerAddress,
  readPrivateRoute,
  readServerAddress,
} from "../rules/lwql-private-route.rules.ts";
import type { LangWatchQLNames } from "../services/langwatch-ql-access-model.service.ts";
import { LangWatchQLSqlModeClusterGuardService } from "../services/langwatch-ql-sql-mode-cluster-guard.service.ts";
import { LangWatchQLSqlTextService } from "../services/langwatch-ql-sql-text.service.ts";
import type { LwqlConvergencePlan } from "./lwql-provision.task.ts";

const logger = createLogger("langwatch:task:lwql-private-targets");
const selfProvisioning = LangWatchQLSelfProvisioningService.create();
const sqlText = LangWatchQLSqlTextService.create();
const clusterGuard = LangWatchQLSqlModeClusterGuardService.create();

/** The access stores SQL writes to: a reader held there is one rendered mode never updates. */
const SQL_ACCESS_STORAGES: readonly string[] = ["local_directory", "replicated"];

/** A rendered private server still holding the reader an earlier sql-mode upgrade created. */
export class LwqlPrivateStaleSqlReaderError extends Error {
  readonly reader: string;
  readonly storage: string;

  constructor({ reader, storage }: { reader: string; storage: string }) {
    super(`the reader ${reader} is held in the SQL access store ${storage}`);
    this.name = "LwqlPrivateStaleSqlReaderError";
    this.reader = reader;
    this.storage = storage;
  }
}

/** A rendered private server of several hosts whose plain CREATE would reach one of them. */
export class LwqlPrivateDatabaseNotReplicatedError extends Error {
  readonly database: string;
  readonly engine: string;
  readonly hostCount: number;

  constructor({
    database,
    engine,
    hostCount,
  }: {
    database: string;
    engine: string;
    hostCount: number;
  }) {
    super(`the database ${database} on ${hostCount} hosts uses the ${engine} engine`);
    this.name = "LwqlPrivateDatabaseNotReplicatedError";
    this.database = database;
    this.engine = engine;
    this.hostCount = hostCount;
  }
}

type RowReader = Pick<LangWatchQLProvisioningRepository, "queryRows">;

/** Where the server holds the reader: in an access store, or not while it does not know it. */
type LwqlReaderPlacement =
  | { readonly held: true; readonly storage: string }
  | { readonly held: false };

/** Asks `system.users` where the reader is held; the name is checked as an identifier first. */
export async function readerPlacementOf({
  repository,
  reader,
}: {
  repository: RowReader;
  reader: string;
}): Promise<LwqlReaderPlacement> {
  const name = sqlText.assertIdentifier(reader, "reader");
  const rows = await repository.queryRows(
    `SELECT storage FROM system.users WHERE name = ${clickHouseLiteral(name)}`,
  );
  const storage = rows[0]?.storage;
  return typeof storage === "string" ? { held: true, storage } : { held: false };
}

/**
 * Rendered mode writes no access entity and no `ON CLUSTER`: a reader a sql-mode upgrade created
 * is never updated, and a plain CREATE reaches one host unless the database is Replicated. Either
 * leaves the server unconverged, before any statement runs.
 */
export async function assertRenderedPrivateServer({
  repository,
  names,
}: {
  repository: RowReader;
  names: LangWatchQLNames;
}): Promise<void> {
  const reader = names.restrictedUser;
  const placement = await readerPlacementOf({ repository, reader });
  if (placement.held && SQL_ACCESS_STORAGES.includes(placement.storage)) {
    throw new LwqlPrivateStaleSqlReaderError({ reader, storage: placement.storage });
  }
  const query = (sql: string) => repository.queryRows(sql);
  const hostCount = Math.max(
    await clusterGuard.maxOwnClusterHostCount(query),
    await clusterGuard.maxReplicaHostCount(query),
  );
  if (hostCount <= 1) return;
  const database = sqlText.assertIdentifier(names.database, "database");
  const [row] = await query(
    `SELECT engine FROM system.databases WHERE name = ${clickHouseLiteral(database)}`,
  );
  const engine = typeof row?.engine === "string" ? row.engine : "absent";
  if (engine !== "Replicated") {
    throw new LwqlPrivateDatabaseNotReplicatedError({ database, engine, hostCount });
  }
}

/** Bounds each request, not each target, so one unresponsive server cannot hold the deploy. */
const PRIVATE_REQUEST_TIMEOUT_MS = 15_000;

const SINGLE_NODE_BYPASS = "LWQL_ACCESS_MODEL_SQL_SINGLE_NODE";

/** A route variable's organisation and its admin URL, as the migration task reads them. */
export interface LwqlPrivateEndpoint {
  readonly organizationId?: string;
  readonly url: string;
}

/** A private server's names: its database, its organisation's reader and the tenant setting. */
export function privateNamesOf({
  database,
  reader,
  tenantSetting,
}: {
  database: string;
  reader: LwqlPrivateReader;
  tenantSetting: string;
}): LangWatchQLNames {
  return {
    database,
    restrictedUser: reader.username,
    settingsProfile: reader.settingsProfile,
    // A PostgreSQL-engine table over the scoped project keys: no key row lives on this server.
    keyMapTable: LWQL_PROJECT_KEYS_VIEW,
    tenantSetting,
  };
}

/**
 * The shared plan, re-aimed at one private server: its database, the organisation's reader as the
 * restricted identity, and the same tenant setting the router sends. The admin URL only opens the
 * repository; no statement names its user, and no shared Postgres credential comes along.
 */
export function privatePlanOf({
  shared,
  endpoint,
  address,
  reader,
}: {
  shared: LwqlConvergencePlan;
  endpoint: LwqlPrivateEndpoint;
  address: LwqlServerAddress;
  reader: LwqlPrivateReader;
}): LwqlConvergencePlan {
  const { database } = address;
  // A private server is judged by its own access store, never by the shared run's bypass.
  const settings = Object.fromEntries(
    Object.entries(shared.settings).filter(([name]) => name !== SINGLE_NODE_BYPASS),
  );
  return {
    ...shared,
    request: {
      ...shared.request,
      connection: {
        ...shared.request.connection,
        url: address.origin,
        username: reader.username,
        password: reader.password,
        database,
      },
      postgresReaderPassword: "",
      // The shared Postgres is never named to a customer's server; its login is the config's.
      endpoint: { host: "", port: 0, database: "" },
    },
    names: privateNamesOf({ database, reader, tenantSetting: shared.names.tenantSetting }),
    settings,
    sourceDatabase: () => database,
    openRepository: () =>
      ClickHouseLangWatchQLProvisioningRepository.open({
        url: endpoint.url,
        requestTimeoutMs: PRIVATE_REQUEST_TIMEOUT_MS,
      }),
  };
}

/**
 * The source tables and the key map the reader has no sole row policy on (none means guarded), or
 * `unloaded` where a rendered server does not hold the reader yet: its users.d is not mounted.
 */
async function tablesWithoutOwnPolicy({
  plan,
  reader,
}: {
  plan: LwqlConvergencePlan;
  reader: LwqlPrivateReader;
}): Promise<string[] | "unloaded"> {
  const database = sqlText.assertIdentifier(plan.sourceDatabase(), "database");
  const tables = [
    ...selfProvisioning.policedTables({ names: plan.names, sourceDatabase: database }),
    `${database}.${plan.names.keyMapTable}`,
  ];
  const isRendered = selfProvisioning.accessModelMode({ source: plan.settings }) === "rendered";
  const repository = plan.openRepository();
  try {
    if (isRendered && !(await readerPlacementOf({ repository, reader: reader.username })).held) {
      return "unloaded";
    }
    const policies = await repository.findRowPolicies({ tables });
    return unguardedTables({
      policies,
      tables,
      reader: sqlText.assertIdentifier(reader.username, "reader"),
    });
  } finally {
    await repository.close();
  }
}

/** Plain code-point order, so the owner of a database never depends on the locale. */
function compareCodePoints({ left, right }: { left: string; right: string }): number {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

/** One private server: converge its ClickHouse half, then check every table is row-policed. */
async function provisionOne({
  plan,
  reader,
  organizationId,
  converge,
}: {
  plan: LwqlConvergencePlan;
  reader: LwqlPrivateReader;
  organizationId: string;
  converge: (plan: LwqlConvergencePlan) => Promise<void>;
}): Promise<void> {
  await converge(plan);
  const unguarded = await tablesWithoutOwnPolicy({ plan, reader });
  if (unguarded === "unloaded") {
    logger.warn(
      { organizationId, reader: reader.username },
      "LangWatchQL provisioned a private ClickHouse whose reader is not loaded yet; its queries stay refused until the rendered users.d file is mounted on the server",
    );
    return;
  }
  if (unguarded.length === 0) return;
  logger.warn(
    { organizationId, tables: unguarded },
    "LangWatchQL provisioned a private ClickHouse but these tables have no row policy for the organisation's reader, or one that applies to others too; its queries are not isolated until the server is fixed",
  );
}

/** Never carries the route URL: the summary is the server's code and error type only. */
function warnNotProvisioned({
  organizationId,
  error,
}: {
  organizationId: string;
  error: unknown;
}): void {
  if (error instanceof LwqlPrivateCollectionAbsentError) {
    logger.warn(
      { organizationId },
      "LangWatchQL private provisioning stopped: the organisation's ClickHouse holds no lwql_postgres named collection; its queries stay refused until infra mounts it",
    );
    return;
  }
  if (error instanceof LwqlPrivateStaleSqlReaderError) {
    logger.warn(
      { organizationId, reader: error.reader, storage: error.storage },
      "LangWatchQL private provisioning stopped: the organisation's ClickHouse holds its reader in a SQL access store, from an earlier sql-mode upgrade, which rendered mode never updates; drop that user so the rendered users.d file takes over. The server is not converged until then",
    );
    return;
  }
  if (error instanceof LwqlPrivateDatabaseNotReplicatedError) {
    const { database, engine, hostCount } = error;
    logger.warn(
      { organizationId, database, engine, hostCount },
      "LangWatchQL private provisioning stopped: the organisation's ClickHouse has more than one host and its database does not use the Replicated engine, so the views would reach one host only. The server is not converged until the database is Replicated",
    );
    return;
  }
  logger.warn(
    { organizationId, error: clickHouseErrorSummary(error) },
    "LangWatchQL provisioning on this organisation's private ClickHouse could not complete; its queries stay refused until the server is set up",
  );
}

/** Why a route may not be provisioned: unreadable, or on a shared server whatever its database. */
function refusalOf({
  endpoint,
  sharedOrigins,
}: {
  endpoint: LwqlPrivateEndpoint;
  sharedOrigins: readonly string[];
}): { address: LwqlServerAddress } | { reason: string } {
  const read = readPrivateRoute({ url: endpoint.url });
  if ("refusal" in read) return { reason: read.refusal };
  // A private reader's `CREATE OR REPLACE` would take over the shared server's row policies.
  if (sharedOrigins.includes(read.route.origin)) {
    return { reason: "the route names a shared server" };
  }
  return { address: read.route };
}

/** The address this endpoint may provision, or `skipped` once warned about or already owned. */
function claimServer({
  endpoint,
  sharedOrigins,
  owners,
}: {
  endpoint: LwqlPrivateEndpoint;
  sharedOrigins: readonly string[];
  owners: Map<string, string>;
}): { claimed: LwqlServerAddress } | { skipped: true } {
  const { organizationId } = endpoint;
  if (organizationId === undefined) {
    logger.warn("LangWatchQL private provisioning skipped a route that names no organisation");
    return { skipped: true };
  }
  const checked = refusalOf({ endpoint, sharedOrigins });
  if ("reason" in checked) {
    logger.warn(
      { organizationId, reason: checked.reason },
      "LangWatchQL private provisioning refused a route; the organisation stays refused",
    );
    return { skipped: true };
  }
  const server = `${checked.address.origin}/${checked.address.database}`;
  const owner = owners.get(server);
  if (owner === organizationId) return { skipped: true };
  if (owner !== undefined) {
    logger.warn(
      { organizationId, owner },
      "LangWatchQL private provisioning refused an organisation whose route names a server and database another organisation's reader already owns; it stays refused",
    );
    return { skipped: true };
  }
  owners.set(server, organizationId);
  return { claimed: checked.address };
}

/**
 * Converges each distinct private server and never throws: a failed target warns, URL and
 * passwords left out, and its organisation stays refused. The first organisation in id order owns
 * a server and database; another claiming it is refused (this run only). No pepper, no target.
 */
export async function provisionLwqlPrivateTargets({
  endpoints,
  sharedUrl,
  keyPepper,
  shared,
  converge,
}: {
  endpoints: readonly LwqlPrivateEndpoint[];
  sharedUrl: string | undefined;
  keyPepper: string | undefined;
  shared: LwqlConvergencePlan;
  converge: (plan: LwqlConvergencePlan) => Promise<void>;
}): Promise<void> {
  if (endpoints.length === 0) return;
  if (keyPepper === undefined) {
    logger.warn(
      { organisations: endpoints.length },
      "LangWatchQL private provisioning skipped: no key pepper (API_KEY_PEPPER, CREDENTIALS_SECRET or NEXTAUTH_SECRET) to derive the readers from; those organisations stay refused",
    );
    return;
  }
  const sharedOrigins = [sharedUrl, shared.request.connection.url].flatMap((url) => {
    const read = url === undefined ? undefined : readServerAddress({ url });
    return read === undefined || "unreadable" in read ? [] : [read.address.origin];
  });
  const owners = new Map<string, string>();
  const ordered = [...endpoints].toSorted((a, b) =>
    compareCodePoints({ left: a.organizationId ?? "", right: b.organizationId ?? "" }),
  );
  for (const endpoint of ordered) {
    const claimed = claimServer({ endpoint, sharedOrigins, owners });
    if ("skipped" in claimed) continue;
    const { organizationId } = endpoint;
    if (organizationId === undefined) continue;
    const address = claimed.claimed;
    const reader = privateReaderOf({ keyPepper, organizationId });
    try {
      const plan = privatePlanOf({ shared, endpoint, address, reader });
      await provisionOne({ plan, reader, organizationId, converge });
    } catch (error) {
      warnNotProvisioned({ organizationId, error });
    }
  }
}
