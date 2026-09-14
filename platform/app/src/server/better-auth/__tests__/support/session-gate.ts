import { BetterAuthDatabaseHooks, type DatabaseHookUser } from "../../hooks";

type SessionGateUser = Pick<
  DatabaseHookUser,
  "deactivatedAt" | "signupConfirmationPending"
>;

/** The real PR2 hook with only its session-gate reads populated. */
export function createSessionGateHooks({
  findUser,
}: {
  findUser: (userId: string) => Promise<SessionGateUser | null>;
}): BetterAuthDatabaseHooks {
  return new BetterAuthDatabaseHooks({
    users: {
      findById: async ({ userId }) => {
        const user = await findUser(userId);
        return user
          ? {
              id: userId,
              email: null,
              name: null,
              pendingSsoSetup: false,
              ...user,
            }
          : null;
      },
      updatePendingSsoSetup: async () => undefined,
      updateLastLoginAt: async () => undefined,
      countOrganizationMemberships: async () => 0,
    },
    organizations: { findByDomain: async () => null },
    accounts: {
      countForUser: async () => 0,
      reconcileOAuthAccounts: async () => undefined,
    },
    ssoArrival: { admit: async () => undefined },
    ssoMigration: {
      decideAccountLink: async () => ({ kind: "not_migrating" }),
      authorizeAndRecordAuthentication: async () => ({ action: "continue" }),
    },
    federationAllowed: async () => false,
    analytics: { trackSignUp: () => undefined },
    nurturing: {
      trackActivity: () => undefined,
      syncProfile: () => undefined,
    },
  });
}
