/**
 * Pins the refusal shape of `validateScopeInOrg`: every arm (organization,
 * team, project) answers a scope outside the caller's organization with the
 * handled `scope_not_in_organization` code. Both the role-binding service and
 * the group router validate through this one method, so this is the contract
 * their callers see.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type PrismaClient,
  RoleBindingScopeType,
} from "~/generated/prisma/client";
import { PrismaRoleBindingRepository } from "../role-binding.prisma.repository";

const teamFindFirst = vi.fn();
const projectFindFirst = vi.fn();

const prisma = {
  team: { findFirst: teamFindFirst },
  project: { findFirst: projectFindFirst },
} as unknown as PrismaClient;

let repository: PrismaRoleBindingRepository;

beforeEach(() => {
  vi.clearAllMocks();
  repository = new PrismaRoleBindingRepository(prisma);
});

describe("PrismaRoleBindingRepository.validateScopeInOrg", () => {
  describe("when the organization scope names another organization", () => {
    it("refuses with scope_not_in_organization", async () => {
      await expect(
        repository.validateScopeInOrg({
          organizationId: "org_1",
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: "org_other",
        }),
      ).rejects.toMatchObject({ code: "scope_not_in_organization" });
    });
  });

  describe("when the team is not in the organization", () => {
    it("refuses with scope_not_in_organization and names only the scope kind", async () => {
      teamFindFirst.mockResolvedValue(null);

      await expect(
        repository.validateScopeInOrg({
          organizationId: "org_1",
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: "team_foreign",
        }),
      ).rejects.toMatchObject({
        code: "scope_not_in_organization",
        meta: { scopeType: RoleBindingScopeType.TEAM },
      });
    });
  });

  describe("when the project belongs to another organization", () => {
    it("refuses with scope_not_in_organization", async () => {
      projectFindFirst.mockResolvedValue({
        id: "proj_1",
        team: { organizationId: "org_other" },
      });

      await expect(
        repository.validateScopeInOrg({
          organizationId: "org_1",
          scopeType: RoleBindingScopeType.PROJECT,
          scopeId: "proj_1",
        }),
      ).rejects.toMatchObject({ code: "scope_not_in_organization" });
    });
  });

  describe("when the project does not exist", () => {
    it("refuses with scope_not_in_organization", async () => {
      projectFindFirst.mockResolvedValue(null);

      await expect(
        repository.validateScopeInOrg({
          organizationId: "org_1",
          scopeType: RoleBindingScopeType.PROJECT,
          scopeId: "proj_missing",
        }),
      ).rejects.toMatchObject({ code: "scope_not_in_organization" });
    });
  });

  describe("when the scope belongs to the organization", () => {
    it("resolves for a matching team", async () => {
      teamFindFirst.mockResolvedValue({ id: "team_1" });

      await expect(
        repository.validateScopeInOrg({
          organizationId: "org_1",
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: "team_1",
        }),
      ).resolves.toBeUndefined();
    });
  });
});
