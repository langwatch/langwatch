import type { Instant } from "@langwatch/time";

/** A user's SSO/session-relevant fields, as read by the Better Auth hooks. */
export type BetterAuthHookUser = {
  id: string;
  email: string | null;
  deactivatedAt: Instant | null;
  pendingSsoSetup: boolean;
};

/** An SSO-domain-matched organization, the fields the hooks act on. */
export type BetterAuthHookOrganization = {
  id: string;
  name: string;
  ssoProvider: string | null;
};

/**
 * Private persistence boundary for the Better Auth database hooks — the
 * ADR-027 SSO gate, ADR-101 identifier reconciliation and the ADR-116 SSO
 * auto-join. One boundary because every hook in `better-auth-hooks.api.ts`
 * reads and writes the same handful of rows (User, Organization, Account,
 * OrganizationUser).
 */
export abstract class BetterAuthHooksRepository {
  abstract tryFindUserForHooks(input: { userId: string }): Promise<BetterAuthHookUser | null>;
  abstract tryFindOrganizationBySsoDomain(input: {
    domain: string;
  }): Promise<BetterAuthHookOrganization | null>;
  abstract countAccountsForUser(input: { userId: string }): Promise<number>;
  abstract flagPendingSsoSetup(input: { userId: string }): Promise<void>;
  /**
   * Creates the default MEMBER membership row. Returns `"already-exists"`
   * rather than throwing on a concurrent duplicate (unique-constraint), which
   * the caller treats as success.
   */
  abstract createOrganizationMembership(input: {
    userId: string;
    organizationId: string;
  }): Promise<"created" | "already-exists">;
  /**
   * Atomically deletes every OAuth account row for the user EXCEPT the one
   * being linked/refreshed, and clears `pendingSsoSetup`.
   */
  abstract reconcileSsoAccounts(input: {
    userId: string;
    providerId: string;
    accountId: string;
  }): Promise<void>;
  abstract recordLastLogin(input: { userId: string }): Promise<void>;
  abstract countOrgMembershipsForUser(input: { userId: string }): Promise<number>;
}
