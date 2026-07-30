/**
 * Router-level tests for the createInvites already-a-member guard.
 *
 * The guard itself is covered at the service level in
 * invite.service.unit.test.ts. What is covered here is the wiring: that the
 * organization.createInvites path actually calls it, and calls it before the
 * licence check, so an admin at their seat cap is told the real reason instead
 * of being sold an upgrade for a seat they already own.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InviteService } from "../../../invites/invite.service";
import { createInnerTRPCContext } from "../../trpc";
import { inviteRouter } from "../invite";

vi.mock("../../../../env.mjs", () => ({
  env: {
    SENDGRID_API_KEY: "test-key",
    BASE_HOST: "http://localhost:3000",
  },
}));

vi.mock("../../../auditLog", () => ({
  auditLog: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../../app-layer/app", () => ({
  getApp: () => ({
    usageLimits: {
      notifyResourceLimitReached: vi.fn().mockResolvedValue(undefined),
    },
    notifications: {
      sendSlackSignupEvent: vi.fn().mockResolvedValue(undefined),
    },
    nurturing: null,
  }),
}));

vi.mock("../../rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../rbac")>();
  return {
    ...actual,
    skipPermissionCheck: ({ ctx, next }: any) => {
      ctx.permissionChecked = true;
      return next();
    },
    checkOrganizationPermission:
      () =>
      async ({ ctx, next }: any) => {
        ctx.permissionChecked = true;
        return next();
      },
  };
});

describe("organization.createInvites", () => {
  let organizationUserFindFirst: ReturnType<typeof vi.fn>;
  let licenseLimitsSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    organizationUserFindFirst = vi.fn();
    // Spied, not stubbed away: the guard under test stays real, and the licence
    // check is only here to prove which of the two runs first.
    licenseLimitsSpy = vi
      .spyOn(InviteService.prototype, "checkLicenseLimits")
      .mockResolvedValue(undefined);
  });

  function createCaller() {
    const ctx = createInnerTRPCContext({
      session: {
        user: { id: "user-1", name: "Test User", email: "admin@example.com" },
        expires: "2099-01-01",
      },
    });
    (ctx as any).prisma = {
      organization: {
        findFirst: vi.fn().mockResolvedValue({ id: "org-1", members: [] }),
      },
      organizationUser: { findFirst: organizationUserFindFirst },
      team: { findMany: vi.fn().mockResolvedValue([]) },
      organizationInvite: { findFirst: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(),
    };
    return inviteRouter.createCaller(ctx);
  }

  function invite(email: string) {
    return {
      organizationId: "org-1",
      invites: [{ email, role: "MEMBER" as const }],
    };
  }

  describe("when the address already belongs to an organization member", () => {
    it("refuses with the already-a-member code", async () => {
      organizationUserFindFirst.mockResolvedValue({
        user: { email: "already@example.com" },
      });

      const caller = createCaller();

      // Asserted on the handled error's `code`, not its prose (ADR-045). At the
      // tRPC boundary the handled error is the `cause`; the outer TRPCError
      // carries only the mapped transport code.
      await expect(
        caller.createInvites(invite("already@example.com")),
      ).rejects.toMatchObject({
        code: "CONFLICT",
        cause: expect.objectContaining({
          code: "already_organization_member",
          meta: { email: "already@example.com" },
        }),
      });
    });

    it("refuses before the licence limit is consulted", async () => {
      organizationUserFindFirst.mockResolvedValue({
        user: { email: "already@example.com" },
      });

      const caller = createCaller();

      await caller.createInvites(invite("already@example.com")).catch(() => {});

      expect(licenseLimitsSpy).not.toHaveBeenCalled();
    });
  });

  describe("when the address belongs to nobody in the organization", () => {
    it("goes on to consult the licence limit", async () => {
      organizationUserFindFirst.mockResolvedValue(null);

      const caller = createCaller();

      await caller.createInvites(invite("new@example.com")).catch(() => {});

      expect(licenseLimitsSpy).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: "org-1" }),
      );
    });
  });
});
