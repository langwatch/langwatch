/**
 * Billed vs non-billed cost attribution for a trace.
 *
 * LangWatch bills per captured event, never per token. But a customer's own
 * LLM spend depends on how they pay the provider: gateway / virtual-key usage
 * is billed per token, while a coding assistant on a bundled subscription
 * (e.g. Claude Max) is NOT billed per token, so its list-price token cost is
 * theoretical. The bundled portion is summed per span at fold time into the
 * trace's `nonBilledCost`, so a trace that mixes billed and bundled spans
 * splits correctly. Rows folded before that column existed fall back to the
 * legacy all-or-nothing `langwatch.cost.non_billable = "true"` marker (resolved
 * by the receiver from the tool's `bundledPlan` admin flag).
 */

/** Resource attribute the receiver stamps on bundled ingest traces. */
export const NON_BILLABLE_ATTR = "langwatch.cost.non_billable";

/** True when a trace's LLM cost is bundled / not billed per token. */
export function isNonBillableTrace(
  attributes: Record<string, string> | null | undefined,
): boolean {
  return attributes?.[NON_BILLABLE_ATTR] === "true";
}

export interface CostSplit {
  /** Cost actually billed per token (real spend). */
  billedCost: number;
  /** Bundled / theoretical cost that is not billed per token. */
  nonBilledCost: number;
}

/**
 * Split a trace's grand list-price cost. A non-billable trace contributes its
 * whole cost to the non-billed bucket; otherwise it is all billed.
 */
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
 * Resolve a trace's bundled (non-billed) cost. Prefers the fold-time per-span
 * `nonBilledCost` amount; for rows folded before that column existed (null),
 * falls back to the legacy all-or-nothing boolean. Clamped to [0, totalCost].
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
    foldedNonBilledCost != null
      ? foldedNonBilledCost
      : splitTraceCost({
          totalCost,
          nonBillable: isNonBillableTrace(attributes),
        }).nonBilledCost;
  return Math.min(Math.max(0, folded), grand);
}
