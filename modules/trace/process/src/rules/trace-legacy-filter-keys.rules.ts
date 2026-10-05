import { findUnkeyedFilterFields } from "@langwatch/analytics-filters";

/**
 * A keyed legacy filter sent without its key, which trace search compiles to a
 * condition matching nothing. Trace search only: analytics reads a flat
 * `evaluations.passed` list as "across every evaluator", which works.
 */
export interface UnkeyedLegacyFilter {
  field: string;
  message: string;
  received: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const SIMPLER = " The filter string is simpler:";

/**
 * The sentence pointing a flat `evaluations.passed` list at its filter-string
 * form, empty unless every value asks for the same verdict.
 */
function filterStringSentence(field: string, value: unknown): string {
  if (field !== "evaluations.passed" || !Array.isArray(value)) return "";
  if (value.every((verdict) => verdict === "false")) {
    return `${SIMPLER} filter: "evaluatorVerdict:fail".`;
  }
  if (value.every((verdict) => verdict === "true")) {
    return `${SIMPLER} filter: "evaluatorVerdict:pass".`;
  }
  return "";
}

/**
 * Every keyed legacy filter sent shallower than its key (and subkey) require.
 *
 * @param offersFilterString - whether the route also takes a `filter` string,
 *   so the message can point at the simpler form.
 */
export function findUnkeyedLegacyFilters({
  filters,
  offersFilterString,
}: {
  filters: unknown;
  offersFilterString: boolean;
}): UnkeyedLegacyFilter[] {
  if (!isRecord(filters)) return [];

  return findUnkeyedFilterFields(filters).map(({ field, example }) => {
    const received = filters[field];
    const hint = offersFilterString ? filterStringSentence(field, received) : "";
    return {
      field: `filters.${field}`,
      message: `"${field}" needs its key, as in ${example}. Without the key it matches no trace.${hint}`,
      received,
    };
  });
}
