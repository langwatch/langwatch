import { RoleBindingScopeType, TeamUserRole } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  checkRoleBindingPermission,
  type ScopeRef,
} from "../role-binding-resolver";

// The API-key ceiling path (resolveApiKeyPermission → checkRoleBindingPermission
// for the owning user) resolves the user's bindings through collectBindingsForUser.
// A stale cross-org binding for a user who is not a current OrganizationUser of
// the org must not confer access.

const ORG_A = "org_a";
const TEAM_A = "team_a";
const PROJECT_A = "project_a";
const USER_B = "user_b";

const projectScope: ScopeRef = {
  type: "project",
  id: PROJECT_A,
  teamId: TEAM_A,
};

const staleBinding = {
  role: TeamUserRole.ADMIN,
  customRoleId: null,
  scopeType: RoleBindingScopeType.PROJECT,
  scopeId: PROJECT_A,
};

// Fake that models the org-membership predicate the direct-binding query is
// expected to carry: the seeded binding is only visible to a current member.
// When `isMember` is false the binding must be filtered out by the predicate;
// if the predicate is absent (the vulnerable shape) the binding leaks and the
// test fails — which is exactly what makes this a regression test.
function makePrisma({ isMember }: { isMember: boolean }) {
  return {
    roleBinding: {
      findMany: vi.fn().mockImplementation(async ({ where }: any) => {
        // The group-binding query carries `where.group`; there are no groups here.
        if (where.group) return [];
        const gatesOnMembership =
          where.user?.orgMemberships?.some?.organizationId === ORG_A;
        if (gatesOnMembership) return isMember ? [staleBinding] : [];
        // Predicate missing → stale binding leaks (pre-fix behavior).
        return [staleBinding];
      }),
    },
    customRole: { findUnique: vi.fn().mockResolvedValue(null) },
    teamUser: { findFirst: vi.fn().mockResolvedValue(null) },
  } as unknown as Parameters<typeof checkRoleBindingPermission>[0]["prisma"];
}

describe("checkRoleBindingPermission() tenant isolation", () => {
  describe("when the user is not a current member of the org", () => {
    it("denies despite a pre-existing cross-org binding", async () => {
      const prisma = makePrisma({ isMember: false });

      const allowed = await checkRoleBindingPermission({
        prisma,
        userId: USER_B,
        organizationId: ORG_A,
        scope: projectScope,
        permission: "project:view",
      });

      expect(allowed).toBe(false);
    });
  });

  describe("when the user is a current member of the org", () => {
    it("resolves the binding for a genuine member", async () => {
      const prisma = makePrisma({ isMember: true });

      const allowed = await checkRoleBindingPermission({
        prisma,
        userId: USER_B,
        organizationId: ORG_A,
        scope: projectScope,
        permission: "project:view",
      });

      expect(allowed).toBe(true);
    });
  });
});
