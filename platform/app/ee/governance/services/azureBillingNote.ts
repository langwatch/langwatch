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
 * (`assertAzureBillHasItsOwnCredential`), so the state this reason would
 * explain cannot be stored.
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
  claimsSubscription: boolean;
  /** The customer's own declaration — never inferred (ADR-128 §21.4). */
  prepaidDeclared: boolean;
  /** Whether the window holds any Azure-billed rollup rows at all. */
  hasAzureSpendRows: boolean;
  /** How far the bill has been priced, or null before the first read. */
  costPricedThroughDay: string | null;
  /** Set while a read window is held after a failed read. */
  costHeldSinceMs: number | null;
}): GovernanceAzureBillingNote | null {
  const {
    claimsSubscription,
    prepaidDeclared,
    hasAzureSpendRows,
    costPricedThroughDay,
    costHeldSinceMs,
  } = params;

  if (!claimsSubscription) return null;
  if (hasAzureSpendRows) return null;
  if (costHeldSinceMs !== null) return "billing_read_failed";
  if (costPricedThroughDay === null) return null;
  return prepaidDeclared ? "prepaid_declared" : "no_spend_recorded";
}

/**
 * The sentence the panel shows for each note.
 *
 * Digit-free on purpose, like the seat lane's absence copy: these sentences
 * explain why there is NO figure, and a digit in one is a figure waiting to
 * be misread. Each is honest about what happened — a failed read says the
 * data is missing, never that the bill was empty, because those ask the
 * reader for opposite things.
 */
export function azureBillingNoteSentence(
  note: GovernanceAzureBillingNote,
): string {
  switch (note) {
    case "prepaid_declared":
      return "This Copilot is declared as running on prepaid message packs, which never appear on the Azure bill — an empty bill here is expected.";
    case "no_spend_recorded":
      return "The Azure bill was read and holds no Copilot charges for this period.";
    case "billing_read_failed":
      return "The Azure bill could not be read, so its charges are missing here rather than empty. They appear as soon as a read succeeds.";
  }
}
