/**
 * The ceiling on what a credential may be granted.
 *
 * This is the escalation boundary for API keys: whatever a key ends up holding
 * has to be something its creator already held, at that scope. Two halves make
 * that true, and both are pinned here — the permission each role actually
 * stands for, and the check that the granting user holds it.
 *
 * The scope checks below are the tenant boundary rather than a validation
 * nicety: a team or project from another organization must be refused, not
 * resolved.
 */

import { describe, expect, it } from "vitest";
import { ApiKeyScopeViolationError } from "@langwatch/api-key-contract";
import type { ApiKeyScope } from "@langwatch/api-key-contract";
import { ApiKeyGrantPolicyService } from "../api-key-grant-policy.service";

type Fakes = {
  can?: boolean;
  allow?: (permission: string) => boolean;
  permissionsAsked?: string[];
  userBindings?: Array<{ scopeType: string; scopeId: string; role: string }>;
  scopeBindings?: Array<{ apiKeyId: string; role: string }>;
  customRoles?: Array<{ id: string; permissions: unknown }>;
  team?: "found" | "missing";
  project?: { archivedAt?: Date | null; team: { id: string; organizationId: string } };
  personalOwner?: string | null;
  attached?: { attached: string[]; duplicates: string[] };
  calls?: Array<Record<string, unknown>>;
};

function policyWith(fakes: Fakes = {}) {
  const calls: Array<Record<string, unknown>> = [];
  const service = ApiKeyGrantPolicyService.create({
    repository: {
      tryFindPersonalWorkspaceOwner: async () =>
        fakes.personalOwner === undefined ? null : { ownerUserId: fakes.personalOwner },
    },
    authz: {
      hasPermission: async () => true,
      can: async (input: { permission: string }) => {
        calls.push({ method: "can", permission: input.permission });
        return fakes.allow?.(input.permission) ?? fakes.can ?? true;
      },
      listUserBindings: async () => fakes.userBindings ?? [],
      listScopeBindings: async () => fakes.scopeBindings ?? [],
      listUserCreatedRoles: async () => fakes.customRoles ?? [],
    },
    organizations: {
      getTeam: async () => {
        if (fakes.team === "missing") throw new Error("no such team");
        return { id: "team-1" };
      },
    },
    projects: {
      getWithTeam: async () =>
        fakes.project ?? {
          archivedAt: null,
          team: { id: "team-1", organizationId: "organization-1" },
        },
    },
    bindingIds: { generateBindingId: () => "generated-binding" },
    grants: {
      defineRole: async (input: Record<string, unknown>) => {
        calls.push({ method: "defineRole", ...input });
      },
      attachBindings: async () => fakes.attached ?? { attached: [], duplicates: [] },
      revokeBindingsWhere: async (input: Record<string, unknown>) => {
        calls.push({ method: "revokeBindingsWhere", ...input });
      },
    },
  } as never);

  return { calls, service };
}

const ORG = "organization-1";
const scope = (over: Partial<ApiKeyScope> = {}): ApiKeyScope => ({
  scopeType: "PROJECT",
  scopeId: "project-1",
  role: "MEMBER",
  ...over,
});

describe("ApiKeyGrantPolicyService", () => {
  describe("assertCeiling", () => {
    describe("given a user who does not hold the permission being granted", () => {
      /** @scenario Service rejects permissions above creator ceiling */
      it("refuses to mint a key above its owner's ceiling", async () => {
        const { service } = policyWith({ can: false });

        await expect(
          service.assertCeiling("user-1", ORG, [scope({ role: "ADMIN" })], []),
        ).rejects.toBeInstanceOf(ApiKeyScopeViolationError);
      });
    });

    describe("given a user whose own role is Member", () => {
      // The role each binding stands for decides what the ceiling is asked
      // about, so the same user clears MEMBER and is stopped at ADMIN.
      const memberCeiling = { allow: (permission: string) => permission !== "project:manage" };

      /** @scenario "All" mode is bounded by user ceiling */
      it("may mint a Member key but not an Admin one", async () => {
        const member = policyWith(memberCeiling);
        await expect(
          member.service.assertCeiling("user-1", ORG, [scope({ role: "MEMBER" })], []),
        ).resolves.toBeUndefined();

        const admin = policyWith(memberCeiling);
        await expect(
          admin.service.assertCeiling("user-1", ORG, [scope({ role: "ADMIN" })], []),
        ).rejects.toBeInstanceOf(ApiKeyScopeViolationError);
      });
    });

    describe("given a user who holds it", () => {
      it("allows the grant", async () => {
        const { service } = policyWith({ can: true });

        await expect(
          service.assertCeiling("user-1", ORG, [scope({ role: "ADMIN" })], []),
        ).resolves.toBeUndefined();
      });

      it("checks the ceiling at the binding's own scope, not the organization", async () => {
        const { service, calls } = policyWith({});

        await service.assertCeiling("user-1", ORG, [scope()], []);

        expect(calls.filter((call) => call.method === "can")).toHaveLength(1);
      });
    });

    // The permission each role stands for IS the ceiling. Map ADMIN to
    // something weak and a user holding only `project:view` could mint an
    // admin key, with every check still passing.
    describe("given each role", () => {
      const expected: Array<[ApiKeyScope["role"], ApiKeyScope["scopeType"], string]> = [
        ["ADMIN", "ORGANIZATION", "organization:manage"],
        ["ADMIN", "PROJECT", "project:manage"],
        ["MEMBER", "ORGANIZATION", "organization:view"],
        ["MEMBER", "PROJECT", "project:update"],
        ["VIEWER", "PROJECT", "project:view"],
      ];

      for (const [role, scopeType, permission] of expected) {
        it(`requires ${permission} to grant ${role} on a ${scopeType.toLowerCase()}`, async () => {
          const { service, calls } = policyWith({});

          await service.assertCeiling(
            "user-1",
            ORG,
            [scope({ role, scopeType, scopeId: scopeType === "ORGANIZATION" ? ORG : "project-1" })],
            [],
          );

          expect(calls.find((call) => call.method === "can")?.permission).toBe(permission);
        });
      }
    });

    describe("given a CUSTOM binding naming a role", () => {
      it("checks every permission that role carries", async () => {
        const { service, calls } = policyWith({
          customRoles: [{ id: "role-1", permissions: ["project:manage", "project:view"] }],
        });

        await service.assertCeiling(
          "user-1",
          ORG,
          [scope({ role: "CUSTOM", customRoleId: "role-1" })],
          [],
        );

        expect(
          calls.filter((call) => call.method === "can").map((call) => call.permission),
        ).toEqual(["project:manage", "project:view"]);
      });

      it("refuses a role it cannot resolve, rather than granting nothing and passing", async () => {
        const { service } = policyWith({ customRoles: [] });

        await expect(
          service.assertCeiling(
            "user-1",
            ORG,
            [scope({ role: "CUSTOM", customRoleId: "role-1" })],
            [],
          ),
        ).rejects.toBeInstanceOf(ApiKeyScopeViolationError);
      });

      it("refuses a role whose permissions are not strings", async () => {
        const { service } = policyWith({ customRoles: [{ id: "role-1", permissions: [{}, 7] }] });

        await expect(
          service.assertCeiling(
            "user-1",
            ORG,
            [scope({ role: "CUSTOM", customRoleId: "role-1" })],
            [],
          ),
        ).rejects.toBeInstanceOf(ApiKeyScopeViolationError);
      });
    });
  });

  describe("validateScope", () => {
    describe("given an organization scope for a different organization", () => {
      it("refuses it", async () => {
        const { service } = policyWith({});

        await expect(
          service.validateScope(scope({ scopeType: "ORGANIZATION", scopeId: "other-org" }), ORG),
        ).rejects.toBeInstanceOf(ApiKeyScopeViolationError);
      });
    });

    describe("given a team that is not in this organization", () => {
      it("refuses it", async () => {
        const { service } = policyWith({ team: "missing" });

        await expect(
          service.validateScope(scope({ scopeType: "TEAM", scopeId: "team-9" }), ORG),
        ).rejects.toBeInstanceOf(ApiKeyScopeViolationError);
      });
    });

    describe("given a project owned by another organization", () => {
      /** @scenario Service validates scope belongs to organization */
      it("refuses it, rather than resolving a scope across the tenant boundary", async () => {
        const { service } = policyWith({
          project: { archivedAt: null, team: { id: "team-1", organizationId: "other-org" } },
        });

        await expect(service.validateScope(scope(), ORG)).rejects.toBeInstanceOf(
          ApiKeyScopeViolationError,
        );
      });
    });

    describe("given an archived project", () => {
      it("refuses it", async () => {
        const { service } = policyWith({
          project: { archivedAt: new Date(), team: { id: "team-1", organizationId: ORG } },
        });

        await expect(service.validateScope(scope(), ORG)).rejects.toBeInstanceOf(
          ApiKeyScopeViolationError,
        );
      });
    });

    describe("given a live project in this organization", () => {
      it("resolves it with the team that carries it", async () => {
        const { service } = policyWith({});

        await expect(service.validateScope(scope(), ORG)).resolves.toEqual({
          type: "project",
          id: "project-1",
          teamId: "team-1",
          organizationId: ORG,
        });
      });
    });
  });

  describe("assertPersonalScopesOwnedBy", () => {
    describe("given a personal workspace belonging to somebody else", () => {
      it("refuses to grant it away", async () => {
        const { service } = policyWith({ personalOwner: "user-2" });

        await expect(
          service.assertPersonalScopesOwnedBy({
            scopes: [scope()],
            organizationId: ORG,
            ownerUserId: "user-1",
          }),
        ).rejects.toBeInstanceOf(ApiKeyScopeViolationError);
      });
    });

    describe("given the owner's own personal workspace", () => {
      it("allows it", async () => {
        const { service } = policyWith({ personalOwner: "user-1" });

        await expect(
          service.assertPersonalScopesOwnedBy({
            scopes: [scope()],
            organizationId: ORG,
            ownerUserId: "user-1",
          }),
        ).resolves.toBeUndefined();
      });
    });
  });

  describe("tryValidatePermissionSelection", () => {
    describe("given permissions outside restricted mode", () => {
      it("refuses them", () => {
        const { service } = policyWith({});

        expect(() =>
          service.tryValidatePermissionSelection({
            bindings: [scope()],
            permissionMode: "all",
            permissions: ["project:view"],
          }),
        ).toThrow(ApiKeyScopeViolationError);
      });
    });

    describe("given restricted mode with no CUSTOM binding", () => {
      it("refuses it", () => {
        const { service } = policyWith({});

        expect(() =>
          service.tryValidatePermissionSelection({
            bindings: [scope()],
            permissionMode: "restricted",
            permissions: ["project:view"],
          }),
        ).toThrow(ApiKeyScopeViolationError);
      });
    });

    describe("given a CUSTOM binding with no permissions", () => {
      it("refuses it, rather than minting a role that grants nothing", () => {
        const { service } = policyWith({});

        expect(() =>
          service.tryValidatePermissionSelection({
            bindings: [scope({ role: "CUSTOM" })],
            permissionMode: "restricted",
            permissions: [],
          }),
        ).toThrow(ApiKeyScopeViolationError);
      });
    });

    describe("given a permission that is not resource:action", () => {
      it("refuses it", () => {
        const { service } = policyWith({});

        expect(() =>
          service.tryValidatePermissionSelection({
            bindings: [scope({ role: "CUSTOM" })],
            permissionMode: "restricted",
            permissions: ["wildcard-everything"],
          }),
        ).toThrow(ApiKeyScopeViolationError);
      });
    });

    describe("given a valid restricted selection", () => {
      it("returns the permissions sorted, so the same grant has one spelling", () => {
        const { service } = policyWith({});

        expect(
          service.tryValidatePermissionSelection({
            bindings: [scope({ role: "CUSTOM" })],
            permissionMode: "restricted",
            permissions: ["project:view", "organization:view"],
          }),
        ).toEqual(["organization:view", "project:view"]);
      });
    });

    describe("given no permissions and no CUSTOM binding", () => {
      it("asks for nothing", () => {
        const { service } = policyWith({});

        expect(
          service.tryValidatePermissionSelection({ bindings: [scope()], permissionMode: "all" }),
        ).toBeUndefined();
      });
    });
  });

  describe("isOrgAdmin", () => {
    describe("given an admin binding on a different organization", () => {
      it("does not count it", async () => {
        const { service } = policyWith({
          userBindings: [{ scopeType: "ORGANIZATION", scopeId: "other-org", role: "ADMIN" }],
        });

        await expect(service.isOrgAdmin({ userId: "user-1", organizationId: ORG })).resolves.toBe(
          false,
        );
      });
    });

    describe("given an admin binding on a team rather than the organization", () => {
      it("does not count it", async () => {
        const { service } = policyWith({
          userBindings: [{ scopeType: "TEAM", scopeId: ORG, role: "ADMIN" }],
        });

        await expect(service.isOrgAdmin({ userId: "user-1", organizationId: ORG })).resolves.toBe(
          false,
        );
      });
    });

    describe("given an organization admin binding", () => {
      it("counts it", async () => {
        const { service } = policyWith({
          userBindings: [{ scopeType: "ORGANIZATION", scopeId: ORG, role: "ADMIN" }],
        });

        await expect(service.isOrgAdmin({ userId: "user-1", organizationId: ORG })).resolves.toBe(
          true,
        );
      });
    });
  });

  describe("writeBindings", () => {
    const input = {
      apiKeyId: "key-1",
      organizationId: ORG,
      bindings: [scope()],
      actor: { type: "user" as const, id: "user-1" },
      replace: true,
    };

    describe("given a replace where every requested binding already exists", () => {
      // The ordinary edit: the form resubmits the key's current scopes while
      // changing its name. Everything comes back as a duplicate and nothing is
      // freshly attached — and the bindings to keep are exactly those
      // duplicates, so they have to survive the revoke.
      /** @scenario Editing a key without changing its scopes keeps them */
      it("keeps the bindings it just confirmed, rather than revoking them all", async () => {
        const { service, calls } = policyWith({
          attached: { attached: [], duplicates: ["binding-1"] },
        });

        await service.writeBindings(input);

        expect(calls.find((call) => call.method === "revokeBindingsWhere")?.where).toEqual({
          apiKeyId: "key-1",
          id: { notIn: ["binding-1"] },
        });
      });
    });

    describe("given a replace that attaches some and repeats others", () => {
      it("keeps both", async () => {
        const { service, calls } = policyWith({
          attached: { attached: ["binding-2"], duplicates: ["binding-1"] },
        });

        await service.writeBindings(input);

        expect(calls.find((call) => call.method === "revokeBindingsWhere")?.where).toEqual({
          apiKeyId: "key-1",
          id: { notIn: ["binding-2", "binding-1"] },
        });
      });
    });

    describe("given a replace with nothing to keep", () => {
      it("revokes every binding on the key", async () => {
        const { service, calls } = policyWith({ attached: { attached: [], duplicates: [] } });

        await service.writeBindings({ ...input, bindings: [] });

        expect(calls.find((call) => call.method === "revokeBindingsWhere")?.where).toEqual({
          apiKeyId: "key-1",
        });
      });
    });

    describe("given no replace", () => {
      it("revokes nothing", async () => {
        const { service, calls } = policyWith({});

        await service.writeBindings({ ...input, replace: false });

        expect(calls.some((call) => call.method === "revokeBindingsWhere")).toBe(false);
      });
    });

    describe("given permissions", () => {
      const restricted = {
        ...input,
        bindings: [scope({ role: "CUSTOM" })],
        permissions: ["project:view", "organization:view"],
      };

      /** @scenario Service stores CustomRole permissions as sorted array */
      it("stores them sorted, so the same grant has one spelling on the role", async () => {
        const { service, calls } = policyWith({});

        await service.writeBindings(restricted);

        expect(calls.find((call) => call.method === "defineRole")).toMatchObject({
          permissions: ["organization:view", "project:view"],
        });
      });

      /** @scenario Creating a restricted key creates a CustomRole and links it to bindings */
      it("mints the key's own role and points its CUSTOM bindings at it", async () => {
        const { service, calls } = policyWith({});

        const result = await service.writeBindings(restricted);

        expect(calls.find((call) => call.method === "defineRole")).toMatchObject({
          roleId: "apikey:key-1",
          kind: "system_api_key",
        });
        expect(result[0]?.customRoleId).toBe("apikey:key-1");
      });

      /** @scenario Updating a key from All to Restricted upserts a CustomRole */
      it("reuses the same role id when an existing key becomes restricted", async () => {
        // The update path names no role id, so a key that gains permissions
        // later lands on the one derived from its own id rather than a second
        // role alongside the first.
        const { service, calls } = policyWith({});

        await service.writeBindings({ ...restricted, replace: true, roleId: undefined });

        expect(calls.filter((call) => call.method === "defineRole")).toMatchObject([
          { roleId: "apikey:key-1" },
        ]);
      });

      it("leaves non-CUSTOM bindings unlinked", async () => {
        const { service } = policyWith({});

        const result = await service.writeBindings({
          ...restricted,
          bindings: [scope({ role: "MEMBER" })],
        });

        expect(result[0]?.customRoleId).toBeUndefined();
      });
    });
  });
});
