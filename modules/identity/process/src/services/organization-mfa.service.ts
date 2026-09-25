import {
  type OrganizationMemberFactor,
  satisfiesOrganizationMfaRequirement,
} from "@langwatch/identity-contract";

import type { TwoStepVerificationRepository } from "../repositories/two-step-verification.repository.ts";

/** The organization's second-factor membership condition, as its administrator reads it (D06). */
export class OrganizationMfaService {
  static create(accounts: TwoStepVerificationRepository): OrganizationMfaService {
    return new OrganizationMfaService(accounts);
  }

  private constructor(private readonly accounts: TwoStepVerificationRepository) {}

  /**
   * Asked against the ACCOUNT and as though the requirement were on, whatever is set: an
   * administrator about to turn it on sees who it would hold. A factor that rides only a
   * sign-in reads as unable here, with the passkey count beside it saying why.
   */
  async findMemberFactors({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<OrganizationMemberFactor[]> {
    const members = await this.accounts.findMemberAccountFactors({ organizationId });
    return members.map((member) => ({
      ...member,
      satisfaction: satisfiesOrganizationMfaRequirement({
        mfaRequired: true,
        evidence: { accountEnrollmentEnabled: member.accountEnrollmentEnabled, amr: null },
      }),
    }));
  }
}
