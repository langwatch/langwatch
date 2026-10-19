/** What the server says about where a `CREATE FUNCTION` would land. */
export type AppFunctionStoreProbe = Readonly<{
  /** The widest replica set of any replicated table; 0 on a plain server. */
  maxTotalReplicas: number;
  /** The Keeper path the SQL UDF store is moved to, or empty for local disk. */
  userDefinedZookeeperPath: string;
}>;

/**
 * Whether the app functions can be created so every replica sees them: one
 * node keeps them on its disk; more than one needs the store in Keeper, or the
 * others answer UNKNOWN_FUNCTION. ADR-136 (lwql app functions identity UDFs).
 */
export function canProvisionAppFunctions(probe: AppFunctionStoreProbe): boolean {
  return probe.maxTotalReplicas <= 1 || probe.userDefinedZookeeperPath.trim() !== "";
}
