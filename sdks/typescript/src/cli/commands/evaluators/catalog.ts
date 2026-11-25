/**
 * Catalog validated by CLI; synced with platform at build via copy-types.sh.
 * Fails before network: if slug is wrong, closest matches and command to list
 * all types are shown immediately (see server/evaluations/evaluators.ts).
 */
import { AVAILABLE_EVALUATORS } from "@/internal/generated/types/evaluators.generated";
import { NATIVE_EVALUATOR_DEFINITIONS } from "@/internal/generated/types/evaluators.native";

interface CatalogDefinition {
  name: string;
  description: string;
  category: string;
  isGuardrail: boolean;
}

/** One catalog row, shaped for listing and for machine consumption. */
export interface EvaluatorTypeEntry {
  slug: string;
  name: string;
  category: string;
  isGuardrail: boolean;
  description: string;
}

const catalog: Record<string, CatalogDefinition> = {
  ...(AVAILABLE_EVALUATORS as unknown as Record<string, CatalogDefinition>),
  ...(NATIVE_EVALUATOR_DEFINITIONS as unknown as Record<string, CatalogDefinition>),
};

/** Every evaluator type the platform accepts, sorted by slug. */
export const evaluatorTypeCatalog = (): EvaluatorTypeEntry[] =>
  Object.entries(catalog)
    .map(([slug, def]) => ({
      slug,
      name: def.name,
      category: def.category,
      isGuardrail: def.isGuardrail,
      description: def.description.trim().split("\n")[0] ?? "",
    }))
    .toSorted((a, b) => a.slug.localeCompare(b.slug));

export const isValidEvaluatorType = (slug: string): boolean => slug in catalog;

/**
 * Catalog slugs closest to a miss via Levenshtein distance.
 * Handles stale renames like "ragas/answer_relevancy".
 */
export const closestEvaluatorTypes = (input: string, count = 5): string[] =>
  Object.keys(catalog)
    .map((slug) => ({ slug, distance: levenshtein(input, slug) }))
    .toSorted((a, b) => a.distance - b.distance || a.slug.localeCompare(b.slug))
    .slice(0, count)
    .map((entry) => entry.slug);

/** Iterative two-row Levenshtein — the catalog is ~40 slugs, cost is nothing. */
const levenshtein = (a: string, b: string): number => {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length]!;
};
