/** The typed ClickHouse read builder (ADR-202): one tenant scope renders predicate and setting. */
export {
  clickhouseRead,
  ClickHouseRead,
  ClickHouseReadStart,
  readerStatementOf,
  type ClickHouseReadStatement,
  type DerivedColumns,
  type MetadataReadStatement,
  type ReadOps,
  type ReaderReadStatement,
  type SystemReadStatement,
} from "./read.ts";
export {
  tenantScope,
  type AllTenantsScope,
  type ProofScope,
  type ReaderScope,
  type ServerMetadataScope,
  type SingleTenantScope,
  type TenantScope,
  type TenantSetScope,
} from "./scope.ts";
export {
  aliasOf,
  defineClickHouseTable,
  everyReplica,
  SERVER_METADATA_TABLES,
  SYSTEM_IDENTITY_TABLES,
  systemIdentityTable,
  systemTable,
  type ClickHouseTable,
  type ClickHouseTableFacts,
  type ColumnsSpec,
  type ServerMetadataTableName,
  type SystemIdentityTableName,
  type TableKind,
} from "./table.ts";
export {
  systemBackupLog,
  systemColumns,
  systemDisks,
  systemMutations,
  systemParts,
  systemPartsColumns,
  systemReplicas,
  systemServerSettings,
  systemTables,
} from "./system-tables.ts";
export { boundRows, type BoundRowColumns } from "./bound-rows.ts";
export { braidCondition } from "./braid-condition.ts";
export {
  column,
  cond,
  param,
  sql,
  type AggregateState,
  type ColumnRef,
  type ColumnType,
  type Condition,
  type ConditionOps,
  type Conditions,
  type Direction,
  type Expression,
  type JsonObject,
} from "./expression.ts";
export { fn } from "./functions.ts";
export { QueryBuilderError, type QueryBuilderViolation } from "./query-builder-error.ts";
export { REVIEWED_FRAGMENTS, type ReviewedFragmentId } from "./reviewed-fragments.ts";
