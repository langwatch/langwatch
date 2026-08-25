/**
 * LangWatchQL analytics SQL — the surface the REST routes import.
 *
 * Routes reach for this barrel and nothing deeper: the catalog, the validator,
 * the provisioning statements and the executor are the service's business, not
 * a route handler's.
 *
 * @see specs/analytics/lwql-api.feature
 */

export { lwqlTenantCapability } from "./capability";
export type { LangWatchQLColumnUnit } from "./catalog/types";
export { LWQL_COLUMN_UNITS } from "./catalog/types";
export type { LangWatchQLDiagnostic, LangWatchQLDiagnosticCode } from "./diagnostics";
export {
  LWQL_CLEAN_DIAGNOSTICS_MEANING,
  LWQL_DIAGNOSTIC_CODES,
  lwqlDiagnostics,
} from "./diagnostics";
export {
  LangWatchQLParameterMissingError,
  LangWatchQLReservedParameterSuppliedError,
  LangWatchQLReservedParameterTypeError,
  LangWatchQLUnavailableError,
} from "./errors";
export type {
  LangWatchQLColumn,
  LangWatchQLConnection,
  LangWatchQLExecutor,
  LangWatchQLResultLimits,
  LangWatchQLStatistics,
} from "./executor";
export {
  applyLangWatchQLResultLimits,
  createLangWatchQLExecutor,
  DEFAULT_LWQL_RESULT_LIMITS,
  lwqlConnectionFromEnv,
} from "./executor";
export type { LangWatchQLQueryResult, ValidatedLangWatchQL } from "./lwql.service";
export {
  closeLangWatchQLService,
  createLangWatchQLService,
  DEFAULT_LWQL_DATABASE,
  getLangWatchQLService,
  LangWatchQLService,
  setLangWatchQLService,
} from "./lwql.service";
export type { LangWatchQLTimeWindowResolution } from "./resolveTimeWindow";
export { resolveLangWatchQLTimeWindow } from "./resolveTimeWindow";
export type {
  LangWatchQLSchema,
  LangWatchQLSchemaColumn,
  LangWatchQLSchemaDataset,
} from "./schema";
export { describeLangWatchQLSchema, lwqlExampleSql } from "./schema";
export { MAX_LWQL_LENGTH } from "./sqlText";
export type { LangWatchQLTimeWindow } from "./timeWindow";
export {
  formatLangWatchQLDateTimeParameter,
  isLangWatchQLDateTimeParameterType,
  isLangWatchQLTimeWindowParameter,
  LWQL_PERIOD_END_PARAMETER,
  LWQL_PERIOD_START_PARAMETER,
  LWQL_TIME_WINDOW_PARAMETERS,
} from "./timeWindow";
