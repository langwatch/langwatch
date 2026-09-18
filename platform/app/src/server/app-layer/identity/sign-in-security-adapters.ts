import { createHmac } from "node:crypto";
import {
  type LockoutPolicy,
  type LockoutState,
  type SessionBound,
  strictestLockoutPolicy,
  strictestSessionBound,
} from "@langwatch/identity";
import { createLogger } from "@langwatch/observability";
import type { Prisma, PrismaClient } from "~/generated/prisma/client";
import type {
  BoundableSession,
  SessionActivityPort,
  SessionBoundPolicyPort,
  SessionEndPort,
} from "./session-bound.service";
import type { SessionRevocationService } from "./session-revocation.service";
import type {
  LockoutEvidencePort,
  LockoutIdentityPort,
  LockoutPolicyPort,
  LockoutStatePort,
} from "./sign-in-lockout.service";
import type {
  SignInSecurityMembershipPort,
  SignInSecurityReleaseEvidencePort,
  SignInSecuritySessionsPort,
  SignInSecuritySettings,
  SignInSecuritySettingsPort,
} from "./sign-in-security-settings";

/**
 * The reads and writes behind the two sign-in security rules an organization
 * can set: locking an account after repeated failures (GAC-09) and bounding
 * how long a browser session lasts (GAC-10). Prisma lives here so both
 * services stay decisions.
 *
 * Specs: specs/identity/org-account-lockout.feature,
 * specs/identity/org-session-lifetime.feature.
 */

const logger = createLogger("langwatch:identity:sign-in-security");

/**
 * How long an installation-wide answer is trusted before it is asked again.
 *
 * Both services ask "has anybody on this installation set one of these"
 * before doing anything else, and on the overwhelmingly common answer - no -
 * that question is the entire cost of the feature. Asking Postgres per
 * sign-in and per authenticated request would make the early-out more
 * expensive than what it avoids.
 *
 * Thirty seconds is the lag between an administrator saving a setting and the
 * installation-wide answer noticing. That lag NEVER delays enforcement for
 * the organization that just saved: the save itself sweeps the sessions
 * already past the new window, and this cache only governs how soon the
 * cheap early-out stops short-circuiting.
 */
const INSTALLATION_ANSWER_TTL_MS = 30_000;

/** One remembered answer, and when it stops being trusted. */
interface CachedAnswer<T> {
  value: T;
  readAt: number;
}

/**
 * Whether any organization on this installation locks accounts, and the
 * strictest rule among those that do.
 *
 * Aggregates ACROSS organizations deliberately, which is the one read in
 * either feature that is not tenant-scoped. It answers two questions: the
 * early-out above, and which rule governs an address that resolves to
 * nobody - see `SignInLockoutService.policyFor` for why an unknown address
 * must be governed by something rather than by nothing.
 */
export class PrismaLockoutPolicies implements LockoutPolicyPort {
  private installationAnswer: CachedAnswer<LockoutPolicy> | null = null;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly now: () => number = Date.now,
  ) {}

  async forUser({ userId }: { userId: string }): Promise<LockoutPolicy> {
    // THROUGH `Organization`, NOT `OrganizationUser`. Keyed only by `userId`,
    // `OrganizationUser` spans every organization at once, so the org-tenancy
    // guard refuses it (ADR-021) — and that refusal is a plain Error, so it
    // does not degrade to a handled failure on one screen: it is thrown
    // underneath `getServerAuthSession`, whose catch returns a null session,
    // which turns EVERY authenticated tRPC call on the installation into
    // UNAUTHORIZED while `/api/auth/get-session` still answers 200. The
    // browser therefore believes it is signed in and bounces between the
    // application and the sign-in screen.
    //
    // Dormant until an organization sets one of these, which is why it was
    // not seen: the read is only reached once `installationWide()` finds a
    // non-zero rule anywhere. A new organization now starts with a one-day
    // idle window, so the very first organization created after that default
    // landed is enough to reach it.
    //
    // `two-step-account.adapter.ts` hit exactly this and carries the same
    // fix: ask the organizations, filtered by membership, which is a shape
    // the guard accepts.
    const governing = await this.prisma.organization.findMany({
      where: { members: { some: { userId, disabledAt: null } } },
      select: { lockoutAfterFailedAttempts: true, lockoutMinutes: true },
    });
    return strictestLockoutPolicy(
      governing.map((organization) => ({
        afterFailedAttempts: organization.lockoutAfterFailedAttempts,
        lockMinutes: organization.lockoutMinutes,
      })),
    );
  }

  async installationWide(): Promise<LockoutPolicy> {
    const remembered = this.installationAnswer;
    if (
      remembered !== null &&
      this.now() - remembered.readAt < INSTALLATION_ANSWER_TTL_MS
    ) {
      return remembered.value;
    }

    // Only the organizations that lock, which on a deployment where nobody
    // has turned this on is none of them and reads no rows.
    const locking = await this.prisma.organization.findMany({
      where: { lockoutAfterFailedAttempts: { gt: 0 } },
      select: { lockoutAfterFailedAttempts: true, lockoutMinutes: true },
    });
    const value = strictestLockoutPolicy(
      locking.map((organization) => ({
        afterFailedAttempts: organization.lockoutAfterFailedAttempts,
        lockMinutes: organization.lockoutMinutes,
      })),
    );
    this.installationAnswer = { value, readAt: this.now() };
    return value;
  }

  /** Forgets the remembered answer, for a save that has just changed it. */
  forget(): void {
    this.installationAnswer = null;
  }
}

/** The consecutive-failure state for one address. */
export class PrismaLockoutState implements LockoutStatePort {
  constructor(private readonly prisma: PrismaClient) {}

  async read({
    identifierHash,
  }: {
    identifierHash: string;
  }): Promise<LockoutState | null> {
    const row = await this.prisma.signInAttemptLock.findUnique({
      where: { identifierHash },
      select: {
        failedCount: true,
        lockedUntil: true,
        consecutiveLockouts: true,
        heldForReview: true,
      },
    });
    return row;
  }

  async write({
    identifierHash,
    state,
    userId,
  }: {
    identifierHash: string;
    state: LockoutState;
    userId: string | null;
  }): Promise<void> {
    const row = {
      failedCount: state.failedCount,
      lockedUntil: state.lockedUntil,
      consecutiveLockouts: state.consecutiveLockouts,
      heldForReview: state.heldForReview,
      userId,
    };
    // An upsert rather than a read-then-write: two failed attempts racing for
    // the same address must not both insert, and the unique index on the hash
    // is what makes the second one an update.
    await this.prisma.signInAttemptLock.upsert({
      where: { identifierHash },
      create: { identifierHash, ...row },
      update: row,
    });
  }

  async clear({ identifierHash }: { identifierHash: string }): Promise<void> {
    await this.prisma.signInAttemptLock.deleteMany({
      where: { identifierHash },
    });
  }

  async clearForUser({ userId }: { userId: string }): Promise<number> {
    const { count } = await this.prisma.signInAttemptLock.deleteMany({
      where: { userId },
    });
    return count;
  }
}

/**
 * Whose account an address is, if anybody's.
 *
 * `User.email` rather than the identifier projection, because this must
 * answer for an address that has NO account at all without that being an
 * error - the whole design rests on an unknown address being counted exactly
 * like a known one, so "nobody" is an ordinary answer here.
 */
export class PrismaLockoutIdentity implements LockoutIdentityPort {
  constructor(private readonly prisma: PrismaClient) {}

  async userIdFor({
    identifier,
  }: {
    identifier: string;
  }): Promise<string | null> {
    const user = await this.prisma.user.findFirst({
      where: { email: { equals: identifier, mode: "insensitive" } },
      select: { id: true },
    });
    return user?.id ?? null;
  }
}

/**
 * Removes the lock-out rows that have stopped meaning anything, and returns
 * how many went (GAC-09).
 *
 * Driven by the `sign_in_lock_maintenance` process manager rather than an
 * interval loop, so the fleet runs it once rather than once per replica.
 *
 * It releases NOTHING. A held row has no date that will free it and only an
 * administrator or a proved mailbox clears it; a live lock still has time to
 * run. So a sweep that has not happened all week costs disk rather than
 * protection, and a lock survives every restart because it is a date in a row
 * and not a timer in a process.
 */
export async function reapFinishedSignInLocks({
  prisma,
  settledBefore,
}: {
  prisma: PrismaClient;
  settledBefore: Date;
}): Promise<number> {
  const { count } = await prisma.signInAttemptLock.deleteMany({
    where: {
      heldForReview: false,
      // The COUNT is why this waits rather than deleting the moment a lock
      // lifts: `failedCount` is what makes five failures over ten minutes
      // different from five over a year.
      updatedAt: { lt: settledBefore },
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: settledBefore } }],
    },
  });
  return count;
}

/**
 * A lock, written where an auditor can still read it months later.
 *
 * The audit log rather than the lock table, because the two answer different
 * questions and only one of them is evidence. `SignInAttemptLock` is protocol
 * state: it is overwritten by the next attempt and reaped once it stops
 * meaning anything, so a lock that happened in March leaves no trace in it by
 * April. GAC-09 asks us to show that locks happen and that repeated ones are
 * escalated, which needs a record that is appended rather than updated.
 *
 * `userId` is nullable on `AuditLog`, which is what lets a lock against an
 * address with no account be recorded at all rather than silently dropped -
 * and those are precisely the rows that show an attack rather than a
 * forgotten password.
 *
 * NOTHING HERE CARRIES A CREDENTIAL, and nothing carries the address either:
 * a trail that accumulated the passwords and addresses people typed would be
 * a worse breach than the one it exists to prevent.
 */
export class AuditLogLockoutEvidence implements LockoutEvidencePort {
  constructor(private readonly prisma: PrismaClient) {}

  async locked({
    userId,
    failedCount,
    consecutiveLockouts,
    lockedUntil,
  }: {
    userId: string | null;
    failedCount: number;
    consecutiveLockouts: number;
    lockedUntil: Date;
  }): Promise<void> {
    await this.write({
      action: "identity.sign_in.locked_out",
      userId,
      metadata: {
        failedCount,
        consecutiveLockouts,
        lockedUntil: lockedUntil.toISOString(),
        // Whether this was a real account is itself worth recording: a run of
        // locks against addresses that resolve to nobody is an attack, and a
        // run against one that resolves is usually somebody's bad morning.
        addressHadAccount: userId !== null,
      },
    });
  }

  async escalated({
    userId,
    consecutiveLockouts,
  }: {
    userId: string | null;
    consecutiveLockouts: number;
  }): Promise<void> {
    await this.write({
      action: "identity.sign_in.lockout_escalated",
      userId,
      metadata: { consecutiveLockouts, addressHadAccount: userId !== null },
    });
  }

  /**
   * Writes the row, and never lets its failure refuse a sign-in.
   *
   * The lock itself is already recorded in the state row by the time this
   * runs, so a failed audit write loses evidence rather than protection. The
   * log line is the backstop, and it names the action so the gap is findable.
   */
  private async write({
    action,
    userId,
    metadata,
  }: {
    action: string;
    userId: string | null;
    // The audit column's own type rather than a loose record: `metadata` is
    // JSON in Postgres, and Prisma will not accept a shape that might hold an
    // `undefined`.
    metadata: Prisma.InputJsonObject;
  }): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: { action, userId, metadata },
      });
    } catch (error) {
      logger.error(
        { error, action, ...metadata },
        "could not record a sign-in lock-out in the audit log; the lock itself stands",
      );
    }
  }
}

/**
 * The address, keyed-hashed for storage.
 *
 * Keyed, not a bare digest. Without the key the lock table is a list of every
 * address anybody has ever typed at our sign-in screen - including addresses
 * with no account here - recoverable by anyone who can read it against a
 * dictionary of email addresses, because the keyspace of email addresses is
 * small enough to enumerate.
 */
export function keyedIdentifierHasher(
  secret: string | undefined,
): (key: string) => string {
  return (key: string) => {
    // Fail closed rather than hash with nothing. An empty key turns this into
    // a plain SHA-256 of an email address, and the keyspace of email
    // addresses is small enough to enumerate - so the table would become the
    // recoverable list this function exists to prevent, while still looking
    // hashed. Refusing is safe because the caller only reaches here once an
    // organization has actually set a threshold.
    if (secret === undefined || secret.length === 0) {
      throw new Error(
        "cannot key the sign-in lock-out table: this deployment has no NEXTAUTH_SECRET",
      );
    }
    return (
      createHmac("sha256", secret)
        // Domain-separated, so the same deployment secret used for a different
        // purpose can never produce the same digest for the same input.
        .update(`langwatch:sign-in-lockout\u0000${key}`)
        .digest("base64url")
    );
  };
}

/** The strictest session bound among a person's organizations. */
export class PrismaSessionBoundPolicies implements SessionBoundPolicyPort {
  private installationAnswer: CachedAnswer<SessionBound> | null = null;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly now: () => number = Date.now,
  ) {}

  async forUser({ userId }: { userId: string }): Promise<SessionBound> {
    // THROUGH `Organization`, NOT `OrganizationUser`. Keyed only by `userId`,
    // `OrganizationUser` spans every organization at once, so the org-tenancy
    // guard refuses it (ADR-021) — and that refusal is a plain Error, so it
    // does not degrade to a handled failure on one screen: it is thrown
    // underneath `getServerAuthSession`, whose catch returns a null session,
    // which turns EVERY authenticated tRPC call on the installation into
    // UNAUTHORIZED while `/api/auth/get-session` still answers 200. The
    // browser therefore believes it is signed in and bounces between the
    // application and the sign-in screen.
    //
    // Dormant until an organization sets one of these, which is why it was
    // not seen: the read is only reached once `installationWide()` finds a
    // non-zero rule anywhere. A new organization now starts with a one-day
    // idle window, so the very first organization created after that default
    // landed is enough to reach it.
    //
    // `two-step-account.adapter.ts` hit exactly this and carries the same
    // fix: ask the organizations, filtered by membership, which is a shape
    // the guard accepts.
    const governing = await this.prisma.organization.findMany({
      where: { members: { some: { userId, disabledAt: null } } },
      select: {
        sessionIdleTimeoutMinutes: true,
        sessionMaxLifetimeMinutes: true,
      },
    });
    return strictestSessionBound(
      governing.map((organization) => ({
        idleTimeoutMinutes: organization.sessionIdleTimeoutMinutes,
        maxLifetimeMinutes: organization.sessionMaxLifetimeMinutes,
      })),
    );
  }

  async installationWide(): Promise<SessionBound> {
    const remembered = this.installationAnswer;
    if (
      remembered !== null &&
      this.now() - remembered.readAt < INSTALLATION_ANSWER_TTL_MS
    ) {
      return remembered.value;
    }

    const bounding = await this.prisma.organization.findMany({
      where: {
        OR: [
          { sessionIdleTimeoutMinutes: { gt: 0 } },
          { sessionMaxLifetimeMinutes: { gt: 0 } },
        ],
      },
      select: {
        sessionIdleTimeoutMinutes: true,
        sessionMaxLifetimeMinutes: true,
      },
    });
    const value = strictestSessionBound(
      bounding.map((organization) => ({
        idleTimeoutMinutes: organization.sessionIdleTimeoutMinutes,
        maxLifetimeMinutes: organization.sessionMaxLifetimeMinutes,
      })),
    );
    this.installationAnswer = { value, readAt: this.now() };
    return value;
  }

  forget(): void {
    this.installationAnswer = null;
  }
}

/** Recording that a session was used. */
export class PrismaSessionActivity implements SessionActivityPort {
  constructor(private readonly prisma: PrismaClient) {}

  async touch({
    sessionId,
    at,
  }: {
    sessionId: string;
    at: Date;
  }): Promise<void> {
    // `updateMany` rather than `update`, so a session that has just been
    // revoked by something else is a no-op instead of a throw on a row that
    // is gone.
    await this.prisma.session.updateMany({
      where: { id: sessionId },
      data: { lastSeenAt: at },
    });
  }
}

/**
 * Ending a session that is past its window.
 *
 * Delegates to the revocation service rather than deleting the row, because
 * the row is only half of a session: the cached copy in the shared store
 * would keep answering for up to thirty days, and a session refused in one
 * place and honoured in another has not ended.
 */
export class RevocationSessionEnd implements SessionEndPort {
  constructor(private readonly revocation: () => SessionRevocationService) {}

  async end({
    token,
    userId,
  }: {
    token: string;
    userId: string;
  }): Promise<void> {
    await this.revocation().revokeOne({ token, userId });
  }
}

/**
 * The four sign-in security settings columns on `Organization`, read and
 * written directly — the settings SURFACE's own store, distinct from the two
 * policy ports above, which answer the strictest rule across an installation
 * or a person's memberships rather than one organization's own saved values.
 */
export class PrismaSignInSecuritySettings
  implements SignInSecuritySettingsPort
{
  constructor(private readonly prisma: PrismaClient) {}

  async read({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<SignInSecuritySettings> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        lockoutAfterFailedAttempts: true,
        lockoutMinutes: true,
        sessionIdleTimeoutMinutes: true,
        sessionMaxLifetimeMinutes: true,
      },
    });
    return {
      lockoutAfterFailedAttempts: organization?.lockoutAfterFailedAttempts ?? 0,
      lockoutMinutes: organization?.lockoutMinutes ?? 30,
      sessionIdleTimeoutMinutes: organization?.sessionIdleTimeoutMinutes ?? 0,
      sessionMaxLifetimeMinutes: organization?.sessionMaxLifetimeMinutes ?? 0,
    };
  }

  async write({
    organizationId,
    settings,
  }: {
    organizationId: string;
    settings: SignInSecuritySettings;
  }): Promise<void> {
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { ...settings },
    });
  }
}

/**
 * Every session belonging to a member of one organization, for the sweep a
 * settings save runs (GAC-10) — a narrower read than the policy ports above,
 * which never name individual sessions.
 */
export class PrismaOrganizationSessions implements SignInSecuritySessionsPort {
  constructor(private readonly prisma: PrismaClient) {}

  async forOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<readonly BoundableSession[]> {
    const members = await this.prisma.organizationUser.findMany({
      where: { organizationId },
      select: { userId: true },
    });
    if (members.length === 0) return [];

    const sessions = await this.prisma.session.findMany({
      where: { userId: { in: members.map((member) => member.userId) } },
      select: {
        id: true,
        sessionToken: true,
        userId: true,
        createdAt: true,
        lastSeenAt: true,
        updatedAt: true,
      },
    });
    return sessions.map((session) => ({
      id: session.id,
      token: session.sessionToken,
      userId: session.userId,
      createdAt: session.createdAt,
      lastSeenAt: session.lastSeenAt,
      updatedAt: session.updatedAt,
    }));
  }
}

/**
 * Whether a person belongs to an organization — the tenancy check
 * `releaseHeldAccount` runs before it acts on a userId the caller's
 * `organization:manage` grant does not otherwise reach.
 */
export class PrismaOrganizationMembership
  implements SignInSecurityMembershipPort
{
  constructor(private readonly prisma: PrismaClient) {}

  async isMember({
    organizationId,
    userId,
  }: {
    organizationId: string;
    userId: string;
  }): Promise<boolean> {
    const membership = await this.prisma.organizationUser.findFirst({
      where: { organizationId, userId },
      select: { userId: true },
    });
    return membership !== null;
  }
}

/**
 * A lock-out release, put on the record with the administrator's own id
 * (GAC-09) — `AuditLog.actorUserId`, the same column an impersonation names
 * the real operator on, because a release is likewise an act one person takes
 * on another's record.
 */
export class AuditLogSignInSecurityReleaseEvidence
  implements SignInSecurityReleaseEvidencePort
{
  constructor(private readonly prisma: PrismaClient) {}

  async released({
    organizationId,
    userId,
    actorUserId,
  }: {
    organizationId: string;
    userId: string;
    actorUserId: string;
  }): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        action: "identity.sign_in.lock_released",
        userId,
        actorUserId,
        organizationId,
      },
    });
  }
}
