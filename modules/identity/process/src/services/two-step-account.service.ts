import type { AuthApi } from "@langwatch/auth-contract";
import type { TwoStepAccountStanding } from "@langwatch/identity-contract";

import type { TwoStepVerificationRepository } from "../repositories/two-step-verification.repository.ts";

export type TwoStepAccountServiceDeps = {
  accounts: TwoStepVerificationRepository;
  /** Whether this deployment offers two-step verification at all; auth owns the flag. */
  deployment: Pick<AuthApi, "offersTwoStepVerification">;
};

/** The account side of two-step verification (D06): what a person's own security screen reads. */
export class TwoStepAccountService {
  static create(deps: TwoStepAccountServiceDeps): TwoStepAccountService {
    return new TwoStepAccountService(deps);
  }

  private constructor(private readonly deps: TwoStepAccountServiceDeps) {}

  /** Nothing at all where the deployment offers none, rather than a setup nobody can finish. */
  async getStanding({ userId }: { userId: string }): Promise<TwoStepAccountStanding> {
    if (!this.deps.deployment.offersTwoStepVerification()) {
      return { offered: false, enabled: false, holdsPasskey: false, requiringOrganizations: [] };
    }
    const [account, requiringOrganizations] = await Promise.all([
      this.deps.accounts.getAccountFactors({ userId }),
      this.deps.accounts.findRequiringOrganizations({ userId }),
    ]);
    return {
      offered: true,
      enabled: account.accountEnrollmentEnabled,
      holdsPasskey: account.passkeyCount > 0,
      requiringOrganizations,
    };
  }
}
