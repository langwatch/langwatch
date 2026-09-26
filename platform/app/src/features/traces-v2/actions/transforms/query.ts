import {
  addSameFieldOrValue,
  addToOrGroupAtLocation,
  combineQueries,
  removeFacetValueFromQuery,
  toggleFacetInQuery,
} from "~/server/app-layer/traces/query-language/mutations";
import {
  isEmptyAST,
  parse,
  serialize,
} from "~/server/app-layer/traces/query-language/parse";
import {
  getFacetValueState,
  validateAst,
} from "~/server/app-layer/traces/query-language/queries";
import {
  type SetFilterPayload,
  setFilterPayloadSchema,
  type ToggleFacetPayload,
  toggleFacetPayloadSchema,
} from "../schemas";
import { ExplorerTransformError, type Transform } from "./types";

/**
 * The query as the store would hold it: parsed, checked against the
 * language's own limits, and serialised back to its canonical text.
 */
function canonicalQuery(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  let ast: ReturnType<typeof parse>;
  try {
    ast = parse(trimmed);
  } catch (error) {
    throw new ExplorerTransformError({
      code: "filter_invalid",
      message:
        error instanceof Error ? error.message : "The filter did not parse.",
      meta: { query: trimmed },
    });
  }
  const refusal = validateAst(ast);
  if (refusal) {
    throw new ExplorerTransformError({
      code: "filter_invalid",
      message: refusal,
      meta: { query: trimmed },
    });
  }
  return isEmptyAST(ast) ? "" : serialize(ast);
}

/** Set the query, or join a filter to the one on screen. */
export const setFilter: Transform<SetFilterPayload, { query: string }> = ({
  state,
  payload,
}) => {
  const { query, mode } = setFilterPayloadSchema.parse(payload);
  const next = canonicalQuery(
    mode === "add"
      ? combineQueries({ base: state.queryText, addition: query })
      : query,
  );
  return {
    state: { ...state, queryText: next, page: 1 },
    result: { query: next },
  };
};

/**
 * The query after one click on a sidebar value.
 *
 * A value steps from neutral to included to excluded and back. Adding a value
 * follows faceted-search semantics: a second value of the same field joins
 * the first with OR, because a field cannot equal two values at once, and a
 * value of another field narrows with AND. `orGroupLocation` splices the value
 * into an OR group the query already has, and `combinator: "OR"` opens a fresh
 * top-level OR across fields instead.
 */
export function toggledFacetQuery({
  queryText,
  field,
  value,
  combinator,
  orGroupLocation,
}: {
  queryText: string;
  field: string;
  value: string;
  combinator?: "AND" | "OR";
  orGroupLocation?: { start: number; end: number };
}): string {
  const current = facetStateIn({ queryText, field, value });
  if (current === "neutral" && orGroupLocation) {
    return addToOrGroupAtLocation({
      currentQuery: queryText,
      groupStart: orGroupLocation.start,
      groupEnd: orGroupLocation.end,
      fieldName: field,
      value,
    });
  }
  if (current === "neutral" && combinator !== "OR") {
    return addSameFieldOrValue({
      currentQuery: queryText,
      fieldName: field,
      value,
    });
  }
  return toggleFacetInQuery({
    currentQuery: queryText,
    fieldName: field,
    value,
    currentState: current,
    combinator: combinator ?? "AND",
  });
}

/**
 * The query with one value forced to excluded, or back to neutral when it
 * already was.
 */
export function excludedFacetQuery({
  queryText,
  field,
  value,
}: {
  queryText: string;
  field: string;
  value: string;
}): string {
  if (facetStateIn({ queryText, field, value }) === "exclude") {
    return removeFacetValueFromQuery({
      currentQuery: queryText,
      fieldName: field,
      value,
    });
  }
  // `currentState: "include"` strips any clause for the value first and then
  // appends its negation, which is "make it excluded" from either start.
  return toggleFacetInQuery({
    currentQuery: queryText,
    fieldName: field,
    value,
    currentState: "include",
  });
}

function facetStateIn({
  queryText,
  field,
  value,
}: {
  queryText: string;
  field: string;
  value: string;
}): ReturnType<typeof getFacetValueState> {
  const trimmed = queryText.trim();
  if (!trimmed) return "neutral";
  try {
    return getFacetValueState(parse(trimmed), field, value);
  } catch {
    return "neutral";
  }
}

/** One click on a sidebar value. */
export const toggleFacet: Transform<ToggleFacetPayload, { query: string }> = ({
  state,
  payload,
}) => {
  const { field, value, exclude } = toggleFacetPayloadSchema.parse(payload);
  const args = { queryText: state.queryText, field, value };
  const next = canonicalQuery(
    exclude ? excludedFacetQuery(args) : toggledFacetQuery(args),
  );
  return {
    state: { ...state, queryText: next, page: 1 },
    result: { query: next },
  };
};
