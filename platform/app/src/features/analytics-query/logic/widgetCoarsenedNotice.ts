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

import { LWQL_GRANULARITY_MAX_BUCKETS } from "~/server/analytics/lwql/timeWindow";

/**
 * How one datapoint step is named in member-facing copy.
 *
 * The three offered steps get words; anything else falls back to seconds,
 * which is a shape this should never be handed but must not crash on.
 */
export function describeGranularityStep(seconds: number): string {
  if (seconds === 1) return "1-second";
  if (seconds === 60) return "1-minute";
  if (seconds === 3600) return "1-hour";
  return `${seconds}-second`;
}

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
    `Showing ${describeGranularityStep(to)} buckets instead of ` +
    `${describeGranularityStep(from)}: this period at ` +
    `${describeGranularityStep(from)} would exceed the ` +
    `${LWQL_GRANULARITY_MAX_BUCKETS.toLocaleString()} datapoint limit.`
  );
}
