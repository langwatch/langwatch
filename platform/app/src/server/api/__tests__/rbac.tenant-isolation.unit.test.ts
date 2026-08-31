import { describe, expect, it, vi } from "vitest";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";

import type { Session } from "~/server/auth";
import { appPermissionsService } from "~/test-utils/appPermissionsMock";

import { batchScopePermissions, hasProjectPermission, hasTeamPermission } from "../rbac";

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

type MockPrisma = Parameters<typeof hasProjectPermission>[0]["prisma"];

/**
 * The context the resolvers take. `permissionsFor` reads the ADR-110 fork gate
 * off `ctx.app.permissions` and falls back to `getApp()` when the context
 * carries none — in a unit worker, where no app is initialized, that fallback
 * throws. The two per-scope cases below never reach it, because the membership
 * gate refuses first; the batched resolver reads the gate BEFORE its own
 * membership check, so it does. Each call gets its own service so the gate's
 * per-organization cache cannot carry one test's answer into the next, and
 * every stub leaves `systemMigrationTenantState` empty — the "not on the
 * engine" answer that keeps the legacy walk the one under test.
 */
const context = (prisma: MockPrisma) => ({
  prisma,
  session: sessionForUserB,
  app: { permissions: appPermissionsService(prisma) },
});

/** No migration row: this organization has not cut over. */
const notOnEngine = () => ({ findUnique: vi.fn().mockResolvedValue(null) });

const grantingProjectBinding = {
  role: TeamUserRole.ADMIN,
  customRoleId: null,
  scopeType: RoleBindingScopeType.PROJECT,
  scopeId: PROJECT_A,
};

describe("read-path tenant isolation", () => {
  describe("when a non-member has a stale project-scoped binding", () => {
    it("denies project access before consulting the binding", async () => {
      const roleBindingFindMany = vi.fn().mockResolvedValue([grantingProjectBinding]);
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
        systemMigrationTenantState: notOnEngine(),
      } as unknown as MockPrisma;

      const permitted = await hasProjectPermission(context(prisma), PROJECT_A, "project:view");

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
          findUnique: vi.fn().mockResolvedValue({ id: TEAM_A, organizationId: ORG_A }),
        },
        // user_B is not an OrganizationUser of org_A.
        organizationUser: { findFirst: vi.fn().mockResolvedValue(null) },
        groupMembership: { findMany: vi.fn().mockResolvedValue([]) },
        roleBinding: { findMany: roleBindingFindMany },
        teamUser: { findFirst: vi.fn().mockResolvedValue(null) },
        systemMigrationTenantState: notOnEngine(),
      } as unknown as MockPrisma;

      const permitted = await hasTeamPermission(context(prisma), TEAM_A, "team:view");

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
          // `disabledAt` is load-bearing: since #7476 a row arriving without
          // the column reads as a disabled seat, and a disabled seat is not a
          // membership. Omitting it made this "genuine member" a locked-out
          // one, which denies before any binding is read.
          findFirst: vi
            .fn()
            .mockResolvedValue({ role: OrganizationUserRole.MEMBER, disabledAt: null }),
        },
        groupMembership: { findMany: vi.fn().mockResolvedValue([]) },
        roleBinding: {
          findMany: vi.fn().mockResolvedValue([grantingProjectBinding]),
        },
        teamUser: { findFirst: vi.fn().mockResolvedValue(null) },
        systemMigrationTenantState: notOnEngine(),
      } as unknown as MockPrisma;

      const permitted = await hasProjectPermission(context(prisma), PROJECT_A, "project:view");

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
        systemMigrationTenantState: notOnEngine(),
      } as unknown as MockPrisma;

      const { teams, projects } = await batchScopePermissions(context(prisma), {
        organizationId: ORG_A,
        teamIds: [TEAM_A],
        projectIds: [PROJECT_A],
        projectTeamId: { [PROJECT_A]: TEAM_A },
        permission: "project:view",
      });

      expect(projects.get(PROJECT_A)).toBe(false);
      expect(teams.get(TEAM_A)).toBe(false);
      // Membership short-circuits before any binding is loaded.
      expect(roleBindingFindMany).not.toHaveBeenCalled();
    });

    it("still grants a genuine member", async () => {
      const prisma = {
        organizationUser: {
          // `disabledAt` is load-bearing: since #7476 a row arriving without
          // the column reads as a disabled seat, and a disabled seat is not a
          // membership. Omitting it made this "genuine member" a locked-out
          // one, which denies before any binding is read.
          findFirst: vi
            .fn()
            .mockResolvedValue({ role: OrganizationUserRole.MEMBER, disabledAt: null }),
        },
        groupMembership: { findMany: vi.fn().mockResolvedValue([]) },
        roleBinding: {
          findMany: vi.fn().mockResolvedValue([grantingProjectBinding]),
        },
        customRole: { findMany: vi.fn().mockResolvedValue([]) },
        teamUser: { findMany: vi.fn().mockResolvedValue([]) },
        systemMigrationTenantState: notOnEngine(),
      } as unknown as MockPrisma;

      const { projects } = await batchScopePermissions(context(prisma), {
        organizationId: ORG_A,
        teamIds: [],
        projectIds: [PROJECT_A],
        projectTeamId: { [PROJECT_A]: TEAM_A },
        permission: "project:view",
      });

      expect(projects.get(PROJECT_A)).toBe(true);
    });
  });
});
