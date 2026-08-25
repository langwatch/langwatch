import { HandledError, NotFoundError } from "@langwatch/handled-error";
import { CannotImpersonateWithoutSecondFactorError } from "@langwatch/identity";
import type { PrismaClient } from "~/generated/prisma/client";
import { isAdmin } from "./isAdmin";

/** Impersonation window handed to the UI once a start call succeeds. */
const IMPERSONATION_TTL_MS = 1000 * 60 * 60; // 1 hour

/**
 * Thrown when an admin attempts to impersonate a deactivated user. These
 * accounts have had their sessions revoked intentionally — allowing an
 * admin to re-enter them would defeat the revocation. Maps to HTTP 400
 * because the request itself is well-formed; only the target state is wrong.
 */
export class CannotImpersonateDeactivatedUserError extends HandledError {
  constructor(userId: string) {
    super(
      "cannot_impersonate_deactivated_user",
      "Cannot impersonate a deactivated user",
      { httpStatus: 400, meta: { userId } },
    );
    this.name = "CannotImpersonateDeactivatedUserError";
  }
}

/**
 * Thrown when an admin tries to impersonate another admin. Prevents a
 * malicious (or compromised) admin from hopping between admin identities
 * and washing out the audit trail. Maps to HTTP 403 because the action is
 * deliberately denied, not a system failure — clients should render an
 * "impersonation not permitted" message, not retry.
 */
export class CannotImpersonateAdminError extends HandledError {
  constructor(userId: string) {
    super("cannot_impersonate_admin", "Cannot impersonate another admin", {
      httpStatus: 403,
      meta: { userId },
    });
    this.name = "CannotImpersonateAdminError";
  }
}

/**
 * Thrown when the requested impersonation target does not exist in the DB.
 * Maps to HTTP 404.
 */
export class UserToImpersonateNotFoundError extends NotFoundError {
  constructor(userId: string) {
    super("user_to_impersonate_not_found", "User to impersonate", userId);
    this.name = "UserToImpersonateNotFoundError";
  }
}

/**
 * Minimum shape of the audit logger the service needs. Kept structural so
 * tests can inject a stub without pulling the real ~/server/auditLog module
 * and its transitive OTel/DB dependencies.
 */
export type AuditLogFn = (input: {
  userId: string;
  action: string;
  args: Record<string, unknown>;
  req: unknown;
}) => Promise<void>;

export interface StartImpersonationInput {
  sessionId: string;
  impersonatorUserId: string;
  userIdToImpersonate: string;
  reason: string;
  req: unknown;
}

export interface StopImpersonationInput {
  sessionId: string;
}

/**
 * Service that starts and stops Backoffice impersonation sessions.
 *
 * Lives under `ee/admin/` because impersonation is strictly an admin
 * (Backoffice) operation — it is not exposed to regular tenants.
 *
 * Dependencies are injected through the constructor so both the Hono route
 * and unit tests can supply their own `PrismaClient` and audit-log sink.
 * Avoids reaching into the `prisma` global or the `auditLog` import from
 * inside service logic (per the project's no-abstraction-leaks rule in
 * `CLAUDE.md`).
 */
export class ImpersonationService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly auditLog: AuditLogFn,
  ) {}

  static create(
    prisma: PrismaClient,
    auditLog: AuditLogFn,
  ): ImpersonationService {
    return new ImpersonationService(prisma, auditLog);
  }

  /**
   * Start an impersonation window on an existing BetterAuth session.
   *
   * Validates the target user, writes an audit log entry, and stores the
   * `{actor, subject}` claims on the session row so the rest of the app can
   * read `session.principal` and `session.user.impersonator` through
   * `getServerAuthSession` (D06). The reason is stored beside both people,
   * not only in the audit log, so a request made under an impersonation
   * carries its own justification.
   *
   * Throws (and does NOT mutate the session) when:
   *   - The target user does not exist → {@link UserToImpersonateNotFoundError}
   *   - The target is deactivated       → {@link CannotImpersonateDeactivatedUserError}
   *   - The target is an admin          → {@link CannotImpersonateAdminError}
   *   - The target belongs to an organization requiring a second factor and
   *     the OPERATOR has not set one up
   *     → {@link CannotImpersonateWithoutSecondFactorError}
   *
   * The audit log is written before the session mutation so a DB failure
   * during the update still leaves a trail of the *attempt* — matching the
   * behaviour of the previous inline handler.
   */
  /**
   * Borrowing somebody's access inside an organization that requires a second
   * factor requires one on the OPERATOR'S own account (D06).
   *
   * The requirement is about the operator, not the target, and that is the
   * whole point: impersonation would otherwise be a way to reach an
   * organization's data while holding less than its own members must hold.
   * A person who has set one up is challenged at every sign-in, so
   * `twoFactorEnabled` is the durable answer and no session evidence can add
   * to it.
   *
   * Reads the TARGET's organizations, because those are the ones whose data
   * the operator is about to see. Those slugs are read off the target row in
   * `start` rather than here — see the note on that query.
   */
  private async assertOperatorCanProveSecondFactor({
    operatorUserId,
    targetUserId,
    requiringOrganizationSlugs,
  }: {
    operatorUserId: string;
    targetUserId: string;
    requiringOrganizationSlugs: readonly string[];
  }): Promise<void> {
    if (requiringOrganizationSlugs.length === 0) return;

    const operator = await this.prisma.user.findUnique({
      where: { id: operatorUserId },
      select: { twoFactorEnabled: true },
    });
    if (operator?.twoFactorEnabled) return;

    throw new CannotImpersonateWithoutSecondFactorError(
      `impersonate: operator ${operatorUserId} has no second factor; target ${targetUserId} belongs to ${requiringOrganizationSlugs.join(
        ", ",
      )}`,
    );
  }

  async start(input: StartImpersonationInput): Promise<void> {
    /**
     * The target, plus the memberships that decide whether the operator needs
     * a second factor of their own.
     *
     * The memberships ride along as a NESTED read on purpose. "Which of this
     * person's organizations require a factor" is a question about one person
     * across many organizations, so a top-level
     * `organizationUser.findMany({ where: { userId, ... } })` carries no
     * single-organization predicate and `guardOrganizationId` (ADR-021)
     * rejects it outright — which is exactly what took every impersonation
     * down with a 500 rather than merely skipping the check. The guard runs on
     * top-level model operations (`$allOperations` in `src/server/db.ts`), so
     * reading the memberships through the target row asks the same question
     * without presenting the guard a query it must refuse. Same reason, same
     * shape as the nurturing lookup in `src/server/better-auth/hooks.ts`.
     *
     * It also costs one round trip instead of two.
     */
    const target = await this.prisma.user.findUnique({
      where: { id: input.userIdToImpersonate },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        deactivatedAt: true,
        orgMemberships: {
          where: { organization: { mfaRequired: true } },
          select: { organization: { select: { slug: true } } },
        },
      },
    });

    if (!target) {
      throw new UserToImpersonateNotFoundError(input.userIdToImpersonate);
    }
    if (target.deactivatedAt) {
      throw new CannotImpersonateDeactivatedUserError(target.id);
    }
    if (isAdmin(target)) {
      throw new CannotImpersonateAdminError(target.id);
    }
    await this.assertOperatorCanProveSecondFactor({
      operatorUserId: input.impersonatorUserId,
      targetUserId: target.id,
      requiringOrganizationSlugs: target.orgMemberships.map(
        (membership) => membership.organization.slug,
      ),
    });

    await this.auditLog({
      userId: input.impersonatorUserId,
      action: "admin/impersonate",
      args: { userIdToImpersonate: target.id, reason: input.reason },
      req: input.req,
    });

    // The {actor, subject} claims, which is the shape the authz principal
    // already speaks (D06). The operator is the actor and stays the session's
    // own user; the target is the subject. Nothing here copies the target's
    // name, e-mail or picture onto the session — the legacy payload did, and
    // it went stale the moment either of them changed.
    await this.prisma.session.update({
      where: { id: input.sessionId },
      data: {
        actorUserId: input.impersonatorUserId,
        subjectUserId: target.id,
        impersonationReason: input.reason,
        impersonationExpiresAt: new Date(Date.now() + IMPERSONATION_TTL_MS),
      },
    });
  }

  /**
   * End the impersonation window on the given session. Idempotent at the
   * Prisma level — clearing claims that are already empty is a no-op, and the
   * operator's own session is untouched either way: stopping returns them to
   * themselves rather than signing them out.
   */
  async stop(input: StopImpersonationInput): Promise<void> {
    await this.prisma.session.update({
      where: { id: input.sessionId },
      data: {
        actorUserId: null,
        subjectUserId: null,
        impersonationReason: null,
        impersonationExpiresAt: null,
      },
    });
  }
}
