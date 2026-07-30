/**
 * Message fragments that mark a ClickHouse failure as transient — overload,
 * timeouts, connection loss, and Keeper/cluster recovery. Only a genuine
 * data-integrity error is not on this list.
 */
export const CLICKHOUSE_TRANSIENT_MESSAGE_FRAGMENTS = [
  "Too many simultaneous queries",
  "TIMEOUT_EXCEEDED",
  "SOCKET_TIMEOUT",
  "NETWORK_ERROR",
  "MEMORY_LIMIT_EXCEEDED",
  "connect ECONNREFUSED",
  "connect ETIMEDOUT",
  "QUERY_WAS_CANCELLED",
  "Query was cancelled",
  "TABLE_IS_READ_ONLY",
  "Table is in readonly mode",
  "KEEPER_EXCEPTION",
  "Coordination::Exception",
  "Session expired",
  "Connection loss",
  "CANNOT_READ_ALL_DATA",
  "Write buffer has been canceled",
] as const;

export function isTransientClickHouseMessage(message: string): boolean {
  return CLICKHOUSE_TRANSIENT_MESSAGE_FRAGMENTS.some((fragment) =>
    message.includes(fragment),
  );
}
