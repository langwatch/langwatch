import type { LockoutPolicy, SessionBound } from "@langwatch/auth-contract";

/** One organization's sign-in security rule, as it is stored: four columns. */
export interface OrganizationSignInSecurityRule {
  lockout: LockoutPolicy;
  sessionBound: SessionBound;
}

/**
 * The rules organizations set over their members' sign-ins (GAC-09, GAC-10).
 * Every read answers with rows, never a decision: which rule wins among
 * several is arithmetic, and it lives in the contract's pure modules.
 */
export interface SignInSecuritySettingsRepository {
  /** The rules of the organizations this person belongs to and is not
   *  disabled in. Empty when they belong to none. */
  findForUser(input: { userId: string }): Promise<readonly OrganizationSignInSecurityRule[]>;
  /**
   * Every organization on this installation that set one: the early-out, and
   * what governs an address resolving to nobody - it belongs to no
   * organization, so the strictest rule anybody set stands in.
   */
  findConfigured(): Promise<readonly OrganizationSignInSecurityRule[]>;
  /** This organization's own rule, for the card that edits it. */
  findForOrganization(input: {
    organizationId: string;
  }): Promise<readonly OrganizationSignInSecurityRule[]>;
  save(input: { organizationId: string; rule: OrganizationSignInSecurityRule }): Promise<void>;
}
