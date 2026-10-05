import { availableFilters } from "./registry";
import type { FilterDefinition, FilterField } from "./types";

/** A keyed field written without its key, and the shape it should have had. */
export interface UnkeyedFilterField {
  field: string;
  example: string;
}

/** One id an evaluation condition selects results by, and where it sits. */
export interface EvaluationFilterReference {
  field: string;
  id: string;
}

const isFilterField = (field: string): field is FilterField =>
  Object.hasOwn(availableFilters, field);

const definitionOf = (field: string): FilterDefinition | undefined =>
  isFilterField(field) ? availableFilters[field] : undefined;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyArray = (value: unknown): value is unknown[] =>
  Array.isArray(value) && value.length > 0;

/** What a caller writes in place of the key a field is selected by. */
const placeholderFor = (selector: FilterField): string => {
  if (selector.startsWith("evaluations.")) return "<monitorId>";
  if (selector === "metadata.key") return "<metadataKey>";
  if (selector === "events.event_type") return "<eventType>";
  if (selector === "events.metrics.key") return "<metricKey>";
  return "<key>";
};

const exampleFor = ({
  field,
  keySelector,
  definition,
  values,
}: {
  field: string;
  keySelector: FilterField;
  definition: FilterDefinition;
  values: unknown[];
}): string => {
  const key = placeholderFor(keySelector);
  const leaf = definition.requiresSubkey
    ? { [placeholderFor(definition.requiresSubkey.filter)]: values }
    : values;
  return JSON.stringify({ [field]: { [key]: leaf } });
};

/** The values a keyed field states one level too shallow, if it does. */
const valuesMissingAKey = ({
  definition,
  value,
}: {
  definition: FilterDefinition;
  value: unknown;
}): unknown[] | undefined => {
  if (isNonEmptyArray(value)) return value;
  if (!definition.requiresSubkey || !isRecord(value)) return undefined;
  return Object.values(value).find(isNonEmptyArray);
};

/**
 * Keyed fields written as a bare list. `{"evaluations.passed":["false"]}`
 * names no monitor, so the matcher can never select a result by it and the
 * condition matches nothing. An empty list states no condition and passes.
 */
export function findUnkeyedFilterFields(
  filters: Record<string, unknown>,
): UnkeyedFilterField[] {
  const unkeyed: UnkeyedFilterField[] = [];
  for (const [field, value] of Object.entries(filters)) {
    const definition = definitionOf(field);
    const keySelector = definition?.requiresKey?.filter;
    if (!definition || !keySelector) continue;
    const values = valuesMissingAKey({ definition, value });
    if (!values) continue;
    unkeyed.push({
      field,
      example: exampleFor({ field, keySelector, definition, values }),
    });
  }
  return unkeyed;
}

/** The ids one evaluation field selects results by. */
const referencedIds = ({
  field,
  value,
}: {
  field: string;
  value: unknown;
}): string[] => {
  const keyedByMonitor =
    definitionOf(field)?.requiresKey?.filter.startsWith("evaluations.") ??
    false;
  if (keyedByMonitor) return isRecord(value) ? Object.keys(value) : [];
  if (!field.startsWith("evaluations.evaluator_id") || !Array.isArray(value)) {
    return [];
  }
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
    isFilterField(field)
      ? referencedIds({ field, value }).map((id) => ({ field, id }))
      : [],
  );
}
