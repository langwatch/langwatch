/**
 * @vitest-environment node
 *
 * The any-of project gate, exercised through the DECLARED seam
 * (`.permissionAny(…)` → checkDeclaredPermissionAny → resolveProjectPermissionAny).
 * It backs surfaces a caller can legitimately reach from more than one
 * feature, so it is asked about several permissions per request, on routes
 * (the media existence probe) that run once per item on screen. Where the
 * caller stands is the same for every permission in the list, so it is read
 * once.
 */

import { PermissionDeniedError } from "@langwatch/authz";
import { describe, expect, it, vi } from "vitest";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import { checkDeclaredPermissionAny } from "~/server/app-layer/authz/trpc-middleware";
import { permissionsServiceFor } from "~/server/app-layer/permissions/runtime";
import type { Session } from "~/server/auth";
import type { Permission } from "../rbac";

const ORGANIZATION_ID = "organization_1";
const TEAM_ID = "team_1";
const PROJECT_ID = "project_1";
const USER_ID = "user_1";

const session = { user: { id: USER_ID } } as unknown as Session;

const buildPrisma = (teamRole: TeamUserRole) => {
  const projectFindUnique = vi.fn().mockResolvedValue({
    team: { id: TEAM_ID, organizationId: ORGANIZATION_ID },
  });
  const organizationUserFindFirst = vi
    .fn()
    .mockResolvedValue({ role: OrganizationUserRole.MEMBER });
  const prisma = {
    project: { findUnique: projectFindUnique },
    organizationUser: { findFirst: organizationUserFindFirst },
    groupMembership: { findMany: vi.fn().mockResolvedValue([]) },
    roleBinding: {
      findMany: vi.fn().mockResolvedValue([
        {
          role: teamRole,
          customRoleId: null,
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: TEAM_ID,
        },
      ]),
    },
    teamUser: { findFirst: vi.fn().mockResolvedValue(null) },
    systemMigrationTenantState: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    systemMigrationTenantState: { findUnique: vi.fn().mockResolvedValue(null) },
  };
  return { prisma, projectFindUnique, organizationUserFindFirst };
};

const runGate = ({
  prisma,
  permissions,
}: {
  prisma: unknown;
  permissions: [Permission, ...Permission[]];
}) => {
  const next = vi.fn().mockResolvedValue("permitted");
  const middleware = checkDeclaredPermissionAny(permissions);
  return {
    next,
    run: () =>
      middleware({
        ctx: {
          prisma,
          session,
          permissionChecked: false,
          app: { permissions: permissionsServiceFor(prisma as never) },
        } as never,
        input: { projectId: PROJECT_ID },
        next,
      } as never),
  };
};

describe("checkDeclaredPermissionAny over the real resolver", () => {
  describe("given a caller who holds only the second permission", () => {
    describe("when the gate runs", () => {
      it("permits the call", async () => {
        const { prisma } = buildPrisma(TeamUserRole.VIEWER);
        const { next, run } = runGate({
          prisma,
          permissions: ["annotations:update", "traces:view"],
        });

        await run();

        expect(next).toHaveBeenCalledTimes(1);
      });

      it("reads the project and the organization membership once", async () => {
        const { prisma, projectFindUnique, organizationUserFindFirst } =
          buildPrisma(TeamUserRole.VIEWER);
        const { run } = runGate({
          prisma,
          permissions: ["annotations:update", "traces:view"],
        });

        await run();

        expect(projectFindUnique).toHaveBeenCalledTimes(1);
        expect(organizationUserFindFirst).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("given a caller who holds none of the permissions", () => {
    describe("when the gate runs", () => {
      it("refuses with the stable denial code, without repeating the lookups", async () => {
        const { prisma, projectFindUnique, organizationUserFindFirst } =
          buildPrisma(TeamUserRole.VIEWER);
        const { next, run } = runGate({
          prisma,
          permissions: ["annotations:update", "datasets:update"],
        });

        const error = await run().then(
          () => {
            throw new Error("expected the gate to refuse");
          },
          (thrown: unknown) => thrown as { cause?: unknown },
        );
        expect(error.cause).toBeInstanceOf(PermissionDeniedError);
        expect((error.cause as PermissionDeniedError).code).toBe(
          "permission_denied",
        );
        expect(next).not.toHaveBeenCalled();
        expect(projectFindUnique).toHaveBeenCalledTimes(1);
        expect(organizationUserFindFirst).toHaveBeenCalledTimes(1);
      });
    });
  });
});
