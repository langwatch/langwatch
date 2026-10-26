/**
 * The Keeper node a replicated server's SQL function store lives under, as the
 * chart renders `user_defined_zookeeper_path`. ClickHouse 25.10 lists that
 * setting nowhere in SQL, so the probe compares the node with every replica. ADR-136.
 */
export const APP_FUNCTION_KEEPER_STORE = { parent: "/clickhouse", name: "user_defined" } as const;

/** The full Keeper path, for the logs and checkup copy that name it. */
export const APP_FUNCTION_KEEPER_STORE_PATH = `${APP_FUNCTION_KEEPER_STORE.parent}/${APP_FUNCTION_KEEPER_STORE.name}`;

/** How long a create may take to reach every Keeper-backed replica through its watch. */
export const APP_FUNCTION_REPLICA_WAIT_MS = 10_000;

/** What the server says about where a `CREATE FUNCTION` would land. */
export type AppFunctionStoreProbe = Readonly<{
  /** The widest replica set of any replicated table; 0 on a plain server. */
  maxTotalReplicas: number;
  /** Whether every replica keeps its SQL functions in Keeper; false where Keeper was not asked. */
  functionStoreInKeeper: boolean;
}>;

/** One cluster in `system.clusters`. */
export type ClusterLayout = Readonly<{
  name: string;
  /** Every host of every shard: what `clusterAllReplicas` asks. */
  hosts: number;
  /** The replica count of its widest shard. */
  widestShard: number;
}>;

/** One replica's SQL user-defined functions, name to `create_query`, keyed by `hostName()`. */
export type ReplicaFunctions = Readonly<{
  host: string;
  functions: Readonly<Record<string, string>>;
}>;

/** What Keeper and every replica hold, read to tell a Keeper function store from a local one. */
export type AppFunctionStoreReadings = Readonly<{
  /** Whether the store node exists; any server configured for it may have made it. */
  storeNodeExists: boolean;
  /** The children of the store node, `function_<escaped name>.sql` for each function. */
  storeEntries: readonly string[];
  /** Every replica of the cluster, each from its own `system.functions`. */
  replicas: readonly ReplicaFunctions[];
}>;

/** A created app function that did not reach the Keeper store and every replica alike. */
export type SplitAppFunction = Readonly<{
  name: string;
  /** Hosts whose `system.functions` does not list it. */
  missingOn: readonly string[];
  /** Whether Keeper holds its `function_<name>.sql` child. */
  inKeeper: boolean;
  /** Whether every host that lists it holds the same definition. */
  oneDefinition: boolean;
}>;

const FUNCTION_ENTRY = /^function_.*\.sql$/;

/** ClickHouse's `escapeForFileName`: every byte outside `[A-Za-z0-9_]` becomes `%XX`. */
function escapeForFileName(name: string): string {
  return [...new TextEncoder().encode(name)]
    .map((byte) => {
      const char = String.fromCharCode(byte);
      return /\w/.test(char) ? char : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    })
    .join("");
}

function storeEntry(name: string): string {
  return `function_${escapeForFileName(name)}.sql`;
}

function sameSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((entry) => right.has(entry));
}

/**
 * The cluster to ask every replica through: the named one when it spans the widest
 * replica set, else the one cluster whose widest shard equals it. Empty where none
 * or more than one fits, since a replica outside the cluster would go unchecked.
 */
export function findFunctionStoreCluster({
  named,
  clusters,
  maxTotalReplicas,
}: {
  named: string | undefined;
  clusters: readonly ClusterLayout[];
  maxTotalReplicas: number;
}): ClusterLayout[] {
  if (named !== undefined) {
    return clusters.filter(
      (cluster) => cluster.name === named && cluster.widestShard >= maxTotalReplicas,
    );
  }
  const fitting = clusters.filter((cluster) => cluster.widestShard === maxTotalReplicas);
  return fitting.length === 1 ? fitting : [];
}

/** Hosts whose SQL functions are not exactly the Keeper store's entries. */
export function findReplicasOffStore({
  storeEntries,
  replicas,
}: Pick<AppFunctionStoreReadings, "storeEntries" | "replicas">): string[] {
  const stored = new Set(storeEntries.filter((entry) => FUNCTION_ENTRY.test(entry)));
  return replicas
    .filter((replica) => !sameSet(new Set(Object.keys(replica.functions).map(storeEntry)), stored))
    .map((replica) => replica.host);
}

/** Functions whose `create_query` differs between the replicas that hold them. */
export function findFunctionsWithSplitDefinitions({
  replicas,
}: Pick<AppFunctionStoreReadings, "replicas">): string[] {
  const definitions = new Map<string, Set<string>>();
  for (const replica of replicas) {
    for (const [name, definition] of Object.entries(replica.functions)) {
      definitions.set(name, (definitions.get(name) ?? new Set()).add(definition));
    }
  }
  return [...definitions].filter(([, held]) => held.size > 1).map(([name]) => name);
}

/**
 * In Keeper when every replica holds exactly the store's functions with one definition
 * each, as Keeper-backed replicas load the same entries. Same names and definitions held
 * locally cannot be told apart: ADR-136.
 */
export function isFunctionStoreInKeeper(readings: AppFunctionStoreReadings): boolean {
  return (
    readings.storeNodeExists &&
    readings.replicas.length > 0 &&
    findReplicasOffStore(readings).length === 0 &&
    findFunctionsWithSplitDefinitions(readings).length === 0
  );
}

/** The created functions that are missing from a host or Keeper, or differ between hosts. */
export function findSplitAppFunctions({
  names,
  storeEntries,
  replicas,
}: Pick<AppFunctionStoreReadings, "storeEntries" | "replicas"> & {
  names: readonly string[];
}): SplitAppFunction[] {
  const stored = new Set(storeEntries);
  return names
    .map((name) => {
      const holding = replicas.filter((replica) => Object.hasOwn(replica.functions, name));
      return {
        name,
        missingOn: replicas
          .filter((replica) => !Object.hasOwn(replica.functions, name))
          .map((replica) => replica.host),
        inKeeper: stored.has(storeEntry(name)),
        oneDefinition: new Set(holding.map((replica) => replica.functions[name])).size <= 1,
      };
    })
    .filter((split) => split.missingOn.length > 0 || !split.inKeeper || !split.oneDefinition);
}

/** More than one replica: a create on local disk would reach one of them only. */
export function needsKeeperFunctionStore(maxTotalReplicas: number): boolean {
  return maxTotalReplicas > 1;
}

/**
 * Whether the app functions can be created so every replica sees them: one
 * node keeps them on its disk; more than one needs the store in Keeper, or the
 * others answer UNKNOWN_FUNCTION. ADR-136 (lwql app functions identity UDFs).
 */
export function canProvisionAppFunctions(probe: AppFunctionStoreProbe): boolean {
  return !needsKeeperFunctionStore(probe.maxTotalReplicas) || probe.functionStoreInKeeper;
}
