import { describe, it, expect, vi, beforeEach } from "vitest";
import { OrganizationUserRole, TeamUserRole, type PrismaClient } from "@prisma/client";
import { organizationRouter } from "../organization";
import { createInnerTRPCContext } from "../../trpc";

vi.mock("../../../auditLog", () => ({
  auditLog: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../rbac")>();
  return {
    ...actual,
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
    skipPermissionCheck: ({ ctx, next }: any) => {
      ctx.permissionChecked = true;
      return next();
    },
  };
});

describe("organizationRouter member role validation", () => {
  let caller: ReturnType<typeof organizationRouter.createCaller>;
  let txMock: {
    team: { findUnique: ReturnType<typeof vi.fn> };
    organizationUser: { findUnique: ReturnType<typeof vi.fn> };
    customRole: { findUnique: ReturnType<typeof vi.fn> };
  };

  beforeEach(() => {
    vi.clearAllMocks();

    txMock = {
      team: {
        findUnique: vi.fn().mockResolvedValue({ organizationId: "org-1" }),
      },
      organizationUser: {
        findUnique: vi.fn().mockResolvedValue({ role: OrganizationUserRole.EXTERNAL }),
      },
      customRole: {
        findUnique: vi.fn().mockResolvedValue({
          organizationId: "org-1",
          permissions: [],
        }),
      },
    };

    const prismaMock = {
      $transaction: vi.fn(async (callback: (tx: typeof txMock) => unknown) =>
        callback(txMock),
      ),
    };

    const ctx = createInnerTRPCContext({
      session: {
        user: { id: "admin-user-id" },
        expires: "1",
      },
      permissionChecked: true,
      publiclyShared: false,
    });

    ctx.prisma = prismaMock as unknown as PrismaClient;
    caller = organizationRouter.createCaller(ctx);
  });

  describe("updateTeamMemberRole", () => {
    describe("when target user is Lite Member", () => {
      it("rejects built-in roles different from Viewer", async () => {
        await expect(
          caller.updateTeamMemberRole({
            teamId: "team-1",
            userId: "member-1",
            role: TeamUserRole.ADMIN,
          }),
        ).rejects.toMatchObject({
          code: "BAD_REQUEST",
          message: "Lite Member users can only have Viewer team role",
        });
      });

      it("rejects custom roles", async () => {
        await expect(
          caller.updateTeamMemberRole({
            teamId: "team-1",
            userId: "member-1",
            role: "custom:role-1",
            customRoleId: "role-1",
          }),
        ).rejects.toMatchObject({
          code: "BAD_REQUEST",
          message: "Lite Member users can only have Viewer team role",
        });
      });
    });
  });
});
