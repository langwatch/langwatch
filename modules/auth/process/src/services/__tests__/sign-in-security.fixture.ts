import type { LockoutPolicy, SessionBound } from "@langwatch/auth-contract";
import type { OrganizationApi, SignInSecurityPolicy } from "@langwatch/organization-contract";
import type { Instant } from "@langwatch/time";

import { MemorySignInAttemptLockRepository } from "../../repositories/memory/memory.sign-in-attempt-lock.repository.ts";
import { SessionBoundService } from "../session-bound.service.ts";
import { SignInLockoutService, type SignInLockoutEvidence } from "../sign-in-lockout.service.ts";

/** What the evidence port was told, as rows a test can read back. */
export type RecordedEvidence = {
  locked: { userId: string | null; failedCount: number; consecutiveLockouts: number }[];
  escalated: { userId: string | null; consecutiveLockouts: number }[];
};

type SignInSecurityOrganizations = Pick<
  OrganizationApi,
  | "getSignInSecurityPolicy"
  | "updateSignInSecurityPolicy"
  | "findSignInSecurityPoliciesForUser"
  | "findConfiguredSignInSecurityPolicies"
>;

const NO_RULE: SignInSecurityPolicy = {
  lockoutAfterFailedAttempts: 0,
  lockoutMinutes: 30,
  sessionIdleTimeoutMinutes: 0,
  sessionMaxLifetimeMinutes: 0,
};

const asksSomething = (policy: SignInSecurityPolicy): boolean =>
  policy.lockoutAfterFailedAttempts > 0 ||
  policy.sessionIdleTimeoutMinutes > 0 ||
  policy.sessionMaxLifetimeMinutes > 0;

/**
 * OrganizationApi's four sign-in security operations, answering as the
 * organization's own twin does (memory.organization.sign-in-security-policy test).
 */
function signInSecurityOrganizations(
  memberships: Map<string, Set<string>>,
): SignInSecurityOrganizations {
  const policies = new Map<string, SignInSecurityPolicy>();
  return {
    getSignInSecurityPolicy: async ({ organizationId }) => policies.get(organizationId) ?? NO_RULE,
    updateSignInSecurityPolicy: async ({ organizationId, policy }) => {
      policies.set(organizationId, policy);
    },
    findSignInSecurityPoliciesForUser: async ({ userId }) =>
      [...(memberships.get(userId) ?? [])].map((id) => policies.get(id) ?? NO_RULE),
    findConfiguredSignInSecurityPolicies: async () => [...policies.values()].filter(asksSomething),
  };
}

/**
 * The sign-in security services over their own memory twins - the same
 * repositories a process booted without a database composes, so a test here
 * exercises the shipped code rather than a stand-in for it.
 */
export function signInSecurityFixture({ now }: { now: () => Instant }) {
  const locks = MemorySignInAttemptLockRepository.create({ now });
  const memberships = new Map<string, Set<string>>();
  const organizations = signInSecurityOrganizations(memberships);
  /** Puts a person in an organization, as the Postgres twin's membership row does. */
  const join = ({ userId, organizationId }: { userId: string; organizationId: string }) => {
    memberships.set(userId, new Set([...(memberships.get(userId) ?? []), organizationId]));
  };
  const accounts = new Map<string, string>();
  const touched: { sessionId: string; at: Instant }[] = [];
  const recorded: RecordedEvidence = { locked: [], escalated: [] };

  const evidence: SignInLockoutEvidence = {
    locked: async (entry) => {
      recorded.locked.push(entry);
    },
    escalated: async (entry) => {
      recorded.escalated.push(entry);
    },
  };

  return {
    locks,
    organizations,
    recorded,
    touched,
    join,
    /** Puts an organization's rule in place and joins whoever belongs to it. */
    organization: async ({
      id,
      lockout,
      sessionBound,
      members = [],
    }: {
      id: string;
      lockout: LockoutPolicy;
      sessionBound: SessionBound;
      members?: string[];
    }) => {
      await organizations.updateSignInSecurityPolicy({
        organizationId: id,
        policy: {
          lockoutAfterFailedAttempts: lockout.afterFailedAttempts,
          lockoutMinutes: lockout.lockMinutes,
          sessionIdleTimeoutMinutes: sessionBound.idleTimeoutMinutes,
          sessionMaxLifetimeMinutes: sessionBound.maxLifetimeMinutes,
        },
      });
      for (const userId of members) join({ userId, organizationId: id });
    },
    /** Gives an address an account, which an unknown address never gets. */
    account: ({ identifier, userId }: { identifier: string; userId: string }) => {
      accounts.set(identifier, userId);
      return userId;
    },
    lockout: SignInLockoutService.create({
      locks,
      organizations,
      directory: {
        findUserIdFor: async ({ identifier }) => accounts.get(identifier) ?? null,
      },
      evidence,
      // A test hash, so a case can assert on what was stored without the
      // deployment secret the real hasher refuses to work without.
      hashIdentifier: (key) => `keyed:${key}`,
      now,
    }),
    sessionBound: SessionBoundService.create({
      organizations,
      activity: {
        touch: async (entry) => {
          touched.push(entry);
        },
      },
      now,
    }),
  };
}
