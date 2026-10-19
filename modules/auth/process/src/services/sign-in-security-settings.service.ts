import {
  type ReleaseHeldAccountResult,
  type SaveSignInSecurityInput,
  type SaveSignInSecurityResult,
  SIGN_IN_SECURITY_ENTERPRISE_REFUSAL,
  type SignInSecuritySettings,
} from "@langwatch/auth-contract";
import {
  EnterprisePlanRequiredError,
  isEnterpriseTier,
  type EntitlementApi,
} from "@langwatch/entitlement-contract";
import { type OrganizationApi, UserNotInOrganizationError } from "@langwatch/organization-contract";

import type { SignInAttemptLockRepository } from "../repositories/sign-in-attempt-lock.repository.ts";
import {
  assertSessionWindowSensible,
  willActivateSignInSecurity,
} from "../rules/sign-in-security.rules.ts";

/** Who belongs to an organization, as its owner answers. */
export interface SignInSecurityMembers {
  findMemberUserIds(input: { organizationId: string }): Promise<readonly string[]>;
  isMember(input: { organizationId: string; userId: string }): Promise<boolean>;
}

/** A release, put on the record with the administrator's own id. */
export interface SignInSecurityReleaseEvidence {
  released(input: { organizationId: string; userId: string; actorUserId: string }): Promise<void>;
}

/** Ends the sessions already past a window just saved. */
interface SignInSecuritySessionSweep {
  endSessionsPastWindow(input: { userIds: readonly string[] }): Promise<number>;
}

interface SignInSecuritySettingsDeps {
  /** The four columns live on the organization; it reads and writes them. */
  organizations: Pick<OrganizationApi, "getSignInSecurityPolicy" | "updateSignInSecurityPolicy">;
  locks: SignInAttemptLockRepository;
  members: SignInSecurityMembers;
  entitlements: Pick<EntitlementApi, "getActivePlan">;
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
    return this.deps.organizations.getSignInSecurityPolicy({ organizationId });
  }

  async save({
    organizationId,
    ...next
  }: SaveSignInSecurityInput): Promise<SaveSignInSecurityResult> {
    assertSessionWindowSensible(next);

    const current = await this.get({ organizationId });
    if (willActivateSignInSecurity({ current, next })) {
      await this.assertEntitled({ organizationId });
    }

    await this.deps.organizations.updateSignInSecurityPolicy({ organizationId, policy: next });

    const userIds = await this.deps.members.findMemberUserIds({ organizationId });
    const sweptSessions = await this.deps.sessions.endSessionsPastWindow({ userIds });

    return { ok: true, sweptSessions };
  }

  /** Asked on a save that turns a rule on from off, which only the stored settings tell. */
  private async assertEntitled({ organizationId }: { organizationId: string }): Promise<void> {
    const plan = await this.deps.entitlements.getActivePlan({ organizationId });
    if (!isEnterpriseTier(plan.type)) {
      throw new EnterprisePlanRequiredError(SIGN_IN_SECURITY_ENTERPRISE_REFUSAL);
    }
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
