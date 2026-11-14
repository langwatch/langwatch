/** The typed ClickHouse read builder (ADR-202): one tenant scope renders predicate and setting. */
export {
  clickhouseRead,
  ClickHouseRead,
  ClickHouseReadStart,
  readerStatementOf,
  type ClickHouseReadStatement,
  type DerivedColumns,
  type MetadataReadStatement,
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
  SERVER_METADATA_TABLES,
  systemTable,
  type ClickHouseTable,
  type ClickHouseTableFacts,
  type ColumnsSpec,
  type ServerMetadataTableName,
  type TableKind,
} from "./table.ts";
export { systemColumns, systemReplicas, systemServerSettings } from "./system-tables.ts";
export {
  column,
  param,
  sql,
  type ColumnRef,
  type ColumnType,
  type Condition,
  type ConditionOps,
  type Direction,
  type Expression,
} from "./expression.ts";
export { fn } from "./functions.ts";
export { QueryBuilderError, type QueryBuilderViolation } from "./query-builder-error.ts";
export { REVIEWED_FRAGMENTS, type ReviewedFragmentId } from "./reviewed-fragments.ts";
