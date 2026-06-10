import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { RoleBindingScopeType, TeamUserRole } from "@prisma/client";
import { apiKeyRouter } from "../apiKey";
import { createInnerTRPCContext } from "../../trpc";

vi.mock("nanoid", () => ({
  nanoid: vi.fn(() => "mock-nano-id"),
  customAlphabet: vi.fn(
    () => () => "mock48characterrandomstringforapikeygeneration",
  ),
}));

vi.mock("../../rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../rbac")>();
  return {
    ...actual,
    skipPermissionCheck:
      () =>
      async ({ ctx, next }: any) => {
        ctx.permissionChecked = true;
        return next();
      },
  };
});

vi.mock("../../../auditLog", () => ({
  auditLog: vi.fn(() => Promise.resolve()),
}));

const ORG_ID = "org_1";
const USER_ID = "user_1";
const ACTIVE_PROJECT_ID = "project_active";
const ARCHIVED_PROJECT_ID = "project_archived";

function buildMockPrisma() {
  return {
    organizationUser: {
      findFirst: vi.fn().mockResolvedValue({ userId: USER_ID }),
    },
    roleBinding: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: "rb_1",
          role: TeamUserRole.ADMIN,
          customRoleId: null,
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: ORG_ID,
        },
        {
          id: "rb_2",
          role: TeamUserRole.ADMIN,
          customRoleId: null,
          scopeType: RoleBindingScopeType.PROJECT,
          scopeId: ACTIVE_PROJECT_ID,
        },
        {
          id: "rb_3",
          role: TeamUserRole.ADMIN,
          customRoleId: null,
          scopeType: RoleBindingScopeType.PROJECT,
          scopeId: ARCHIVED_PROJECT_ID,
        },
      ]),
    },
    organization: {
      findMany: vi
        .fn()
        .mockResolvedValue([{ id: ORG_ID, name: "Test Org" }]),
    },
    team: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    project: {
      findMany: vi.fn().mockResolvedValue([
        { id: ACTIVE_PROJECT_ID, name: "Active Project" },
      ]),
    },
    customRole: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  } as unknown as PrismaClient;
}

describe("apiKey.myBindings", () => {
  let caller: ReturnType<typeof apiKeyRouter.createCaller>;
  let mockPrisma: PrismaClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma = buildMockPrisma();

    const ctx = createInnerTRPCContext({
      session: {
        user: { id: USER_ID },
        expires: "1",
      },
      req: undefined,
      res: undefined,
      permissionChecked: true,
      publiclyShared: false,
    });

    ctx.prisma = mockPrisma;
    caller = apiKeyRouter.createCaller(ctx);
  });

  describe("when user has bindings to both active and archived projects", () => {
    it("excludes bindings to archived projects", async () => {
      const result = await caller.myBindings({ organizationId: ORG_ID });

      const projectBindings = result.filter(
        (b) => b.scopeType === RoleBindingScopeType.PROJECT,
      );

      expect(projectBindings).toHaveLength(1);
      expect(projectBindings[0]!.scopeId).toBe(ACTIVE_PROJECT_ID);
      expect(
        result.find((b) => b.scopeId === ARCHIVED_PROJECT_ID),
      ).toBeUndefined();
    });

    it("keeps organization-scoped bindings unchanged", async () => {
      const result = await caller.myBindings({ organizationId: ORG_ID });

      const orgBindings = result.filter(
        (b) => b.scopeType === RoleBindingScopeType.ORGANIZATION,
      );

      expect(orgBindings).toHaveLength(1);
      expect(orgBindings[0]!.scopeId).toBe(ORG_ID);
    });

    it("queries projects with archivedAt null filter", async () => {
      await caller.myBindings({ organizationId: ORG_ID });

      expect(
        (mockPrisma.project.findMany as ReturnType<typeof vi.fn>),
      ).toHaveBeenCalledWith({
        where: {
          id: { in: [ACTIVE_PROJECT_ID, ARCHIVED_PROJECT_ID] },
          archivedAt: null,
        },
        select: { id: true, name: true },
      });
    });
  });
});
