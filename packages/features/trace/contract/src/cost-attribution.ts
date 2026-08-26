import { ATTR_KEYS } from "./trace-attributes";

/** Resource attribute stamped on traces whose provider cost is bundled. */
export const NON_BILLABLE_ATTR = ATTR_KEYS.LANGWATCH_COST_NON_BILLABLE;

export interface CostSplit {
  billedCost: number;
  nonBilledCost: number;
}

export function isNonBillableTrace(
  attributes: Record<string, string> | null | undefined,
): boolean {
  return attributes?.[NON_BILLABLE_ATTR] === "true";
}

export function splitTraceCost({
  totalCost,
  nonBillable,
}: {
  totalCost: number | null | undefined;
  nonBillable: boolean;
}): CostSplit {
  const grand = totalCost ?? 0;

  return nonBillable
    ? { billedCost: 0, nonBilledCost: grand }
    : { billedCost: grand, nonBilledCost: 0 };
}

/**
 * Prefer the fold-time per-span split. Older rows fall back to the legacy
 * all-or-nothing marker, and corrupt values cannot escape the trace total.
 */
export function resolveNonBilledCost({
  foldedNonBilledCost,
  totalCost,
  attributes,
}: {
  foldedNonBilledCost: number | null | undefined;
  totalCost: number | null | undefined;
  attributes: Record<string, string> | null | undefined;
}): number {
  const grand = totalCost ?? 0;
  const folded =
    foldedNonBilledCost ??
    splitTraceCost({
      totalCost,
      nonBillable: isNonBillableTrace(attributes),
    }).nonBilledCost;

  return Math.min(Math.max(0, folded), grand);
}
