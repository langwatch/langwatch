import type { GovernanceRestApi } from "@langwatch/enterprise-governance-contract";

import type { CodingAgentBillingPolicy } from "../app/coding-agent.members.ts";

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
