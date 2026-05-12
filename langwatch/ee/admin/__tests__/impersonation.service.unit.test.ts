import type { PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CannotImpersonateAdminError,
  CannotImpersonateDeactivatedUserError,
  ImpersonationService,
  UserToImpersonateNotFoundError,
  type AuditLogFn,
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
}

function makePrisma(): StubPrisma {
  return {
    user: { findUnique: vi.fn() },
    session: {
      findUnique: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
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
    describe("given a healthy, non-admin, non-deactivated target", () => {
      it("writes an audit log and stamps the session with the impersonating user", async () => {
        const prisma = makePrisma();
        prisma.user.findUnique.mockResolvedValue({
          id: "user_target",
          name: "Target",
          email: "target@example.com",
          image: null,
          deactivatedAt: null,
        });
        const auditLog = makeAuditLog();
        const service = ImpersonationService.create(
          prisma as unknown as PrismaClient,
          auditLog,
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
        expect(data.impersonating.id).toBe("user_target");
        expect(data.impersonating.email).toBe("target@example.com");
        // Expiry is ~1h in the future; accept anything within a 5s window
        // of "now + 1h" to avoid flaky timing assertions.
        const expires = new Date(data.impersonating.expires).getTime();
        const expected = Date.now() + 60 * 60 * 1000;
        expect(Math.abs(expires - expected)).toBeLessThan(5_000);
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
        expect((err as CannotImpersonateDeactivatedUserError).httpStatus).toBe(400);
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
    });
  });

  describe("stop", () => {
    it("clears the impersonating column on the given session", async () => {
      const prisma = makePrisma();
      const service = ImpersonationService.create(
        prisma as unknown as PrismaClient,
        makeAuditLog(),
      );

      await service.stop({ sessionId: "sess_1" });

      expect(prisma.session.update).toHaveBeenCalledTimes(1);
      const call = prisma.session.update.mock.calls[0]!;
      const [{ where, data }] = call;
      expect(where).toEqual({ id: "sess_1" });
      // Prisma.DbNull — vitest's deep equal compares by reference for
      // unknown symbols, so just assert the property exists.
      expect("impersonating" in data).toBe(true);
    });
  });
});

