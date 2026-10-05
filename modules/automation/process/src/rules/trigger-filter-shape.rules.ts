import { availableFilters, isFilterField } from "@langwatch/analytics-filters";

/** One id an evaluation condition selects results by, and where it sits. */
export interface EvaluationFilterReference {
  field: string;
  id: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The ids one evaluation field selects results by. */
const referencedIds = ({ field, value }: { field: string; value: unknown }): string[] => {
  const keyedByMonitor =
    isFilterField(field) &&
    (availableFilters[field].requiresKey?.filter.startsWith("evaluations.") ?? false);
  if (keyedByMonitor) return isRecord(value) ? Object.keys(value) : [];
  if (!field.startsWith("evaluations.evaluator_id") || !Array.isArray(value)) return [];
  return value.filter((id): id is string => typeof id === "string");
};

/**
 * Every id an evaluation condition selects results by: the keys of the keyed
 * fields (`evaluations.passed` and its siblings) and the listed ids of the
 * `evaluations.evaluator_id*` fields. Results carry the monitor's id.
 */
export function findEvaluationFilterReferences(
  filters: Record<string, unknown>,
): EvaluationFilterReference[] {
  return Object.entries(filters).flatMap(([field, value]) =>
    isFilterField(field) ? referencedIds({ field, value }).map((id) => ({ field, id })) : [],
  );
}
