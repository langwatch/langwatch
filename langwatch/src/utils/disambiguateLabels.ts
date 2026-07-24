/**
 * Append a suffix only to entries whose label collides with another in the
 * same list. The 80% case (no collision) renders untouched; the 20% case
 * (e.g. two "Personal Workspace" projects from different parent teams)
 * gets disambiguated as `Personal Workspace · ariana-zone-co` /
 * `Personal Workspace · acme-engineering`.
 *
 * Mirrors the same-name-org disambiguation logic embedded in
 * `WorkspaceSwitcher.tsx`. Pulled out as a generic helper so the audit-log
 * Project filter, members invite team-dropdown, and any other duplicate-
 * prone picker can reuse the same shape without re-implementing.
 *
 * Usage:
 *   const items = projects.map((p) => ({ id: p.id, label: p.name }));
 *   const out = disambiguateLabels(items, (p) => parentTeamFor(p).name);
 *   // out: Array<{ id, label, displayLabel }>
 *
 * `displayLabel === label` when there's no collision; otherwise it appends
 * `· <suffix>` so the rendered string stays scannable.
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
    displayLabel:
      (counts[item.label] ?? 0) > 1
        ? `${item.label} · ${suffix(item)}`
        : item.label,
  }));
}
