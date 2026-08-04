/**
 * Governed analytics SQL — the surface the REST routes import.
 *
 * Routes reach for this barrel and nothing deeper: the catalog, the validator,
 * the provisioning statements and the executor are the service's business, not
 * a route handler's.
 *
 * @see specs/analytics/governed-sql-api.feature
 */

export { governedTenantCapability } from "./capability";
export type { GovernedColumnUnit } from "./catalog/types";
export { GOVERNED_COLUMN_UNITS } from "./catalog/types";
export type {
  GovernedSqlDiagnostic,
  GovernedSqlDiagnosticCode,
} from "./diagnostics";
export {
  GOVERNED_SQL_CLEAN_DIAGNOSTICS_MEANING,
  GOVERNED_SQL_DIAGNOSTIC_CODES,
  governedSqlDiagnostics,
} from "./diagnostics";
export {
  GovernedSqlParameterMissingError,
  GovernedSqlUnavailableError,
} from "./errors";
export type {
  GovernedSqlColumn,
  GovernedSqlConnection,
  GovernedSqlExecutor,
  GovernedSqlResultLimits,
  GovernedSqlStatistics,
} from "./executor";
export {
  applyGovernedResultLimits,
  createGovernedSqlExecutor,
  DEFAULT_GOVERNED_SQL_RESULT_LIMITS,
  governedSqlConnectionFromEnv,
} from "./executor";
export type { GovernedSqlQueryResult } from "./governedSql.service";
export {
  createGovernedSqlService,
  DEFAULT_GOVERNED_DATABASE,
  GovernedSqlService,
  getGovernedSqlService,
  setGovernedSqlService,
} from "./governedSql.service";
export type {
  GovernedSchema,
  GovernedSchemaColumn,
  GovernedSchemaDataset,
} from "./schema";
export { describeGovernedSchema, governedExampleSql } from "./schema";
