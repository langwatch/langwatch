export { extractFreeTextTerms, translateFilterToClickHouse } from "./ast";
export {
  FIELD_DEFS,
  KNOWN_FIELDS,
  type KnownField,
} from "./build-handlers";
export {
  diagnoseFilterQueryReachability,
  evaluateQueryInMemory,
  queryNeeds,
} from "./evaluate";
export {
  type DerivedSpanRow,
  type FieldDef,
  type FieldNeeds,
  type InMemoryTrace,
  UNSUPPORTED,
} from "./field-def";
