/**
 * The legacy `filters` map at the trace-search boundary: `POST
 * /api/traces/search` and the deprecated `POST /api/trace/search`.
 *
 * Some of its fields are keyed: `evaluations.passed` filters one monitor's
 * verdict, so its values sit under that monitor's id —
 * `{"evaluations.passed": {"<monitorId>": ["false"]}}`. The request schema
 * accepts a flat list for every field, and the condition builder answers a
 * keyed field that arrives without its key with a condition that matches
 * nothing. Over REST that is a search returning zero traces with a 200, which
 * reads as "no trace failed" rather than "your request was malformed".
 *
 * So a keyed field sent without its key is refused here, naming the field.
 *
 * Trace search only. Analytics translates the same map differently: there a
 * flat `evaluations.passed` list means "across every evaluator" and works, so
 * refusing it would break a valid request.
 */

import {
  type FieldViolation,
  RequestValidationError,
} from "~/server/api/validation";
import { findUnkeyedFilterFields } from "./trigger-filter-shape";
import type { FilterField } from "./types";

/** A filter-string equivalent worth pointing at, for the fields that have one. */
const FILTER_STRING_HINTS: Partial<Record<FilterField, string>> = {
  "evaluations.passed": 'filter: "evaluatorVerdict:fail"',
};

/**
 * Refuses a trace search whose keyed filter fields arrive shallower than their
 * key requires, instead of letting them match nothing.
 *
 * @param offersFilterString - whether the route also takes a `filter` string,
 *   so the refusal can point at the simpler form.
 * @throws RequestValidationError 422, one violation per keyed field sent
 *   shallower than its key (and subkey) require.
 */
export function assertLegacyFiltersKeyed({
  filters,
  offersFilterString,
}: {
  filters: Partial<Record<FilterField, unknown>> | undefined;
  offersFilterString: boolean;
}): void {
  const violations = unkeyedFilterViolations({ filters, offersFilterString });
  if (violations.length > 0) {
    throw new RequestValidationError({ target: "json", violations });
  }
}

/**
 * The same refusal as a sentence, for the deprecated routes that answer a
 * malformed body with `400 { error }` rather than a handled error.
 */
export function legacyFiltersKeyedRefusal(
  filters: Partial<Record<FilterField, unknown>> | undefined,
): string | undefined {
  const violations = unkeyedFilterViolations({
    filters,
    offersFilterString: false,
  });
  if (violations.length === 0) return undefined;
  return violations.map((violation) => violation.message).join(" ");
}

/** Built on the automations API's detector, so both answer the same shapes. */
function unkeyedFilterViolations({
  filters,
  offersFilterString,
}: {
  filters: Partial<Record<FilterField, unknown>> | undefined;
  offersFilterString: boolean;
}): FieldViolation[] {
  if (!filters) return [];

  return findUnkeyedFilterFields(filters).map(({ field, example }) => {
    const hint = offersFilterString
      ? FILTER_STRING_HINTS[field as FilterField]
      : undefined;
    return {
      field: `filters.${field}`,
      type: "filter_key_required",
      message: `"${field}" needs its key, as in ${example}. Without the key it matches no trace.${hint ? ` The filter string is simpler: ${hint}.` : ""}`,
      received: filters[field as FilterField],
    };
  });
}
