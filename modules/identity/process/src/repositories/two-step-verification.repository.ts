import type { MemberAccountFactors, RequiringOrganization } from "@langwatch/identity-contract";

/** What one person's account carries toward a second factor. */
export type AccountSecondFactors = {
  accountEnrollmentEnabled: boolean;
  passkeyCount: number;
};

/** The organization's own switch, and what its members are told it is called. */
export type OrganizationMfaSetting = { mfaRequired: boolean; name: string; slug: string };

/** The active members' identifiers minted through a live connection; `connected` false for none. */
export type FederatedMemberIdentifiers = {
  connected: boolean;
  userIds: string[];
  identifierIds: string[];
};

export type PersonContact = { userId: string; name: string | null; email: string | null };

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
  /** Throws `OrganizationNotFoundError` when no organization carries this id. */
  abstract getOrganizationSetting(args: {
    organizationId: string;
  }): Promise<OrganizationMfaSetting>;
  abstract saveOrganizationRequirement(args: {
    organizationId: string;
    mfaRequired: boolean;
  }): Promise<void>;
  /** A disabled seat is not a member. */
  abstract isActiveMember(args: { userId: string; organizationId: string }): Promise<boolean>;
  /** A discarded or torn-down connection is not one this organization has. */
  abstract getFederatedMemberIdentifiers(args: {
    organizationId: string;
  }): Promise<FederatedMemberIdentifiers>;
  abstract findPeople(args: { userIds: readonly string[] }): Promise<PersonContact[]>;
}
