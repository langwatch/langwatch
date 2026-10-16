/**
 * The Keeper node a replicated server's SQL function store lives under, as the
 * chart renders `user_defined_zookeeper_path`. ClickHouse 25.10 lists that
 * setting nowhere in SQL, so the probe compares the node with this server. ADR-136.
 */
export const APP_FUNCTION_KEEPER_STORE = { parent: "/clickhouse", name: "user_defined" } as const;

/** The full Keeper path, for the logs and checkup copy that name it. */
export const APP_FUNCTION_KEEPER_STORE_PATH = `${APP_FUNCTION_KEEPER_STORE.parent}/${APP_FUNCTION_KEEPER_STORE.name}`;

/** What the server says about where a `CREATE FUNCTION` would land. */
export type AppFunctionStoreProbe = Readonly<{
  /** The widest replica set of any replicated table; 0 on a plain server. */
  maxTotalReplicas: number;
  /** Whether this server keeps its SQL functions in Keeper; false where Keeper was not asked. */
  functionStoreInKeeper: boolean;
}>;

/** What Keeper and this server hold, read to tell a Keeper function store from a local one. */
export type AppFunctionStoreReadings = Readonly<{
  /** Whether the store node exists; any server configured for it may have made it. */
  storeNodeExists: boolean;
  /** The SQL user-defined functions this server knows, from its own `system.functions`. */
  serverFunctions: readonly string[];
  /** The children of the store node, `function_<escaped name>.sql` for each function. */
  storeEntries: readonly string[];
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

/**
 * In Keeper when the store holds exactly the functions this server knows: a Keeper-backed
 * server loads every entry, a local one none. An empty store with no local function cannot
 * be told apart in SQL on 25.10, so there the node alone decides. ADR-136.
 */
export function isFunctionStoreInKeeper({
  storeNodeExists,
  serverFunctions,
  storeEntries,
}: AppFunctionStoreReadings): boolean {
  if (!storeNodeExists) return false;
  const expected = new Set(
    serverFunctions.map((name) => `function_${escapeForFileName(name)}.sql`),
  );
  const stored = new Set(storeEntries.filter((entry) => FUNCTION_ENTRY.test(entry)));
  return expected.size === stored.size && [...expected].every((entry) => stored.has(entry));
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
