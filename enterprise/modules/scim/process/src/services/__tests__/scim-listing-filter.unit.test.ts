// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * A filter the directory cannot honour is refused, never widened into a read
 * of the whole organization. ADR-002.
 */
import { scimPatchRequestSchema, ScimProtocolError } from "@langwatch/enterprise-scim-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import { describe, expect, it, vi } from "vitest";

import { GrantsFake } from "../../__tests__/support/grants-fake.ts";
import { scimRepositoryFixture } from "../../__tests__/support/scim-repository-fixture.ts";
import type { ScimDepartmentAssignment } from "../scim-cost-center.service.ts";
import { ScimDirectoryService } from "../scim-directory.service.ts";
import type { ScimDirectoryRepository } from "../scim-directory.service.ts";
import { ScimGrantsService } from "../scim-grants.service.ts";
import type { ScimUserProvisioning } from "../scim-provisioning.service.ts";
import { ScimService } from "../scim.service.ts";
import { QuietScimSyncLifecycle } from "./support/quiet-scim-sync-lifecycle.ts";

const ORGANIZATION = "org-1";
const PERSON = "user-1";

const storedUser = {
  id: PERSON,
  name: "Alice Smith",
  email: "alice@acme.com",
  emailVerified: false,
  image: null,
  pendingSsoSetup: false,
  createdAt: new Date("2024-01-01T00:00:00Z"),
  updatedAt: new Date("2024-01-02T00:00:00Z"),
  lastLoginAt: null,
  deactivatedAt: null,
};

class EnterpriseEntitlements implements Pick<EntitlementApi, "getActivePlan"> {
  async getActivePlan() {
    return {
      planSource: "free" as const,
      type: "ENTERPRISE",
      name: "Enterprise",
      free: false,
      maxMembers: 1,
      maxMembersLite: 1,
      maxMessagesPerMonth: 1,
      canPublish: true,
      prices: { USD: 0, EUR: 0 },
    };
  }
}

function departments(): ScimDepartmentAssignment {
  return {
    departmentResolveByNameOrCreate: vi.fn(async () => ({
      id: "department-1",
      organizationId: ORGANIZATION,
      name: "Engineering",
      createdAt: new Date(0),
      updatedAt: new Date(0),
    })),
    departmentAssignUser: vi.fn(async () => undefined),
  };
}

function userService(): ScimUserProvisioning {
  return {
    findById: vi.fn(async () => storedUser),
    findByEmail: vi.fn(async () => null),
    create: vi.fn(async () => storedUser),
    updateProfile: vi.fn(async () => storedUser),
    deactivate: vi.fn(async () => ({ ...storedUser, deactivatedAt: new Date() })),
    reactivate: vi.fn(async () => storedUser),
  } satisfies ScimUserProvisioning;
}

function directoryRepository(): ScimDirectoryRepository {
  return {
    findGroup: vi.fn(async () => null),
    listGroupMemberIds: vi.fn(async () => []),
    listGroupMembers: vi.fn(async () => []),
    addGroupMember: vi.fn(async () => undefined),
    removeGroupMembers: vi.fn(async () => undefined),
    listGroups: vi.fn(async () => ({ rows: [], total: 0 })),
    createGroup: vi.fn(),
    renameGroup: vi.fn(async () => undefined),
    deleteGroup: vi.fn(async () => undefined),
    groupSlugExists: vi.fn(async () => false),
    listRoleBindings: vi.fn(async () => []),
  };
}

function scimService(repository = scimRepositoryFixture(), users = userService()) {
  return {
    users,
    repository,
    service: ScimService.create({
      prisma: repository,
      writer: new GrantsFake(),
      users,
      auth: { revokeAllBrowserSessions: vi.fn(async () => undefined) },
      governance: departments(),
      entitlements: new EnterpriseEntitlements(),
      lifecycle: new QuietScimSyncLifecycle(),
      provenOffboarding: false,
    }),
  };
}

describe("ScimService.listUsers", () => {
  describe("when the filter names an attribute the listing cannot match", () => {
    /** @scenario "A user listing filtered by an unsupported attribute is refused" */
    it("refuses with invalidFilter rather than listing the organization", async () => {
      const { service, repository } = scimService();

      const refusal = await service
        .listUsers({ organizationId: ORGANIZATION, filter: 'emails.value eq "alice@acme.com"' })
        .catch((error: unknown) => error);

      expect(refusal).toBeInstanceOf(ScimProtocolError);
      expect((refusal as ScimProtocolError).response).toMatchObject({
        status: "400",
        scimType: "invalidFilter",
      });
      expect(repository.listMemberships).not.toHaveBeenCalled();
    });
  });

  describe("when the filter names userName", () => {
    /** @scenario "A user listing filtered by userName matches without regard to case" */
    it("narrows the read to that address", async () => {
      const { service, repository } = scimService();

      await service.listUsers({
        organizationId: ORGANIZATION,
        filter: 'userName eq "alice@acme.com"',
      });

      expect(repository.listMemberships).toHaveBeenCalledWith(
        expect.objectContaining({ email: "alice@acme.com" }),
      );
    });
  });
});

describe("ScimDirectoryService.listGroups", () => {
  describe("when the expression is richer than equality", () => {
    /** @scenario "A group listing filtered by an unsupported expression is refused" */
    it("refuses with invalidFilter rather than listing every group", async () => {
      const repository = directoryRepository();
      const service = ScimDirectoryService.create({
        prisma: repository,
        grants: ScimGrantsService.create({ repository, grants: new GrantsFake() }),
      });

      const refusal = await service
        .listGroups({ organizationId: ORGANIZATION, filter: 'displayName sw "Eng"' })
        .catch((error: unknown) => error);

      expect(refusal).toBeInstanceOf(ScimProtocolError);
      expect((refusal as ScimProtocolError).response.scimType).toBe("invalidFilter");
      expect(repository.listGroups).not.toHaveBeenCalled();
    });
  });
});

describe("ScimService.updateUser", () => {
  const patch = (operation: Record<string, unknown>) =>
    scimPatchRequestSchema.parse({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
      Operations: [operation],
    });

  describe("when the directory patches only the family name", () => {
    /** @scenario "A patch naming only the surname keeps the forename" */
    it("keeps the given name it did not mention", async () => {
      const repository = scimRepositoryFixture({
        findMembership: vi.fn(async () => ({
          userId: PERSON,
          organizationId: ORGANIZATION,
          user: storedUser,
        })),
      });
      const { service, users } = scimService(repository);

      await service.updateUser({
        id: PERSON,
        organizationId: ORGANIZATION,
        patchRequest: patch({ op: "replace", path: "name.familyName", value: "Byron" }),
      });

      expect(users.updateProfile).toHaveBeenCalledWith({ id: PERSON, name: "Alice Byron" });
    });
  });

  describe("when the parts arrive unwrapped under a name path", () => {
    /** @scenario "A patch sending the family name as a dotted path is applied" */
    it("writes both halves", async () => {
      const repository = scimRepositoryFixture({
        findMembership: vi.fn(async () => ({
          userId: PERSON,
          organizationId: ORGANIZATION,
          user: storedUser,
        })),
      });
      const { service, users } = scimService(repository);

      await service.updateUser({
        id: PERSON,
        organizationId: ORGANIZATION,
        patchRequest: patch({
          op: "replace",
          path: "name",
          value: { givenName: "Augusta", familyName: "Byron" },
        }),
      });

      expect(users.updateProfile).toHaveBeenCalledWith({ id: PERSON, name: "Augusta Byron" });
    });
  });
});
