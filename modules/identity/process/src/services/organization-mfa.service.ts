import type { AuthApi } from "@langwatch/auth-contract";
import {
  connectionAssertsSecondFactor,
  IdentityMfaEnrollmentRequiredError,
  IdentityMfaRequirementNotLicensedError,
  isAmr,
  type OrganizationConnectionFactors,
  type OrganizationMemberFactor,
  type OrganizationMfaRequirement,
  type OrganizationMfaRequirementChange,
  type OrganizationMfaStanding,
  satisfiesOrganizationMfaRequirement,
} from "@langwatch/identity-contract";

import type { TwoStepVerificationRepository } from "../repositories/two-step-verification.repository.ts";
import type { OrganizationMfaNotifierService } from "./organization-mfa-notifier.service.ts";

export type OrganizationMfaServiceDeps = {
  accounts: TwoStepVerificationRepository;
  /** What a session proved, the provider's assertions, and whether the deployment offers it. */
  auth: Pick<
    AuthApi,
    "findSessionAmr" | "findAssertedAmrForIdentifiers" | "offersTwoStepVerification"
  >;
  notifier: OrganizationMfaNotifierService;
  /** Whether this organization's plan carries the requirement, asked per call. */
  entitled: (args: { organizationId: string }) => Promise<boolean>;
};

/**
 * The organization's second-factor membership condition (D06). It ends no session, in
 * either direction: there is no session write here to end one with.
 */
export class OrganizationMfaService {
  static create(deps: OrganizationMfaServiceDeps): OrganizationMfaService {
    return new OrganizationMfaService(deps);
  }

  private constructor(private readonly deps: OrganizationMfaServiceDeps) {}

  /**
   * Membership first, as a tenancy boundary: a stranger gets a member-with-nothing's shape and
   * no name, or the procedure is an existence oracle over every tenant.
   */
  async getStanding({
    userId,
    organizationId,
    sessionId,
  }: {
    userId: string;
    organizationId: string;
    sessionId: string | null;
  }): Promise<OrganizationMfaStanding> {
    const amr = sessionId ? await this.deps.auth.findSessionAmr({ sessionId }) : null;
    if (!(await this.deps.accounts.isActiveMember({ userId, organizationId }))) {
      return {
        organizationId,
        organizationName: null,
        required: false,
        satisfaction: satisfiesOrganizationMfaRequirement({
          mfaRequired: false,
          evidence: { accountEnrollmentEnabled: false, amr },
        }),
        holdsPasskey: false,
      };
    }
    const organization = await this.deps.accounts.getOrganizationSetting({ organizationId });
    const required = this.deps.auth.offersTwoStepVerification() && organization.mfaRequired;
    const account = await this.deps.accounts.getAccountFactors({ userId });
    return {
      organizationId,
      organizationName: organization.name,
      required,
      satisfaction: satisfiesOrganizationMfaRequirement({
        mfaRequired: required,
        evidence: { accountEnrollmentEnabled: account.accountEnrollmentEnabled, amr },
      }),
      holdsPasskey: account.passkeyCount > 0,
    };
  }

  async getRequirement({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<OrganizationMfaRequirement> {
    const [organization, connection] = await Promise.all([
      this.deps.accounts.getOrganizationSetting({ organizationId }),
      this.connectionFactors({ organizationId }),
    ]);
    return {
      mfaRequired: organization.mfaRequired,
      offered: this.deps.auth.offersTwoStepVerification(),
      connection,
    };
  }

  /**
   * The plan is asked only for a change that turns it ON: an organization whose plan lapsed
   * with the requirement on can always release its held members.
   */
  async setRequirement({
    organizationId,
    mfaRequired,
    actorUserId,
  }: {
    organizationId: string;
    mfaRequired: boolean;
    actorUserId: string;
  }): Promise<OrganizationMfaRequirementChange> {
    if (!this.deps.auth.offersTwoStepVerification()) {
      throw new IdentityMfaEnrollmentRequiredError(
        `organization ${organizationId} cannot require a second factor while two-step verification is not offered here`,
      );
    }
    const current = await this.deps.accounts.getOrganizationSetting({ organizationId });
    if (current.mfaRequired === mfaRequired) {
      return { previous: current.mfaRequired, next: mfaRequired };
    }
    if (mfaRequired && !(await this.deps.entitled({ organizationId }))) {
      throw new IdentityMfaRequirementNotLicensedError(
        `organization ${organizationId} asked to require a second factor on a plan that does not carry the requirement`,
      );
    }
    await this.deps.accounts.saveOrganizationRequirement({ organizationId, mfaRequired });
    const members = await this.deps.accounts.findMemberAccountFactors({ organizationId });
    await this.deps.notifier.notifyRequirementChanged({
      organizationId,
      organizationName: current.name,
      actorUserId,
      required: mfaRequired,
      members,
    });
    return { previous: current.mfaRequired, next: mfaRequired };
  }

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
    const members = await this.deps.accounts.findMemberAccountFactors({ organizationId });
    return members.map((member) => ({
      ...member,
      satisfaction: satisfiesOrganizationMfaRequirement({
        mfaRequired: true,
        evidence: { accountEnrollmentEnabled: member.accountEnrollmentEnabled, amr: null },
      }),
    }));
  }

  /** Unrecognized values are dropped from what is reported and count for nothing. */
  private async connectionFactors({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<OrganizationConnectionFactors> {
    const federated = await this.deps.accounts.getFederatedMemberIdentifiers({ organizationId });
    if (!federated.connected) {
      return { connected: false, assertedFactors: [], assertsSecondFactor: false };
    }
    const asserted =
      federated.identifierIds.length === 0
        ? []
        : await this.deps.auth.findAssertedAmrForIdentifiers({
            userIds: federated.userIds,
            identifierIds: federated.identifierIds,
          });
    return {
      connected: true,
      assertedFactors: asserted.filter(isAmr),
      assertsSecondFactor: connectionAssertsSecondFactor(asserted),
    };
  }
}
