// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Why the Azure bill shows nothing, when a source claims one (ADR-128 §21.3).
 *
 * A closed list bounded by what the system can actually know: whether a read
 * has completed, whether its window is held, and what the customer declared.
 * The puller collapses every failure kind — refusal, throttle, timeout,
 * malformed reply — into one held window, so this list carries ONE
 * `billing_read_failed` for all of them rather than claiming a granularity
 * the pipeline does not preserve. Provider error text never reaches the
 * browser; the screen turns each reason into a fixed sentence.
 *
 * `no_billing_credentials` is deliberately not here: a save that names a
 * subscription without the billing pair is refused at write time
 * (`assertAzureBillHasItsOwnCredential`) — on create, and on an edit that
 * adds the claim while the stored secrets are carried across unread — so the
 * state this reason would explain cannot be stored.
 *
 * The sentences these notes render as live with the rest of the panel copy
 * in `src/components/governance/costLaneFormat.ts`.
 *
 * Spec: specs/governance/azure-billing-identity.feature
 */

export type GovernanceAzureBillingNote =
  | "billing_read_failed"
  | "prepaid_declared"
  | "no_spend_recorded";

/**
 * The note for the spend panel, or null when there is nothing to explain —
 * no bill claimed, figures on the screen already speaking for themselves, or
 * a first read that has not happened yet.
 *
 * Order is the decision. Rows first: real amounts outrank every explanation,
 * including the customer's own prepaid declaration — a tenant can run packs
 * for one agent and pay-as-you-go for another, and the declaration explains
 * an empty bill, it never overrides a real one. The held window next: the
 * prepaid sentence claims "we read the bill and it was empty", which a held
 * read cannot stand behind. Only a clean, completed, empty read reaches the
 * declaration at all.
 */
export function azureBillingNoteFrom(params: {
  /** Whether any live source names an Azure subscription. */
  hasSubscriptionClaim: boolean;
  /** The customer's own declaration — never inferred (ADR-128 §21.4). */
  isPrepaidDeclared: boolean;
  /**
   * Whether the window holds rollup rows from the CLAIMING SOURCE's bill
   * read. Scoped to that one source, never to the whole pulled lane: the
   * lane is fed by every pulled provider, and another provider's rows must
   * not silence a note about the Azure bill.
   */
  hasAzureSpendRows: boolean;
  /** How far the bill has been priced, or null before the first read. */
  costPricedThroughDay: string | null;
  /** Set while a read window is held after a failed read. */
  costHeldSinceMs: number | null;
}): GovernanceAzureBillingNote | null {
  const {
    hasSubscriptionClaim,
    isPrepaidDeclared,
    hasAzureSpendRows,
    costPricedThroughDay,
    costHeldSinceMs,
  } = params;

  if (!hasSubscriptionClaim) return null;
  if (hasAzureSpendRows) return null;
  if (costHeldSinceMs !== null) return "billing_read_failed";
  if (costPricedThroughDay === null) return null;
  return isPrepaidDeclared ? "prepaid_declared" : "no_spend_recorded";
}
