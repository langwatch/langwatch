import { availableFilters } from "~/server/filters/registry";
import type { FilterDefinition, FilterField } from "~/server/filters/types";

/**
 * One chip per condition a stored structured filter states. A keyed field
 * (`metadata.value`, `evaluations.passed`) gets one chip per key, named with
 * that key, so "Metadata · plan = true" says which metadata it reads.
 */
export type FilterChip =
  | {
      kind: "condition";
      id: string;
      label: string;
      /** The key (and subkey) a keyed field selects by; empty otherwise. */
      keys: string[];
      value: string;
    }
  | {
      kind: "unkeyed";
      id: string;
      label: string;
      /** What the missing key names, e.g. "metadata key". */
      keyNoun: string;
      /** The nested shape the condition needed, as stored JSON. */
      example: string;
    };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFilterField = (field: string): field is FilterField =>
  Object.hasOwn(availableFilters, field);

const definitionOf = (field: string): FilterDefinition | undefined =>
  isFilterField(field) ? availableFilters[field] : undefined;

/** The old label for a field the registry does not know: drop the first
 *  segment (except `evaluations`) and humanise the rest. */
function legacyLabel(field: string): string {
  const words = field
    .split(".")
    .filter((word, i) => i !== 0 || word.toLowerCase() === "evaluations")
    .join(" ")
    .replaceAll("_", " ");
  return words.replace(/\b\w/g, (c) => c.toUpperCase());
}

const labelOf = (field: string) =>
  definitionOf(field)?.name ?? legacyLabel(field);

const KEY_NOUNS: Record<string, { noun: string; placeholder: string }> = {
  "metadata.key": { noun: "metadata key", placeholder: "<metadataKey>" },
  "events.event_type": { noun: "event type", placeholder: "<eventType>" },
  "events.metrics.key": { noun: "metric", placeholder: "<metricKey>" },
};

function keyNounOf(selector: string): { noun: string; placeholder: string } {
  if (selector.startsWith("evaluations.")) {
    return { noun: "monitor", placeholder: "<monitorId>" };
  }
  return KEY_NOUNS[selector] ?? { noun: "key", placeholder: "<key>" };
}

const joinValues = (values: unknown[]) => values.map(String).join(", ");

function unkeyedChip({
  field,
  definition,
  values,
}: {
  field: string;
  definition: FilterDefinition;
  values: unknown[];
}): FilterChip {
  const key = keyNounOf(definition.requiresKey?.filter ?? "");
  const missing = definition.requiresSubkey
    ? keyNounOf(definition.requiresSubkey.filter)
    : key;
  const leaf = definition.requiresSubkey
    ? { [missing.placeholder]: values }
    : values;
  return {
    kind: "unkeyed",
    id: field,
    label: labelOf(field),
    keyNoun: missing.noun,
    example: JSON.stringify({ [field]: { [key.placeholder]: leaf } }),
  };
}

function conditionChip({
  field,
  label,
  keys,
  value,
}: {
  field: string;
  label: string;
  keys: string[];
  value: string;
}): FilterChip {
  const id = [field, ...keys].join(":");
  return { kind: "condition", id, label, keys, value };
}

/** A leaf list, or null when it states no condition (empty or not a list). */
const leafValues = (value: unknown): string | null =>
  Array.isArray(value) && value.length > 0 ? joinValues(value) : null;

function chipsUnderKey({
  field,
  label,
  key,
  inner,
}: {
  field: string;
  label: string;
  key: string;
  inner: unknown;
}): FilterChip[] {
  if (!isRecord(inner)) {
    const value = Array.isArray(inner) ? leafValues(inner) : String(inner);
    return value === null
      ? []
      : [conditionChip({ field, label, keys: [key], value })];
  }
  return Object.entries(inner).flatMap(([subKey, leaf]) => {
    const value = leafValues(leaf);
    return value === null
      ? []
      : [conditionChip({ field, label, keys: [key, subKey], value })];
  });
}

function chipsOfField(field: string, value: unknown): FilterChip[] {
  const definition = definitionOf(field);
  const label = labelOf(field);
  // An empty list states no condition, so it gets no chip.
  if (Array.isArray(value)) {
    if (value.length === 0) return [];
    if (definition?.requiresKey) {
      return [unkeyedChip({ field, definition, values: value })];
    }
    return [
      conditionChip({ field, label, keys: [], value: joinValues(value) }),
    ];
  }
  if (!isRecord(value)) {
    return [conditionChip({ field, label, keys: [], value: String(value) })];
  }
  return Object.entries(value).flatMap(([key, inner]) => {
    if (
      definition?.requiresSubkey &&
      Array.isArray(inner) &&
      inner.length > 0
    ) {
      const chip = unkeyedChip({ field, definition, values: inner });
      return [{ ...chip, id: `${field}:${key}` }];
    }
    return chipsUnderKey({ field, label, key, inner });
  });
}

/** Every chip a stored filter object (or its JSON) shows, in field order. */
export function filterChipsOf(
  filters: string | Record<string, unknown>,
): FilterChip[] {
  let parsed: unknown = filters;
  if (typeof filters === "string") {
    try {
      parsed = JSON.parse(filters);
    } catch {
      return [];
    }
  }
  if (!isRecord(parsed)) return [];
  return Object.entries(parsed).flatMap(([field, value]) =>
    chipsOfField(field, value),
  );
}
