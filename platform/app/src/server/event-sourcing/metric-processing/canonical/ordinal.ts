/**
 * Ordinal (UTF-16 code-unit) comparison, never `localeCompare`: two workers
 * deriving a SeriesId's attribute order must agree byte-for-byte with each
 * other and with ClickHouse's ordering of a `String` column, and ICU collation
 * inverts base62 identifiers at the `Z` -> `a` step (ADR-098).
 */
export function compareOrdinal(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
