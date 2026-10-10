/**
 * The one sentence every count on the Explorer shows: the selection header,
 * the pagination line and the sidebar total all render this string, so no two
 * of them can name a different number or a different noun.
 *
 * Kept apart from `useExplorerCounts` so a test that mocks the hook can still
 * build the copy the way the page does.
 *
 * Spec: specs/traces-v2/search.feature ("The header, the pagination line and
 * the sidebar total show one number", "A total of one is named in the
 * singular").
 */

/** The counters of a run that has not settled, as the copy reads them. */
export interface InstantEvalCounters {
  judged: number;
  total: number | null;
  matched: number;
}

/** The singular of each noun the Explorer counts in. */
const ITEM_NOUN_SINGULAR: Record<string, string> = {
  traces: "trace",
  conversations: "conversation",
};

/** The noun as the count needs it: "1 trace", "2 traces". */
export function explorerItemNoun({
  totalHits,
  itemNoun,
}: {
  totalHits: number;
  itemNoun: string;
}): string {
  return totalHits === 1
    ? (ITEM_NOUN_SINGULAR[itemNoun] ?? itemNoun)
    : itemNoun;
}

/** The totals copy: the run's counters while it judges, the plain count after. */
export function explorerCountSummary({
  totalHits,
  itemNoun,
  instantEval,
}: {
  totalHits: number;
  itemNoun: string;
  instantEval: InstantEvalCounters | null;
}): string {
  if (instantEval) {
    const judged = instantEval.judged.toLocaleString();
    const total =
      instantEval.total === null ? "?" : instantEval.total.toLocaleString();
    return `${instantEval.matched.toLocaleString()} matched so far · ${judged} of ${total} judged`;
  }
  return `${totalHits.toLocaleString()} ${explorerItemNoun({ totalHits, itemNoun })}`;
}
