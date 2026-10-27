/**
 * What you can filter on, written out for a model: every search field with real
 * values from the project's own facets beside it, so it need not guess `model:gpt4`.
 * Ported from main's query-language/fieldCatalogue.ts; the facet read is the caller's.
 */

import { FIELD_VALUES, isInstantEvalField, SEARCH_FIELDS } from "@langwatch/trace-contract";

/** Values fetched per categorical field before merging with the static list. */
export const DYNAMIC_VALUES_LIMIT = 20;
/** Values shown per field. Enough to establish the shape, not a data dump. */
const SAMPLES_SHOWN = 8;

/** The facet keys whose live values the catalogue shows. */
export const CATEGORICAL_FACET_KEYS: readonly string[] = Object.values(SEARCH_FIELDS).flatMap(
  (meta) => (meta.valueType === "categorical" && meta.facetField ? [meta.facetField] : []),
);

/** One line per field: `- name (valueType): label — e.g. a, b, c`. */
export function buildFieldsBlock({
  dynamicValues,
}: {
  dynamicValues: ReadonlyMap<string, readonly string[]>;
}): string {
  const lines: string[] = [];
  for (const [name, meta] of Object.entries(SEARCH_FIELDS)) {
    // An `eval` chip is a run the router decides on; the model never writes one.
    if (isInstantEvalField(name)) continue;
    const fromDb = meta.facetField ? (dynamicValues.get(meta.facetField) ?? []) : [];
    const fromStatic = FIELD_VALUES[name] ?? [];
    const sample = Array.from(new Set([...fromDb, ...fromStatic])).slice(0, SAMPLES_SHOWN);
    const sampleStr = sample.length > 0 ? ` — e.g. ${sample.join(", ")}` : "";
    lines.push(`- ${name} (${meta.valueType}): ${meta.label}${sampleStr}`);
  }
  return lines.join("\n");
}
