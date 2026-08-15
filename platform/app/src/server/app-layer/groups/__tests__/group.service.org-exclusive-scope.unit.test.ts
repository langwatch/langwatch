/**
 * @vitest-environment node
 *
 * A group binding that names a custom role carrying an organization-exclusive
 * permission cannot sit at team or project scope. The resolver never grants
 * such a permission from below organization scope (ADR-021), so accepting the
 * write would store a grant that does nothing while the administrator who made
 * it believes it took effect. Direct role bindings have refused this since
 * `RoleBindingService.validateBindingRoles`; group bindings reach the same
 * resolver and must refuse it the same way.
 */

import { describe, expect, it, vi } from "vitest";
import { RoleBindingScopeType, TeamUserRole } from "~/generated/prisma/client";
import { RoleService } from "~/server/role";
import { OrgExclusivePermissionScopeError } from "~/server/role-bindings/errors";
import { GroupRestService } from "../group.service";
import type { GroupRepository } from "../repositories/group.repository";

const ORGANIZATION_ID = "org_1";
const CUSTOM_ROLE_ID = "role_1";

/** A custom role whose permissions only ever resolve at organization scope. */
const ORG_EXCLUSIVE_ROLE = {
  id: CUSTOM_ROLE_ID,
  permissions: ["organization:manage"],
};

/** A custom role that resolves at any scope. */
const PROJECT_ROLE = { id: CUSTOM_ROLE_ID, permissions: ["project:view"] };

function buildService(role: { id: string; permissions: string[] }) {
  const createBinding = vi.fn();
  const createAtomic = vi.fn();
  const repo = {
    areUsersInOrganization: vi.fn().mockResolvedValue(true),
    findUniqueSlug: vi.fn().mockResolvedValue("reviewers"),
    validateScopeInOrganization: vi.fn().mockResolvedValue(true),
    anyScopeIsPersonalTeam: vi.fn().mockResolvedValue(false),
    findGroupOnly: vi.fn().mockResolvedValue({ id: "group_1" }),
    createBinding,
    createAtomic,
  } as unknown as GroupRepository;

  const prisma = {
    customRole: {
      findMany: vi.fn().mockResolvedValue([role]),
    },
  };
  const roleService = new RoleService(prisma as never);
  vi.spyOn(roleService, "validateRolesAssignable").mockResolvedValue(undefined);

  return {
    service: new GroupRestService({ repo, roleService }),
    createBinding,
    createAtomic,
  };
}

describe("GroupRestService", () => {
  describe("given a custom role carrying an organization-exclusive permission", () => {
    describe("when a group is created with that role bound to a team", () => {
      it("refuses the write instead of storing a grant that never resolves", async () => {
        const { service, createAtomic } = buildService(ORG_EXCLUSIVE_ROLE);

        await expect(
          service.create({
            organizationId: ORGANIZATION_ID,
            name: "Reviewers",
            bindings: [
              {
                role: TeamUserRole.CUSTOM,
                customRoleId: CUSTOM_ROLE_ID,
                scopeType: RoleBindingScopeType.TEAM,
                scopeId: "team_1",
              },
            ],
          }),
        ).rejects.toBeInstanceOf(OrgExclusivePermissionScopeError);

        expect(createAtomic).not.toHaveBeenCalled();
      });
    });

    describe("when that role is bound to a team on an existing group", () => {
      it("refuses the write instead of storing a grant that never resolves", async () => {
        const { service, createBinding } = buildService(ORG_EXCLUSIVE_ROLE);

        await expect(
          service.addBinding({
            groupId: "group_1",
            organizationId: ORGANIZATION_ID,
            role: TeamUserRole.CUSTOM,
            customRoleId: CUSTOM_ROLE_ID,
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: "team_1",
          }),
        ).rejects.toBeInstanceOf(OrgExclusivePermissionScopeError);

        expect(createBinding).not.toHaveBeenCalled();
      });
    });

    describe("when that role is bound at organization scope", () => {
      it("accepts the write, which is the scope the permission resolves at", async () => {
        const { service, createBinding } = buildService(ORG_EXCLUSIVE_ROLE);

        await service.addBinding({
          groupId: "group_1",
          organizationId: ORGANIZATION_ID,
          role: TeamUserRole.CUSTOM,
          customRoleId: CUSTOM_ROLE_ID,
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: ORGANIZATION_ID,
        });

        expect(createBinding).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("given a custom role with no organization-exclusive permission", () => {
    describe("when it is bound to a team", () => {
      it("accepts the write", async () => {
        const { service, createBinding } = buildService(PROJECT_ROLE);

        await service.addBinding({
          groupId: "group_1",
          organizationId: ORGANIZATION_ID,
          role: TeamUserRole.CUSTOM,
          customRoleId: CUSTOM_ROLE_ID,
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: "team_1",
        });

        expect(createBinding).toHaveBeenCalledTimes(1);
      });
    });
  });
});
