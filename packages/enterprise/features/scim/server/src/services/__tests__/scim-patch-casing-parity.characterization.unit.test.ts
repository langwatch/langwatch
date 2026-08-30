// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { ScimDepartmentAssignment } from "../scim-cost-center.service";
import { EntitlementService } from "@langwatch/entitlement-contract";
import { scimPatchRequestSchema } from "@langwatch/enterprise-scim-contract";
import type { ScimUserProvisioning } from "../scim-provisioning.service";
import { describe, expect, it, vi } from "vitest";
import type { ScimRepositoryPort } from "../../ports/scim-repository.port";
import { ScimDirectoryService } from "../scim-directory.service";
import { ScimGrantsService } from "../scim-grants.service";
import { ScimService } from "../scim.service";
import { QuietScimSyncLifecycle } from "../../ports/__tests__/support/quiet-scim-sync-lifecycle";
import { GrantsFake } from "../../__tests__/support/grants-fake";
import type { ScimDirectoryRepository } from "../scim-directory.service";

const patchSchema = "urn:ietf:params:scim:api:messages:2.0:PatchOp";
const parse = (operations: unknown[]) =>
  scimPatchRequestSchema.parse({ schemas: [patchSchema], Operations: operations });

class EnterpriseEntitlements extends EntitlementService {
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

function groupRepository(): ScimDirectoryRepository {
  return {
    tryFindGroup: vi.fn(async () => ({
      id: "group-1",
      organizationId: "org-1",
      name: "Engineering",
      slug: "engineering",
      scimSource: "scim",
      externalId: "group-1",
      createdAt: new Date("2024-01-01T00:00:00Z"),
      updatedAt: new Date("2024-01-02T00:00:00Z"),
    })),
    listGroupMemberIds: vi.fn(async () => ["user-1"]),
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

const notReached = async (): Promise<never> => {
  throw new Error("not reached by the patch-casing parity tests");
};

function userService(): ScimUserProvisioning {
  const current = {
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
  // The three this file exercises answer; the other three throw, because a
  // patch that reached user creation or a profile write would mean the casing
  // parity under test had routed somewhere it should not.
  return {
    tryFindById: vi.fn(async () => ({ ...current, deactivatedAt: new Date() })),
    deactivate: vi.fn(async () => ({ ...current, deactivatedAt: new Date() })),
    reactivate: vi.fn(async () => current),
    tryFindByEmail: vi.fn(notReached),
    create: vi.fn(notReached),
    updateProfile: vi.fn(notReached),
  } satisfies ScimUserProvisioning;
}

function governance(): ScimDepartmentAssignment {
  return {
    departmentResolveByNameOrCreate: vi.fn(async () => ({
      id: "department-1",
      organizationId: "org-1",
      name: "Engineering",
      // A Department carries its timestamps; the stub used to omit them and a
      // cast onto the whole service hid it.
      createdAt: new Date(0),
      updatedAt: new Date(0),
    })),
    departmentAssignUser: vi.fn(async () => undefined),
  };
}

describe("SCIM PATCH operation casing parity", () => {
  it("normalizes capitalized operations at the protocol boundary", () => {
    const parsed = parse([
      { op: "Replace", path: "active", value: false },
      { op: "Add", path: "members", value: [{ value: "user-1" }] },
      { op: "Remove", path: 'members[value eq "user-1"]' },
    ]);
    expect(parsed.Operations.map((operation) => operation.op)).toEqual([
      "replace",
      "add",
      "remove",
    ]);
  });

  it("applies a capitalized Replace to user deactivation", async () => {
    const repo: ScimRepositoryPort = {
      ...groupRepository(),
      tryFindMembership: vi.fn(async () => ({
        user: {
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
        },
      })),
    };
    const users = userService();
    const service = ScimService.create({
      prisma: repo,
      writer: new GrantsFake(),
      users,
      auth: { revokeAllBrowserSessions: vi.fn(async () => undefined) },
      governance: governance(),
      entitlements: new EnterpriseEntitlements(),
      lifecycle: new QuietScimSyncLifecycle(),
      provenOffboarding: false,
    });
    await service.updateUser({
      id: "user-1",
      organizationId: "org-1",
      patchRequest: parse([{ op: "Replace", path: "active", value: false }]),
    });
    expect(users.deactivate).toHaveBeenCalledWith({ id: "user-1" });
  });

  it("applies a capitalized Replace to group renaming", async () => {
    const repo = groupRepository();
    const grants = new GrantsFake();
    const service = ScimDirectoryService.create({
      prisma: repo,
      grants: ScimGrantsService.create({ repository: repo, grants }),
    });
    await service.updateGroup({
      externalScimId: "group-1",
      organizationId: "org-1",
      patchRequest: parse([{ op: "Replace", path: "displayName", value: "Platform" }]),
    });
    expect(repo.renameGroup).toHaveBeenCalledWith({ id: "group-1", name: "Platform" });
  });

  it("continues to accept the RFC lowercase spelling", () => {
    expect(parse([{ op: "replace", value: { active: false } }]).Operations[0]?.op).toBe("replace");
  });

  it("rejects a value that is not a SCIM operation", () => {
    expect(
      scimPatchRequestSchema.safeParse({
        schemas: [patchSchema],
        Operations: [{ op: "Delete", value: {} }],
      }).success,
    ).toBe(false);
  });
});
