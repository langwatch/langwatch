/** The typed ClickHouse read builder (ADR-202): one tenant scope renders predicate and setting. */
export {
  clickhouseRead,
  ClickHouseRead,
  ClickHouseReadStart,
  readerStatementOf,
  type ClickHouseReadStatement,
  type ReaderReadStatement,
  type SystemReadStatement,
} from "./read.ts";
export {
  tenantScope,
  type AllTenantsScope,
  type ProofScope,
  type ReaderScope,
  type SingleTenantScope,
  type TenantScope,
  type TenantSetScope,
} from "./scope.ts";
export {
  defineClickHouseTable,
  type ClickHouseTable,
  type ClickHouseTableFacts,
  type ColumnsSpec,
} from "./table.ts";
export {
  column,
  fn,
  sql,
  type ColumnRef,
  type ColumnType,
  type Condition,
  type ConditionOps,
  type Expression,
} from "./expression.ts";
export { QueryBuilderError, type QueryBuilderViolation } from "./query-builder-error.ts";
export { REVIEWED_FRAGMENTS, type ReviewedFragmentId } from "./reviewed-fragments.ts";
