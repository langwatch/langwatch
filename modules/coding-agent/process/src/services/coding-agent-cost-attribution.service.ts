import type { GovernanceRestApi } from "@langwatch/enterprise-governance-contract";

/**
 * The billing entitlement decision required to present coding-agent costs.
 * Composition selects the policy; callers do not supply a partial entitlement
 * view or individual callbacks.
 */
export interface CodingAgentBillingPolicy {
  isSourceNonBillable(input: { organizationId: string; sourceType: string }): Promise<boolean>;
}

/** Governance's bundled-plan policy decides which sources are billed (main `presets.ts:1873`). */
export class GovernanceCodingAgentBillingService implements CodingAgentBillingPolicy {
  static create({
    governance,
  }: {
    governance: Pick<GovernanceRestApi, "isSourceBilled">;
  }): GovernanceCodingAgentBillingService {
    return new GovernanceCodingAgentBillingService(governance);
  }

  private constructor(private readonly governance: Pick<GovernanceRestApi, "isSourceBilled">) {}

  async isSourceNonBillable(input: {
    organizationId: string;
    sourceType: string;
  }): Promise<boolean> {
    return !(await this.governance.isSourceBilled(input));
  }
}
