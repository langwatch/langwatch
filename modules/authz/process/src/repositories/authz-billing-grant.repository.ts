/** One live Billing grant: who holds it, and its grant id. */
export type BillingGrantRow = Readonly<{ grantId: string; userId: string }>;

/**
 * The Billing role's rows on the grants head (specs/licensing/billing-role.feature): live
 * USER grants at the organization's own scope carrying the `billing` role key.
 */
export abstract class AuthzBillingGrantRepository {
  /** Live grants, narrowed to one holder when named; oldest first. */
  abstract findGrants(input: {
    organizationId: string;
    userId?: string;
  }): Promise<BillingGrantRow[]>;

  /** Of these people, the ones whose membership is present and enabled. */
  abstract findEnabledMemberIds(input: {
    organizationId: string;
    userIds: readonly string[];
  }): Promise<string[]>;
}
