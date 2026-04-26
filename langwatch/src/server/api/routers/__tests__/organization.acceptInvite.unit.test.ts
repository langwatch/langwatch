/**
 * Unit tests for acceptInvite status guard.
 *
 * Regression tests for #450: acceptInvite must require status === "PENDING"
 * before applying the invite. Non-PENDING statuses (PAYMENT_PENDING,
 * WAITING_APPROVAL) must be rejected with BAD_REQUEST.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { organizationRouter } from "../organization";
import { createInnerTRPCContext } from "../../trpc";
import {
  INVITE_ALREADY_ACCEPTED_MESSAGE,
  INVITE_NOT_READY_MESSAGE,
} from "../../../invites/errors";

vi.mock("../../../../env.mjs", () => ({
  env: {
    SENDGRID_API_KEY: "test-key",
    BASE_HOST: "http://localhost:3000",
  },
}));

vi.mock("../../../auditLog", () => ({
  auditLog: vi.fn(() => Promise.resolve()),
}));

// PersonalWorkspaceService.ensure() is hooked into acceptInvite (since
// 651e0c1b2) and runs outside the invite tx for fault isolation. The
// service opens its own Prisma transaction and walks Team/Project
// findFirst+create methods that this test's invite-shape tx mock
// doesn't provide. We stub the ensure() call at the test boundary —
// the unit's purpose is acceptInvite status-guard behaviour, not
// personal-workspace internals (those have their own integration
// test at personalWorkspace.service.integration.test.ts).
vi.mock("../../../governance/personalWorkspace.service", () => ({
  PersonalWorkspaceService: class {
    constructor(_prisma: unknown) {}
    async ensure(_args: unknown) {
      return {
        team: { id: "stub-team", isPersonal: true, ownerUserId: "user-1" },
        project: { id: "stub-project", isPersonal: true, ownerUserId: "user-1" },
        created: false,
      };
    }
  },
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
    checkTeamPermission:
      () =>
      async ({ ctx, next }: any) => {
        ctx.permissionChecked = true;
        return next();
      },
  };
});

function makeInvite(overrides: Record<string, unknown> = {}) {
  return {
    id: "inv-1",
    email: "user@example.com",
    inviteCode: "test-code",
    status: "PENDING",
    expiration: new Date(Date.now() + 86400000),
    organizationId: "org-1",
    teamIds: "team-1",
    teamAssignments: null,
    role: "MEMBER",
    requestedBy: null,
    subscriptionId: null,
    organization: { id: "org-1", name: "Test Org" },
    ...overrides,
  };
}

describe("organization.acceptInvite", () => {
  let findUniqueMock: ReturnType<typeof vi.fn>;
  let transactionMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    findUniqueMock = vi.fn();
    transactionMock = vi.fn();
  });

  function createCaller(email = "user@example.com") {
    const ctx = createInnerTRPCContext({
      session: {
        user: { id: "user-1", name: "Test User", email },
        expires: "2099-01-01",
      },
    });
    (ctx as any).prisma = {
      organizationInvite: { findUnique: findUniqueMock },
      project: { findFirst: vi.fn().mockResolvedValue(null) },
      $transaction: transactionMock,
    };
    return organizationRouter.createCaller(ctx);
  }

  describe("when invite status is PENDING", () => {
    it("proceeds to apply the invite", async () => {
      findUniqueMock.mockResolvedValue(makeInvite({ status: "PENDING" }));
      transactionMock.mockImplementation(async (fn: any) => {
        // Simulate successful transaction — the actual applyInvite
        // internals are not under test here
        await fn({
          organizationUser: { createMany: vi.fn() },
          roleBinding: { deleteMany: vi.fn(), create: vi.fn() },
          organizationInvite: {
            update: vi.fn().mockResolvedValue(makeInvite({ status: "ACCEPTED" })),
            findFirst: vi.fn().mockResolvedValue(null),
          },
          project: { findFirst: vi.fn().mockResolvedValue(null) },
        });
      });

      const caller = createCaller();
      const result = await caller.acceptInvite({ inviteCode: "test-code" });

      expect(result.success).toBe(true);
      // Only ONE $transaction call is observed by the mock — the
      // invite-apply tx. PersonalWorkspaceService is stubbed at the
      // module boundary (above) so its internal tx never reaches the
      // test's $transaction mock; that path is covered by
      // personalWorkspace.service.integration.test.ts instead.
      expect(transactionMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("when invite status is PAYMENT_PENDING", () => {
    it("rejects with BAD_REQUEST", async () => {
      findUniqueMock.mockResolvedValue(
        makeInvite({ status: "PAYMENT_PENDING", expiration: null })
      );

      const caller = createCaller();

      await expect(
        caller.acceptInvite({ inviteCode: "test-code" })
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: INVITE_NOT_READY_MESSAGE,
      });
    });

    it("does not call the transaction", async () => {
      findUniqueMock.mockResolvedValue(
        makeInvite({ status: "PAYMENT_PENDING", expiration: null })
      );

      const caller = createCaller();

      await caller
        .acceptInvite({ inviteCode: "test-code" })
        .catch(() => {});

      expect(transactionMock).not.toHaveBeenCalled();
    });
  });

  describe("when invite status is WAITING_APPROVAL", () => {
    it("rejects with BAD_REQUEST", async () => {
      findUniqueMock.mockResolvedValue(
        makeInvite({ status: "WAITING_APPROVAL", expiration: null })
      );

      const caller = createCaller();

      await expect(
        caller.acceptInvite({ inviteCode: "test-code" })
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: INVITE_NOT_READY_MESSAGE,
      });
    });

    it("does not call the transaction", async () => {
      findUniqueMock.mockResolvedValue(
        makeInvite({ status: "WAITING_APPROVAL", expiration: null })
      );

      const caller = createCaller();

      await caller
        .acceptInvite({ inviteCode: "test-code" })
        .catch(() => {});

      expect(transactionMock).not.toHaveBeenCalled();
    });
  });

  describe("when invite status is ACCEPTED", () => {
    it("rejects with the already-accepted message", async () => {
      findUniqueMock.mockResolvedValue(makeInvite({ status: "ACCEPTED" }));

      const caller = createCaller();

      await expect(
        caller.acceptInvite({ inviteCode: "test-code" })
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: INVITE_ALREADY_ACCEPTED_MESSAGE,
      });
    });
  });
});
