/**
 * The trace filter language at the API-key boundary.
 *
 * The language itself lives in `~/server/app-layer/traces/query-language` and
 * `.../filter-to-clickhouse`, and reached only tRPC until now: an API-key
 * caller had the legacy filter map and a free-text query, which is most of why
 * agents invent field names — the richer language was there and unreachable.
 *
 * Two jobs here, both of them boundary work rather than language work.
 *
 * **Compile, don't forward.** The datastore layer takes a parameterized
 * condition, never the string: a parse failure has to become a 422 that names
 * the offending field, and a rejection raised behind a datastore call can only
 * surface as a 500.
 *
 * **Refuse in the caller's vocabulary.** `FilterParseError` and
 * `FilterFieldUnknownError` are already handled errors with the field and the
 * known-field list in their `meta`, but they are the *language's* codes, raised
 * from a filter the browser composed clause by clause. Over REST the filter is
 * one string in a request body, so it is a field of that body that is wrong,
 * and the canonical answer for that is `validation_error` with the path — the
 * same shape an unknown `select` path already answers with on this route.
 *
 * @see ../../../../server/app-layer/traces/query-language/grammar.ts — the syntax
 * @see specs/traces/trace-filter-api.feature
 */

import { RequestValidationError } from "~/server/api/validation";
import {
  FilterFieldUnknownError,
  FilterParseError,
} from "~/server/app-layer/traces/errors";
import { translateFilterToClickHouse } from "~/server/app-layer/traces/filter-to-clickhouse/ast";
import { KNOWN_FIELDS } from "~/server/app-layer/traces/filter-to-clickhouse/build-handlers";

/**
 * Longest filter string the boundary accepts.
 *
 * A shape ceiling, not a cost one: the translator already refuses a query past
 * its node and parameter ceilings, and this only keeps pathological input away
 * from a parser fed an attacker-controlled string. Far above any filter the
 * search bar composes.
 */
export const MAX_TRACE_FILTER_LENGTH = 4_000;

/** The body field a refusal points at. */
const FILTER_FIELD = "filter";

/**
 * Compiles a filter string into the condition the trace read appends, or
 * `undefined` when there is nothing to filter on.
 *
 * An absent filter and an empty one are the same request — a caller building
 * the body from optional parts should not have to strip the key to mean "no
 * filter", and the translator already answers `null` for whitespace.
 *
 * @throws RequestValidationError 422, naming `filter` and — for an unknown
 *   field — the fields the language does have.
 */
export function compileTraceFilter({
  filter,
  tenantId,
  timeRange,
}: {
  filter: string | undefined;
  tenantId: string;
  timeRange: { from: number; to: number };
}): { sql: string; params: Record<string, unknown> } | undefined {
  if (!filter || filter.trim().length === 0) return undefined;
  try {
    return (
      translateFilterToClickHouse(filter, tenantId, timeRange) ?? undefined
    );
  } catch (error) {
    if (error instanceof FilterFieldUnknownError) {
      const field = error.meta?.field;
      throw new RequestValidationError({
        target: "json",
        violations: [
          {
            field: FILTER_FIELD,
            type: "unknown_filter_field",
            message: `The filter names a field this language does not have: ${String(field)}. See GET /api/v1/query/reference for every field, and GET /api/traces/facets for the values one holds.`,
            expected: KNOWN_FIELDS,
            received: field,
          },
        ],
      });
    }
    if (error instanceof FilterParseError) {
      throw new RequestValidationError({
        target: "json",
        violations: [
          {
            field: FILTER_FIELD,
            type: "invalid_filter_syntax",
            message: `${error.message}. Operators must be uppercase (AND, OR, NOT), every clause needs a value, and a value with spaces must be quoted.`,
            received: filter,
          },
        ],
      });
    }
    throw error;
  }
}
