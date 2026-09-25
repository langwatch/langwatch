import {
  AuthzEngine,
  collectedBindingSchema,
  type AuthzScopeRef,
  type CollectedGrants,
} from "@langwatch/authz-contract";
import type { Prisma } from "@langwatch/prisma-client/generated";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import {
  adminGrantBindings,
  privateTokenGrantBinding,
  publicTokenGrantBinding,
  grantRowFor,
  roleRowFor,
} from "../seed-authz.ts";

const organizationId = "local-dev-organization";
const teamId = "local-dev-team";
const projectId = "local-dev-project";
const userId = "local-dev-admin-user";
const privateKeyId = "private-key";
const publicKeyId = "public-key";
const publicRoleId = "local-dev-public-ingestion-role";
const occurredAt = Temporal.Instant.from("2026-09-25T00:00:00Z");

const grantRows = [
  ...adminGrantBindings({ organizationId, teamId, userId }),
  privateTokenGrantBinding({ organizationId, apiKeyId: privateKeyId }),
  publicTokenGrantBinding({
    organizationId,
    projectId,
    apiKeyId: publicKeyId,
    roleId: publicRoleId,
  }),
].map((binding) => grantRowFor({ binding, occurredAt }));

const publicRoleProjection = {
  id: publicRoleId,
  organizationId,
  name: "local-dev-public-ingestion",
  description: null,
  permissions: ["traces:create"],
  kind: "system_api_key",
} as const satisfies Parameters<typeof roleRowFor>[0]["role"];
const publicRole = roleRowFor({ role: publicRoleProjection, occurredAt });

/** The binding list the engine's reader builds from live `Grant` rows for one principal. */
function bindingsHeldBy({
  principalType,
  principalId,
}: {
  principalType: Prisma.GrantUncheckedCreateInput["principalType"];
  principalId: string;
}) {
  return grantRows
    .filter((row) => row.principalType === principalType && row.principalId === principalId)
    .map((row) =>
      collectedBindingSchema.parse({
        roleKey: row.roleKey,
        scopeType: row.scopeType,
        scopeId: row.scopeId,
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
    bindings: bindingsHeldBy({ principalType: "API_KEY", principalId: apiKeyId }),
    customRolePermissions,
  };
}

const ownerGrants: CollectedGrants = {
  principal: { type: "user", id: userId },
  organizationId,
  organizationRole: "ADMIN",
  isOrgMember: true,
  membershipDisabled: false,
  bindings: bindingsHeldBy({ principalType: "USER", principalId: userId }),
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
      customRolePermissions: new Map([[publicRole.id, publicRoleProjection.permissions]]),
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
