/**
 * The sign-in security tRPC router: `get`/`save`/`release` wired to the
 * composed identity ports from `runtime.ts`, over a fake permission decision
 * so no database is needed — the same seam
 * `evaluators.tenant-workflow.unit.test.ts` and
 * `team.update.multi-binding.unit.test.ts` use (`ctx.app.permissions`).
 *
 * Specs: specs/identity/org-account-lockout.feature,
 * specs/identity/org-session-lifetime.feature.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createInnerTRPCContext } from "../../trpc";

// The tRPC boundary audits every mutation against real Postgres
// (`auditLogMutations` in `../../trpc.ts`) unless this is mocked — the same
// seam `team.update.multi-binding.unit.test.ts` mocks for the same reason.
vi.mock("@ee/audit-log/auditLog", () => ({
  auditLog: vi.fn(() => Promise.resolve()),
}));

vi.mock("~/server/app-layer/identity/runtime", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("~/server/app-layer/identity/runtime")
    >();
  return {
    ...actual,
    forgetSignInSecurityPolicies: vi.fn(),
    sessionBound: vi.fn(),
    signInLockout: vi.fn(),
    signInSecurityMembership: vi.fn(),
    signInSecurityReleaseEvidence: vi.fn(),
    signInSecuritySessions: vi.fn(),
    signInSecuritySettings: vi.fn(),
  };
});

vi.mock("../../enterprise", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../enterprise")>();
  return { ...actual, assertEnterprisePlan: vi.fn() };
});

const {
  forgetSignInSecurityPolicies,
  sessionBound,
  signInLockout,
  signInSecurityMembership,
  signInSecurityReleaseEvidence,
  signInSecuritySessions,
  signInSecuritySettings,
} = await import("~/server/app-layer/identity/runtime");
const { assertEnterprisePlan } = await import("../../enterprise");
const { signInSecurityRouter } = await import("../signInSecurity");

const OFF = {
  lockoutAfterFailedAttempts: 0,
  lockoutMinutes: 30,
  sessionIdleTimeoutMinutes: 0,
  sessionMaxLifetimeMinutes: 0,
};

/** A caller for "ana", permitted on every declared permission — the
 *  permission DECISION is faked; the router's own logic is not. */
function callerAs({
  userId = "ana",
  permitted = true,
}: {
  userId?: string;
  permitted?: boolean;
} = {}) {
  const ctx = createInnerTRPCContext({
    session: {
      user: { id: userId, email: `${userId}@acme.com`, name: userId },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    },
  });
  ctx.app = {
    permissions: {
      getDecision: vi.fn().mockResolvedValue({
        permitted,
        organizationRole: null,
        denialReason: permitted ? null : undefined,
      }),
    },
  } as never;
  // Off, deterministically, whatever the test env's flag happens to be —
  // this router's own gate is entitlement, not the second-factor gate.
  ctx.mfaGate = { offered: () => false } as never;
  return signInSecurityRouter.createCaller(ctx);
}

function settingsPort(read: typeof OFF) {
  return { read: vi.fn().mockResolvedValue(read), write: vi.fn() };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("signInSecurity.get", () => {
  it("reads through the composed settings port", async () => {
    const read = settingsPort(OFF);
    vi.mocked(signInSecuritySettings).mockReturnValue(read as never);

    const result = await callerAs().get({ organizationId: "acme" });

    expect(result).toEqual(OFF);
    expect(read.read).toHaveBeenCalledWith({ organizationId: "acme" });
  });

  it("refuses a caller the permission decision denies", async () => {
    vi.mocked(signInSecuritySettings).mockReturnValue(
      settingsPort(OFF) as never,
    );

    // The middleware raises UNAUTHORIZED, but the wire code the client sees
    // is re-derived from the handled cause's 403 — the caller IS
    // authenticated, they just lack the permission.
    await expect(
      callerAs({ permitted: false }).get({ organizationId: "acme" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("signInSecurity.save", () => {
  it("refuses a session window whose maximum is shorter than its idle timeout, before touching any port", async () => {
    const settings = settingsPort(OFF);
    vi.mocked(signInSecuritySettings).mockReturnValue(settings as never);

    await expect(
      callerAs().save({
        organizationId: "acme",
        lockoutAfterFailedAttempts: 0,
        lockoutMinutes: 30,
        sessionIdleTimeoutMinutes: 120,
        sessionMaxLifetimeMinutes: 60,
      }),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        code: "identity_session_max_lifetime_too_short",
      }),
    });
    expect(settings.read).not.toHaveBeenCalled();
    expect(settings.write).not.toHaveBeenCalled();
  });

  describe("given the organization is fully off and asks to turn a rule on", () => {
    it("checks the plan, and refuses without writing when it is not entitled", async () => {
      const settings = settingsPort(OFF);
      vi.mocked(signInSecuritySettings).mockReturnValue(settings as never);
      vi.mocked(assertEnterprisePlan).mockRejectedValue(
        Object.assign(new Error("needs Enterprise"), {
          code: "enterprise_plan_required",
        }),
      );

      await expect(
        callerAs().save({
          organizationId: "acme",
          lockoutAfterFailedAttempts: 5,
          lockoutMinutes: 30,
          sessionIdleTimeoutMinutes: 0,
          sessionMaxLifetimeMinutes: 0,
        }),
      ).rejects.toThrow("needs Enterprise");

      expect(assertEnterprisePlan).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "acme",
          errorMessage: expect.stringMatching(/enterprise plan/i),
        }),
      );
      expect(settings.write).not.toHaveBeenCalled();
      expect(forgetSignInSecurityPolicies).not.toHaveBeenCalled();
    });

    it("writes, forgets the cached policy answer, and sweeps sessions once entitled", async () => {
      const settings = settingsPort(OFF);
      vi.mocked(signInSecuritySettings).mockReturnValue(settings as never);
      vi.mocked(assertEnterprisePlan).mockResolvedValue(undefined);
      const enforce = vi
        .fn()
        .mockResolvedValueOnce({ withinBound: false, reason: "idle" })
        .mockResolvedValueOnce({ withinBound: true });
      vi.mocked(sessionBound).mockReturnValue({ enforce } as never);
      vi.mocked(signInSecuritySessions).mockReturnValue({
        forOrganization: vi.fn().mockResolvedValue([
          {
            id: "s1",
            token: "t1",
            userId: "sam",
            createdAt: new Date(),
            lastSeenAt: new Date(),
            updatedAt: new Date(),
          },
          {
            id: "s2",
            token: "t2",
            userId: "gil",
            createdAt: new Date(),
            lastSeenAt: new Date(),
            updatedAt: new Date(),
          },
        ]),
      } as never);

      const next = {
        organizationId: "acme",
        lockoutAfterFailedAttempts: 5,
        lockoutMinutes: 30,
        sessionIdleTimeoutMinutes: 0,
        sessionMaxLifetimeMinutes: 0,
      };
      const result = await callerAs().save(next);

      expect(settings.write).toHaveBeenCalledWith({
        organizationId: "acme",
        settings: {
          lockoutAfterFailedAttempts: 5,
          lockoutMinutes: 30,
          sessionIdleTimeoutMinutes: 0,
          sessionMaxLifetimeMinutes: 0,
        },
      });
      // Forgotten on every successful write — the installation-wide answer
      // both policy adapters cache is stale the moment this write lands.
      expect(forgetSignInSecurityPolicies).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ ok: true, sweptSessions: 1 });
    });
  });

  describe("given a rule is already active", () => {
    it("adjusts the numbers without asking the plan again", async () => {
      const active = { ...OFF, lockoutAfterFailedAttempts: 5 };
      const settings = settingsPort(active);
      vi.mocked(signInSecuritySettings).mockReturnValue(settings as never);
      vi.mocked(sessionBound).mockReturnValue({
        enforce: vi.fn().mockResolvedValue({ withinBound: true }),
      } as never);
      vi.mocked(signInSecuritySessions).mockReturnValue({
        forOrganization: vi.fn().mockResolvedValue([]),
      } as never);

      await callerAs().save({
        organizationId: "acme",
        lockoutAfterFailedAttempts: 8,
        lockoutMinutes: 30,
        sessionIdleTimeoutMinutes: 0,
        sessionMaxLifetimeMinutes: 0,
      });

      expect(assertEnterprisePlan).not.toHaveBeenCalled();
      expect(settings.write).toHaveBeenCalled();
      expect(forgetSignInSecurityPolicies).toHaveBeenCalled();
    });

    it("turns everything off without asking the plan", async () => {
      const active = { ...OFF, sessionIdleTimeoutMinutes: 60 };
      const settings = settingsPort(active);
      vi.mocked(signInSecuritySettings).mockReturnValue(settings as never);
      vi.mocked(sessionBound).mockReturnValue({
        enforce: vi.fn().mockResolvedValue({ withinBound: true }),
      } as never);
      vi.mocked(signInSecuritySessions).mockReturnValue({
        forOrganization: vi.fn().mockResolvedValue([]),
      } as never);

      await callerAs().save({ organizationId: "acme", ...OFF });

      expect(assertEnterprisePlan).not.toHaveBeenCalled();
      expect(settings.write).toHaveBeenCalledWith({
        organizationId: "acme",
        settings: OFF,
      });
    });
  });
});

describe("signInSecurity.release", () => {
  it("releases through the composed membership, lock-out and evidence ports", async () => {
    const release = vi.fn().mockResolvedValue(1);
    vi.mocked(signInLockout).mockReturnValue({ release } as never);
    const isMember = vi.fn().mockResolvedValue(true);
    vi.mocked(signInSecurityMembership).mockReturnValue({ isMember } as never);
    const released = vi.fn().mockResolvedValue(undefined);
    vi.mocked(signInSecurityReleaseEvidence).mockReturnValue({
      released,
    } as never);

    const result = await callerAs({ userId: "ana" }).release({
      organizationId: "acme",
      userId: "sam",
    });

    expect(result).toEqual({ released: true });
    expect(isMember).toHaveBeenCalledWith({
      organizationId: "acme",
      userId: "sam",
    });
    expect(release).toHaveBeenCalledWith({ userId: "sam" });
    expect(released).toHaveBeenCalledWith({
      organizationId: "acme",
      userId: "sam",
      actorUserId: "ana",
    });
  });
});
