import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import { guardOrganizationId } from "~/utils/dbOrganizationIdProtection";
import {
  type AuditLogFn,
  CannotImpersonateAdminError,
  CannotImpersonateDeactivatedUserError,
  ImpersonationService,
  UserToImpersonateNotFoundError,
} from "../impersonation.service";

/**
 * Unit tests for the Backoffice impersonation service. The service is DI'd
 * so every dependency (PrismaClient, audit logger) is a stub here — no real
 * DB, no real auth stack. Covers the four explicit outcomes the service
 * contract promises:
 *
 *   1. Happy path: start writes an audit log + updates the session.
 *   2. Rejects impersonating a deactivated user (400).
 *   3. Rejects impersonating an admin (403).
 *   4. Rejects an unknown target user (404).
 *
 * Also covers `stop()` clearing the impersonating column.
 *
 * Admin detection is driven by `isAdmin()` which reads ADMIN_EMAILS from the
 * environment — we set it explicitly in the one test that needs it to keep
 * the rest of the suite independent of the developer's local env.
 */

interface StubSession {
  findUnique: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
}
interface StubUser {
  findUnique: ReturnType<typeof vi.fn>;
}
interface StubPrisma {
  user: StubUser;
  session: StubSession;
  organizationUser: { findMany: ReturnType<typeof vi.fn> };
}

function makePrisma(): StubPrisma {
  return {
    user: { findUnique: vi.fn() },
    session: {
      findUnique: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    /**
     * Not a stub that answers — the REAL organization-tenancy guard.
     *
     * This delegate used to resolve `[]` unconditionally, and that is exactly
     * how a top-level `organizationUser.findMany({ where: { userId, ... } })`
     * reached production: the guard refuses a query with no
     * single-organization predicate (ADR-021), so every impersonation answered
     * 500 while this suite stayed green. Running the guard here means a query
     * the database would refuse is a query these tests refuse too — the
     * service is expected to read memberships nested off the target row, which
     * never lands on this delegate at all.
     */
    organizationUser: {
      findMany: vi.fn(async (args: unknown) =>
        guardOrganizationId(
          { model: "OrganizationUser", action: "findMany", args },
          async () => [],
        ),
      ),
    },
  };
}

function makeAuditLog(): AuditLogFn & { calls: Parameters<AuditLogFn>[0][] } {
  const calls: Parameters<AuditLogFn>[0][] = [];
  const fn = (async (input) => {
    calls.push(input);
  }) as AuditLogFn & { calls: Parameters<AuditLogFn>[0][] };
  fn.calls = calls;
  return fn;
}

/**
 * The identity fork the session resolves an address through. Answers null by
 * default, which means "fall back to the legacy column" — the shape every
 * case here already assumed.
 */
const resolveIdentityEmail = vi.fn(async () => null as string | null);

describe("ImpersonationService", () => {
  const originalAdminEmails = process.env.ADMIN_EMAILS;

  beforeEach(() => {
    // Keep every test's admin detection deterministic.
    process.env.ADMIN_EMAILS = "root@langwatch.ai";
  });

  afterEach(() => {
    process.env.ADMIN_EMAILS = originalAdminEmails;
  });

  describe("start", () => {
    describe("given the target belongs to an organization requiring a second factor", () => {
      /**
       * The target row as the service now reads it: the memberships that
       * require a second factor ride along as a nested select, so the slugs
       * are part of the target rather than a second query.
       */
      const healthyTarget = (requiringOrganizationSlugs: string[] = []) => ({
        id: "user_target",
        name: "Target",
        email: "target@example.com",
        image: null,
        deactivatedAt: null,
        orgMemberships: requiringOrganizationSlugs.map((slug) => ({
          organization: { slug },
        })),
      });

      /** @scenario "Impersonating into an organization that requires it takes the operator's own" */
      it("refuses when the operator has not set one up, and stamps nothing", async () => {
        const prisma = makePrisma();
        prisma.user.findUnique
          .mockResolvedValueOnce(healthyTarget(["acme"]))
          // The operator's own account, read only because the target's
          // organization requires one.
          .mockResolvedValueOnce({ twoFactorEnabled: false });
        const auditLog = makeAuditLog();
        const service = ImpersonationService.create(
          prisma as unknown as PrismaClient,
          auditLog,
          resolveIdentityEmail,
        );

        const attempt = service.start({
          sessionId: "sess_1",
          impersonatorUserId: "user_admin",
          userIdToImpersonate: "user_target",
          reason: "Debugging trace #42",
          req: {},
        });

        await expect(attempt).rejects.toMatchObject({
          code: "cannot_impersonate_without_second_factor",
        });
        // Refused before anything happened: no window opened.
        expect(prisma.session.update).not.toHaveBeenCalled();
      });

      it("allows it when the operator has one of their own", async () => {
        const prisma = makePrisma();
        prisma.user.findUnique
          .mockResolvedValueOnce(healthyTarget(["acme"]))
          .mockResolvedValueOnce({ twoFactorEnabled: true });
        const service = ImpersonationService.create(
          prisma as unknown as PrismaClient,
          makeAuditLog(),
          resolveIdentityEmail,
        );

        await service.start({
          sessionId: "sess_1",
          impersonatorUserId: "user_admin",
          userIdToImpersonate: "user_target",
          reason: "Debugging trace #42",
          req: {},
        });

        expect(prisma.session.update).toHaveBeenCalled();
      });

      it("does not consult the operator when no organization requires one", async () => {
        const prisma = makePrisma();
        prisma.user.findUnique.mockResolvedValue(healthyTarget());
        const service = ImpersonationService.create(
          prisma as unknown as PrismaClient,
          makeAuditLog(),
          resolveIdentityEmail,
        );

        await service.start({
          sessionId: "sess_1",
          impersonatorUserId: "user_admin",
          userIdToImpersonate: "user_target",
          reason: "Debugging trace #42",
          req: {},
        });

        // Only the target was read. Nobody's own enrollment is anybody's
        // business until an organization actually asks for it.
        expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
        expect(prisma.session.update).toHaveBeenCalled();
      });

      /**
       * The regression that took production down, executed rather than
       * asserted about.
       *
       * "Which of this person's organizations require a factor" spans every
       * organization they belong to, so asking it as a top-level
       * `organizationUser.findMany` presents `guardOrganizationId` a query with
       * no single-organization predicate and the guard refuses it — a refusal
       * the customer met as "Couldn't impersonate the user", not as a skipped
       * check. The stub delegate above runs the real guard, so restoring that
       * query fails this test with the production error instead of shipping.
       *
       * The delegate going untouched is the invariant, not a detail: the
       * memberships have to arrive nested off the target row, where the guard
       * is right not to look. The clause itself is deliberately NOT compared
       * against a re-typed copy of itself — a hand-copied literal matches its
       * own copy no matter how far the real query drifts, which is the failure
       * mode this whole file exists to stop.
       */
      /** @scenario "Looking up the requirement decides the request rather than failing it" */
      it("asks for the memberships without a top-level OrganizationUser query", async () => {
        const prisma = makePrisma();
        prisma.user.findUnique
          // "acme" requires a factor, so the check runs in full rather than
          // short-circuiting on an empty membership list.
          .mockResolvedValueOnce(healthyTarget(["acme"]))
          .mockResolvedValueOnce({ twoFactorEnabled: true });
        const service = ImpersonationService.create(
          prisma as unknown as PrismaClient,
          makeAuditLog(),
          resolveIdentityEmail,
        );

        await service.start({
          sessionId: "sess_1",
          impersonatorUserId: "user_admin",
          userIdToImpersonate: "user_target",
          reason: "Debugging trace #42",
          req: {},
        });

        expect(prisma.organizationUser.findMany).not.toHaveBeenCalled();
        const [targetRead] = prisma.user.findUnique.mock.calls[0]!;
        expect(targetRead.select).toHaveProperty("orgMemberships");
        expect(prisma.session.update).toHaveBeenCalled();
      });
    });

    describe("given a healthy, non-admin, non-deactivated target", () => {
      /** @scenario "An impersonated session records both people" */
      it("records the operator as the actor and the target as the subject", async () => {
        const prisma = makePrisma();
        prisma.user.findUnique.mockResolvedValue({
          id: "user_target",
          name: "Target",
          email: "target@example.com",
          image: null,
          deactivatedAt: null,
          // Belongs to nothing that requires a second factor.
          orgMemberships: [],
        });
        const auditLog = makeAuditLog();
        const service = ImpersonationService.create(
          prisma as unknown as PrismaClient,
          auditLog,
          resolveIdentityEmail,
        );

        await service.start({
          sessionId: "sess_1",
          impersonatorUserId: "user_admin",
          userIdToImpersonate: "user_target",
          reason: "Debugging trace #42",
          req: { foo: "bar" },
        });

        expect(auditLog.calls).toEqual([
          {
            userId: "user_admin",
            action: "admin/impersonate",
            args: {
              userIdToImpersonate: "user_target",
              reason: "Debugging trace #42",
            },
            req: { foo: "bar" },
          },
        ]);
        expect(prisma.session.update).toHaveBeenCalledTimes(1);
        const call = prisma.session.update.mock.calls[0]!;
        const [{ where, data }] = call;
        expect(where).toEqual({ id: "sess_1" });
        expect(data.actorUserId).toBe("user_admin");
        expect(data.subjectUserId).toBe("user_target");
        // The reason rides beside both people, not only in the audit log.
        expect(data.impersonationReason).toBe("Debugging trace #42");
        // Expiry is ~1h in the future; accept anything within a 5s window
        // of "now + 1h" to avoid flaky timing assertions.
        const expires = new Date(data.impersonationExpiresAt).getTime();
        const expected = Date.now() + 60 * 60 * 1000;
        expect(Math.abs(expires - expected)).toBeLessThan(5_000);
      });

      /** @scenario "Starting an impersonation still takes a reason" */
      it("records the reason beside both people, not only in the audit log", async () => {
        const prisma = makePrisma();
        prisma.user.findUnique.mockResolvedValue({
          id: "user_target",
          name: "Target",
          email: "target@example.com",
          image: null,
          deactivatedAt: null,
          // The service's own select always asks for these, so a stub
          // without them is a target shape the database cannot return.
          orgMemberships: [],
        });
        const auditLog = makeAuditLog();
        const service = ImpersonationService.create(
          prisma as unknown as PrismaClient,
          auditLog,
          resolveIdentityEmail,
        );

        await service.start({
          sessionId: "sess_1",
          impersonatorUserId: "user_admin",
          userIdToImpersonate: "user_target",
          reason: "customer asked us to look",
          req: {},
        });

        const [{ data }] = prisma.session.update.mock.calls[0]!;
        expect(data.impersonationReason).toBe("customer asked us to look");
        expect(data.actorUserId).toBe("user_admin");
        expect(data.subjectUserId).toBe("user_target");
        expect(auditLog.calls[0]?.args).toMatchObject({
          reason: "customer asked us to look",
        });
      });

      /** @scenario "An impersonated session records both people" */
      it("writes nothing to the legacy impersonation payload", async () => {
        const prisma = makePrisma();
        prisma.user.findUnique.mockResolvedValue({
          id: "user_target",
          name: "Target",
          email: "target@example.com",
          image: null,
          deactivatedAt: null,
          orgMemberships: [],
        });
        const service = ImpersonationService.create(
          prisma as unknown as PrismaClient,
          makeAuditLog(),
          resolveIdentityEmail,
        );

        await service.start({
          sessionId: "sess_1",
          impersonatorUserId: "user_admin",
          userIdToImpersonate: "user_target",
          reason: "Debugging trace #42",
          req: {},
        });

        const [{ data }] = prisma.session.update.mock.calls[0]!;
        expect("impersonating" in data).toBe(false);
        // Nor a copy of the subject's own details, which is what went stale
        // the moment either person changed theirs.
        expect("name" in data).toBe(false);
        expect("email" in data).toBe(false);
      });
    });

    describe("given the target user does not exist", () => {
      it("throws UserToImpersonateNotFoundError and leaves the session untouched", async () => {
        const prisma = makePrisma();
        prisma.user.findUnique.mockResolvedValue(null);
        const auditLog = makeAuditLog();
        const service = ImpersonationService.create(
          prisma as unknown as PrismaClient,
          auditLog,
          resolveIdentityEmail,
        );

        await expect(
          service.start({
            sessionId: "sess_1",
            impersonatorUserId: "user_admin",
            userIdToImpersonate: "user_missing",
            reason: "…",
            req: null,
          }),
        ).rejects.toBeInstanceOf(UserToImpersonateNotFoundError);

        expect(prisma.session.update).not.toHaveBeenCalled();
        expect(auditLog.calls).toHaveLength(0);
      });
    });

    describe("given the target user is deactivated", () => {
      it("throws CannotImpersonateDeactivatedUserError with 400 status", async () => {
        const prisma = makePrisma();
        prisma.user.findUnique.mockResolvedValue({
          id: "user_deactivated",
          name: null,
          email: "shadow@example.com",
          image: null,
          deactivatedAt: new Date("2026-01-01"),
        });
        const service = ImpersonationService.create(
          prisma as unknown as PrismaClient,
          makeAuditLog(),
          resolveIdentityEmail,
        );

        const err = await service
          .start({
            sessionId: "sess_1",
            impersonatorUserId: "user_admin",
            userIdToImpersonate: "user_deactivated",
            reason: "…",
            req: null,
          })
          .catch((e) => e);

        expect(err).toBeInstanceOf(CannotImpersonateDeactivatedUserError);
        expect((err as CannotImpersonateDeactivatedUserError).httpStatus).toBe(
          400,
        );
        expect(prisma.session.update).not.toHaveBeenCalled();
      });
    });

    describe("given the target user is themselves an admin", () => {
      it("throws CannotImpersonateAdminError with 403 status", async () => {
        const prisma = makePrisma();
        prisma.user.findUnique.mockResolvedValue({
          id: "user_other_admin",
          name: "Other Admin",
          // Match ADMIN_EMAILS set in beforeEach — isAdmin is case-insensitive.
          email: "Root@Langwatch.ai",
          image: null,
          deactivatedAt: null,
        });
        const service = ImpersonationService.create(
          prisma as unknown as PrismaClient,
          makeAuditLog(),
          resolveIdentityEmail,
        );

        const err = await service
          .start({
            sessionId: "sess_1",
            impersonatorUserId: "user_admin",
            userIdToImpersonate: "user_other_admin",
            reason: "…",
            req: null,
          })
          .catch((e) => e);

        expect(err).toBeInstanceOf(CannotImpersonateAdminError);
        expect((err as CannotImpersonateAdminError).httpStatus).toBe(403);
        expect(prisma.session.update).not.toHaveBeenCalled();
      });

      it("still refuses when their admin address is only on their identifier", async () => {
        // ADR-101 §5: once a user's backfill is finalized their address lives
        // on the identifier and `User.email` is a stale copy. The session's
        // admin gate reads the resolved one, so a guard reading the column
        // would let an operator whose ADMIN_EMAILS address moved be
        // impersonated — the admin-to-admin hop this refusal exists to stop.
        const prisma = makePrisma();
        prisma.user.findUnique.mockResolvedValue({
          id: "user_other_admin",
          name: "Other Admin",
          // The stale copy, which is NOT in ADMIN_EMAILS.
          email: "old-address@example.com",
          image: null,
          deactivatedAt: null,
        });
        resolveIdentityEmail.mockResolvedValueOnce("root@langwatch.ai");

        const service = ImpersonationService.create(
          prisma as unknown as PrismaClient,
          makeAuditLog(),
          resolveIdentityEmail,
        );

        const err = await service
          .start({
            sessionId: "sess_1",
            impersonatorUserId: "user_admin",
            userIdToImpersonate: "user_other_admin",
            reason: "…",
            req: null,
          })
          .catch((e) => e);

        expect(err).toBeInstanceOf(CannotImpersonateAdminError);
        expect(prisma.session.update).not.toHaveBeenCalled();
      });
    });
  });

  describe("stop", () => {
    /** @scenario "The banner and the way out keep working on the new claims" */
    it("clears both halves of the claim and ends no session", async () => {
      const prisma = makePrisma();
      const service = ImpersonationService.create(
        prisma as unknown as PrismaClient,
        makeAuditLog(),
        resolveIdentityEmail,
      );

      await service.stop({ sessionId: "sess_1" });

      expect(prisma.session.update).toHaveBeenCalledTimes(1);
      const call = prisma.session.update.mock.calls[0]!;
      const [{ where, data }] = call;
      expect(where).toEqual({ id: "sess_1" });
      expect(data).toEqual({
        actorUserId: null,
        subjectUserId: null,
        impersonationReason: null,
        impersonationExpiresAt: null,
      });
    });
  });
});
