/**
 * collectConfusionMatrixTraceIds - the trace ids the confusion matrix looks
 * annotations up by, and how much of the run they actually cover.
 *
 * One trace id per row PER TARGET, so the list grows as rows x targets rather
 * than rows. The hook that consumes it chunks at 50 ids per request, so an
 * uncapped 2000-row run with four targets would fan out to 160 concurrent
 * queries against a browser budget of six connections per origin, starving
 * every other query on the page. Bound it, and report how far the bound
 * reached so the caller can score exactly the rows whose annotations were
 * fetched.
 */

import type { BatchResultRow } from "./types";

/**
 * Ceiling on trace ids fetched for annotation lookup.
 *
 * The hook chunks at 50 ids per request, so this caps the fan-out at ten
 * concurrent queries. Agreement is a sampling question anyway: a few hundred
 * annotated rows settle it, and the interval shown in the drawer already
 * reports how settled.
 */
export const CONFUSION_MATRIX_MAX_TRACES = 500;

export type ConfusionMatrixTraceLookup = {
  traceIds: string[];
  /**
   * Rows whose every target was reached before the cap. Scoring past this
   * point would read rows whose annotations were never fetched as "not
   * annotated", which is the one thing this chart must never do.
   */
  coveredRows: number;
  /** True when the cap stopped the walk before the run ran out of rows. */
  truncated: boolean;
};

/** Stable identity for the "nothing to fetch" path, so the memo chain holds. */
export const EMPTY_TRACE_LOOKUP: ConfusionMatrixTraceLookup = {
  traceIds: [],
  coveredRows: 0,
  truncated: false,
};

export const collectConfusionMatrixTraceIds = ({
  rows,
  targetIds,
}: {
  rows: BatchResultRow[];
  targetIds: Set<string>;
}): ConfusionMatrixTraceLookup => {
  const traceIds: string[] = [];
  let coveredRows = 0;

  for (const row of rows) {
    for (const targetId of targetIds) {
      // Checked before the push rather than after, so a row whose last target
      // lands exactly on the cap still counts as covered.
      if (traceIds.length >= CONFUSION_MATRIX_MAX_TRACES) {
        return { traceIds, coveredRows, truncated: true };
      }
      const traceId = row.targets[targetId]?.traceId;
      if (traceId) traceIds.push(traceId);
    }
    coveredRows++;
  }

  return { traceIds, coveredRows, truncated: false };
};
