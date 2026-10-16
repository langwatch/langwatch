import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { createLogger } from "@langwatch/observability";

import {
  APP_FUNCTION_KEEPER_STORE,
  APP_FUNCTION_KEEPER_STORE_PATH,
  type AppFunctionStoreProbe,
  type AppFunctionStoreReadings,
  type ClusterLayout,
  findFunctionStoreCluster,
  findFunctionsWithSplitDefinitions,
  findReplicasOffStore,
  findSplitAppFunctions,
  isFunctionStoreInKeeper,
  needsKeeperFunctionStore,
  type ReplicaFunctions,
  type SplitAppFunction,
} from "../../features/app-functions/rules/langwatch-ql-app-function-store.rules.ts";
import { LangWatchQLAppFunctionStoreRepository } from "../langwatch-ql-app-function-store.repository.ts";
import type { LangWatchQLProvisioningRepository } from "../langwatch-ql-provisioning.repository.ts";

const logger = createLogger("langwatch:analytics:lwql-app-function-store");

type ReadRows = (sql: string) => Promise<Record<string, unknown>[]>;

const MAX_TOTAL_REPLICAS_SQL =
  "SELECT toString(max(total_replicas)) AS max_total_replicas FROM system.replicas";

const CLUSTERS_SQL =
  "SELECT cluster AS name, toString(count()) AS hosts, toString(max(replica_num)) AS widest_shard " +
  "FROM system.clusters GROUP BY cluster";

const KEEPER_FUNCTION_STORE_SQL =
  "SELECT toString(count()) AS stores FROM system.zookeeper " +
  `WHERE path = '${APP_FUNCTION_KEEPER_STORE.parent}' AND name = '${APP_FUNCTION_KEEPER_STORE.name}'`;

const KEEPER_FUNCTION_ENTRIES_SQL = `SELECT name FROM system.zookeeper WHERE path = '${APP_FUNCTION_KEEPER_STORE_PATH}'`;

function toReplicaFunctions(row: Record<string, unknown>): ReplicaFunctions {
  return { host: String(row.host), functions: (row.functions ?? {}) as Record<string, string> };
}

function quoted(value: string): string {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

// system.functions is local to each server, so each host says which store it reads.
// Every host has builtins, so one with no SQL function still answers a row.
const HOST_FUNCTIONS_SELECT =
  "SELECT hostName() AS host, " +
  "CAST(groupArrayIf((name, create_query), origin = 'SQLUserDefined') AS Map(String, String)) AS functions ";

function replicaFunctionsSql(cluster: string): string {
  return (
    HOST_FUNCTIONS_SELECT +
    `FROM clusterAllReplicas(${quoted(cluster)}, system.functions) GROUP BY host ` +
    "SETTINGS skip_unavailable_shards = 0"
  );
}

const SERVER_FUNCTIONS_SQL = `${HOST_FUNCTIONS_SELECT}FROM system.functions`;

/**
 * Reads the replica layout and, only when replicated, whether every replica (or, unread
 * together, this server) keeps its functions in Keeper. A server that cannot answer
 * answers nothing, so it is never taken for a single node. ADR-136.
 */
export class ClickHouseLangWatchQLAppFunctionStoreRepository extends LangWatchQLAppFunctionStoreRepository {
  private constructor(
    private readonly rows: ReadRows,
    private readonly cluster: string | undefined,
  ) {
    super();
  }

  /** Finds the cluster from `system.clusters`, having no `CLICKHOUSE_CLUSTER` to read. */
  static create(
    clickhouse: ClickHouseQueryClient,
  ): ClickHouseLangWatchQLAppFunctionStoreRepository {
    return new ClickHouseLangWatchQLAppFunctionStoreRepository(async (sql) => {
      const result = await clickhouse.query<Record<string, unknown>>({
        tenantId: "",
        sql,
        // The replica layout and the Keeper store describe the server, which no tenant owns.
        SKIP_TENANT_CHECK: true,
      });
      return result.rows;
    }, undefined);
  }

  /** Over the deploy task's admin connection, the one that then creates the functions. */
  static overAdmin({
    admin,
    cluster,
  }: {
    admin: Pick<LangWatchQLProvisioningRepository, "queryRows">;
    /** `CLICKHOUSE_CLUSTER`; unset, the cluster is found from `system.clusters`. */
    cluster: string | undefined;
  }): ClickHouseLangWatchQLAppFunctionStoreRepository {
    return new ClickHouseLangWatchQLAppFunctionStoreRepository(
      (sql) => admin.queryRows(sql),
      cluster,
    );
  }

  async findProbe(): Promise<AppFunctionStoreProbe[]> {
    try {
      const maxTotalReplicas = await this.maxTotalReplicas();
      if (!needsKeeperFunctionStore(maxTotalReplicas)) {
        return [{ maxTotalReplicas, functionStoreInKeeper: false }];
      }
      const readings = await this.readFunctionStore(maxTotalReplicas);
      const offStore = findReplicasOffStore(readings);
      if (readings.storeNodeExists && offStore.length > 0) {
        logger.warn(
          { hosts: offStore, keeperPath: APP_FUNCTION_KEEPER_STORE_PATH },
          "These ClickHouse replicas hold SQL functions other than the Keeper function store's, so they keep them on local disk",
        );
      }
      const splitDefinitions = findFunctionsWithSplitDefinitions(readings);
      if (splitDefinitions.length > 0) {
        logger.warn(
          { functions: splitDefinitions, keeperPath: APP_FUNCTION_KEEPER_STORE_PATH },
          "These SQL functions have different definitions on different ClickHouse replicas, so at least one replica keeps them on local disk",
        );
      }
      return [{ maxTotalReplicas, functionStoreInKeeper: isFunctionStoreInKeeper(readings) }];
    } catch (error) {
      logger.error(
        { error },
        "Could not read the replica layout from system.replicas or the function store from system.zookeeper and system.functions, so LangWatchQL app functions are not provisionable until it can",
      );
      return [];
    }
  }

  /**
   * The created functions that did not reach Keeper and every replica alike; empty on a
   * single node. Throws where this server or Keeper cannot be read: an unchecked create is
   * not a good one. Where the replicas cannot be read together, checks this server only.
   */
  async findSplitAppFunctions({
    names,
  }: {
    names: readonly string[];
  }): Promise<SplitAppFunction[]> {
    const maxTotalReplicas = await this.maxTotalReplicas();
    if (!needsKeeperFunctionStore(maxTotalReplicas)) return [];
    return findSplitAppFunctions({ names, ...(await this.readFunctionStore(maxTotalReplicas)) });
  }

  private async maxTotalReplicas(): Promise<number> {
    const [replicas] = await this.rows(MAX_TOTAL_REPLICAS_SQL);
    return Number(replicas?.max_total_replicas ?? "0") || 0;
  }

  private async readFunctionStore(maxTotalReplicas: number): Promise<AppFunctionStoreReadings> {
    const [node] = await this.rows(KEEPER_FUNCTION_STORE_SQL);
    if (Number(node?.stores ?? "0") === 0) {
      return { storeNodeExists: false, storeEntries: [], replicas: [] };
    }
    const [entries, replicas] = await Promise.all([
      this.rows(KEEPER_FUNCTION_ENTRIES_SQL),
      this.readReplicas(maxTotalReplicas),
    ]);
    return {
      storeNodeExists: true,
      storeEntries: entries.map((row) => String(row.name)),
      replicas,
    };
  }

  // A cross-replica read needs inter-server auth, the REMOTE grant and every replica up.
  // Missing any of them must not withhold the functions, so the store is still compared
  // with the server this connection reaches, as before; the warn says what went unchecked.
  private async readReplicas(maxTotalReplicas: number): Promise<ReplicaFunctions[]> {
    try {
      return await this.readEveryReplica(maxTotalReplicas);
    } catch (error) {
      logger.warn(
        { error, keeperPath: APP_FUNCTION_KEEPER_STORE_PATH },
        "Could not read system.functions from every ClickHouse replica through clusterAllReplicas, so the LangWatchQL app function store is checked on this server only and a replica keeping its functions on local disk goes unseen. A refused login as user default usually means the cluster in remote_servers has no working <secret>",
      );
      return this.readThisServer();
    }
  }

  private async readThisServer(): Promise<ReplicaFunctions[]> {
    return (await this.rows(SERVER_FUNCTIONS_SQL)).map(toReplicaFunctions);
  }

  private async readEveryReplica(maxTotalReplicas: number): Promise<ReplicaFunctions[]> {
    const clusters: ClusterLayout[] = (await this.rows(CLUSTERS_SQL)).map((row) => ({
      name: String(row.name),
      hosts: Number(row.hosts),
      widestShard: Number(row.widest_shard),
    }));
    const [cluster] = findFunctionStoreCluster({ named: this.cluster, clusters, maxTotalReplicas });
    if (cluster === undefined) {
      throw new Error(
        `No single cluster in system.clusters spans the ${maxTotalReplicas} replicas` +
          (this.cluster === undefined ? "" : ` (CLICKHOUSE_CLUSTER is ${this.cluster})`),
      );
    }
    const replicas = (await this.rows(replicaFunctionsSql(cluster.name))).map(toReplicaFunctions);
    if (replicas.length !== cluster.hosts) {
      throw new Error(
        `Cluster ${cluster.name} has ${cluster.hosts} hosts but only these answered: ${replicas.map((replica) => replica.host).join(", ")}`,
      );
    }
    return replicas;
  }
}
