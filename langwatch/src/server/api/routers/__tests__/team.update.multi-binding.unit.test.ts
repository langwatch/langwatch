import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { TeamUserRole } from "@prisma/client";
import { teamRouter } from "../team";
import { createInnerTRPCContext } from "../../trpc";

// team.update writes membership to RoleBinding. A user can hold MORE THAN ONE
// TEAM binding on a team — a built-in role plus additive custom-role grants —
// and RBAC unions them. The settings form shows/edits only the displayed
// (highest-privilege) binding, so a save must update just that one and PRESERVE
// the user's other bindings. Deleting the extras would let a routine autosaved
// edit silently revoke custom-role grants. team:manage is real authorization
// the page passes; it's mocked to a pass-through to isolate the sync logic.
vi.mock("../../rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../rbac")>();
  return {
    ...actual,
    checkTeamPermission:
      () =>
      async ({ ctx, next }: any) => {
        ctx.permissionChecked = true;
        return next();
      },
  };
});

const ORG_ID = "org_1";
const TEAM_ID = "team_1";
const USER_ID = "user_multi";
const MEMBER_BINDING_ID = "rb_member";
const CUSTOM_BINDING_ID = "rb_custom";
const CUSTOM_ROLE_ID = "cr_1";

describe("team.update", () => {
  let deleteMany: ReturnType<typeof vi.fn>;
  let update: ReturnType<typeof vi.fn>;
  let create: ReturnType<typeof vi.fn>;
  let caller: ReturnType<typeof teamRouter.createCaller>;

  beforeEach(() => {
    deleteMany = vi.fn().mockResolvedValue({ count: 0 });
    update = vi.fn().mockResolvedValue({});
    create = vi.fn().mockResolvedValue({});

    const tx = {
      team: { update: vi.fn().mockResolvedValue({}) },
      roleBinding: {
        // The user has a built-in MEMBER binding AND an additive custom-role
        // binding. The form displays the higher-privilege one (MEMBER).
        findMany: vi.fn().mockResolvedValue([
          { id: MEMBER_BINDING_ID, userId: USER_ID, role: TeamUserRole.MEMBER, customRoleId: null },
          { id: CUSTOM_BINDING_ID, userId: USER_ID, role: TeamUserRole.CUSTOM, customRoleId: CUSTOM_ROLE_ID },
        ]),
        deleteMany,
        update,
        create,
      },
    };

    const prisma = {
      team: { findUnique: vi.fn().mockResolvedValue({ organizationId: ORG_ID }) },
      $transaction: (fn: (tx: unknown) => unknown) => fn(tx),
    } as unknown as PrismaClient;

    const ctx = createInnerTRPCContext({
      session: { user: { id: "caller" }, expires: "1" },
      req: undefined,
      res: undefined,
      permissionChecked: true,
      publiclyShared: false,
    });
    ctx.prisma = prisma;
    caller = teamRouter.createCaller(ctx);
  });

  describe("when editing the displayed role of a user who also has an additive custom-role binding", () => {
    it("updates only the displayed binding and preserves the custom-role binding", async () => {
      await caller.update({
        teamId: TEAM_ID,
        name: "Team",
        members: [{ userId: USER_ID, role: TeamUserRole.VIEWER }],
      });

      // Displayed (MEMBER) binding is updated to VIEWER...
      expect(update).toHaveBeenCalledWith({
        where: { id: MEMBER_BINDING_ID },
        data: { role: TeamUserRole.VIEWER, customRoleId: null },
      });
      // ...and the additive custom-role binding is left untouched.
      expect(deleteMany).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    });
  });

  describe("when a user is removed from the team", () => {
    it("deletes all of that user's bindings", async () => {
      await caller.update({
        teamId: TEAM_ID,
        name: "Team",
        // USER_ID is no longer in the submitted list.
        members: [{ userId: "someone_else", role: TeamUserRole.ADMIN }],
      });

      expect(deleteMany).toHaveBeenCalledWith({
        where: { id: { in: [MEMBER_BINDING_ID, CUSTOM_BINDING_ID] } },
      });
    });
  });
});
