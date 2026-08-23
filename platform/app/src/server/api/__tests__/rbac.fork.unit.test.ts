/**
 * @vitest-environment node
 *
 * ADR-092 delivery-plan PR 3 — the fork at the tRPC seams. Most cases here are
 * built so the two resolvers CANNOT agree: the organization holds a
 * grant-head fact and no compat `RoleBinding` row at all, so legacy denies and
 * the engine allows. Which answer comes back is therefore proof of which
 * resolver is primary, rather than a coincidence of both saying yes.
 *
 * The organization-permission case is the exception, and says so where it
 * stands: both resolvers deny an org-exclusive permission, so its answer
 * discriminates nothing and the proof is that the legacy shadow was never
 * called. Do not read it as one of the disagreement cases.
 *
 * The mirror case is the point of the whole PR: with the cutover projection
 * off (or absent), the same stubs must produce the legacy answer and the
 * stage-A4 shadow comparison, untouched.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkDeclaredPermissionAny } from "~/server/app-layer/authz/trpc-middleware";
import type { Session } from "~/server/auth";
import { appPermissionsService } from "~/test-utils/appPermissionsMock";

// The stage-A4 shadow is stubbed rather than silenced: "the legacy path still
// shadows" is half of what these tests assert, and a sample rate of zero
// cannot be told apart from a missing call.

import {
  batchScopePermissions,
  hasOrganizationPermission,
  resolveProjectPermission,
  resolveTeamPermission,
} from "../rbac";

// Ids of their own: the cutover gate caches per organization for a minute,
// and unit files share a module registry inside a worker.
const ORGANIZATION_ID = "organization_fork_1";
const TEAM_ID = "team_fork_1";
const PROJECT_ID = "project_fork_1";
const USER_ID = "user_fork_1";

const session = { user: { id: USER_ID } } as unknown as Session;

/**
 * An organization whose only record of this user's access is a Grant head:
 * PROJECT-scoped `admin`, no compat binding row behind it.
 */
function buildPrisma({ onEngine }: { onEngine: boolean | undefined }) {
  const grantFindMany = vi.fn(async (args: any) => {
    if (args?.where?.principalType !== "USER") return [];
    return [
      { roleKey: "admin", scopeType: "PROJECT", scopeId: PROJECT_ID },
      { roleKey: "admin", scopeType: "TEAM", scopeId: TEAM_ID },
    ];
  });
  const roleBindingFindMany = vi.fn().mockResolvedValue([]);
  const migrationStateFindUnique = vi
    .fn()
    .mockResolvedValue(onEngine ? { status: "finalized" } : null);

  const prisma = {
    project: {
      findUnique: vi.fn().mockResolvedValue({
        team: { id: TEAM_ID, organizationId: ORGANIZATION_ID },
      }),
    },
    team: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ id: TEAM_ID, organizationId: ORGANIZATION_ID }),
    },
    organizationUser: {
      findFirst: vi.fn().mockResolvedValue({ role: "MEMBER" }),
    },
    groupMembership: { findMany: vi.fn().mockResolvedValue([]) },
    roleBinding: { findMany: roleBindingFindMany },
    customRole: { findMany: vi.fn().mockResolvedValue([]) },
    teamUser: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    grant: { findMany: grantFindMany },
    systemMigrationTenantState: { findUnique: migrationStateFindUnique },
    role: { findMany: vi.fn().mockResolvedValue([]) },
  };

  return {
    ctx: {
      prisma,
      session,
      app: { permissions: appPermissionsService(prisma as never) },
    } as never,
    grantFindMany,
    roleBindingFindMany,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the fork at the permission seams", () => {
  describe("given a migrated organization", () => {
    describe("when a project permission is resolved", () => {
      /** @scenario "A cut-over organization is decided by the engine" */
      it("returns the engine's answer, and never runs legacy", async () => {
        const { ctx, roleBindingFindMany } = buildPrisma({ onEngine: true });

        const result = await resolveProjectPermission(
          ctx,
          PROJECT_ID,
          "traces:view",
        );

        // Legacy has no binding row to grant this; the engine has a grant.
        expect(result).toEqual({ permitted: true, organizationRole: "MEMBER" });
        // The engine answered alone: nothing reads the compat binding head
        // behind it, which is what the shadow comparison used to do.
        expect(roleBindingFindMany).not.toHaveBeenCalled();
      });
    });

    describe("when any of several permissions is enough", () => {
      /** @scenario "A declared check decides exactly as the middleware it replaced" */
      it("returns the engine's answer for the gate", async () => {
        const { ctx } = buildPrisma({ onEngine: true });
        const next = vi.fn().mockResolvedValue("permitted");

        const outcome = await checkDeclaredPermissionAny([
          "annotations:update",
          "traces:view",
        ])({
          ctx: {
            ...(ctx as Record<string, unknown>),
            permissionChecked: false,
            app: {
              permissions: appPermissionsService(
                (ctx as { prisma: never }).prisma,
              ),
            },
          },
          input: { projectId: PROJECT_ID },
          next,
        } as never);

        expect(outcome).toBe("permitted");
        expect(next).toHaveBeenCalledTimes(1);
      });
    });

    describe("when a team permission is resolved", () => {
      it("returns the engine's answer", async () => {
        const { ctx } = buildPrisma({ onEngine: true });

        const result = await resolveTeamPermission(ctx, TEAM_ID, "traces:view");

        expect(result).toEqual({ permitted: true, organizationRole: "MEMBER" });
      });
    });

    describe("when an organization permission is resolved", () => {
      it("returns the engine's answer", async () => {
        const { ctx } = buildPrisma({ onEngine: true });

        // An org-exclusive permission no team/project grant can confer, so
        // the MEMBER floor cannot answer it either: only the engine's read of
        // the org-scoped grant head decides it.
        const permitted = await hasOrganizationPermission(
          ctx,
          ORGANIZATION_ID,
          "organization:manage",
        );

        // The user's grants are PROJECT- and TEAM-scoped, so both resolvers
        // deny — but through the engine, which is what the absent stage-A4
        // comparison shows.
        expect(permitted).toBe(false);
      });
    });

    describe("when a batch of scopes is resolved", () => {
      it("answers every scope from the engine's snapshot", async () => {
        const { ctx } = buildPrisma({ onEngine: true });

        const result = await batchScopePermissions(ctx, {
          organizationId: ORGANIZATION_ID,
          teamIds: [TEAM_ID, "team_fork_other"],
          projectIds: [PROJECT_ID],
          projectTeamId: { [PROJECT_ID]: TEAM_ID },
          permission: "traces:view",
        });

        expect([...result.teams]).toEqual([
          [TEAM_ID, true],
          ["team_fork_other", false],
        ]);
        expect([...result.projects]).toEqual([[PROJECT_ID, true]]);
      });
    });
  });

  describe("given an organization still on the legacy path", () => {
    describe("when its migration has not finished", () => {
      /** @scenario "An organization that has not cut over is unchanged" */
      it("keeps the legacy answer and the stage-A4 shadow", async () => {
        const { ctx, grantFindMany } = buildPrisma({ onEngine: false });

        const result = await resolveProjectPermission(
          ctx,
          PROJECT_ID,
          "traces:view",
        );

        expect(result).toEqual({
          permitted: false,
          organizationRole: "MEMBER",
        });
        // Nothing read the grant head: the engine is not answering here.
        expect(grantFindMany).not.toHaveBeenCalled();
      });
    });

    describe("when it has no migration state row at all", () => {
      it("reads as legacy, which is every organization today", async () => {
        const { ctx } = buildPrisma({ onEngine: undefined });

        const result = await resolveProjectPermission(
          ctx,
          PROJECT_ID,
          "traces:view",
        );

        expect(result.permitted).toBe(false);
      });
    });

    describe("when a batch of scopes is resolved", () => {
      it("keeps the legacy maps", async () => {
        const { ctx } = buildPrisma({ onEngine: false });

        const result = await batchScopePermissions(ctx, {
          organizationId: ORGANIZATION_ID,
          teamIds: [TEAM_ID],
          projectIds: [PROJECT_ID],
          projectTeamId: { [PROJECT_ID]: TEAM_ID },
          permission: "traces:view",
        });

        expect([...result.teams]).toEqual([[TEAM_ID, false]]);
        expect([...result.projects]).toEqual([[PROJECT_ID, false]]);
      });
    });
  });

  describe("given the demo project", () => {
    it("answers before the fork, whichever head the organization is on", async () => {
      process.env.DEMO_PROJECT_ID = PROJECT_ID;
      try {
        const { ctx, grantFindMany } = buildPrisma({ onEngine: true });

        const result = await resolveProjectPermission(
          ctx,
          PROJECT_ID,
          "traces:view",
        );

        expect(result).toEqual({ permitted: true, organizationRole: null });
        // The demo rule is identical on both paths, so the early return stays
        // in front of the fork and nothing is collected at all.
        expect(grantFindMany).not.toHaveBeenCalled();
      } finally {
        delete process.env.DEMO_PROJECT_ID;
      }
    });
  });
});
