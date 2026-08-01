/**
 * Dedupe a list of `{ value }` items by `value`, keeping the FIRST occurrence.
 *
 * Used to SUPPLEMENT a preloaded facet list with server prefix-search results
 * without double-listing a value that appears in both. Passing the preloaded
 * items first means their richer payload (count, dotColor, aggregates) wins
 * over the leaner server row for the same value.
 */
export function dedupeByValue<T extends { value: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    if (seen.has(item.value)) continue;
    seen.add(item.value);
    out.push(item);
  }
  return out;
}
