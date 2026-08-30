// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { scimPatchRequestSchema } from "@langwatch/enterprise-scim-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScimRepositoryPort } from "../../ports/scim-repository.port";
import { ScimDirectoryService } from "../scim-directory.service";
import { ScimGrantsService } from "../scim-grants.service";
import { GrantsFake } from "../../__tests__/support/grants-fake";

const schema = "urn:ietf:params:scim:api:messages:2.0:PatchOp";
const group = {
  id: "group-1",
  organizationId: "org-1",
  name: "Engineering",
  slug: "engineering",
  scimSource: "scim",
  externalId: "group-1",
  createdAt: new Date("2024-01-01T00:00:00Z"),
  updatedAt: new Date("2024-01-02T00:00:00Z"),
};

function repository(): ScimRepositoryPort {
  return {
    tryFindGroup: vi.fn(async () => group),
    listGroupMemberIds: vi.fn(async () => ["user-1", "user-2"]),
    listGroupMembers: vi.fn(async () => []),
    addGroupMember: vi.fn(async () => undefined),
    removeGroupMembers: vi.fn(async () => undefined),
    listGroups: vi.fn(async () => ({ rows: [], total: 0 })),
    createGroup: vi.fn(),
    renameGroup: vi.fn(async () => undefined),
    deleteGroup: vi.fn(async () => undefined),
    groupSlugExists: vi.fn(async () => false),
    listRoleBindings: vi.fn(async () => []),
  } as ScimRepositoryPort;
}

function patch(operations: unknown[]) {
  return scimPatchRequestSchema.parse({ schemas: [schema], Operations: operations });
}

function harness() {
  const repo = repository();
  const grants = new GrantsFake();
  const service = ScimDirectoryService.create({
    prisma: repo,
    grants: ScimGrantsService.create({ repository: repo, grants }),
  });
  const update = (operations: unknown[]) =>
    service.updateGroup({
      externalScimId: "group-1",
      organizationId: "org-1",
      patchRequest: patch(operations),
    });
  return { repo, update };
}

describe("SCIM group PATCH parity", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ignores unrelated attributes", async () => {
    const { repo, update } = harness();
    await update([{ op: "replace", path: "externalId", value: "abc-123" }]);
    expect(repo.removeGroupMembers).not.toHaveBeenCalled();
    expect(repo.addGroupMember).not.toHaveBeenCalled();
  });

  it("ignores an unrelated attribute while preserving the supported group", async () => {
    const { repo, update } = harness();
    await update([{ op: "replace", path: "externalId", value: "abc-123" }]);
    expect(repo.tryFindGroup).toHaveBeenCalled();
  });

  it("renames a group through a no-path value object without touching members", async () => {
    const { repo, update } = harness();
    await update([{ op: "replace", value: { displayName: "Platform" } }]);
    expect(repo.renameGroup).toHaveBeenCalledWith({ id: "group-1", name: "Platform" });
    expect(repo.removeGroupMembers).not.toHaveBeenCalled();
  });

  it("does not touch members for a no-path rename", async () => {
    const { repo, update } = harness();
    await update([{ op: "replace", value: { displayName: "Platform" } }]);
    expect(repo.addGroupMember).not.toHaveBeenCalled();
  });

  it("renames a group through the displayName path", async () => {
    const { repo, update } = harness();
    await update([{ op: "replace", path: "displayName", value: "Platform" }]);
    expect(repo.renameGroup).toHaveBeenCalledWith({ id: "group-1", name: "Platform" });
    expect(repo.removeGroupMembers).not.toHaveBeenCalled();
  });

  it("ignores an unsupported filtered member attribute", async () => {
    const { repo, update } = harness();
    await update([{ op: "replace", path: 'members[value eq "user-1"].display', value: "Alice" }]);
    expect(repo.removeGroupMembers).not.toHaveBeenCalled();
  });

  it("ignores a bare array value", async () => {
    const { repo, update } = harness();
    await update([{ op: "replace", value: [{ value: "user-1" }] }]);
    expect(repo.removeGroupMembers).not.toHaveBeenCalled();
  });

  it("ignores a members path with no value", async () => {
    const { repo, update } = harness();
    await update([{ op: "replace", path: "members" }]);
    expect(repo.removeGroupMembers).not.toHaveBeenCalled();
  });

  it("ignores a members path whose value is not a list", async () => {
    const { repo, update } = harness();
    await update([{ op: "replace", path: "members", value: "user-1" }]);
    expect(repo.removeGroupMembers).not.toHaveBeenCalled();
  });

  it("does not write for a malformed members path", async () => {
    const { repo, update } = harness();
    await update([{ op: "replace", path: "members", value: "user-1" }]);
    expect(repo.addGroupMember).not.toHaveBeenCalled();
  });

  it("ignores a no-path malformed members value", async () => {
    const { repo, update } = harness();
    await update([{ op: "replace", value: { members: "user-1" } }]);
    expect(repo.removeGroupMembers).not.toHaveBeenCalled();
  });

  it("ignores a member entry without an id", async () => {
    const { repo, update } = harness();
    await update([{ op: "replace", path: "members", value: [{ display: "Alice" }] }]);
    expect(repo.removeGroupMembers).not.toHaveBeenCalled();
  });

  it("ignores an empty member object", async () => {
    const { repo, update } = harness();
    await update([{ op: "replace", path: "members", value: [{}] }]);
    expect(repo.removeGroupMembers).not.toHaveBeenCalled();
    expect(repo.addGroupMember).not.toHaveBeenCalled();
  });

  it("ignores a blank member id", async () => {
    const { repo, update } = harness();
    await update([{ op: "replace", path: "members", value: [{ value: "  " }] }]);
    expect(repo.removeGroupMembers).not.toHaveBeenCalled();
  });

  it("ignores a partly readable member list", async () => {
    const { repo, update } = harness();
    await update([
      {
        op: "replace",
        path: "members",
        value: [{ value: "user-3" }, { display: "Alice" }],
      },
    ]);
    expect(repo.removeGroupMembers).not.toHaveBeenCalled();
    expect(repo.addGroupMember).not.toHaveBeenCalled();
  });

  it.each([null, [], { members: [] }])(
    "clears an explicit empty member list (%s)",
    async (value) => {
      const { repo, update } = harness();
      const operation =
        value !== null && !Array.isArray(value)
          ? { op: "replace", value }
          : { op: "replace", path: "members", value };
      await update([operation]);
      expect(repo.removeGroupMembers).toHaveBeenCalledWith({
        groupId: "group-1",
        userIds: ["user-1", "user-2"],
      });
    },
  );

  it("adds newcomers and removes departed members", async () => {
    const { repo, update } = harness();
    await update([
      {
        op: "replace",
        path: "members",
        value: [{ value: "user-2" }, { value: "user-3" }],
      },
    ]);
    expect(repo.addGroupMember).toHaveBeenCalledWith({
      groupId: "group-1",
      organizationId: "org-1",
      userId: "user-3",
    });
    expect(repo.removeGroupMembers).toHaveBeenCalledWith({
      groupId: "group-1",
      userIds: ["user-1"],
    });
  });

  it("applies a member replacement after an unrelated operation", async () => {
    const { repo, update } = harness();
    await update([
      { op: "replace", path: "externalId", value: "abc-123" },
      {
        op: "replace",
        path: "members",
        value: [{ value: "user-2" }, { value: "user-3" }],
      },
    ]);
    expect(repo.removeGroupMembers).toHaveBeenCalledWith({
      groupId: "group-1",
      userIds: ["user-1"],
    });
  });

  it("applies a rename and member replacement in the same value object", async () => {
    const { repo, update } = harness();
    await update([
      {
        op: "replace",
        value: { displayName: "Platform", members: [{ value: "user-1" }] },
      },
    ]);
    expect(repo.renameGroup).toHaveBeenCalledWith({ id: "group-1", name: "Platform" });
    expect(repo.removeGroupMembers).toHaveBeenCalledWith({
      groupId: "group-1",
      userIds: ["user-2"],
    });
  });

  it("ignores an add operation for an unrelated attribute", async () => {
    const { repo, update } = harness();
    await update([{ op: "add", path: "externalId", value: "abc-123" }]);
    expect(repo.addGroupMember).not.toHaveBeenCalled();
    expect(repo.removeGroupMembers).not.toHaveBeenCalled();
  });
});
