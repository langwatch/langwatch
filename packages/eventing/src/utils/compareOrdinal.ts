/**
 * Ordinal (UTF-16) comparison; cannot use localeCompare as workers must agree
 * with ClickHouse's byte-ordering for SeriesIds, PointIds, and cursor ties.
 */
export function compareOrdinal(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
