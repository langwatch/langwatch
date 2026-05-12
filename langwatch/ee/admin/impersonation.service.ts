import { Prisma, type PrismaClient } from "@prisma/client";
import { DomainError, NotFoundError } from "~/server/app-layer/domain-error";
import { isAdmin } from "./isAdmin";

/** Impersonation window handed to the UI once a start call succeeds. */
const IMPERSONATION_TTL_MS = 1000 * 60 * 60; // 1 hour

/**
 * Thrown when an admin attempts to impersonate a deactivated user. These
 * accounts have had their sessions revoked intentionally — allowing an
 * admin to re-enter them would defeat the revocation. Maps to HTTP 400
 * because the request itself is well-formed; only the target state is wrong.
 */
export class CannotImpersonateDeactivatedUserError extends DomainError {
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
export class CannotImpersonateAdminError extends DomainError {
  constructor(userId: string) {
    super(
      "cannot_impersonate_admin",
      "Cannot impersonate another admin",
      { httpStatus: 403, meta: { userId } },
    );
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

  static create(prisma: PrismaClient, auditLog: AuditLogFn): ImpersonationService {
    return new ImpersonationService(prisma, auditLog);
  }

  /**
   * Start an impersonation window on an existing BetterAuth session.
   *
   * Validates the target user, writes an audit log entry, and stores the
   * impersonating identity on the session row so the rest of the app can
   * read `session.user.impersonator` through `getServerAuthSession`.
   *
   * Throws (and does NOT mutate the session) when:
   *   - The target user does not exist → {@link UserToImpersonateNotFoundError}
   *   - The target is deactivated       → {@link CannotImpersonateDeactivatedUserError}
   *   - The target is an admin          → {@link CannotImpersonateAdminError}
   *
   * The audit log is written before the session mutation so a DB failure
   * during the update still leaves a trail of the *attempt* — matching the
   * behaviour of the previous inline handler.
   */
  async start(input: StartImpersonationInput): Promise<void> {
    const target = await this.prisma.user.findUnique({
      where: { id: input.userIdToImpersonate },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        deactivatedAt: true,
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

    await this.auditLog({
      userId: input.impersonatorUserId,
      action: "admin/impersonate",
      args: { userIdToImpersonate: target.id, reason: input.reason },
      req: input.req,
    });

    await this.prisma.session.update({
      where: { id: input.sessionId },
      data: {
        impersonating: {
          id: target.id,
          name: target.name,
          email: target.email,
          image: target.image,
          expires: new Date(Date.now() + IMPERSONATION_TTL_MS),
        },
      },
    });
  }

  /**
   * End the impersonation window on the given session. Idempotent at the
   * Prisma level — clearing an already-empty `impersonating` column is a
   * no-op.
   */
  async stop(input: StopImpersonationInput): Promise<void> {
    await this.prisma.session.update({
      where: { id: input.sessionId },
      data: { impersonating: Prisma.DbNull },
    });
  }
}
