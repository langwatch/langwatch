/**
 * The query reference — the one door that describes both query languages.
 *
 * Routes and tools reach for this barrel and nothing deeper.
 *
 * @see specs/analytics/query-reference.feature
 */

export type {
  QueryLanguage,
  QueryReference,
  QueryReferenceDecision,
  QueryReferenceDynamicPrefix,
  QueryReferenceEndpoint,
  QueryReferenceExample,
  QueryReferenceFilterField,
  QueryReferenceLangWatchQL,
  QueryReferenceTraceFilter,
} from "./describe-query-reference";
export {
  describeQueryReference,
  QUERY_REFERENCE_VERSION,
} from "./describe-query-reference";
