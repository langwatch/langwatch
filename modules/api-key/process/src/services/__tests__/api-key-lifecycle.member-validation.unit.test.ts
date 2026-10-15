/**
 * A create naming a person is checked for organization membership before anything else:
 * scopes, personal-scope ownership and ceilings run only for a member.
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import { HandledError } from "@langwatch/handled-error";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { MemoryApiKeyDatabase } from "../../repositories/memory/memory.api-key.database.ts";
import { MemoryApiKeyRepository } from "../../repositories/memory/memory.api-key.repository.ts";
import { ApiKeyGrantPolicyService } from "../api-key-grant-policy.service.ts";
import { ApiKeyLifecycleService } from "../api-key-lifecycle.service.ts";
import { ApiKeyTokenService } from "../api-key-token.service.ts";

const ORG_ID = "org_1";
const USER_ID = "user_1";

function makeService({ isMember }: { isMember: boolean }) {
  const repository = MemoryApiKeyRepository.create({ memory: MemoryApiKeyDatabase.create() });
  const create = vi.spyOn(repository, "create");
  const hasPermission = vi.fn<AuthzApi["hasPermission"]>(async () => isMember);
  const findPermissionsBeyondCaller = vi.fn<AuthzApi["findPermissionsBeyondCaller"]>(
    async () => [],
  );
  const getTeam = vi.fn<OrganizationApi["getTeam"]>(async () => {
    throw new Error("team not found");
  });
  const findPersonalWorkspaceOwner = vi.fn<ProjectApi["findPersonalWorkspaceOwner"]>(
    async () => null,
  );
  const dependencies = {
    authz: createApiFixture<AuthzApi>({ hasPermission, findPermissionsBeyondCaller }),
    grants: createApiFixture<AuthzApi>({}),
    organizations: createApiFixture<OrganizationApi>({ getTeam }),
    projects: createApiFixture<ProjectApi>({ findPersonalWorkspaceOwner }),
    bindingIds: { generateBindingId: () => "rb_new" },
    legacyGrants: {} as never,
    tokens: ApiKeyTokenService.create("test-pepper"),
  };
  const policy = ApiKeyGrantPolicyService.create(dependencies);
  const service = ApiKeyLifecycleService.create({ ...dependencies, repository }, policy, {
    forget: async () => void 0,
  });

  return {
    service,
    create,
    hasPermission,
    findPermissionsBeyondCaller,
    getTeam,
    findPersonalWorkspaceOwner,
  };
}

async function codeOf(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return HandledError.isHandled(error) ? error.code : error;
  }
  return null;
}

describe("ApiKeyLifecycleService member validation", () => {
  describe("given a create carrying the userId of an organization member", () => {
    it("checks organization view for that user and writes the key to them", async () => {
      const { service, create, hasPermission } = makeService({ isMember: true });

      await service.writeDisabled({
        name: "Personal Key",
        userId: USER_ID,
        organizationId: ORG_ID,
        permissionMode: "all",
        bindings: [{ role: "ADMIN", scopeType: "ORGANIZATION", scopeId: ORG_ID }],
      });

      expect(hasPermission).toHaveBeenCalledWith({
        userId: USER_ID,
        organizationId: ORG_ID,
        permission: "organization:view",
      });
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ userId: USER_ID }));
    });
  });

  describe("given a create carrying the userId of a non-member", () => {
    it("refuses with a scope violation and writes nothing", async () => {
      const { service, create } = makeService({ isMember: false });

      expect(
        await codeOf(() =>
          service.writeDisabled({
            name: "Personal Key",
            userId: USER_ID,
            organizationId: ORG_ID,
            permissionMode: "all",
            bindings: [{ role: "ADMIN", scopeType: "ORGANIZATION", scopeId: ORG_ID }],
          }),
        ),
      ).toBe("api_key_scope_violation");
      expect(create).not.toHaveBeenCalled();
    });

    it("refuses on membership before scope, ownership and ceiling would also fail", async () => {
      const {
        service,
        create,
        hasPermission,
        getTeam,
        findPersonalWorkspaceOwner,
        findPermissionsBeyondCaller,
      } = makeService({ isMember: false });

      expect(
        await codeOf(() =>
          service.writeDisabled({
            name: "Personal Key",
            userId: USER_ID,
            organizationId: ORG_ID,
            permissionMode: "all",
            bindings: [{ role: "ADMIN", scopeType: "TEAM", scopeId: "team_missing" }],
          }),
        ),
      ).toBe("api_key_scope_violation");

      expect(hasPermission).toHaveBeenCalledTimes(1);
      expect(getTeam).not.toHaveBeenCalled();
      expect(findPersonalWorkspaceOwner).not.toHaveBeenCalled();
      expect(findPermissionsBeyondCaller).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    });
  });

  describe("given a create with no userId and a scope that does not resolve", () => {
    it("skips the membership check and fails on the scope", async () => {
      const { service, hasPermission, getTeam } = makeService({ isMember: false });

      expect(
        await codeOf(() =>
          service.writeDisabled({
            name: "Automation Key",
            userId: null,
            organizationId: ORG_ID,
            permissionMode: "all",
            bindings: [{ role: "ADMIN", scopeType: "TEAM", scopeId: "team_missing" }],
          }),
        ),
      ).toBe("api_key_scope_violation");

      expect(hasPermission).not.toHaveBeenCalled();
      expect(getTeam).toHaveBeenCalledTimes(1);
    });
  });
});
