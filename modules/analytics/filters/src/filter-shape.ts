import { availableFilters } from "./registry.ts";
import type { FilterDefinition, FilterField } from "./types.ts";

/** A keyed field written without its key, and the shape it should have had. */
export interface UnkeyedFilterField {
  field: string;
  example: string;
}

/** Whether a name is a field of the filter registry; an own key, never a prototype member. */
export const isFilterField = (field: string): field is FilterField =>
  Object.hasOwn(availableFilters, field);

const definitionsOf = (field: string): FilterDefinition[] =>
  isFilterField(field) ? [availableFilters[field]] : [];

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
}): unknown[] => {
  if (isNonEmptyArray(value)) return value;
  if (!definition.requiresSubkey || !isRecord(value)) return [];
  return Object.values(value).find(isNonEmptyArray) ?? [];
};

/**
 * Keyed fields written as a bare list. `{"evaluations.passed":["false"]}`
 * names no monitor, so the matcher can never select a result by it and the
 * condition matches nothing. An empty list states no condition and passes.
 */
export function findUnkeyedFilterFields(filters: Record<string, unknown>): UnkeyedFilterField[] {
  return Object.entries(filters).flatMap(([field, value]) =>
    definitionsOf(field).flatMap((definition) => {
      const keySelector = definition.requiresKey?.filter;
      if (!keySelector) return [];
      const values = valuesMissingAKey({ definition, value });
      if (values.length === 0) return [];
      return [{ field, example: exampleFor({ field, keySelector, definition, values }) }];
    }),
  );
}
