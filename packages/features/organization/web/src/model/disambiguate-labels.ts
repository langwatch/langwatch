/**
 * Append a suffix only to entries whose label collides with another in the
 * same list.
 *
 * A FAMILY-LOCAL COPY of `platform/app/src/utils/disambiguateLabels.ts`, taken
 * rather than shared because the audit trail's Project filter was its ONLY
 * caller: the docblock there names three prospective ones — the members invite
 * dropdown among them — and none of the three ever arrived. The platform module
 * is deleted with this move; if a second caller appears it is a Design System
 * helper, not an organization one.
 *
 * The 80% case (no collision) renders untouched; the 20% case — two "Personal
 * Workspace" projects under different teams — gets disambiguated as
 * `Personal Workspace · acme-engineering`, so the rendered string stays
 * scannable.
 */
export function disambiguateLabels<T extends { label: string }>(
  items: readonly T[],
  suffix: (item: T) => string,
): Array<T & { displayLabel: string }> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    counts[item.label] = (counts[item.label] ?? 0) + 1;
  }
  return items.map((item) => ({
    ...item,
    displayLabel: (counts[item.label] ?? 0) > 1 ? `${item.label} · ${suffix(item)}` : item.label,
  }));
}
