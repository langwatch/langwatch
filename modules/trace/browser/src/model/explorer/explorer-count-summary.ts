/**
 * The one sentence every count on the Explorer shows, so no two surfaces can
 * name a different number or a different noun.
 * @see specs/traces-v2/search.feature
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
  return totalHits === 1 ? (ITEM_NOUN_SINGULAR[itemNoun] ?? itemNoun) : itemNoun;
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
    const total = instantEval.total === null ? "?" : instantEval.total.toLocaleString();
    return `${instantEval.matched.toLocaleString()} matched so far · ${judged} of ${total} judged`;
  }
  return `${totalHits.toLocaleString()} ${explorerItemNoun({ totalHits, itemNoun })}`;
}
