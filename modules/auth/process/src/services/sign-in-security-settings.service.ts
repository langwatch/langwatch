import {
  NO_LOCKOUT,
  NO_SESSION_BOUND,
  type ReleaseHeldAccountResult,
  type SaveSignInSecurityInput,
  type SaveSignInSecurityResult,
  type SignInSecuritySettings,
} from "@langwatch/auth-contract";
import { UserNotInOrganizationError } from "@langwatch/organization-contract";

import type { SignInAttemptLockRepository } from "../repositories/sign-in-attempt-lock.repository.ts";
import type { SignInSecuritySettingsRepository } from "../repositories/sign-in-security-settings.repository.ts";
import {
  assertSessionWindowSensible,
  willActivateSignInSecurity,
} from "../rules/sign-in-security.rules.ts";

/** Who belongs to an organization, as its owner answers. */
export interface SignInSecurityMembers {
  findMemberUserIds(input: { organizationId: string }): Promise<readonly string[]>;
  isMember(input: { organizationId: string; userId: string }): Promise<boolean>;
}

/** Refuses an organization whose plan does not carry these controls. */
export interface SignInSecurityPlanGate {
  assertEntitled(input: { organizationId: string }): Promise<void>;
}

/** A release, put on the record with the administrator's own id. */
export interface SignInSecurityReleaseEvidence {
  released(input: { organizationId: string; userId: string; actorUserId: string }): Promise<void>;
}

/** Ends the sessions already past a window just saved. */
export interface SignInSecuritySessionSweep {
  endSessionsPastWindow(input: { userIds: readonly string[] }): Promise<number>;
}

export interface SignInSecuritySettingsDeps {
  settings: SignInSecuritySettingsRepository;
  locks: SignInAttemptLockRepository;
  members: SignInSecurityMembers;
  plan: SignInSecurityPlanGate;
  evidence: SignInSecurityReleaseEvidence;
  sessions: SignInSecuritySessionSweep;
}

/**
 * The administrator's side of GAC-09 and GAC-10: read and save the two rules,
 * and release somebody the organization holds.
 * specs/identity/org-account-lockout.feature, specs/identity/org-session-lifetime.feature
 */
export class SignInSecuritySettingsService {
  static create(deps: SignInSecuritySettingsDeps): SignInSecuritySettingsService {
    return new SignInSecuritySettingsService(deps);
  }

  private constructor(private readonly deps: SignInSecuritySettingsDeps) {}

  async get({ organizationId }: { organizationId: string }): Promise<SignInSecuritySettings> {
    const [rule] = await this.deps.settings.findForOrganization({ organizationId });
    const lockout = rule?.lockout ?? NO_LOCKOUT;
    const bound = rule?.sessionBound ?? NO_SESSION_BOUND;

    return {
      lockoutAfterFailedAttempts: lockout.afterFailedAttempts,
      lockoutMinutes: lockout.lockMinutes,
      sessionIdleTimeoutMinutes: bound.idleTimeoutMinutes,
      sessionMaxLifetimeMinutes: bound.maxLifetimeMinutes,
    };
  }

  async save({
    organizationId,
    ...next
  }: SaveSignInSecurityInput): Promise<SaveSignInSecurityResult> {
    assertSessionWindowSensible(next);

    const current = await this.get({ organizationId });
    if (willActivateSignInSecurity({ current, next })) {
      await this.deps.plan.assertEntitled({ organizationId });
    }

    await this.deps.settings.save({
      organizationId,
      rule: {
        lockout: {
          afterFailedAttempts: next.lockoutAfterFailedAttempts,
          lockMinutes: next.lockoutMinutes,
        },
        sessionBound: {
          idleTimeoutMinutes: next.sessionIdleTimeoutMinutes,
          maxLifetimeMinutes: next.sessionMaxLifetimeMinutes,
        },
      },
    });

    const userIds = await this.deps.members.findMemberUserIds({ organizationId });
    const sweptSessions = await this.deps.sessions.endSessionsPastWindow({ userIds });

    return { ok: true, sweptSessions };
  }

  /**
   * Membership is checked here: a release clears by user id alone, so an
   * administrator of one organization must not release somebody in another.
   * A release that cleared nothing writes nothing to the record.
   */
  async release({
    organizationId,
    userId,
    actorUserId,
  }: {
    organizationId: string;
    userId: string;
    actorUserId: string;
  }): Promise<ReleaseHeldAccountResult> {
    if (!(await this.deps.members.isMember({ organizationId, userId }))) {
      throw new UserNotInOrganizationError(userId);
    }

    const released = (await this.deps.locks.deleteForUser({ userId })) > 0;
    if (released) await this.deps.evidence.released({ organizationId, userId, actorUserId });

    return { released };
  }
}
