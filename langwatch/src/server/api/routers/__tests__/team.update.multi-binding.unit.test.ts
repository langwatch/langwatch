import type { PrismaClient } from "@prisma/client";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInnerTRPCContext } from "../../trpc";
import { teamRouter } from "../team";

// Mutations audit through the global prisma, not ctx.prisma — unmocked, the
// middleware reaches for a real database this unit environment does not have.
vi.mock("../../../auditLog", () => ({
  auditLog: vi.fn(() => Promise.resolve()),
}));

// team.update writes membership to RoleBinding. A user can hold MORE THAN ONE
// TEAM binding on a team — a built-in role plus additive custom-role grants —
// and RBAC unions them. The settings form shows/edits only the displayed
// (highest-privilege) binding, so a save must update just that one and PRESERVE
// the user's other bindings. Deleting the extras would let a routine autosaved
// edit silently revoke custom-role grants. team:manage is real authorization
// the page passes; the caller is seeded as an org admin on the outer prisma
// stub so the REAL rbac middleware resolves and grants. (No vi.mock on the
// rbac module: under the unit pool's shared module registry a module mock can
// silently fail to apply depending on which files preceded this one in the
// worker, which let the real middleware run against a stub that couldn't
// serve it. The seeded-admin path has no such order sensitivity.)

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
  let organizationUserCount: ReturnType<typeof vi.fn>;
  let caller: ReturnType<typeof teamRouter.createCaller>;

  beforeEach(() => {
    deleteMany = vi.fn().mockResolvedValue({ count: 0 });
    update = vi.fn().mockResolvedValue({});
    create = vi.fn().mockResolvedValue({});
    organizationUserCount = vi.fn().mockResolvedValue(1);

    const tx = {
      team: { update: vi.fn().mockResolvedValue({}) },
      roleBinding: {
        // The user has a built-in MEMBER binding AND an additive custom-role
        // binding. The form displays the higher-privilege one (MEMBER).
        findMany: vi.fn().mockResolvedValue([
          {
            id: MEMBER_BINDING_ID,
            userId: USER_ID,
            role: TeamUserRole.MEMBER,
            customRoleId: null,
          },
          {
            id: CUSTOM_BINDING_ID,
            userId: USER_ID,
            role: TeamUserRole.CUSTOM,
            customRoleId: CUSTOM_ROLE_ID,
          },
        ]),
        deleteMany,
        update,
        create,
      },
    };

    const prisma = {
      team: {
        findUnique: vi.fn().mockResolvedValue({ organizationId: ORG_ID }),
      },
      organizationUser: {
        count: organizationUserCount,
        // Current-org membership for the caller: the rbac resolver fails
        // closed without it.
        findFirst: vi
          .fn()
          .mockResolvedValue({ role: OrganizationUserRole.ADMIN }),
      },
      groupMembership: { findMany: vi.fn().mockResolvedValue([]) },
      // The caller's own bindings (rbac middleware, outer prisma) — distinct
      // from the edited user's bindings, which live on the tx stub above. An
      // ORG-scoped ADMIN binding grants team:manage unconditionally.
      roleBinding: {
        findMany: vi.fn().mockResolvedValue([
          {
            role: TeamUserRole.ADMIN,
            customRoleId: null,
            scopeType: RoleBindingScopeType.ORGANIZATION,
          },
        ]),
      },
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

  describe("when a submitted user belongs to another organization", () => {
    it("rejects the update before writing bindings", async () => {
      organizationUserCount.mockResolvedValue(0);

      await expect(
        caller.update({
          teamId: TEAM_ID,
          name: "Team",
          members: [{ userId: "foreign_user", role: TeamUserRole.ADMIN }],
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });

      expect(create).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    });
  });
});
