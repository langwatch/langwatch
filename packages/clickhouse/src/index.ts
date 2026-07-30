/**
 * `@langwatch/clickhouse` — the ClickHouse storage layer.
 *
 * One `defineTable` declaration per table owning its shape, codec inputs and
 * query surface; one client construction path whose retry policy the table's
 * declared merge strategy decides; and the ClickHouse implementations of the
 * store contracts `@langwatch/event-sourcing` declares (ADR-099, ADR-102,
 * ADR-104).
 *
 * `package.json` names this file as the package's only entry point, so anything
 * a consumer is meant to reach has to be exported here — a symbol that exists in
 * `src/` but not below is unreachable from outside the package.
 *
 * The client and the schema are usable without the store adapters: the analytics
 * query builders, the governance services under `ee/` and the ops explain paths
 * read ClickHouse without touching a projection, which is the reason ADR-102 puts
 * this layer in its own package rather than inside the event-sourcing core.
 */

export {
  ch,
  ColumnDecodeError,
} from "./schema/columns";
export type { AnyColumnDef, ColumnDef, ColumnMap, TimeRole } from "./schema/columns";

export {
  aggregating,
  append,
  defineTable,
  replacing,
  TableDefinitionError,
} from "./schema/defineTable";
export type {
  MergeIdempotency,
  MergeStrategy,
  TableDefinition,
  TableDefinitionArgs,
  TableDescription,
  TableRow,
} from "./schema/defineTable";

export { createRowCodec, WireShapeMismatchError } from "./codec/rowCodec";
export type { WireCodec, WireColumn } from "./codec/rowCodec";

export {
  createClickHouseClient,
  ClickHouseOperationError,
} from "./client/clickhouseClient";
export type {
  ClickHouseClient,
  ClickHouseClientConfig,
  ClickHouseQueryResult,
  ClickHouseRawInsert,
  ClickHouseRawQuery,
  ClickHouseTransport,
  CounterHandle,
  HistogramHandle,
  MetricLabels,
  Metrics,
  QueryOptions,
  WriteTarget,
} from "./client/clickhouseClient";

export { decideRetry, isTransientTransportError } from "./client/retryPolicy";
export type { Operation, RetryDecision } from "./client/retryPolicy";

export {
  createPoolRegistry,
  mappedTenantRouter,
  sharedDatabaseRouter,
} from "./client/tenantRouting";
export type {
  PoolRegistry,
  TenantRouter,
  TenantTarget,
} from "./client/tenantRouting";

export { AppendStoreConfigurationError, createAppendStore } from "./stores/appendStore";
export type { AppendStoreArgs } from "./stores/appendStore";

export {
  createReplaceStore,
  ReplaceStoreConfigurationError,
} from "./stores/replaceStore";
export type { ReplaceStoreArgs } from "./stores/replaceStore";
