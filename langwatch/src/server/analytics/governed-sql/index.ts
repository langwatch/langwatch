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
export {
  GovernedSqlParameterMissingError,
  GovernedSqlUnavailableError,
} from "./errors";
export {
  DEFAULT_GOVERNED_SQL_RESULT_LIMITS,
  applyGovernedResultLimits,
  createGovernedSqlExecutor,
  governedSqlConnectionFromEnv,
} from "./executor";
export type {
  GovernedSqlColumn,
  GovernedSqlConnection,
  GovernedSqlExecutor,
  GovernedSqlResultLimits,
  GovernedSqlStatistics,
} from "./executor";
export {
  DEFAULT_GOVERNED_DATABASE,
  GovernedSqlService,
  createGovernedSqlService,
  getGovernedSqlService,
  setGovernedSqlService,
} from "./governedSql.service";
export type {
  GovernedSqlDiagnostic,
  GovernedSqlQueryResult,
} from "./governedSql.service";
export { describeGovernedSchema, governedExampleSql } from "./schema";
export type {
  GovernedSchema,
  GovernedSchemaColumn,
  GovernedSchemaDataset,
} from "./schema";
