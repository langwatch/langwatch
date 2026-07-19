import type { ScopeTriadType } from "~/components/settings/ScopeChipPicker";
import {
  RETENTION_CATEGORIES,
  type RetentionCategory,
} from "~/server/data-retention/retentionPolicy.schema";
import { CATEGORY_LABELS } from "./constants";
import { formatDays } from "./format";

export type RetentionRuleRow = {
  scopeType: ScopeTriadType;
  scopeId: string;
  name: string;
  category: RetentionCategory;
  retentionDays: number;
};

export type RetentionScopeGroup = {
  scopeType: ScopeTriadType;
  scopeId: string;
  name: string;
  byCategory: Partial<Record<RetentionCategory, number>>;
  rules: RetentionRuleRow[];
};

/** Groups override rows by (scopeType, scopeId), preserving first-seen order.
 *  We collapse the three category rows per scope into a single logical group
 *  so the Scope|Policy table renders one row per scope — categories almost
 *  always share the same value in practice. */
export function groupRulesByScope(
  rules: RetentionRuleRow[],
): RetentionScopeGroup[] {
  const groups: RetentionScopeGroup[] = [];
  const indexByKey = new Map<string, number>();
  for (const r of rules) {
    const key = `${r.scopeType}:${r.scopeId}`;
    const idx = indexByKey.get(key);
    if (idx === undefined) {
      indexByKey.set(key, groups.length);
      groups.push({
        scopeType: r.scopeType,
        scopeId: r.scopeId,
        name: r.name,
        byCategory: { [r.category]: r.retentionDays },
        rules: [r],
      });
    } else {
      const group = groups[idx]!;
      group.rules.push(r);
      group.byCategory[r.category] = r.retentionDays;
    }
  }
  return groups;
}

/** Render a single Policy cell value. If all three categories share the same
 *  retention, show one number ("1820 days"). Otherwise show the per-category
 *  breakdown so a divergent legacy override is still legible. */
export function renderPolicyValue(
  byCategory: Partial<Record<RetentionCategory, number>>,
): string {
  const present = RETENTION_CATEGORIES.filter(
    (c) => byCategory[c] !== undefined,
  );
  if (present.length === 0) return "—";
  const values = present.map((c) => byCategory[c]!);
  const allSame = values.every((v) => v === values[0]);
  if (allSame && present.length === RETENTION_CATEGORIES.length) {
    return formatDays(values[0]!);
  }
  return present
    .map((c) => `${CATEGORY_LABELS[c]}: ${formatDays(byCategory[c]!)}`)
    .join(" · ");
}

/** Top-line summary used in the Retention + Usage card. When all three
 *  categories share the same value we show that number; when they diverge
 *  the per-category rows below already carry the detail, so the summary
 *  collapses to "Mixed" instead of repeating the breakdown twice. */
export function renderPolicySummary(
  byCategory: Partial<Record<RetentionCategory, number>>,
): string {
  const present = RETENTION_CATEGORIES.filter(
    (c) => byCategory[c] !== undefined,
  );
  if (present.length === 0) return "—";
  const values = present.map((c) => byCategory[c]!);
  const allSame = values.every((v) => v === values[0]);
  if (allSame && present.length === RETENTION_CATEGORIES.length) {
    return formatDays(values[0]!);
  }
  return "Mixed";
}
