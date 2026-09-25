import type { MemberAccountFactors, RequiringOrganization } from "@langwatch/identity-contract";

/** What one person's account carries toward a second factor. */
export type AccountSecondFactors = {
  accountEnrollmentEnabled: boolean;
  passkeyCount: number;
};

/**
 * The account-level evidence behind two-step verification (D06): the plugin's own
 * `User.twoFactorEnabled`, the passkeys held, and the organizations that require one.
 */
export abstract class TwoStepVerificationRepository {
  /** False and zero for a person with no row: nothing set up is the honest answer. */
  abstract getAccountFactors(args: { userId: string }): Promise<AccountSecondFactors>;
  /** Read, never trusted from the caller, so a stale membership list turns nothing off. */
  abstract findRequiringOrganizations(args: { userId: string }): Promise<RequiringOrganization[]>;
  /** Everyone holding an active seat; a disabled seat is not a member. */
  abstract findMemberAccountFactors(args: {
    organizationId: string;
  }): Promise<MemberAccountFactors[]>;
}
