import {
  type PendingSsoAdmission,
  SsoArrivalService,
} from "@ee/sso/sso-arrival.service";
import type { SignInConnection } from "@ee/sso/sso-assertion.service";
import { vi } from "vitest";
import { createIdentityMigrationFixture } from "~/server/app-layer/system-migrations/__tests__/identity-migration.fixture";
import {
  BetterAuthDatabaseHooks,
  type DatabaseHookConnectionRoutingPort,
  type DatabaseHookUser,
  type SsoMigrationAccountLinkDecision,
} from "../../hooks";

/** Shared hook collaborators; individual tests can replace the routing operation. */
export const userRow = (
  over: Partial<DatabaseHookUser> = {},
): DatabaseHookUser => ({
  id: "user_1",
  email: "u@acme.com",
  name: "User",
  deactivatedAt: null,
  pendingSsoSetup: false,
  signupConfirmationPending: false,
  ...over,
});

type LegacyOrganization = {
  id: string;
  name: string;
  ssoProvider: string | null;
};

export const legacyOrganization = (
  over: Partial<LegacyOrganization> = {},
): LegacyOrganization => ({
  id: "org_1",
  name: "Acme",
  ssoProvider: null,
  ...over,
});

export const hooksOver = ({
  user = null,
  organization = null,
  accountCount = 0,
  federationAllowed = true,
  memberships = 0,
  pendingInvite = null,
  migrationDecision = { kind: "not_migrating" },
  authenticationDecision = { action: "continue" },
  arrivalConnection = null,
  arrivalOrganization = null,
  governingConnectionId = null,
}: {
  user?: DatabaseHookUser | null;
  organization?: LegacyOrganization | null;
  /** The connection the ROUTER says governs the address, or null for none. */
  governingConnectionId?: string | null;
  accountCount?: number;
  federationAllowed?: boolean;
  memberships?: number;
  pendingInvite?: { inviteId: string } | null;
  migrationDecision?: SsoMigrationAccountLinkDecision;
  authenticationDecision?:
    | { action: "continue" }
    | {
        action: "reject";
        code:
          | "SSO_LEGACY_AUTH_RETIRED"
          | "SSO_MIGRATION_AUTH_AMBIGUOUS"
          | "SSO_MIGRATION_AUTH_NOT_ALLOWED";
      };
  arrivalConnection?: SignInConnection | null;
  arrivalOrganization?: { id: string; name: string } | null;
} = {}) => {
  const users = {
    findById: vi.fn().mockResolvedValue(user),
    updatePendingSsoSetup: vi.fn().mockResolvedValue(void 0),
    updateLastLoginAt: vi.fn().mockResolvedValue(void 0),
    countOrganizationMemberships: vi.fn().mockResolvedValue(memberships),
  };
  const organizations = {
    findByDomain: vi.fn().mockResolvedValue(organization),
  };
  const connectionGoverning = vi
    .fn<DatabaseHookConnectionRoutingPort["connectionGoverning"]>()
    .mockResolvedValue(
      governingConnectionId === null
        ? null
        : { connectionId: governingConnectionId },
    );
  const accounts = {
    countForUser: vi.fn().mockResolvedValue(accountCount),
  };
  const ssoMigration = {
    decideAccountLink: vi.fn().mockResolvedValue(migrationDecision),
    authorizeAndRecordAuthentication: vi
      .fn()
      .mockResolvedValue(authenticationDecision),
  };
  let pendingAdmission: PendingSsoAdmission | null = null;
  const createMembership = vi.fn(async () => {
    pendingAdmission = {
      grantId: "rb_sso_admission",
      occurredAtMs: 1_756_000_000_000,
      state: "pending",
    };
    return "created" as const;
  });
  const applyPendingInvite = vi.fn().mockResolvedValue(pendingInvite);
  const requestFromSsoArrival = vi.fn().mockResolvedValue(null);
  const attachBindings = vi.fn(async () => {
    if (pendingAdmission) pendingAdmission.state = "applied";
    return {
      attached: [pendingAdmission?.grantId ?? "rb_sso_admission"],
      duplicates: [],
    };
  });
  const findPendingAdmission = vi.fn(async () =>
    pendingAdmission ? { ...pendingAdmission } : null,
  );
  const completeAdmission = vi.fn(async () => {
    if (!pendingAdmission) return false;
    pendingAdmission = null;
    return true;
  });
  const clearPendingAdmission = vi.fn(async () => {
    pendingAdmission = null;
    return true;
  });
  const announceSignup = vi.fn();
  const startNurturing = vi.fn();
  const trackSignUp = vi.fn();
  const trackActivity = vi.fn();
  const syncProfile = vi.fn();

  const ssoArrival = new SsoArrivalService({
    migrations: createIdentityMigrationFixture().service,
    connections: {
      findConnectionForSignIn: vi.fn().mockResolvedValue(arrivalConnection),
    },
    memberships: {
      findMembership: vi.fn().mockResolvedValue(false),
      createMembership,
      findPendingAdmission,
      completeAdmission,
      clearPendingAdmission,
      findOrganizationForMembership: vi
        .fn()
        .mockResolvedValue(arrivalOrganization),
    },
    invites: { applyPendingInvite },
    joinRequests: { requestFromSsoArrival },
    grants: { attachBindings },
    notifications: {
      joinedAutomatically: vi.fn().mockResolvedValue(void 0),
      announceSignup,
      startNurturing,
    },
  });

  return {
    hooks: new BetterAuthDatabaseHooks({
      users,
      organizations,
      connectionRouting: { connectionGoverning },
      accounts,
      ssoArrival,
      ssoMigration,
      federationAllowed: vi.fn().mockResolvedValue(federationAllowed),
      analytics: { trackSignUp },
      nurturing: { trackActivity, syncProfile },
    }),
    users,
    organizations,
    connectionGoverning,
    accounts,
    ssoMigration,
    createMembership,
    applyPendingInvite,
    requestFromSsoArrival,
    attachBindings,
    announceSignup,
    trackSignUp,
    trackActivity,
    syncProfile,
  };
};
