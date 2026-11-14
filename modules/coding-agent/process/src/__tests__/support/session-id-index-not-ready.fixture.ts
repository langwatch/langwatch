import { SHARED_CLICKHOUSE_TARGET } from "@langwatch/clickhouse-client";

/**
 * Members a scripted ClickHouse double adds so the session id index reads as not filled: the
 * reads then take their statements from before the index, as on a target still filling.
 */
export const sessionIdIndexNotReady = {
  targetOf: async () => SHARED_CLICKHOUSE_TARGET,
  idIndexes: () => ({ isReady: () => false }),
};
