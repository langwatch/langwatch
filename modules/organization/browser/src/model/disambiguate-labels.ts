/** Suffix colliding labels only, keeping common case scannable. */
export function disambiguateLabels<T extends { label: string }>(
  items: readonly T[],
  suffix: (item: T) => string,
): (T & { displayLabel: string })[] {
  const counts: Record<string, number> = {};
  for (const item of items) {
    counts[item.label] = (counts[item.label] ?? 0) + 1;
  }
  return items.map((item) => ({
    ...item,
    displayLabel: (counts[item.label] ?? 0) > 1 ? `${item.label} · ${suffix(item)}` : item.label,
  }));
}
