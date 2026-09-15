/**
 * What a coarsened dashboard widget tells the member.
 *
 * Its own module, with no imports beyond the vocabulary, because the widget
 * that renders it reaches Chakra, the tRPC client and the lazy Vega boundary —
 * and the copy is the part worth testing directly. A test that had to mount the
 * widget to read one string would be proving the harness, not the sentence.
 *
 * The substitution this describes is otherwise invisible: the card redraws at a
 * coarser step and nothing on screen says the answer is not the one the chart
 * was configured to give. So the sentence names both steps and cites the
 * ceiling that forced the change, rather than asserting a bare number the
 * member has no way to check.
 *
 * @see specs/analytics/lwql-saved-charts.feature
 */

import {
  describeLangWatchQLGranularityStep,
  LWQL_GRANULARITY_MAX_BUCKETS,
} from "@langwatch/analytics-contract";

/**
 * How one datapoint step is named inside this notice: the adjective form,
 * because every mention here modifies "buckets".
 */
const step = (seconds: number): string => describeLangWatchQLGranularityStep(seconds, "adjective");

/** The notice a widget shows when its period forced a coarser step. */
export function widgetCoarsenedNotice({
  from,
  to,
}: {
  /** The step the widget was configured with. */
  readonly from: number;
  /** The step it actually ran at. */
  readonly to: number;
}): string {
  return (
    `Showing ${step(to)} buckets instead of ` +
    `${step(from)}: this period at ` +
    `${step(from)} would exceed the ` +
    `${LWQL_GRANULARITY_MAX_BUCKETS.toLocaleString()} datapoint limit.`
  );
}
