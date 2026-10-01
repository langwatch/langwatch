/**
 * SQL mode writes the access model through SQL, which reaches one host unless access storage is
 * replicated; on a multi-host cluster without it the model would be partial, so it is refused.
 * @see specs/lwql/access-model.feature
 */

import { createLogger, type Logger } from "@langwatch/observability";

/** Reads rows from the admin ClickHouse; the guard never holds a client itself. */
export type ClusterGuardQuery = (sql: string) => Promise<Record<string, unknown>[]>;

export const LWQL_SQL_SINGLE_NODE_BYPASS = "LWQL_ACCESS_MODEL_SQL_SINGLE_NODE";

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

export class LangWatchQLSqlModeClusterGuardService {
  static create({
    logger = createLogger("langwatch:analytics:lwql:sqlModeClusterGuard"),
  }: { logger?: Logger } = {}): LangWatchQLSqlModeClusterGuardService {
    return new LangWatchQLSqlModeClusterGuardService(logger);
  }

  private constructor(private readonly logger: Logger) {}

  /** The largest cluster this host belongs to, in distinct hosts. */
  async maxOwnClusterHostCount(query: ClusterGuardQuery): Promise<number> {
    const rows = await query(
      "SELECT toString(max(hosts)) AS host_count FROM (" +
        "SELECT cluster, uniqExact(host_name) AS hosts FROM system.clusters " +
        "WHERE cluster IN (SELECT cluster FROM system.clusters WHERE is_local = 1) " +
        "GROUP BY cluster)",
    );
    return Number(rows[0]?.host_count ?? "0") || 0;
  }

  /** The widest replication any table has — a cluster the `system.clusters` view can miss. */
  async maxReplicaHostCount(query: ClusterGuardQuery): Promise<number> {
    const rows = await query(
      "SELECT toString(max(total_replicas)) AS max_total_replicas FROM system.replicas",
    );
    return Number(rows[0]?.max_total_replicas ?? "0") || 0;
  }

  async assertSafe({
    query,
    source,
  }: {
    query: ClusterGuardQuery;
    source: Record<string, string | undefined>;
  }): Promise<void> {
    if (source[LWQL_SQL_SINGLE_NODE_BYPASS] === "true") {
      this.logger.warn(
        { bypass: LWQL_SQL_SINGLE_NODE_BYPASS },
        "lwql sql mode permitted: cluster guard bypassed by env — single-node scope accepted regardless of topology",
      );
      return;
    }
    const replicatedDirectoryCount = (
      await query("SELECT name, type FROM system.user_directories WHERE type = 'replicated'")
    ).length;
    if (replicatedDirectoryCount > 0) {
      this.logger.info(
        { hostCount: null, replicatedDirectoryCount, decidedBy: "replicatedDirectory" },
        "lwql sql mode permitted: replicated access storage reaches every host",
      );
      return;
    }
    const [clusterHostCount, replicaHostCount] = await Promise.all([
      this.maxOwnClusterHostCount(query),
      this.maxReplicaHostCount(query),
    ]);
    const hostCount = Math.max(clusterHostCount, replicaHostCount);
    const decidedBy = replicaHostCount > clusterHostCount ? "replicas" : "clusters";
    if (hostCount <= 1) {
      this.logger.info(
        { hostCount, replicatedDirectoryCount, decidedBy },
        "lwql sql mode permitted: single-host target",
      );
      return;
    }
    this.logger.error(
      { hostCount, replicatedDirectoryCount, decidedBy },
      "lwql sql mode refused: multi-host cluster with no replicated access storage",
    );
    throw new LwqlSqlModeUnsafeOnClusterError({ hostCount, replicatedDirectoryCount });
  }
}
