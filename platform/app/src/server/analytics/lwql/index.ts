/**
 * LangWatchQL analytics SQL — the surface the REST routes import.
 *
 * Routes reach for this barrel and nothing deeper: the catalog, the validator,
 * the provisioning statements and the executor are the service's business, not
 * a route handler's.
 *
 * @see specs/analytics/lwql-api.feature
 */

export type {
  LangWatchQLAppFunctionDefinition,
  LangWatchQLAppFunctionDefinition as LangWatchQLAppFunction,
  LangWatchQLAppFunctionEncoding,
  LangWatchQLAppFunctionKeyKind,
} from "./appFunctions/catalog";
export {
  LWQL_APP_FUNCTION_CATALOG,
  LWQL_APP_FUNCTION_ENCODINGS,
  LWQL_APP_FUNCTION_KEY_CAPS,
  LWQL_APP_FUNCTION_KEY_KINDS,
  lwqlAppFunction,
  lwqlAppFunctionCap,
  lwqlAppFunctionNames,
  lwqlAppFunctionSignature,
} from "./appFunctions/catalog";
export type {
  LangWatchQLJudgement,
  LangWatchQLJudgementReading,
} from "./appFunctions/evalCatalog";
export { instantEvalQuestionFor } from "./appFunctions/evalQuestions";
export { hydrateLangWatchQLAppFunctions } from "./appFunctions/hydrate";
export type {
  LangWatchQLEvalUsage,
  LangWatchQLHydrationResult,
} from "./appFunctions/hydration/contract";
export type {
  LangWatchQLAppFunctionCall,
  LangWatchQLAppFunctionOption,
} from "./appFunctions/plan";
export type { LangWatchQLAppFunctionTraceSource } from "./appFunctions/traceSource";
export { createLangWatchQLAppFunctionTraceSource } from "./appFunctions/traceSource";
export { lwqlTenantCapability } from "./capability";
export type { LangWatchQLColumnUnit } from "./catalog/types";
export { LWQL_COLUMN_UNITS } from "./catalog/types";
export type { LangWatchQLConnection } from "./connection";
export type {
  LangWatchQLDiagnostic,
  LangWatchQLDiagnosticCode,
} from "./diagnostics";
export {
  LWQL_CLEAN_DIAGNOSTICS_MEANING,
  LWQL_DIAGNOSTIC_CODES,
  lwqlDiagnostics,
} from "./diagnostics";
export {
  LangWatchQLAppFunctionHydrationFailedError,
  LangWatchQLAppFunctionKeyCapError,
  LangWatchQLAppFunctionUnavailableError,
  LangWatchQLParameterMissingError,
  LangWatchQLReservedParameterSuppliedError,
  LangWatchQLReservedParameterTypeError,
  LangWatchQLUnavailableError,
} from "./errors";
export type {
  LangWatchQLColumn,
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
export { MAX_LWQL_LENGTH } from "./limits";
export type {
  LangWatchQLQueryResult,
  ValidatedLangWatchQL,
} from "./lwql.service";
export {
  closeLangWatchQLService,
  createLangWatchQLService,
  DEFAULT_LWQL_DATABASE,
  getLangWatchQLService,
  LangWatchQLService,
  setLangWatchQLService,
} from "./lwql.service";
export type {
  LangWatchQLGranularityResolution,
  LangWatchQLTimeWindowResolution,
} from "./resolveTimeWindow";
export {
  resolveLangWatchQLGranularity,
  resolveLangWatchQLTimeWindow,
} from "./resolveTimeWindow";
export type {
  LangWatchQLSchema,
  LangWatchQLSchemaColumn,
  LangWatchQLSchemaDataset,
  LangWatchQLSchemaFunction,
} from "./schema";
export {
  describeLangWatchQLFunctions,
  describeLangWatchQLSchema,
  lwqlExampleSql,
} from "./schema";
export type { LangWatchQLTimeWindow } from "./timeWindow";
export {
  formatLangWatchQLDateTimeParameter,
  isLangWatchQLDateTimeParameterType,
  isLangWatchQLSurfaceParameter,
  isLangWatchQLTimeWindowParameter,
  LWQL_PERIOD_END_PARAMETER,
  LWQL_PERIOD_START_PARAMETER,
  LWQL_SURFACE_PARAMETERS,
  LWQL_TIME_WINDOW_PARAMETERS,
} from "./timeWindow";
