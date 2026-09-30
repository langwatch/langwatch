/**
 * How often the Explorer reads the table and the sidebar again while an
 * Instant Eval judges.
 *
 * The run's counters move about once a second, and every move means verdicts
 * landed. Reading on every move starts a list read and a whole batch of facet
 * reads a second, each filtered through the verdict subquery, and the server
 * keeps running a read the client has already replaced. The reads are spaced
 * instead: the list often enough that matches visibly arrive, the facets
 * (twenty queries a batch) less often. The read after the run ends is never
 * skipped, so the settled numbers are always the final ones.
 *
 * Spec: specs/traces-v2/instant-eval-search.feature ("Matches appear as
 * pages finish").
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
