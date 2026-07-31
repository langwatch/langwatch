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

export type {
  ClickHouseClient,
  ClickHouseClientConfig,
  ClickHouseQueryResult,
  ClickHouseRawCommand,
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
export {
  ClickHouseOperationError,
  createClickHouseClient,
} from "./client/clickhouseClient";
export type { Operation, RetryDecision } from "./client/retryPolicy";
export { decideRetry, isTransientTransportError } from "./client/retryPolicy";
export type {
  PoolRegistry,
  TenantRouter,
  TenantTarget,
} from "./client/tenantRouting";
export {
  createPoolRegistry,
  mappedTenantRouter,
  sharedDatabaseRouter,
} from "./client/tenantRouting";
export {
  CLICKHOUSE_TRANSIENT_MESSAGE_FRAGMENTS,
  isTransientClickHouseMessage,
} from "./client/transientErrors";
export type { WireCodec, WireColumn } from "./codec/rowCodec";
export { createRowCodec, WireShapeMismatchError } from "./codec/rowCodec";
export type { BoundIdentifiers } from "./query/identifiers";
export { bindIdentifiers } from "./query/identifiers";
export type {
  AnyColumnDef,
  ColumnDef,
  ColumnMap,
  TimeRole,
} from "./schema/columns";
export {
  ColumnDecodeError,
  ch,
} from "./schema/columns";
export type {
  MergeIdempotency,
  MergeStrategy,
  StructuralDebt,
  TableDefinition,
  TableDefinitionArgs,
  TableDescription,
  TableRow,
} from "./schema/defineTable";
export {
  aggregating,
  append,
  defineTable,
  replacing,
  TableDefinitionError,
} from "./schema/defineTable";
export type { ClickHouseAppendArgs } from "./stores/appendStore";
export {
  AppendStoreConfigurationError,
  clickhouseAppend,
} from "./stores/appendStore";
export { clickhouseEventLog } from "./stores/eventLogStore";
export type {
  ClickHouseReplacingArgs,
  FoldStateCache,
} from "./stores/replaceStore";
export {
  clickhouseReplacing,
  noFoldStateCache,
  ReplaceStoreConfigurationError,
} from "./stores/replaceStore";
export type { RowContext, RowMapping } from "./stores/rowMapping";
export {
  deriveAppendMapping,
  deriveRowMapping,
  RowMappingError,
} from "./stores/rowMapping";
export type { EventLogRow } from "./tables/eventLog";
export { eventLogTable } from "./tables/eventLog";
export { SecurityError, validateTenantId } from "./tenancy";
