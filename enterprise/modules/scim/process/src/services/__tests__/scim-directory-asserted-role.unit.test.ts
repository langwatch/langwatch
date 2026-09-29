// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The membership row a directory push writes carries the role the directory asserts.
 * @see specs/identity/scim-connection-sync.feature
 */
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import { fromDate } from "@langwatch/time";
import type { UserProfile } from "@langwatch/user-contract";
import { describe, expect, it, vi } from "vitest";

import { GrantsFake } from "../../__tests__/support/grants-fake.ts";
import { OrganizationAdministrationFake } from "../../__tests__/support/organization-administration-fake.ts";
import { scimRepositoryFixture } from "../../__tests__/support/scim-repository-fixture.ts";
import { MemoryScimRepository } from "../../repositories/memory/memory.scim.repository.ts";
import type { ScimRepository } from "../../repositories/scim.repository.ts";
import type { ScimUserProvisioning } from "../scim-provisioning.service.ts";
import { ScimService } from "../scim.service.ts";
import { QuietScimSyncLifecycle } from "./support/quiet-scim-sync-lifecycle.ts";

const epoch = fromDate(new Date(0));

const person: UserProfile = {
  id: "user-1",
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
      maxMembers: 10,
      maxMembersLite: 10,
      maxMessagesPerMonth: 1,
      canPublish: true,
      prices: { USD: 0, EUR: 0 },
    };
  }
}

function serviceOver({
  repository,
  provenOffboarding,
}: {
  repository: ScimRepository;
  provenOffboarding: boolean;
}): ScimService {
  const users = {
    findByEmail: vi.fn(async () => null),
    findById: vi.fn(async () => person),
    create: vi.fn(async () => person),
  } satisfies ScimUserProvisioning;
  return ScimService.create({
    prisma: repository,
    writer: new GrantsFake(),
    users,
    governance: {
      departmentResolveByNameOrCreate: vi.fn(async () => ({
        id: "department-1",
        organizationId: "org-1",
        name: "Engineering",
        createdAt: new Date(0),
        updatedAt: new Date(0),
      })),
      departmentAssignUser: vi.fn(async () => undefined),
    },
    organization: new OrganizationAdministrationFake(),
    entitlements: new EnterpriseEntitlements(),
    lifecycle: new QuietScimSyncLifecycle(),
    provenOffboarding,
    tokenPepper: "scim-test-pepper",
  });
}

async function push(service: ScimService): Promise<void> {
  await service.createUser({
    organizationId: "org-1",
    request: {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
      userName: "alice@acme.com",
    },
  });
}

describe("the membership role a SCIM push writes", () => {
  describe("given SCIM v2 grants and a SCIM group mapped ADMIN at organization scope", () => {
    /** @scenario Membership is no longer a fixed role written beside the grant */
    it("creates an ADMIN member", async () => {
      const repository = scimRepositoryFixture({
        findDirectoryAssertedRoles: vi.fn(async () => ["MEMBER", "ADMIN"]),
      });

      await push(serviceOver({ repository, provenOffboarding: true }));

      expect(repository.addMembership).toHaveBeenCalledWith({
        userId: "user-1",
        organizationId: "org-1",
        role: "ADMIN",
      });
    });
  });

  describe("given SCIM v2 grants and only non-admin or custom mappings", () => {
    it("creates a MEMBER", async () => {
      const repository = scimRepositoryFixture({
        findDirectoryAssertedRoles: vi.fn(async () => ["VIEWER", "CUSTOM"]),
      });

      await push(serviceOver({ repository, provenOffboarding: true }));

      expect(repository.addMembership).toHaveBeenCalledWith(
        expect.objectContaining({ role: "MEMBER" }),
      );
    });
  });

  describe("given the previous write path", () => {
    it("creates a MEMBER without asking what the directory maps", async () => {
      const findDirectoryAssertedRoles = vi.fn(async () => ["ADMIN"]);
      const repository = scimRepositoryFixture({ findDirectoryAssertedRoles });

      await push(serviceOver({ repository, provenOffboarding: false }));

      expect(findDirectoryAssertedRoles).not.toHaveBeenCalled();
      expect(repository.addMembership).toHaveBeenCalledWith(
        expect.objectContaining({ role: "MEMBER" }),
      );
    });
  });

  describe("given the mapping cannot be read", () => {
    it("writes no membership and fails the push", async () => {
      const repository = scimRepositoryFixture({
        findDirectoryAssertedRoles: vi.fn(async () => {
          throw new Error("role bindings unavailable");
        }),
      });

      await expect(push(serviceOver({ repository, provenOffboarding: true }))).rejects.toThrow(
        "role bindings unavailable",
      );
      expect(repository.addMembership).not.toHaveBeenCalled();
    });
  });
});

describe("MemoryScimRepository.findDirectoryAssertedRoles", () => {
  it("answers only organization-scoped roles of this person's SCIM groups", async () => {
    const repository = MemoryScimRepository.create();
    repository.groups.push(
      {
        id: "scim-group",
        organizationId: "org-1",
        name: "Admins",
        slug: "admins",
        scimSource: "okta",
        externalId: "ext-1",
        connectionId: null,
        createdAt: epoch,
        updatedAt: epoch,
      },
      {
        id: "hand-group",
        organizationId: "org-1",
        name: "Local",
        slug: "local",
        scimSource: null,
        externalId: null,
        connectionId: null,
        createdAt: epoch,
        updatedAt: epoch,
      },
    );
    repository.groupMembers.push(
      { groupId: "scim-group", userId: "user-1" },
      { groupId: "hand-group", userId: "user-1" },
    );
    const binding = {
      userId: null,
      apiKeyId: null,
      customRoleId: null,
      organizationId: "org-1",
    };
    repository.bindings.push(
      {
        ...binding,
        id: "b1",
        groupId: "scim-group",
        scopeType: "ORGANIZATION",
        scopeId: "org-1",
        role: "ADMIN",
      },
      {
        ...binding,
        id: "b2",
        groupId: "scim-group",
        scopeType: "TEAM",
        scopeId: "team-1",
        role: "VIEWER",
      },
      {
        ...binding,
        id: "b3",
        groupId: "hand-group",
        scopeType: "ORGANIZATION",
        scopeId: "org-1",
        role: "MEMBER",
      },
    );

    await expect(
      repository.findDirectoryAssertedRoles({ organizationId: "org-1", userId: "user-1" }),
    ).resolves.toEqual(["ADMIN"]);
    await expect(
      repository.findDirectoryAssertedRoles({ organizationId: "org-1", userId: "user-2" }),
    ).resolves.toEqual([]);
  });
});
