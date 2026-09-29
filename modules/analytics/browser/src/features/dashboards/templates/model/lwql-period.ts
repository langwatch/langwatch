/**
 * The page period as template queries bind it: only through the reserved
 * parameters (ADR-130), so a stored widget follows the board's period and grain.
 */

export const START = "{dashboard_context_period_start:DateTime}";
export const END = "{dashboard_context_period_end:DateTime}";
const GRAIN = "{dashboard_context_granularity_seconds:UInt32}";
/** The start of the equally long window right before the page period. */
export const PREVIOUS_START = `subtractSeconds(${START}, dateDiff('second', ${START}, ${END}))`;
/** The middle of the page period, for "first half against second half". */
export const MIDPOINT = `subtractSeconds(${END}, intDiv(dateDiff('second', ${START}, ${END}), 2))`;

/** Seconds from the epoch (a Thursday) to the first Monday: pins week buckets to Monday. */
const MONDAY_OFFSET_SECONDS = 345_600;

export const inPeriod = (column: string) => `${column} >= ${START} AND ${column} < ${END}`;

/** `column` inside the page period or the equally long window before it. */
export const inPeriodAndPrevious = (column: string) =>
  `${column} >= ${PREVIOUS_START} AND ${column} < ${END}`;

export const bucketOf = (column: string) => {
  const shifted = `subtractSeconds(${column}, ${MONDAY_OFFSET_SECONDS})`;
  const bucket = `toStartOfInterval(${shifted}, INTERVAL ${GRAIN} SECOND)`;
  return `addSeconds(${bucket}, ${MONDAY_OFFSET_SECONDS})`;
};
