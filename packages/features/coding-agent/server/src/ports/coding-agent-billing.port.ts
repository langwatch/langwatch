/**
 * The billing entitlement decision required to present coding-agent costs.
 * Composition selects the policy; callers do not supply a partial entitlement
 * view or individual callbacks.
 */
export abstract class CodingAgentBillingPolicyPort {
  abstract isSourceNonBillable(input: {
    organizationId: string;
    sourceType: string;
  }): Promise<boolean>;
}
