import { findUnkeyedFilterFields } from "@langwatch/analytics-filters";
import type { FieldViolation } from "@langwatch/api/rest";

/**
 * A keyed legacy filter (`evaluations.passed` under a monitor id) sent as a flat list matches
 * no trace, so trace search refuses it naming the field (#8336). Trace search only: analytics
 * reads a flat `evaluations.passed` list as "across every evaluator" and must keep accepting it.
 */
type LegacyFilters = Readonly<Record<string, unknown>> | undefined;

/** The filter-string form of a flat verdict list, only when every value asks for one verdict. */
function verdictHintSentence({ field, value }: { field: string; value: unknown }): string {
  if (field !== "evaluations.passed" || !Array.isArray(value)) return "";
  const simpler = (verdict: string) => ` The filter string is simpler: filter: "${verdict}".`;
  if (value.every((verdict) => verdict === "false")) return simpler("evaluatorVerdict:fail");
  if (value.every((verdict) => verdict === "true")) return simpler("evaluatorVerdict:pass");
  return "";
}

/**
 * One violation per keyed field sent shallower than its key (and subkey) require.
 * `/api/traces/search` throws them as a 422; `/api/trace/search` answers `400 { error }`.
 */
export function unkeyedLegacyFilterViolations({
  filters,
  offersFilterString,
}: {
  filters: LegacyFilters;
  offersFilterString: boolean;
}): FieldViolation[] {
  if (!filters) return [];
  return findUnkeyedFilterFields(filters).map(({ field, example }) => {
    const received = filters[field];
    const hint = offersFilterString ? verdictHintSentence({ field, value: received }) : "";
    return {
      field: `filters.${field}`,
      type: "filter_key_required",
      message: `"${field}" needs its key, as in ${example}. Without the key it matches no trace.${hint}`,
      received,
    };
  });
}
