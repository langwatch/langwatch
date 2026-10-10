/**
 * How often the Explorer reads the table and the sidebar again while a run
 * judges: the list often, the facets (twenty queries a batch) less so, and the
 * read after the run ends never skipped.
 * @see specs/traces-v2/instant-eval-search.feature
 */

export const INSTANT_EVAL_LIST_REFETCH_MS = 2_000;
export const INSTANT_EVAL_FACETS_REFETCH_MS = 8_000;

export function dueInstantEvalRefetches({
  now,
  lastListAt,
  lastFacetsAt,
  isAnyRunActive,
}: {
  now: number;
  lastListAt: number;
  lastFacetsAt: number;
  isAnyRunActive: boolean;
}): { list: boolean; facets: boolean } {
  if (!isAnyRunActive) return { list: true, facets: true };
  return {
    list: now - lastListAt >= INSTANT_EVAL_LIST_REFETCH_MS,
    facets: now - lastFacetsAt >= INSTANT_EVAL_FACETS_REFETCH_MS,
  };
}
