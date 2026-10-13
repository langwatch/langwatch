import {
  AuthzEngine,
  bindingRoleKeyOf,
  collectedBindingSchema,
  type AuthzApi,
  type AuthzAttachBindingsInput,
  type AuthzDefineRoleInput,
  type AuthzScopeRef,
  type CollectedGrants,
} from "@langwatch/authz-contract";
import { describe, expect, it, vi } from "vitest";

import {
  adminGrants,
  attachSeedGrants,
  privateTokenGrant,
  publicTokenGrant,
  type SeedGrant,
} from "../seed-authz.ts";

const organizationId = "local-dev-organization";
const teamId = "local-dev-team";
const projectId = "local-dev-project";
const userId = "local-dev-admin-user";
const privateKeyId = "private-key";
const publicKeyId = "public-key";
const publicRoleId = "local-dev-public-ingestion-role";
const publicRolePermissions = ["traces:create"];

const seedGrants: SeedGrant[] = [
  ...adminGrants({ organizationId, teamId, userId }),
  privateTokenGrant({ organizationId, apiKeyId: privateKeyId }),
  publicTokenGrant({ projectId, apiKeyId: publicKeyId, roleId: publicRoleId }),
];

function principalIdOf({ principal }: SeedGrant): string {
  if ("userId" in principal) return principal.userId;
  if ("apiKeyId" in principal) return principal.apiKeyId;
  return principal.groupId;
}

/** The binding list the engine's reader builds from the projected grants of one principal. */
function bindingsHeldBy({ principalId }: { principalId: string }) {
  return seedGrants
    .filter((grant) => principalIdOf(grant) === principalId)
    .map((grant) =>
      collectedBindingSchema.parse({
        roleKey: bindingRoleKeyOf({ role: grant.role, customRoleId: grant.customRoleId }),
        scopeType: grant.scopeType,
        scopeId: grant.scopeId,
      }),
    );
}

function keyGrants({
  apiKeyId,
  customRolePermissions = new Map(),
}: {
  apiKeyId: string;
  customRolePermissions?: ReadonlyMap<string, readonly string[]>;
}): CollectedGrants {
  return {
    principal: { type: "apiKey", id: apiKeyId },
    organizationId,
    organizationRole: null,
    isOrgMember: false,
    membershipDisabled: false,
    bindings: bindingsHeldBy({ principalId: apiKeyId }),
    customRolePermissions,
  };
}

const ownerGrants: CollectedGrants = {
  principal: { type: "user", id: userId },
  organizationId,
  organizationRole: "ADMIN",
  isOrgMember: true,
  membershipDisabled: false,
  bindings: bindingsHeldBy({ principalId: userId }),
  customRolePermissions: new Map(),
};

const organizationScope: AuthzScopeRef = { type: "organization", id: organizationId };
const engine = new AuthzEngine();

describe("given the grants the local-dev seed writes", () => {
  describe("when the private access token asks at organization scope", () => {
    /** @scenario "The seeded private access token administers its organization" */
    it.each([
      "organization:view",
      "organization:manage",
      "team:view",
      "team:manage",
      "project:view",
      "project:delete",
      "webhookEndpoints:view",
    ])("allows %s within its owner's ceiling", (permission) => {
      const decision = engine.decideWithCeiling({
        keyGrants: keyGrants({ apiKeyId: privateKeyId }),
        ownerGrants,
        permission,
        scope: organizationScope,
      });

      expect(decision.allowed).toBe(true);
    });
  });

  describe("when the public ingestion token asks", () => {
    const grants = keyGrants({
      apiKeyId: publicKeyId,
      customRolePermissions: new Map([[publicRoleId, publicRolePermissions]]),
    });

    /** @scenario "The seeded public ingestion token stays restricted to trace ingestion" */
    it("refuses organization:view", () => {
      const decision = engine.decideWithCeiling({
        keyGrants: grants,
        ownerGrants: null,
        permission: "organization:view",
        scope: organizationScope,
      });

      expect(decision.allowed).toBe(false);
    });

    /** @scenario "The seeded public ingestion token stays restricted to trace ingestion" */
    it("allows traces:create on its project", () => {
      const decision = engine.decideWithCeiling({
        keyGrants: grants,
        ownerGrants: null,
        permission: "traces:create",
        scope: { type: "project", id: projectId, teamId, organizationId },
      });

      expect(decision.allowed).toBe(true);
    });
  });
});

describe("given the fixed local identity is seeded", () => {
  /** @scenario "The fixed local identity's grants come from real commands" */
  it("defines the role, then attaches every grant through the authz API", async () => {
    const calls: string[] = [];
    const authz: Pick<AuthzApi, "defineRole" | "attachBindings"> = {
      defineRole: vi.fn(async ({ roleId }: AuthzDefineRoleInput) => {
        calls.push(`defineRole ${roleId}`);
      }),
      attachBindings: vi.fn(async ({ bindings }: AuthzAttachBindingsInput) => {
        calls.push("attachBindings");
        return { attached: bindings.map((binding) => binding.bindingId), duplicates: [] };
      }),
    };
    const role = {
      roleId: publicRoleId,
      name: "local-dev-public-ingestion",
      permissions: publicRolePermissions,
      kind: "system_api_key",
    } as const;

    await attachSeedGrants({ authz, organizationId, roles: [role], grants: seedGrants });

    expect(calls).toEqual([`defineRole ${publicRoleId}`, "attachBindings"]);
    expect(authz.defineRole).toHaveBeenCalledWith(
      expect.objectContaining({ ...role, organizationId, actor: { type: "system", id: null } }),
    );
    const [attach] = vi.mocked(authz.attachBindings).mock.calls[0] ?? [];
    expect(attach).toMatchObject({
      organizationId,
      caller: { type: "system" },
      onDuplicate: "skip",
      requireProjection: false,
    });
    expect(attach?.bindings).toEqual(
      seedGrants.map((grant) => ({ ...grant, bindingId: expect.any(String) })),
    );
    expect(new Set(attach?.bindings.map((binding) => binding.bindingId)).size).toBe(4);
  });
});
