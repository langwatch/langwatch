/**
 * The Keeper node a replicated server's SQL function store lives under, as the
 * chart renders `user_defined_zookeeper_path`. ClickHouse 25.10 lists that
 * setting nowhere in SQL, so the probe looks for the node instead. ADR-136.
 */
export const APP_FUNCTION_KEEPER_STORE = { parent: "/clickhouse", name: "user_defined" } as const;

/** The full Keeper path, for the logs and checkup copy that name it. */
export const APP_FUNCTION_KEEPER_STORE_PATH = `${APP_FUNCTION_KEEPER_STORE.parent}/${APP_FUNCTION_KEEPER_STORE.name}`;

/** What the server says about where a `CREATE FUNCTION` would land. */
export type AppFunctionStoreProbe = Readonly<{
  /** The widest replica set of any replicated table; 0 on a plain server. */
  maxTotalReplicas: number;
  /** Whether Keeper holds the function store node; false where Keeper was not asked. */
  functionStoreInKeeper: boolean;
}>;

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
