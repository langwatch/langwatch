/**
 * What the membership half reaches that the organization feature does not own.
 *
 * Every one of these was resolved by the platform application out of ambient
 * state — a service locator (`getApp()`), a thunk that existed only to break a
 * construction cycle, or an Enterprise licence store a core package may not
 * name. They are ports here so a process states what it holds, and so a process
 * that holds none of them refuses the operations that need them BY NAME rather
 * than throwing from inside a half-applied member write.
 */

/**
 * The person a plan lookup is attributed to.
 *
 * Structural on purpose: the licence store's own user shape lives in an
 * Enterprise package, and the two writes that carry one only ever forward what
 * the caller already had.
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
 * The seat and plan gates on a membership write.
 *
 * Deliberately TWO methods rather than the platform's four. Classifying a role
 * change, reading the active plan, asserting the seat count and asserting the
 * Enterprise requirement on custom roles are all one decision — "may this
 * organization make this change on its plan" — and splitting them across the
 * seam put half the licence rules inside the organization feature, where the
 * types they need do not exist.
 */
export abstract class OrganizationSeatLicensePort {
  /**
   * Whether one more of `resource` fits inside the organization's plan.
   *
   * Answers rather than throws: re-enabling a membership turns a refusal into
   * a named error carrying the counts, and only the caller knows which.
   */
  abstract checkLimit(input: {
    organizationId: string;
    resource: "members" | "membersLite";
    user?: OrganizationPlanUser | undefined;
  }): Promise<OrganizationSeatDecision>;

  /**
   * Refuses a role change the organization's plan does not carry: the seat
   * classification first (a Lite Member gaining non-view permissions re-checks
   * the full-member seats), then the Enterprise requirement that a custom-role
   * assignment implies.
   *
   * Throws. A refusal is never turned into a different answer here.
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
 * The live browser sessions a revoked seat has to lose.
 *
 * A seat revoked without the session revoked leaves the person working until
 * their token happens to expire, so this is not optional decoration: a process
 * that cannot revoke a session refuses the disable rather than half-performing
 * it.
 */
export abstract class OrganizationSessionRevocationPort {
  abstract revokeAllBrowserSessions(input: { userId: string }): Promise<void>;
}

/**
 * The authorization snapshots cached for one organization.
 *
 * Disabling a membership is a plain column write rather than a grant write, so
 * nothing else retires those snapshots. An admin who has just revoked somebody
 * must not wait for a cache to age out before it is true.
 */
export abstract class OrganizationGrantCachePort {
  abstract invalidateOrganization(input: { organizationId: string }): Promise<void>;
}

/**
 * The prompt tags a new organization is seeded with, and where a compensation
 * failure is reported when provisioning has to undo itself.
 *
 * Both belong to the process: the tag catalogue is the prompt feature's, and
 * the caller has to see what actually went wrong rather than the error raised
 * over the top of it.
 */
export abstract class OrganizationPromptSeedPort {
  abstract seedTagsForOrganization(input: { organizationId: string }): Promise<void>;
  abstract reportCompensationFailure(error: Error): void;
}
