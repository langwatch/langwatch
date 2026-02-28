import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OrganizationUserRole, TeamUserRole, type PrismaClient } from "@prisma/client";
import { organizationRouter, LITE_MEMBER_VIEWER_ONLY_ERROR } from "../organization";
import { createInnerTRPCContext } from "../../trpc";
import { createTestApp, resetApp } from "~/server/app-layer";
import { globalForApp } from "~/server/app-layer/app";
import { PlanProviderService } from "~/server/app-layer/subscription/plan-provider";

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

vi.mock("../../../license-enforcement/license-enforcement.repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../license-enforcement/license-enforcement.repository")>();
  return {
    ...actual,
    LicenseEnforcementRepository: class {
      constructor() {
        // no-op stub
      }
    },
  };
});

vi.mock("../../../license-enforcement/license-limit-guard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../license-enforcement/license-limit-guard")>();
  return {
    ...actual,
    assertMemberTypeLimitNotExceeded: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("../../../license-enforcement/member-classification", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../license-enforcement/member-classification")>();
  return {
    ...actual,
    getRoleChangeType: vi.fn().mockReturnValue("no-change"),
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
    resetApp();

    // Wire App singleton with permissive PlanProvider mock values.
    globalForApp.__langwatch_app = createTestApp({
      planProvider: PlanProviderService.create({
        getActivePlan: vi.fn().mockResolvedValue({
          maxMembers: 100,
          maxMembersLite: 100,
          overrideAddingLimitations: true,
        }),
      } as any),
    });

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

  afterEach(() => {
    resetApp();
  });

  describe("updateTeamMemberRole", () => {
    it("rejects literal CUSTOM role payloads", async () => {
      await expect(
        caller.updateTeamMemberRole({
          teamId: "team-1",
          userId: "member-1",
          role: TeamUserRole.CUSTOM,
        }),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    });

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
          message: LITE_MEMBER_VIEWER_ONLY_ERROR,
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
          message: LITE_MEMBER_VIEWER_ONLY_ERROR,
        });
      });
    });
  });

  describe("updateMemberRole", () => {
    it("rejects team role updates with literal CUSTOM role payloads", async () => {
      await expect(
        caller.updateMemberRole({
          userId: "member-1",
          organizationId: "org-1",
          role: OrganizationUserRole.MEMBER,
          teamRoleUpdates: [
            {
              teamId: "team-1",
              userId: "member-1",
              role: TeamUserRole.CUSTOM,
            },
          ],
        }),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    });

    describe("when mutation reaches enforcement logic", () => {
      let fullTxMock: Record<string, Record<string, ReturnType<typeof vi.fn>>>;

      beforeEach(() => {
        fullTxMock = {
          team: {
            findUnique: vi.fn().mockResolvedValue({ organizationId: "org-1" }),
            findMany: vi.fn().mockResolvedValue([{ id: "team-1" }]),
          },
          organizationUser: {
            findUnique: vi.fn().mockResolvedValue({
              role: OrganizationUserRole.MEMBER,
            }),
            count: vi.fn().mockResolvedValue(2),
            update: vi.fn().mockResolvedValue({}),
          },
          teamUser: {
            findMany: vi.fn().mockResolvedValue([
              {
                teamId: "team-1",
                role: TeamUserRole.ADMIN,
                userId: "member-1",
                assignedRoleId: null,
                assignedRole: null,
              },
            ]),
            count: vi.fn().mockResolvedValue(2),
            update: vi.fn().mockResolvedValue({}),
          },
          customRole: {
            findUnique: vi.fn().mockResolvedValue({
              organizationId: "org-1",
              permissions: [],
            }),
          },
        };

        const prismaMock = {
          $transaction: vi.fn(
            async (callback: (tx: typeof fullTxMock) => unknown) =>
              callback(fullTxMock),
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

      describe("when target user is Lite Member", () => {
        it("rejects non-Viewer team role via teamRoleUpdates", async () => {
          await expect(
            caller.updateMemberRole({
              userId: "member-1",
              organizationId: "org-1",
              role: OrganizationUserRole.EXTERNAL,
              teamRoleUpdates: [
                {
                  teamId: "team-1",
                  userId: "member-1",
                  role: TeamUserRole.ADMIN,
                },
              ],
            }),
          ).rejects.toMatchObject({
            code: "BAD_REQUEST",
            message: LITE_MEMBER_VIEWER_ONLY_ERROR,
          });
        });

        it("rejects MEMBER team role via teamRoleUpdates", async () => {
          await expect(
            caller.updateMemberRole({
              userId: "member-1",
              organizationId: "org-1",
              role: OrganizationUserRole.EXTERNAL,
              teamRoleUpdates: [
                {
                  teamId: "team-1",
                  userId: "member-1",
                  role: TeamUserRole.MEMBER,
                },
              ],
            }),
          ).rejects.toMatchObject({
            code: "BAD_REQUEST",
            message: LITE_MEMBER_VIEWER_ONLY_ERROR,
          });
        });
      });

      describe("when changing org role to EXTERNAL without explicit team role updates", () => {
        it("auto-corrects team roles to Viewer", async () => {
          await caller.updateMemberRole({
            userId: "member-1",
            organizationId: "org-1",
            role: OrganizationUserRole.EXTERNAL,
          });

          expect(fullTxMock.teamUser!.update).toHaveBeenCalledWith(
            expect.objectContaining({
              data: expect.objectContaining({
                role: TeamUserRole.VIEWER,
              }),
            }),
          );
        });
      });
    });
  });
});
