/** The one field a bucket key or a provider filter reads off a budget. */
export type ProviderFilteredBudget = { providerKey: string | null };

export const PROVIDER_BUCKET_SEPARATOR = "|provider:";

/**
 * The ledger buckets spend by (Scope, ScopeId), so anything that must accrue separately has to
 * be separate in that key. Two budgets on the same target, one counting everything and one
 * counting only OpenAI, would otherwise share a bucket and each report the other's spend.
 */
export function bucketScopeIdFor(budget: ProviderFilteredBudget, baseScopeId: string): string {
  return budget.providerKey
    ? `${baseScopeId}${PROVIDER_BUCKET_SEPARATOR}${budget.providerKey}`
    : baseScopeId;
}

/**
 * Per-member bucket key for a GROUP budget. Group ids are nanoids and
 * user ids are cuids, neither contains a colon, so the pair round-trips
 * unambiguously through the ledger's ScopeId column.
 */
export function groupBucketScopeId(groupId: string, principalUserId: string): string {
  return `${groupId}:${principalUserId}`;
}

/**
 * Per-end-user bucket key for an ATTRIBUTED_USER template: the anchor (a virtual key or project
 * id) plus the caller-supplied external id.
 */
export function attributedUserBucketScopeId(anchorId: string, endUserId: string): string {
  return `${anchorId}:${endUserId}`;
}

/**
 * Whether a budget counts spend dispatched to `providerKey`. An unfiltered budget (providerKey
 * null) counts everything; a filtered one counts only its own provider.
 */
export function budgetAppliesToProvider(
  budget: ProviderFilteredBudget,
  dispatchedProviderKey: string | null | undefined,
): boolean {
  if (!budget.providerKey) return true;
  return budget.providerKey === dispatchedProviderKey;
}
