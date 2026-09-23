// Permission decisions service-level resolution; engine walk in contract package.
import type { AuthzPermission, CollectedBinding } from "@langwatch/authz-contract";
import { describe, expect, it, vi } from "vitest";

import { StubAuthzBindingRepository } from "../../repositories/__tests__/support/authz-binding.stub.ts";
import { StubAuthzListingRepository } from "../../repositories/__tests__/support/authz-listing.stub.ts";
import { makeReader } from "../../repositories/__tests__/support/authz-read.stub.ts";
import type {
  AuthzReadRepository,
  OrganizationRole,
} from "../../repositories/authz-read.repository.ts";
import { AuthzService } from "../authz.service.ts";

const ORG = "org-1";
const TEAM = "team-1";
const PROJECT = "proj-1";
const USER = "user-1";
const DEMO_PROJECT = "demo-proj";

type World = {
  membership?: OrganizationRole | null;
  bindings?: CollectedBinding[];
  groupBindings?: CollectedBinding[];
  customRoles?: { id: string; permissions: unknown }[];
  projectKnown?: boolean;
  demoProjectId?: string;
};

/**
 * The stored world one scenario turns on. Everything not named is absent:
 * no membership, no bindings, no teams, no custom roles.
 */
function authzFor({
  membership = "MEMBER",
  bindings = [],
  groupBindings = [],
  customRoles = [],
  projectKnown = true,
  demoProjectId,
}: World = {}): AuthzService {
  const overrides: Partial<AuthzReadRepository> = {
    findOrganizationMembership: vi
      .fn()
      .mockResolvedValue(membership ? { role: membership, disabled: false } : null),
    findUserBindings: vi.fn().mockResolvedValue(bindings),
    findGroupBindings: vi.fn().mockResolvedValue(groupBindings),
    findCustomRolePermissions: vi.fn().mockResolvedValue(customRoles),
    findProjectLineage: vi
      .fn()
      .mockResolvedValue(projectKnown ? { teamId: TEAM, organizationId: ORG } : null),
    findTeamOrganization: vi.fn().mockResolvedValue({ organizationId: ORG }),
  };
  return AuthzService.create({
    isOnEngine: async () => true,
    repository: makeReader(overrides),
    listing: new StubAuthzListingRepository(),
    bindings: new StubAuthzBindingRepository(),
    ...(demoProjectId ? { demoProjectId: () => demoProjectId } : {}),
  });
}

const teamBinding = (roleKey: CollectedBinding["roleKey"]): CollectedBinding => ({
  roleKey,
  scopeType: "TEAM",
  scopeId: TEAM,
});

const orgBinding = (roleKey: CollectedBinding["roleKey"]): CollectedBinding => ({
  roleKey,
  scopeType: "ORGANIZATION",
  scopeId: ORG,
});

const onProject = (authz: AuthzService, permission: AuthzPermission, id = PROJECT) =>
  authz.getDecision({ userId: USER, permission, scope: { tier: "project", id } });

const onOrganization = (authz: AuthzService, permission: AuthzPermission) =>
  authz.getDecision({ userId: USER, permission, scope: { tier: "organization", id: ORG } });

const onTeam = (authz: AuthzService, permission: AuthzPermission) =>
  authz.getDecision({ userId: USER, permission, scope: { tier: "team", id: TEAM } });

describe("given a project-scoped permission check", () => {
  describe("when the project id resolves to nothing", () => {
    /** @scenario "An unresolvable scope id is denied like any other" */
    it("denies and reports no organization role, revealing nothing about the id", async () => {
      const decision = await onProject(
        authzFor({ projectKnown: false, bindings: [teamBinding("admin")] }),
        "workflows:view",
      );

      expect(decision.permitted).toBe(false);
      expect(decision.organizationRole).toBeNull();
    });
  });

  describe("when the caller holds no membership in the owning organization", () => {
    /** @scenario "A caller with no organization membership resolves nothing" */
    /** @scenario "Non-members are denied access" */
    it("denies despite a binding naming them, and reports no role", async () => {
      const decision = await onProject(
        authzFor({ membership: null, bindings: [teamBinding("admin")] }),
        "workflows:view",
      );

      expect(decision.permitted).toBe(false);
      expect(decision.organizationRole).toBeNull();
      expect(decision.denialReason).toBe("no-membership");
    });
  });

  describe("when the caller is a member of the organization but of no team", () => {
    /** @scenario "A built-in role binding grants its bag" */
    it("denies for want of a binding", async () => {
      const decision = await onProject(authzFor(), "workflows:view");

      expect(decision.permitted).toBe(false);
      expect(decision.denialReason).toBe("no-binding");
    });
  });

  describe("when the caller's only binding arrives through a group", () => {
    /** @scenario "A group binding authorizes exactly like a direct one" */
    it("grants — a group binding is a binding", async () => {
      const decision = await onProject(
        authzFor({ groupBindings: [{ ...teamBinding("member"), viaGroupId: "group-1" }] }),
        "workflows:view",
      );

      expect(decision.permitted).toBe(true);
    });
  });

  describe("when the caller holds a built-in role binding", () => {
    /** @scenario "A built-in role binding grants its bag" */
    it("grants what that role's bag carries", async () => {
      const decision = await onProject(
        authzFor({ bindings: [teamBinding("admin")] }),
        "workflows:view",
      );

      expect(decision.permitted).toBe(true);
      expect(decision.organizationRole).toBe("MEMBER");
    });
  });

  describe("when the caller holds a custom role", () => {
    const customRoleWorld = (permissions: string[]): World => ({
      bindings: [teamBinding("custom:custom-1")],
      customRoles: [{ id: "custom-1", permissions }],
    });

    /** @scenario "A custom role binding is authoritative for its holder" */
    /** @scenario "Custom role grants are honored and org role is still known" */
    it("grants a view request from the role's manage grant", async () => {
      const decision = await onProject(
        authzFor(customRoleWorld(["workflows:manage"])),
        "workflows:view",
      );

      expect(decision.permitted).toBe(true);
    });

    /** @scenario "A custom role binding is authoritative for its holder" */
    /** @scenario "Custom role restrictions are honored and org role is still known" */
    it("denies a permission the role does not list, still reporting the role", async () => {
      const decision = await onProject(
        authzFor(customRoleWorld(["analytics:view"])),
        "datasets:manage",
      );

      expect(decision.permitted).toBe(false);
      expect(decision.organizationRole).toBe("MEMBER");
    });
  });

  describe("when the team role decides the outcome", () => {
    const cases: {
      roleKey: CollectedBinding["roleKey"];
      permission: AuthzPermission;
      permitted: boolean;
    }[] = [
      { roleKey: "admin", permission: "analytics:view", permitted: true },
      { roleKey: "admin", permission: "datasets:manage", permitted: true },
      { roleKey: "admin", permission: "team:manage", permitted: true },
      { roleKey: "member", permission: "analytics:view", permitted: true },
      { roleKey: "member", permission: "datasets:manage", permitted: true },
      { roleKey: "member", permission: "team:manage", permitted: false },
      { roleKey: "viewer", permission: "analytics:view", permitted: true },
      { roleKey: "viewer", permission: "datasets:manage", permitted: false },
      { roleKey: "viewer", permission: "team:manage", permitted: false },
    ];

    /** @scenario "A team role decides the outcome at project scope" */
    /** @scenario "Team role permissions are unaffected by org role awareness" */
    it.each(cases)(
      "answers $permitted for a $roleKey asking $permission",
      async ({ roleKey, permission, permitted }) => {
        const decision = await onProject(
          authzFor({ bindings: [teamBinding(roleKey)] }),
          permission,
        );

        expect(decision.permitted).toBe(permitted);
        expect(decision.organizationRole).toBe("MEMBER");
      },
    );
  });

  describe("when the caller's organization role is carried back", () => {
    /** @scenario "Every decision carries the caller's organization role" */
    /** @scenario "Platform identifies the user's organization role" */
    it.each(["ADMIN", "MEMBER", "EXTERNAL"] as const)(
      "reports %s alongside the verdict",
      async (role) => {
        const decision = await onProject(
          authzFor({ membership: role, bindings: [teamBinding("member")] }),
          "analytics:view",
        );

        expect(decision.organizationRole).toBe(role);
        expect(decision.permitted).toBe(true);
      },
    );
  });
});

describe("given the demo project", () => {
  describe("when a signed-in caller with no membership opens it", () => {
    /** @scenario "The demo project opens read-only for a signed-in caller" */
    it("grants the read-only tour", async () => {
      const decision = await onProject(
        authzFor({ membership: null, demoProjectId: DEMO_PROJECT }),
        "analytics:view",
        DEMO_PROJECT,
      );

      expect(decision.permitted).toBe(true);
    });

    /** @scenario "The demo project opens read-only for a signed-in caller" */
    it("refuses anything the tour does not carry", async () => {
      const decision = await onProject(
        authzFor({ membership: null, demoProjectId: DEMO_PROJECT }),
        "workflows:manage",
        DEMO_PROJECT,
      );

      expect(decision.permitted).toBe(false);
    });
  });

  describe("when no demo project is configured", () => {
    /** @scenario "The demo project opens read-only for a signed-in caller" */
    it("treats the same id as an ordinary project", async () => {
      const decision = await onProject(
        authzFor({ membership: null }),
        "analytics:view",
        DEMO_PROJECT,
      );

      expect(decision.permitted).toBe(false);
    });
  });
});

describe("given an organization-scoped permission check", () => {
  describe("when the caller is not a member", () => {
    /** @scenario "A caller with no organization membership resolves nothing" */
    it("denies", async () => {
      const decision = await onOrganization(authzFor({ membership: null }), "organization:view");

      expect(decision.permitted).toBe(false);
      expect(decision.organizationRole).toBeNull();
    });
  });

  describe("when a bare member holds no binding and belongs to no team", () => {
    /** @scenario "Every organization member holds the member floor" */
    it("still reads the organization and the personal tool catalogue", async () => {
      const authz = authzFor();

      await expect(onOrganization(authz, "organization:view")).resolves.toMatchObject({
        permitted: true,
      });
      await expect(onOrganization(authz, "aiTools:view")).resolves.toMatchObject({
        permitted: true,
      });
    });

    /** @scenario "Every organization member holds the member floor" */
    it("does not reach organization management", async () => {
      const decision = await onOrganization(authzFor(), "organization:manage");

      expect(decision.permitted).toBe(false);
    });
  });

  describe("when a lite member carries a stray organization-scoped admin binding", () => {
    const liteWithAdminBinding = (): AuthzService =>
      authzFor({ membership: "EXTERNAL", bindings: [orgBinding("admin")] });

    /** @scenario "A lite member is never promoted by an organization-scoped binding" */
    it("still reaches the member floor", async () => {
      await expect(onOrganization(liteWithAdminBinding(), "aiTools:view")).resolves.toMatchObject({
        permitted: true,
      });
      await expect(
        onOrganization(liteWithAdminBinding(), "organization:view"),
      ).resolves.toMatchObject({ permitted: true });
    });

    /** @scenario "A lite member is never promoted by an organization-scoped binding" */
    it("is never promoted by that binding", async () => {
      const decision = await onOrganization(liteWithAdminBinding(), "organization:manage");

      expect(decision.permitted).toBe(false);
    });
  });

  describe("when an organization admin holds an organization-scoped admin binding", () => {
    /** @scenario "An organization admin holds the organization and its governance surfaces" */
    it("manages the organization", async () => {
      const decision = await onOrganization(
        authzFor({ membership: "ADMIN", bindings: [orgBinding("admin")] }),
        "organization:manage",
      );

      expect(decision.permitted).toBe(true);
    });
  });

  describe("when an organization admin belongs to no team", () => {
    /** @scenario "An organization admin manages any team without joining it" */
    /** @scenario "Org admin can manage any team regardless of team membership" */
    it("still administers any team in the organization", async () => {
      const decision = await onTeam(
        authzFor({ membership: "ADMIN", bindings: [orgBinding("admin")] }),
        "team:manage",
      );

      expect(decision.permitted).toBe(true);
    });
  });

  describe("when a plain member administers a team", () => {
    /** @scenario "A team administrator gains no organization permission" */
    it("gains no organization permission from it", async () => {
      const decision = await onOrganization(
        authzFor({ bindings: [teamBinding("admin")] }),
        "organization:manage",
      );

      expect(decision.permitted).toBe(false);
    });
  });
});

describe("given a lite member", () => {
  const liteMember = (world: World = {}): AuthzService =>
    authzFor({ membership: "EXTERNAL", bindings: [teamBinding("viewer")], ...world });

  describe("when they request a mutating permission", () => {
    /** @scenario "A lite member is refused every mutating permission" */
    it.each([
      "datasets:manage",
      "prompts:manage",
      "annotations:manage",
      "evaluations:manage",
      "workflows:manage",
      "scenarios:manage",
      "secrets:manage",
      "team:manage",
      "project:manage",
      "project:create",
      "project:update",
      "project:delete",
      "triggers:manage",
    ] as AuthzPermission[])("denies %s and names the restriction", async (permission) => {
      const decision = await onProject(liteMember(), permission);

      expect(decision.permitted).toBe(false);
      expect(decision.organizationRole).toBe("EXTERNAL");
      expect(decision.denialReason).toBe("lite-member-restricted");
    });
  });

  describe("when they request a permission the lite bag carries", () => {
    /** @scenario "A lite member is refused every mutating permission" */
    it.each([
      "project:view",
      "analytics:view",
      "traces:view",
      "annotations:view",
      "annotations:create",
      "annotations:update",
      "evaluations:view",
      "datasets:view",
      "workflows:view",
      "prompts:view",
      "scenarios:view",
      "secrets:view",
      "team:view",
    ] as AuthzPermission[])("grants %s", async (permission) => {
      const decision = await onProject(liteMember(), permission);

      expect(decision.permitted).toBe(true);
      expect(decision.organizationRole).toBe("EXTERNAL");
    });
  });

  describe("when a non-empty custom role overrides the cap", () => {
    const withCustomRole = (permissions: string[]): AuthzService =>
      liteMember({
        bindings: [teamBinding("custom:custom-1")],
        customRoles: [{ id: "custom-1", permissions }],
      });

    /** @scenario "A lite member's custom role overrides the cap in both directions" */
    it("grants exactly what the custom role lists", async () => {
      const decision = await onProject(withCustomRole(["datasets:view"]), "datasets:view");

      expect(decision.permitted).toBe(true);
    });

    /** @scenario "A lite member's custom role overrides the cap in both directions" */
    it("denies what it does not list, cap or no cap", async () => {
      const decision = await onProject(withCustomRole(["datasets:view"]), "prompts:view");

      expect(decision.permitted).toBe(false);
    });
  });

  describe("when the same request comes at team scope", () => {
    /** @scenario "A lite member is refused every mutating permission" */
    it("denies the mutating permission and grants the readable one", async () => {
      const authz = liteMember();

      await expect(onTeam(authz, "datasets:manage")).resolves.toMatchObject({
        permitted: false,
        organizationRole: "EXTERNAL",
      });
      await expect(onTeam(authz, "analytics:view")).resolves.toMatchObject({
        permitted: true,
        organizationRole: "EXTERNAL",
      });
    });
  });
});
