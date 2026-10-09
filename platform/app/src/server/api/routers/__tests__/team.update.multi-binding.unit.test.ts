import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import { permissionsServiceFor } from "~/server/app-layer/permissions/runtime";
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

// Editing the displayed team role must preserve additive custom grants.
// Authorization runs against a live organization admin grant; the write plan
// still reads the retained binding projection inside its transaction.

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
    // The retained binding projection also carries the caller's admin role.
    const callerBindings = [
      {
        role: TeamUserRole.ADMIN,
        customRoleId: null,
        scopeType: RoleBindingScopeType.ORGANIZATION,
      },
    ];
    const grantRows = [
      {
        id: MEMBER_BINDING_ID,
        organizationId: ORG_ID,
        principalType: "USER",
        principalId: USER_ID,
        roleKey: "member",
        legacyRole: TeamUserRole.MEMBER,
        source: "role-binding",
        scopeType: "TEAM",
        scopeId: TEAM_ID,
        token: null,
        permission: null,
        resourceKind: null,
        projectId: null,
        createdByUserId: null,
        expiresAt: null,
        maxViews: null,
        occurredAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      {
        id: CUSTOM_BINDING_ID,
        organizationId: ORG_ID,
        principalType: "USER",
        principalId: USER_ID,
        roleKey: `custom:${CUSTOM_ROLE_ID}`,
        legacyRole: TeamUserRole.CUSTOM,
        source: "role-binding",
        scopeType: "TEAM",
        scopeId: TEAM_ID,
        token: null,
        permission: null,
        resourceKind: null,
        projectId: null,
        createdByUserId: null,
        expiresAt: null,
        maxViews: null,
        occurredAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      {
        id: "grant_admin",
        organizationId: ORG_ID,
        principalType: "USER",
        principalId: "caller",
        roleKey: "admin",
        legacyRole: TeamUserRole.ADMIN,
        source: "role-binding",
        scopeType: "ORGANIZATION",
        scopeId: ORG_ID,
        token: null,
        permission: null,
        resourceKind: null,
        projectId: null,
        createdByUserId: null,
        expiresAt: null,
        maxViews: null,
        occurredAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ];

    const prisma: PrismaClient = {
      // The save decides its plan and renames the team under one transaction,
      // so the reads it rests on cannot shift beneath it. The stub runs the
      // callback against itself.
      $transaction: (run: (tx: PrismaClient) => Promise<unknown>) =>
        run(prisma),
      team: {
        findUnique: vi.fn().mockResolvedValue({ organizationId: ORG_ID }),
        update: teamUpdate,
      },
      organizationUser: {
        count: organizationUserCount,
        // Authz requires an active organization membership.
        findFirst: vi.fn().mockResolvedValue({
          role: OrganizationUserRole.ADMIN,
          disabledAt: null,
        }),
      },
      groupMembership: { findMany: vi.fn().mockResolvedValue([]) },
      grant: {
        findMany: vi.fn(
          async ({ where }: { where?: Record<string, unknown> }) => {
            const serializedWhere = JSON.stringify(where);
            const rows = serializedWhere.includes(TEAM_ID)
              ? grantRows.filter((row) => row.scopeId === TEAM_ID)
              : grantRows.filter((row) => row.scopeType === "ORGANIZATION");
            return serializedWhere.includes('"roleKey":"admin"')
              ? rows.filter((row) => row.roleKey === "admin")
              : rows;
          },
        ),
        findFirst: vi.fn().mockResolvedValue(null),
        count: vi.fn().mockResolvedValue(0),
      },
      role: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      roleBinding: {
        findMany: vi.fn(
          async ({ where }: { where?: Record<string, unknown> }) => {
            // The team's group-admin bindings (the last-admin projection).
            if (where?.groupId) return [];
            // The edited team's direct bindings. The role filter is honoured:
            // the last-admin projection asks this table who administers the
            // team, and a stub that answers "everybody" reads a team with no
            // admin as one that has two.
            if (where?.scopeId === TEAM_ID) {
              return where.role
                ? teamBindings.filter((b) => b.role === where.role)
                : teamBindings;
            }
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
    ctx.app = { permissions: permissionsServiceFor(prisma) } as never;
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

  describe("when the ledger dies part-way through a save", () => {
    it("has not revoked anything yet, so the old access is what stands", async () => {
      ledger.attachBindings.mockRejectedValue(new Error("ledger unavailable"));

      await expect(
        caller.update({
          teamId: TEAM_ID,
          name: "Team",
          // A swap: somebody new comes in as admin, the current member goes.
          members: [{ userId: "someone_else", role: TeamUserRole.ADMIN }],
        }),
      ).rejects.toThrow("ledger unavailable");

      // Grants land before revocations precisely so this window leaves a team
      // with too many members rather than one with none.
      expect(ledger.revokeBindings).not.toHaveBeenCalled();
    });
  });

  describe("when the team has no admin left to lose", () => {
    it("lets the save through, because that save is the repair", async () => {
      // Nobody on the team holds ADMIN — the state a seat correction or a
      // half-applied save leaves behind. Promoting somebody back has to be
      // possible from here.
      await caller.update({
        teamId: TEAM_ID,
        name: "Team",
        members: [{ userId: USER_ID, role: TeamUserRole.ADMIN }],
      });

      expect(ledger.changeBindingRole).toHaveBeenCalledWith(
        expect.objectContaining({
          bindingId: MEMBER_BINDING_ID,
          role: TeamUserRole.ADMIN,
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
