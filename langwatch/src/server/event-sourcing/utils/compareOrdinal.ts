/**
 * Ordinal (UTF-16 code-unit) comparison. Canonical ordering must never depend
 * on the host locale or ICU build, so it cannot use `localeCompare`: two
 * workers would otherwise derive different SeriesIds and PointIds from the
 * same attributes, and event-id cursor ties would sort differently from
 * ClickHouse, which orders String columns by bytes. ICU collation also
 * inverts base62 KSUIDs at the `Z` -> `a` step ("Z".localeCompare("a") > 0),
 * scrambling same-instant event order. Pinned against the shared
 * @langwatch/langy comparator by cursorContract.unit.test.ts.
 */
export function compareOrdinal(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
