/**
 * Ordinal (UTF-16 code-unit) string comparison.
 *
 * Canonical ordering must never depend on the host locale or ICU build: two
 * workers deriving a SeriesId's attribute order, or breaking a tie between two
 * PointIds, must agree byte-for-byte with each other and with ClickHouse's
 * byte ordering of a `String` column. `localeCompare` fails both — ICU
 * collation inverts base62 identifiers at the `Z` -> `a` step
 * (`"Z".localeCompare("a") > 0`), which would scramble same-instant ordering
 * differently on every host (ADR-098).
 */
export function compareOrdinal(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
