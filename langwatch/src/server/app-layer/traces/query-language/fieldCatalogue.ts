/**
 * What you can actually filter on, written out for a reader that is a model.
 *
 * `SEARCH_FIELDS` names the fields; this puts REAL VALUES next to them, pulled
 * live from the project's own facets. That difference is most of the accuracy:
 * a model told `model (categorical): Model` guesses `model:gpt4`, and a model
 * told `model (categorical): Model — e.g. gpt-5-mini, claude-opus-4-8` does not
 * have to guess at all. Values come from the caller's time range, so what it is
 * shown is what is actually there to be found.
 *
 * Extracted from `ai-query.ts`, which is its only caller today: the Trace
 * Explorer's Ask AI. A second reader for the same block — a query reference for
 * the CLI, describing the same language to the same kind of reader — was the
 * reason for extracting it and has not been built, so this is one definition
 * with one consumer, not yet a shared one.
 */
import { getApp } from "~/server/app-layer/app";
import { FIELD_VALUES, SEARCH_FIELDS } from "./metadata";

/** Values fetched per categorical field before merging with the static list. */
const DYNAMIC_VALUES_LIMIT = 20;
/** Values shown per field. Enough to establish the shape, not a data dump. */
const SAMPLES_SHOWN = 8;

export interface FieldCatalogueInput {
  projectId: string;
  timeRange: { from: number; to: number };
}

/** One line per field: `- name (valueType): label — e.g. a, b, c`. */
export async function buildFieldsBlock(
  input: FieldCatalogueInput,
): Promise<string> {
  const dynamicValues = await fetchDynamicCategoricalValues(input);
  const lines: string[] = [];
  for (const [name, meta] of Object.entries(SEARCH_FIELDS)) {
    const sample = pickSampleValues(name, meta.facetField, dynamicValues);
    const sampleStr = sample.length > 0 ? ` — e.g. ${sample.join(", ")}` : "";
    lines.push(`- ${name} (${meta.valueType}): ${meta.label}${sampleStr}`);
  }
  return lines.join("\n");
}

function pickSampleValues(
  fieldName: string,
  facetField: string | undefined,
  dynamic: Map<string, string[]>,
): string[] {
  const fromDb = facetField ? (dynamic.get(facetField) ?? []) : [];
  const fromStatic = FIELD_VALUES[fieldName] ?? [];
  return Array.from(new Set([...fromDb, ...fromStatic])).slice(0, SAMPLES_SHOWN);
}

/**
 * `allSettled`, deliberately: one slow or failing facet must degrade that
 * field's examples, never the whole reference. A catalogue missing its sample
 * values is worse than one with them and far better than an error.
 */
async function fetchDynamicCategoricalValues(
  input: FieldCatalogueInput,
): Promise<Map<string, string[]>> {
  const app = getApp();
  const facetFields = Object.values(SEARCH_FIELDS)
    .filter((meta) => meta.valueType === "categorical" && meta.facetField)
    .map((meta) => meta.facetField as string);

  const results = await Promise.allSettled(
    facetFields.map((facetKey) =>
      app.traces.list.getFacetValues({
        tenantId: input.projectId,
        timeRange: input.timeRange,
        facetKey,
        limit: DYNAMIC_VALUES_LIMIT,
        offset: 0,
      }),
    ),
  );

  const map = new Map<string, string[]>();
  results.forEach((result, idx) => {
    const facetKey = facetFields[idx];
    if (!facetKey) return;
    if (result.status === "fulfilled") {
      map.set(
        facetKey,
        result.value.values.map((v) => v.value),
      );
    }
  });
  return map;
}
