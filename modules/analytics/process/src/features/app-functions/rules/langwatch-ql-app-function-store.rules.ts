/** Where ch-config points `user_defined_zookeeper_path` in replicated mode (ADR-136). */
export const APP_FUNCTION_KEEPER_STORE_PATH = "/clickhouse/user_defined";

/** What the server says about where a `CREATE FUNCTION` would land. */
export type AppFunctionStoreProbe = Readonly<{
  /** The widest replica set of any replicated table; 0 on a plain server. */
  maxTotalReplicas: number;
  /** Whether Keeper holds the shared function store's node; false where it was not asked. */
  keeperStoreFound: boolean;
}>;

/** Runs one read-only statement as the app's ClickHouse user and answers its rows. */
export type AppFunctionStoreRowReader = (
  sql: string,
) => Promise<readonly Record<string, unknown>[]>;

const REPLICAS_SQL =
  "SELECT toString(max(total_replicas)) AS max_total_replicas FROM system.replicas";

/**
 * ClickHouse reads `user_defined_zookeeper_path` straight from config, so neither
 * `system.server_settings` nor `getServerSetting` knows it. A server using it creates
 * the store's node at boot: the node at `APP_FUNCTION_KEEPER_STORE_PATH` is the evidence.
 */
const KEEPER_STORE_SQL =
  "SELECT toString(count()) AS found FROM system.zookeeper " +
  "WHERE path = '/clickhouse' AND name = 'user_defined'";

/**
 * The probe every caller shares. Keeper is asked only on a replicated server: one
 * with no replicated table may have no Keeper at all, where `system.zookeeper` throws.
 * Throws when ClickHouse refuses a read, so a caller never mistakes silence for a node.
 */
export async function readAppFunctionStoreProbe({
  queryRows,
}: {
  queryRows: AppFunctionStoreRowReader;
}): Promise<AppFunctionStoreProbe> {
  const replicas = await queryRows(REPLICAS_SQL);
  const maxTotalReplicas = Number(replicas[0]?.max_total_replicas ?? "0") || 0;
  if (maxTotalReplicas <= 1) return { maxTotalReplicas, keeperStoreFound: false };
  const store = await queryRows(KEEPER_STORE_SQL);
  return { maxTotalReplicas, keeperStoreFound: Number(store[0]?.found ?? "0") > 0 };
}

/**
 * Whether the app functions can be created so every replica sees them: one
 * node keeps them on its disk; more than one needs the store in Keeper, or the
 * others answer UNKNOWN_FUNCTION. ADR-136 (lwql app functions identity UDFs).
 */
export function canProvisionAppFunctions(probe: AppFunctionStoreProbe): boolean {
  return probe.maxTotalReplicas <= 1 || probe.keeperStoreFound;
}
