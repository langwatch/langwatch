import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import { createInnerTRPCContext } from "../../trpc";
import { teamRouter } from "../team";

// Mutations audit through the global prisma, not ctx.prisma — unmocked, the
// middleware reaches for a real database this unit environment does not have.
vi.mock("@ee/audit-log/auditLog", () => ({
  auditLog: vi.fn(() => Promise.resolve()),
}));

// team.update edits TEAM-scoped grants. Since ADR-092 delivery-plan PR 2 those
// are ledger commands rather than table writes, so the writer is the seam this
// file observes; the rule under test is unchanged.
const ledger = vi.hoisted(() => ({
  attachBindings: vi.fn(),
  changeBindingRole: vi.fn(),
  revokeBindings: vi.fn(),
}));
vi.mock("~/server/app-layer/authz/ledger", () => ({
  grantsLedgerWriter: () => ledger,
}));

// A user can hold MORE THAN ONE TEAM binding on a team — a built-in role plus
// additive custom-role grants — and RBAC unions them. The settings form
// shows/edits only the displayed (highest-privilege) binding, so a save must
// change just that one and PRESERVE the user's other bindings. Revoking the
// extras would let a routine autosaved edit silently drop custom-role grants.
// team:manage is real authorization the page passes; the caller is seeded as an
// org admin on the prisma stub so the REAL rbac middleware resolves and grants.
// (No vi.mock on the rbac module: under the unit pool's shared module registry
// a module mock can silently fail to apply depending on which files preceded
// this one in the worker, which let the real middleware run against a stub that
// couldn't serve it. The seeded-admin path has no such order sensitivity.)

const ORG_ID = "org_1";
const TEAM_ID = "team_1";
const USER_ID = "user_multi";
const MEMBER_BINDING_ID = "rb_member";
const CUSTOM_BINDING_ID = "rb_custom";
const CUSTOM_ROLE_ID = "cr_1";

describe("team.update", () => {
  let teamUpdate: ReturnType<typeof vi.fn>;
  let organizationUserCount: ReturnType<typeof vi.fn>;
  let caller: ReturnType<typeof teamRouter.createCaller>;

  beforeEach(() => {
    vi.clearAllMocks();
    ledger.attachBindings.mockResolvedValue({ attached: [], duplicates: [] });
    ledger.changeBindingRole.mockResolvedValue(undefined);
    ledger.revokeBindings.mockResolvedValue(undefined);
    teamUpdate = vi.fn().mockResolvedValue({});
    organizationUserCount = vi.fn().mockResolvedValue(1);

    // The edited user has a built-in MEMBER binding AND an additive
    // custom-role binding. The form displays the higher-privilege one.
    const teamBindings = [
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
    ];
    // The caller's own bindings, which the rbac middleware reads. An
    // ORG-scoped ADMIN binding grants team:manage unconditionally.
    const callerBindings = [
      {
        role: TeamUserRole.ADMIN,
        customRoleId: null,
        scopeType: RoleBindingScopeType.ORGANIZATION,
      },
    ];

    const prisma = {
      team: {
        findUnique: vi.fn().mockResolvedValue({ organizationId: ORG_ID }),
        update: teamUpdate,
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
      roleBinding: {
        findMany: vi.fn(
          async ({ where }: { where?: Record<string, unknown> }) => {
            // The team's group-admin bindings (the last-admin projection).
            if (where?.groupId) return [];
            // The edited team's direct bindings.
            if (where?.scopeId === TEAM_ID) return teamBindings;
            return callerBindings;
          },
        ),
      },
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
    it("changes only the displayed binding and preserves the custom-role binding", async () => {
      await caller.update({
        teamId: TEAM_ID,
        name: "Team",
        members: [{ userId: USER_ID, role: TeamUserRole.VIEWER }],
      });

      // Displayed (MEMBER) binding is changed to VIEWER...
      expect(ledger.changeBindingRole).toHaveBeenCalledWith(
        expect.objectContaining({
          bindingId: MEMBER_BINDING_ID,
          role: TeamUserRole.VIEWER,
          customRoleId: null,
        }),
      );
      // ...and the additive custom-role binding is left untouched.
      expect(ledger.revokeBindings).not.toHaveBeenCalled();
      expect(ledger.attachBindings).not.toHaveBeenCalled();
    });
  });

  describe("when a user is removed from the team", () => {
    it("revokes all of that user's bindings", async () => {
      await caller.update({
        teamId: TEAM_ID,
        name: "Team",
        // USER_ID is no longer in the submitted list.
        members: [{ userId: "someone_else", role: TeamUserRole.ADMIN }],
      });

      expect(ledger.revokeBindings).toHaveBeenCalledWith(
        expect.objectContaining({
          bindingIds: [MEMBER_BINDING_ID, CUSTOM_BINDING_ID],
        }),
      );
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

      expect(ledger.attachBindings).not.toHaveBeenCalled();
      expect(ledger.changeBindingRole).not.toHaveBeenCalled();
      expect(teamUpdate).not.toHaveBeenCalled();
    });
  });
});
