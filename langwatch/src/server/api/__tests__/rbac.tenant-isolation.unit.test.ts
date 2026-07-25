import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { Session } from "~/server/auth";

import {
  batchScopePermissions,
  hasProjectPermission,
  hasTeamPermission,
} from "../rbac";

// A pre-existing cross-org binding: user_B is named at a scope in org_A but is
// NOT an OrganizationUser of org_A (the row survives from a since-closed path).
// These tests prove the read path fails closed on current org membership rather
// than trusting the stale binding.

const ORG_A = "org_a";
const TEAM_A = "team_a";
const PROJECT_A = "project_a";
const USER_B = "user_b";

const sessionForUserB = {
  user: { id: USER_B },
} as unknown as Session;

const grantingProjectBinding = {
  role: TeamUserRole.ADMIN,
  customRoleId: null,
  scopeType: RoleBindingScopeType.PROJECT,
  scopeId: PROJECT_A,
};

describe("read-path tenant isolation", () => {
  describe("when a non-member has a stale project-scoped binding", () => {
    it("denies project access before consulting the binding", async () => {
      const roleBindingFindMany = vi
        .fn()
        .mockResolvedValue([grantingProjectBinding]);
      const prisma = {
        project: {
          findUnique: vi.fn().mockResolvedValue({
            team: { id: TEAM_A, organizationId: ORG_A },
          }),
        },
        // No OrganizationUser row → user_B is not a member of org_A.
        organizationUser: { findFirst: vi.fn().mockResolvedValue(null) },
        groupMembership: { findMany: vi.fn().mockResolvedValue([]) },
        roleBinding: { findMany: roleBindingFindMany },
        teamUser: { findFirst: vi.fn().mockResolvedValue(null) },
      } as unknown as Parameters<typeof hasProjectPermission>[0]["prisma"];

      const permitted = await hasProjectPermission(
        { prisma, session: sessionForUserB },
        PROJECT_A,
        "project:view",
      );

      expect(permitted).toBe(false);
      // Fail-closed happens on membership, before any binding lookup runs.
      expect(roleBindingFindMany).not.toHaveBeenCalled();
    });
  });

  describe("when a non-member has a stale team-scoped binding", () => {
    it("denies team access before consulting the binding", async () => {
      const roleBindingFindMany = vi.fn().mockResolvedValue([
        {
          role: TeamUserRole.ADMIN,
          customRoleId: null,
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: TEAM_A,
        },
      ]);
      const prisma = {
        team: {
          findUnique: vi
            .fn()
            .mockResolvedValue({ id: TEAM_A, organizationId: ORG_A }),
        },
        // user_B is not an OrganizationUser of org_A.
        organizationUser: { findFirst: vi.fn().mockResolvedValue(null) },
        groupMembership: { findMany: vi.fn().mockResolvedValue([]) },
        roleBinding: { findMany: roleBindingFindMany },
        teamUser: { findFirst: vi.fn().mockResolvedValue(null) },
      } as unknown as Parameters<typeof hasTeamPermission>[0]["prisma"];

      const permitted = await hasTeamPermission(
        { prisma, session: sessionForUserB },
        TEAM_A,
        "team:view",
      );

      expect(permitted).toBe(false);
      expect(roleBindingFindMany).not.toHaveBeenCalled();
    });
  });

  describe("when the caller is a current member", () => {
    it("still resolves the binding for a genuine member", async () => {
      const prisma = {
        project: {
          findUnique: vi.fn().mockResolvedValue({
            team: { id: TEAM_A, organizationId: ORG_A },
          }),
        },
        organizationUser: {
          findFirst: vi
            .fn()
            .mockResolvedValue({ role: OrganizationUserRole.MEMBER }),
        },
        groupMembership: { findMany: vi.fn().mockResolvedValue([]) },
        roleBinding: {
          findMany: vi.fn().mockResolvedValue([grantingProjectBinding]),
        },
        teamUser: { findFirst: vi.fn().mockResolvedValue(null) },
      } as unknown as Parameters<typeof hasProjectPermission>[0]["prisma"];

      const permitted = await hasProjectPermission(
        { prisma, session: sessionForUserB },
        PROJECT_A,
        "project:view",
      );

      expect(permitted).toBe(true);
    });
  });

  // The batched resolver answers the same question for many scopes at once, so
  // it needs the same membership gate. It resolves through `loadScopeResolution`
  // rather than the per-call helpers, which is a separate query path and a
  // separate chance to regress.
  describe("batchScopePermissions() with a stale cross-org binding", () => {
    it("denies every scope for a non-member", async () => {
      const roleBindingFindMany = vi.fn().mockResolvedValue([
        grantingProjectBinding,
        {
          role: TeamUserRole.ADMIN,
          customRoleId: null,
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: TEAM_A,
        },
      ]);
      const prisma = {
        // user_B is not an OrganizationUser of org_A.
        organizationUser: { findFirst: vi.fn().mockResolvedValue(null) },
        groupMembership: { findMany: vi.fn().mockResolvedValue([]) },
        roleBinding: { findMany: roleBindingFindMany },
        customRole: { findMany: vi.fn().mockResolvedValue([]) },
        teamUser: { findMany: vi.fn().mockResolvedValue([]) },
      } as unknown as Parameters<typeof batchScopePermissions>[0]["prisma"];

      const { teams, projects } = await batchScopePermissions(
        { prisma, session: sessionForUserB },
        {
          organizationId: ORG_A,
          teamIds: [TEAM_A],
          projectIds: [PROJECT_A],
          projectTeamId: { [PROJECT_A]: TEAM_A },
          permission: "project:view",
        },
      );

      expect(projects.get(PROJECT_A)).toBe(false);
      expect(teams.get(TEAM_A)).toBe(false);
      // Membership short-circuits before any binding is loaded.
      expect(roleBindingFindMany).not.toHaveBeenCalled();
    });

    it("still grants a genuine member", async () => {
      const prisma = {
        organizationUser: {
          findFirst: vi
            .fn()
            .mockResolvedValue({ role: OrganizationUserRole.MEMBER }),
        },
        groupMembership: { findMany: vi.fn().mockResolvedValue([]) },
        roleBinding: {
          findMany: vi.fn().mockResolvedValue([grantingProjectBinding]),
        },
        customRole: { findMany: vi.fn().mockResolvedValue([]) },
        teamUser: { findMany: vi.fn().mockResolvedValue([]) },
      } as unknown as Parameters<typeof batchScopePermissions>[0]["prisma"];

      const { projects } = await batchScopePermissions(
        { prisma, session: sessionForUserB },
        {
          organizationId: ORG_A,
          teamIds: [],
          projectIds: [PROJECT_A],
          projectTeamId: { [PROJECT_A]: TEAM_A },
          permission: "project:view",
        },
      );

      expect(projects.get(PROJECT_A)).toBe(true);
    });
  });
});
