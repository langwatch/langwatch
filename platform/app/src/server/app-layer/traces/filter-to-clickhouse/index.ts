export {
  extractFreeTextTerms,
  type FilterTagTranslator,
  queryNamesField,
  translateFilterAst,
  translateFilterToClickHouse,
  translateFilterWithEvalRuns,
} from "./ast";
export {
  FIELD_DEFS,
  KNOWN_FIELDS,
  type KnownField,
} from "./build-handlers";
export { evaluateQueryInMemory, queryNeeds } from "./evaluate";
export {
  createFacetFilterCompiler,
  type FacetFilterWhere,
  queryNamesFacet,
  queryWithoutFacet,
} from "./facet-filter";
export {
  type DerivedSpanRow,
  type FieldDef,
  type FieldNeeds,
  type InMemoryTrace,
  UNSUPPORTED,
} from "./field-def";
export type { ResolvedInstantEvalRun } from "./instant-eval-field";
