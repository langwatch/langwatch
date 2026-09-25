import type { AuthApi } from "@langwatch/auth-contract";
import {
  IdentityMfaRequiredByOrganizationError,
  type RequestHeaderRecord,
  type TwoStepAccountStanding,
  type TwoStepDisabled,
} from "@langwatch/identity-contract";

import type { TwoStepVerificationRepository } from "../repositories/two-step-verification.repository.ts";

export type TwoStepAccountServiceDeps = {
  accounts: TwoStepVerificationRepository;
  /** Whether this deployment offers two-step verification at all; auth owns the flag. */
  deployment: Pick<AuthApi, "offersTwoStepVerification">;
  /** The two-factor plugin's own re-proof and disable, which auth holds. */
  protocol: Pick<AuthApi, "disableTwoStepVerification">;
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

  /**
   * The organization refusal comes FIRST, before either proof is spent: better-auth does not
   * know our organizations exist, so the refusal lives in front of its disable.
   */
  async disable({
    userId,
    password,
    code,
    headers,
  }: {
    userId: string;
    password?: string | undefined;
    code: string;
    headers: RequestHeaderRecord;
  }): Promise<TwoStepDisabled> {
    const requiring = await this.deps.accounts.findRequiringOrganizations({ userId });
    if (requiring.length > 0) {
      throw new IdentityMfaRequiredByOrganizationError(
        `disable_two_step: ${userId} belongs to ${requiring.length} organization(s) requiring a second factor: ${requiring
          .map((organization) => organization.slug)
          .join(", ")}`,
      );
    }
    await this.deps.protocol.disableTwoStepVerification({
      headers: fetchHeaders(headers),
      password,
      code,
    });
    return { disabled: true };
  }
}

/** One header, which node may hand over absent, once, or repeated. */
function fetchHeaders(record: RequestHeaderRecord): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(record)) {
    for (const one of typeof value === "string" ? [value] : (value ?? [])) {
      headers.append(name, one);
    }
  }
  return headers;
}
