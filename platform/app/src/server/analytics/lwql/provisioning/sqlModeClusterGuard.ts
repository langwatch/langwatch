/**
 * AC9 — `sql` mode is fail-closed on clusters (issue #8258).
 *
 * `sql` mode provisions the LWQL access model as DDL, which lands only on the
 * one ClickHouse server behind the service. On a multi-host cluster whose access
 * storage is not replicated, the other hosts never carry the user, profile,
 * grants or row policies, so a tenant-filtered query could hit a host with no
 * access model at all. This guard refuses that configuration outright rather
 * than provisioning a model that only half the cluster honours.
 *
 * The check: if no `replicated` user directory exists (ClickHouse Cloud and a
 * self-managed `<replicated>` access store both have one, and both pass), and any
 * cluster this server belongs to has more than one host, abort with a named
 * error. The operator either points the app at replicated access storage or
 * accepts single-node scope with `LWQL_ACCESS_MODEL_SQL_SINGLE_NODE=true`.
 *
 * A refusal, not a warning: the error propagates to the non-fatal converge
 * handler, which logs it and leaves LWQL fail-closed until the operator acts.
 * The log carries the two counts only — never any statement text (AC5).
 *
 * @see ./selfProvisionEntry.ts — calls this before the sql-mode access statements
 * @see specs/lwql/access-model.feature
 */

import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:analytics:lwql:sqlModeClusterGuard");

/** Query the guard runs against `system.user_directories` and `system.clusters`. */
export type ClusterGuardQuery = (
  sql: string,
) => Promise<Record<string, string>[]>;

/**
 * `sql` mode was requested on a multi-host cluster with no replicated access
 * storage — provisioning would reach one host only. Named so the refusal is
 * diagnosable; carries the two counts, never any statement text.
 */
export class LwqlSqlModeUnsafeOnClusterError extends Error {
  readonly hostCount: number;
  readonly replicatedDirectoryCount: number;

  constructor({
    hostCount,
    replicatedDirectoryCount,
  }: {
    hostCount: number;
    replicatedDirectoryCount: number;
  }) {
    super(
      "lwql sql mode refused: the ClickHouse target is a multi-host cluster with no replicated access storage, so the access model would reach one host only. " +
        "Point the app at replicated access storage, or set LWQL_ACCESS_MODEL_SQL_SINGLE_NODE=true to accept single-node scope",
    );
    this.name = "LwqlSqlModeUnsafeOnClusterError";
    this.hostCount = hostCount;
    this.replicatedDirectoryCount = replicatedDirectoryCount;
  }
}

/** Env value that accepts single-node scope and bypasses the guard. */
export const LWQL_SQL_SINGLE_NODE_BYPASS = "LWQL_ACCESS_MODEL_SQL_SINGLE_NODE";

/** Whether any user directory is the replicated (Keeper-backed) access store. */
async function hasReplicatedUserDirectory(
  query: ClusterGuardQuery,
): Promise<number> {
  const rows = await query(
    "SELECT name, type FROM system.user_directories WHERE type = 'replicated'",
  );
  return rows.length;
}

/**
 * The largest host count of any cluster this server belongs to. A cluster is
 * "ours" when it carries an `is_local = 1` row; its size is the count of
 * distinct hosts. Zero when the server belongs to no configured cluster.
 */
async function maxOwnClusterHostCount(
  query: ClusterGuardQuery,
): Promise<number> {
  const rows = await query(
    "SELECT cluster, host_name, is_local FROM system.clusters",
  );
  const ownClusters = new Set(
    rows.filter((row) => row.is_local === "1").map((row) => row.cluster),
  );
  const hostsByCluster = new Map<string, Set<string>>();
  for (const row of rows) {
    const { cluster, host_name: hostName } = row;
    if (cluster === undefined || hostName === undefined) continue;
    if (!ownClusters.has(cluster)) continue;
    const hosts = hostsByCluster.get(cluster) ?? new Set<string>();
    hosts.add(hostName);
    hostsByCluster.set(cluster, hosts);
  }
  let max = 0;
  for (const hosts of hostsByCluster.values()) {
    max = Math.max(max, hosts.size);
  }
  return max;
}

/**
 * Refuses `sql`-mode provisioning on a multi-host cluster with no replicated
 * access storage. Passes silently for a single-node target, a replicated access
 * store, or when the single-node bypass is set. Throws
 * {@link LwqlSqlModeUnsafeOnClusterError} otherwise.
 */
export async function assertLwqlSqlModeClusterSafe({
  query,
  env = process.env,
}: {
  query: ClusterGuardQuery;
  env?: NodeJS.ProcessEnv;
}): Promise<void> {
  if (env[LWQL_SQL_SINGLE_NODE_BYPASS] === "true") return;

  const replicatedDirectoryCount = await hasReplicatedUserDirectory(query);
  if (replicatedDirectoryCount > 0) return;

  const hostCount = await maxOwnClusterHostCount(query);
  if (hostCount <= 1) return;

  logger.error(
    { hostCount, replicatedDirectoryCount },
    "lwql sql mode refused: multi-host cluster with no replicated access storage",
  );
  throw new LwqlSqlModeUnsafeOnClusterError({
    hostCount,
    replicatedDirectoryCount,
  });
}
