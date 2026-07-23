/**
 * The evaluator-type catalog the CLI validates against — the SAME two sources
 * the platform's create route accepts, merged the same way (see the app's
 * `server/evaluations/evaluators.ts`): the generated langevals catalog plus
 * the hand-written native evaluators. Both modules are copied verbatim out of
 * the platform by copy-types.sh at build, so this cannot drift from the API
 * by hand-maintenance — only by not rebuilding.
 *
 * Why the CLI validates at all: an agent that invents a type slug used to
 * spend a network round-trip to learn "no", with the valid set nowhere in
 * sight. Failing before the request, with the closest real slugs in hand,
 * turns that dead end into a one-step correction.
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
  ...(NATIVE_EVALUATOR_DEFINITIONS as unknown as Record<
    string,
    CatalogDefinition
  >),
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
    .sort((a, b) => a.slug.localeCompare(b.slug));

export const isValidEvaluatorType = (slug: string): boolean => slug in catalog;

/**
 * The catalog slugs closest to a miss, best first — plain Levenshtein over
 * the whole slug, which ranks a stale rename ("ragas/answer_relevancy") right
 * next to its live successors ("ragas/response_relevancy",
 * "legacy/ragas_answer_relevancy") without any special-casing.
 */
export const closestEvaluatorTypes = (
  input: string,
  count = 5,
): string[] =>
  Object.keys(catalog)
    .map((slug) => ({ slug, distance: levenshtein(input, slug) }))
    .sort((a, b) => a.distance - b.distance || a.slug.localeCompare(b.slug))
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
