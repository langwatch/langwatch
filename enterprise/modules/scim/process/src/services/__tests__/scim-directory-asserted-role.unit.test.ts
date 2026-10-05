// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The membership row a directory push writes carries the role the directory asserts.
 * @see enterprise/modules/scim/specs/scim-connection-sync.feature
 */
import type { AuthzAccessBinding } from "@langwatch/authz-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import { fromDate } from "@langwatch/time";
import type { UserProfile } from "@langwatch/user-contract";
import { describe, expect, it, vi } from "vitest";

import { GrantsFake, listedGrant } from "../../__tests__/support/grants-fake.ts";
import { HeldConnectionsFake } from "../../__tests__/support/held-connections-fake.ts";
import { OrganizationAdministrationFake } from "../../__tests__/support/organization-administration-fake.ts";
import { scimRepositoryFixture } from "../../__tests__/support/scim-repository-fixture.ts";
import { MemoryScimRepository } from "../../repositories/memory/memory.scim.repository.ts";
import type { ScimRepository } from "../../repositories/scim.repository.ts";
import { ScimGrantsService } from "../scim-grants.service.ts";
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
  writer,
  provenOffboarding,
}: {
  repository: ScimRepository;
  writer: GrantsFake;
  provenOffboarding: boolean;
}): ScimService {
  const users = {
    findByEmail: vi.fn(async () => null),
    findById: vi.fn(async () => person),
    create: vi.fn(async () => person),
  } satisfies ScimUserProvisioning;
  return ScimService.create({
    connections: HeldConnectionsFake.of(),
    prisma: repository,
    writer,
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

function groupGrant({
  id,
  groupId,
  role,
  scopeType = "ORGANIZATION",
  scopeId = "org-1",
  organizationId = "org-1",
  customRoleId = null,
}: {
  id: string;
  groupId: string;
  role: AuthzAccessBinding["role"];
  scopeType?: "ORGANIZATION" | "TEAM" | "PROJECT";
  scopeId?: string;
  organizationId?: string;
  customRoleId?: string | null;
}) {
  return listedGrant({
    id,
    organizationId,
    userId: null,
    groupId,
    apiKeyId: null,
    scopeType,
    scopeId,
    role,
    customRoleId,
  });
}

function scimGroupsOf(groupIds: string[]) {
  const findDirectoryGroupIds = vi.fn(async () => groupIds);
  return { repository: scimRepositoryFixture({ findDirectoryGroupIds }), findDirectoryGroupIds };
}

describe("the membership role a SCIM push writes", () => {
  describe("given SCIM v2 grants and a SCIM group mapped ADMIN at organization scope", () => {
    /** @scenario Membership is no longer a fixed role written beside the grant */
    it("creates an ADMIN member", async () => {
      const { repository, findDirectoryGroupIds } = scimGroupsOf(["scim-group"]);
      const writer = new GrantsFake();
      writer.listUserAndGroupBindings.mockResolvedValue([
        groupGrant({ id: "b1", groupId: "scim-group", role: "MEMBER" }),
        groupGrant({ id: "b2", groupId: "scim-group", role: "ADMIN" }),
      ]);

      await push(serviceOver({ repository, writer, provenOffboarding: true }));

      expect(findDirectoryGroupIds).toHaveBeenCalledWith({
        userId: "user-1",
        organizationId: "org-1",
      });
      expect(writer.listUserAndGroupBindings).toHaveBeenCalledWith({
        organizationId: "org-1",
        userId: "user-1",
        groupIds: ["scim-group"],
      });
      expect(repository.addMembership).toHaveBeenCalledWith({
        userId: "user-1",
        organizationId: "org-1",
        role: "ADMIN",
      });
    });
  });

  describe("given SCIM v2 grants and only non-admin or custom mappings", () => {
    it("creates a MEMBER", async () => {
      const { repository } = scimGroupsOf(["scim-group"]);
      const writer = new GrantsFake();
      writer.listUserAndGroupBindings.mockResolvedValue([
        groupGrant({ id: "b1", groupId: "scim-group", role: "VIEWER" }),
        groupGrant({ id: "b2", groupId: "scim-group", role: "CUSTOM", customRoleId: "custom-1" }),
      ]);

      await push(serviceOver({ repository, writer, provenOffboarding: true }));

      expect(repository.addMembership).toHaveBeenCalledWith(
        expect.objectContaining({ role: "MEMBER" }),
      );
    });
  });

  describe("given the previous write path", () => {
    it("creates a MEMBER without asking what the directory maps", async () => {
      const { repository, findDirectoryGroupIds } = scimGroupsOf(["scim-group"]);
      const writer = new GrantsFake();
      writer.listUserAndGroupBindings.mockResolvedValue([
        groupGrant({ id: "b1", groupId: "scim-group", role: "ADMIN" }),
      ]);

      await push(serviceOver({ repository, writer, provenOffboarding: false }));

      expect(findDirectoryGroupIds).not.toHaveBeenCalled();
      expect(writer.listUserAndGroupBindings).not.toHaveBeenCalled();
      expect(repository.addMembership).toHaveBeenCalledWith(
        expect.objectContaining({ role: "MEMBER" }),
      );
    });
  });

  describe("given the mapping cannot be read", () => {
    it("writes no membership and fails the push when the grant listing fails", async () => {
      const { repository } = scimGroupsOf(["scim-group"]);
      const writer = new GrantsFake();
      writer.listUserAndGroupBindings.mockRejectedValue(new Error("role bindings unavailable"));

      await expect(
        push(serviceOver({ repository, writer, provenOffboarding: true })),
      ).rejects.toThrow("role bindings unavailable");
      expect(repository.addMembership).not.toHaveBeenCalled();
    });

    it("writes no membership and fails the push when the SCIM groups cannot be read", async () => {
      const repository = scimRepositoryFixture({
        findDirectoryGroupIds: vi.fn(async () => {
          throw new Error("scim groups unavailable");
        }),
      });

      await expect(
        push(serviceOver({ repository, writer: new GrantsFake(), provenOffboarding: true })),
      ).rejects.toThrow("scim groups unavailable");
      expect(repository.addMembership).not.toHaveBeenCalled();
    });
  });
});

describe("MemoryScimRepository.findDirectoryGroupIds", () => {
  it("answers only this organization's SCIM groups the person belongs to", async () => {
    const repository = MemoryScimRepository.create();
    const group = {
      organizationId: "org-1",
      connectionId: null,
      createdAt: epoch,
      updatedAt: epoch,
    };
    repository.groups.push(
      {
        ...group,
        id: "scim-group",
        name: "Admins",
        slug: "admins",
        scimSource: "okta",
        externalId: "ext-1",
      },
      {
        ...group,
        id: "hand-group",
        name: "Local",
        slug: "local",
        scimSource: null,
        externalId: null,
      },
      {
        ...group,
        id: "other-org-group",
        organizationId: "org-2",
        name: "Elsewhere",
        slug: "elsewhere",
        scimSource: "okta",
        externalId: "ext-2",
      },
    );
    repository.groupMembers.push(
      { groupId: "scim-group", userId: "user-1" },
      { groupId: "hand-group", userId: "user-1" },
      { groupId: "other-org-group", userId: "user-1" },
    );

    await expect(
      repository.findDirectoryGroupIds({ organizationId: "org-1", userId: "user-1" }),
    ).resolves.toEqual(["scim-group"]);
    await expect(
      repository.findDirectoryGroupIds({ organizationId: "org-1", userId: "user-2" }),
    ).resolves.toEqual([]);
  });
});

describe("ScimGrantsService.findDirectoryAssertedRoles", () => {
  it("answers only organization-scoped roles of this person's SCIM groups", async () => {
    const grants = new GrantsFake();
    grants.listUserAndGroupBindings.mockResolvedValue([
      groupGrant({ id: "b1", groupId: "scim-group", role: "ADMIN" }),
      groupGrant({
        id: "b2",
        groupId: "scim-group",
        role: "VIEWER",
        scopeType: "TEAM",
        scopeId: "team-1",
      }),
      groupGrant({ id: "b3", groupId: "hand-group", role: "MEMBER" }),
      groupGrant({
        id: "b4",
        groupId: "scim-group",
        role: "MEMBER",
        organizationId: "org-2",
        scopeId: "org-2",
      }),
      listedGrant({
        id: "b5",
        organizationId: "org-1",
        userId: "user-1",
        groupId: null,
        apiKeyId: null,
        scopeType: "ORGANIZATION",
        scopeId: "org-1",
        role: "ADMIN",
        customRoleId: null,
      }),
    ]);

    await expect(
      ScimGrantsService.create({ grants }).findDirectoryAssertedRoles({
        organizationId: "org-1",
        userId: "user-1",
        groupIds: ["scim-group"],
      }),
    ).resolves.toEqual(["ADMIN"]);
    expect(grants.listUserAndGroupBindings).toHaveBeenCalledWith({
      organizationId: "org-1",
      userId: "user-1",
      groupIds: ["scim-group"],
    });
  });

  it("answers nothing without reading grants when the person is in no SCIM group", async () => {
    const grants = new GrantsFake();

    await expect(
      ScimGrantsService.create({ grants }).findDirectoryAssertedRoles({
        organizationId: "org-1",
        userId: "user-2",
        groupIds: [],
      }),
    ).resolves.toEqual([]);
    expect(grants.listUserAndGroupBindings).not.toHaveBeenCalled();
  });
});
