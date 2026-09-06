/**
 * What the membership half reaches that the organization feature does not own — ports so a
 * process states what it holds, and refuses by name the operations it can't support.
 */

/**
 * The person a plan lookup is attributed to. Structural on purpose, since the licence store's
 * own user shape lives in an Enterprise package.
 */
export type OrganizationPlanUser = Readonly<{
  id: string;
  name?: string | null;
  email?: string | null;
}>;

/** Which seat kind a role change is asking the organization to spend. */
export type OrganizationSeatChangeType = string;

/** What a seat check answers when it refuses. */
export type OrganizationSeatDecision = Readonly<{
  allowed: boolean;
  limitType?: string;
  current?: number;
  max?: number;
}>;

/**
 * The seat and plan gates on a membership write. Deliberately two methods rather than the
 * platform's four: role classification, plan reads, seat counts, and the Enterprise custom-role
 * requirement are all one decision — "may this organization make this change on its plan."
 */
export abstract class OrganizationSeatLicensePort {
  /** Whether one more of `resource` fits inside the organization's plan. Answers rather than
   * throws, since only the caller knows how to turn a refusal into a named error. */
  abstract checkLimit(input: {
    organizationId: string;
    resource: "members" | "membersLite";
    user?: OrganizationPlanUser | undefined;
  }): Promise<OrganizationSeatDecision>;

  /**
   * Refuses a role change the organization's plan does not carry: seat classification first,
   * then the Enterprise requirement a custom-role assignment implies. Throws, never a soft answer.
   */
  abstract assertRoleChangeAllowed(input: {
    organizationId: string;
    currentRole: string;
    userPermissions: string[] | undefined;
    role: string;
    teamRoleUpdates?: ReadonlyArray<{ role: string; customRoleId?: string }> | undefined;
    user?: OrganizationPlanUser | undefined;
  }): Promise<void>;
}

/**
 * The live browser sessions a revoked seat has to lose — not optional decoration, since a
 * seat revoked without the session revoked leaves the person working until the token expires.
 */
export abstract class OrganizationSessionRevocationPort {
  abstract revokeAllBrowserSessions(input: { userId: string }): Promise<void>;
}

/**
 * The authorization snapshots cached for one organization. Disabling a membership is a plain
 * column write, not a grant write, so nothing else retires those snapshots.
 */
export abstract class OrganizationGrantCachePort {
  abstract invalidateOrganization(input: { organizationId: string }): Promise<void>;
}

/**
 * The prompt tags a new organization is seeded with, and where a compensation failure is
 * reported when provisioning undoes itself — the tag catalogue is the prompt feature's.
 */
export abstract class OrganizationPromptSeedPort {
  abstract seedTagsForOrganization(input: { organizationId: string }): Promise<void>;
  abstract reportCompensationFailure(error: Error): void;
}
