import {
  IdentitySessionMaxLifetimeTooShortError,
  IdentityUserNotInOrganizationError,
} from "@langwatch/identity";
import type {
  BoundableSession,
  SessionBoundService,
} from "./session-bound.service";
import type { SignInLockoutService } from "./sign-in-lockout.service";

/**
 * The settings surface's DECISIONS for the two sign-in security rules an
 * organization can set: locking an account after repeated failures (GAC-09)
 * and bounding how long a browser session lasts (GAC-10).
 *
 * No Prisma reaches in here, same rule as `sign-in-lockout.service.ts` and
 * `session-bound.service.ts` next door (`identity-service-layering.unit.test.ts`
 * enforces it tree-wide: a query is only spelled in a repository or adapter
 * file). Every read and write is a port, implemented in
 * `sign-in-security-adapters.ts` and composed in `runtime.ts` — which is what
 * lets the cases that matter be tested as states rather than against a
 * database.
 *
 * Specs: specs/identity/org-account-lockout.feature,
 * specs/identity/org-session-lifetime.feature.
 */

export interface SignInSecuritySettings {
  lockoutAfterFailedAttempts: number;
  lockoutMinutes: number;
  sessionIdleTimeoutMinutes: number;
  sessionMaxLifetimeMinutes: number;
}

/** Where the four settings live. */
export interface SignInSecuritySettingsPort {
  read(args: { organizationId: string }): Promise<SignInSecuritySettings>;
  write(args: {
    organizationId: string;
    settings: SignInSecuritySettings;
  }): Promise<void>;
}

/** Every session belonging to a member of one organization, in the shape
 *  `SessionBoundService` needs to judge it. */
export interface SignInSecuritySessionsPort {
  forOrganization(args: {
    organizationId: string;
  }): Promise<readonly BoundableSession[]>;
}

/** Whether a person belongs to an organization — the tenancy check a release
 *  needs before it may act on somebody's lock. */
export interface SignInSecurityMembershipPort {
  isMember(args: { organizationId: string; userId: string }): Promise<boolean>;
}

/** A release, put on the record. */
export interface SignInSecurityReleaseEvidencePort {
  released(args: {
    organizationId: string;
    userId: string;
    actorUserId: string;
  }): Promise<void>;
}

/** Whether either rule is doing anything at all. */
function isActive(settings: {
  lockoutAfterFailedAttempts: number;
  sessionIdleTimeoutMinutes: number;
  sessionMaxLifetimeMinutes: number;
}): boolean {
  return (
    settings.lockoutAfterFailedAttempts > 0 ||
    settings.sessionIdleTimeoutMinutes > 0 ||
    settings.sessionMaxLifetimeMinutes > 0
  );
}

/**
 * Whether this write is the one that turns a rule on from fully off — the
 * only moment these enterprise-gated settings ask for the plan.
 *
 * Asymmetric on purpose, the same way `OrganizationMfaService.setRequirement`
 * is: adjusting numbers while a rule is already active, or turning either
 * rule further off, never asks again. An organization that activated one of
 * these while entitled and later lost the plan can still tune it or turn it
 * off; only a fresh activation is refused.
 *
 * Treated as ONE feature rather than two independent gates because the
 * settings card offers both rules together and prices them together — an
 * organization already active on either rule has already cleared this gate
 * once.
 */
export function willActivateSignInSecurity({
  current,
  next,
}: {
  current: {
    lockoutAfterFailedAttempts: number;
    sessionIdleTimeoutMinutes: number;
    sessionMaxLifetimeMinutes: number;
  };
  next: {
    lockoutAfterFailedAttempts: number;
    sessionIdleTimeoutMinutes: number;
    sessionMaxLifetimeMinutes: number;
  };
}): boolean {
  return !isActive(current) && isActive(next);
}

/**
 * Refuses a maximum session length that would make the idle timeout it is
 * offered beside unreachable.
 *
 * Zero (no ceiling) is always sensible, whatever the idle timeout is — this
 * only refuses a REAL ceiling that is tighter than the idle window it would
 * never let fire.
 */
export function assertSessionWindowSensible({
  sessionIdleTimeoutMinutes,
  sessionMaxLifetimeMinutes,
}: {
  sessionIdleTimeoutMinutes: number;
  sessionMaxLifetimeMinutes: number;
}): void {
  if (
    sessionMaxLifetimeMinutes > 0 &&
    sessionMaxLifetimeMinutes < sessionIdleTimeoutMinutes
  ) {
    throw new IdentitySessionMaxLifetimeTooShortError(
      `maximum session length of ${sessionMaxLifetimeMinutes} minutes is shorter than the idle timeout of ${sessionIdleTimeoutMinutes} minutes, which would make the idle timeout unreachable`,
    );
  }
}

/**
 * Ends every session, among this organization's members, that is already
 * past the window just saved.
 *
 * Spec: "Saving a window ends the sessions already past it" — turning this on
 * applies to the sessions already open, not only to ones minted after the
 * save. Runs `SessionBoundService.enforce` per session rather than
 * re-deriving the arithmetic here, so a member of two organizations is
 * correctly judged against the STRICTEST bound across all of them, not just
 * the one that was just saved (`enforce` asks the policy port, which reads
 * every membership).
 *
 * A settings save is rare — nothing on the sign-in or request path calls
 * this — so one `enforce` per session is the right trade against
 * re-implementing its own policy lookup here.
 */
export async function sweepSessionsPastWindow({
  organizationId,
  sessions,
  sessionBound,
}: {
  organizationId: string;
  sessions: Pick<SignInSecuritySessionsPort, "forOrganization">;
  sessionBound: Pick<SessionBoundService, "enforce">;
}): Promise<number> {
  const records = await sessions.forOrganization({ organizationId });

  let ended = 0;
  for (const session of records) {
    const verdict = await sessionBound.enforce({ session });
    if (!verdict.withinBound) ended += 1;
  }
  return ended;
}

/**
 * An administrator releases a member their organization holds after a fifth
 * consecutive lock-out (GAC-09).
 *
 * Membership is checked HERE, not left to the caller: `SignInLockoutService`
 * clears by userId alone, with no organization of its own to check against,
 * so an administrator's `organization:manage` grant on one organization must
 * not be usable to release a userId belonging to another.
 *
 * The release is put on the record with the administrator's own id whenever
 * it actually changed anything — spec: "the release is on his record with her
 * name on it". A release that cleared nothing (the account was not held)
 * writes no row: there is nothing to be evidence of.
 */
export async function releaseHeldAccount({
  organizationId,
  userId,
  actorUserId,
  membership,
  lockout,
  evidence,
}: {
  organizationId: string;
  userId: string;
  actorUserId: string;
  membership: Pick<SignInSecurityMembershipPort, "isMember">;
  lockout: Pick<SignInLockoutService, "release">;
  evidence: Pick<SignInSecurityReleaseEvidencePort, "released">;
}): Promise<{ released: boolean }> {
  if (!(await membership.isMember({ organizationId, userId }))) {
    throw new IdentityUserNotInOrganizationError(userId);
  }

  const cleared = await lockout.release({ userId });
  const released = cleared > 0;
  if (released) {
    await evidence.released({ organizationId, userId, actorUserId });
  }
  return { released };
}
