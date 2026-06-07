/**
 * Billed vs non-billed cost attribution for a trace.
 *
 * LangWatch bills per captured event, never per token. But a customer's own
 * LLM spend depends on how they pay the provider: gateway / virtual-key usage
 * is billed per token, while a coding assistant on a bundled subscription
 * (e.g. Claude Max) is NOT billed per token, so its list-price token cost is
 * theoretical. The receiver tags bundled ingest traces with
 * `langwatch.cost.non_billable = "true"` (resolved from the tool's
 * `bundledPlan` admin flag), so we can split a trace's list-price cost into
 * the amount actually billed per token vs the bundled (theoretical) portion.
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
