// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * What a group carried goes when the group does, and nothing else does: a
 * grant an administrator made by hand at the same scope sits outside the
 * slice a directory push is authoritative over, whichever way the directory
 * takes the people out — one removal, a replaced list, or the whole group.
 */
import { fromDate } from "@langwatch/time";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GrantsFake } from "../../__tests__/support/grants-fake.ts";
import type {
  ScimGrantBindingScope,
  ScimGroupRecord,
  ScimRoleBindingRecord,
} from "../../repositories/scim.repository.ts";
import { ScimDirectoryService, type ScimDirectoryRepository } from "../scim-directory.service.ts";
import { ScimGrantsService } from "../scim-grants.service.ts";

const ORGANIZATION = "org-1";
const OKTA = "connection-okta";
const GROUP = "group-1";
const MEMBER = "user-1";
const COLLEAGUE = "user-2";
/** What the group carries, and what an administrator gave the member by hand. */
const GROUP_BINDING = "binding-group";
const MANUAL_BINDING = "binding-manual";

const administrators: ScimGroupRecord = {
  id: GROUP,
  organizationId: ORGANIZATION,
  name: "Administrators",
  slug: "administrators",
  scimSource: "scim",
  externalId: "okta-grp-1",
  connectionId: OKTA,
  createdAt: fromDate(new Date("2024-01-01T00:00:00Z")),
  updatedAt: fromDate(new Date("2024-01-02T00:00:00Z")),
};

const groupBinding: ScimRoleBindingRecord = {
  id: GROUP_BINDING,
  userId: null,
  groupId: GROUP,
  apiKeyId: null,
  scopeType: "ORGANIZATION",
  scopeId: ORGANIZATION,
  role: "ADMIN",
  customRoleId: null,
};

const manualBinding: ScimRoleBindingRecord = {
  id: MANUAL_BINDING,
  userId: MEMBER,
  groupId: null,
  apiKeyId: null,
  scopeType: "ORGANIZATION",
  scopeId: ORGANIZATION,
  role: "VIEWER",
  customRoleId: null,
};

function directoryOver() {
  const members = new Set([MEMBER, COLLEAGUE]);
  const groups = new Map([[GROUP, administrators]]);
  const writes: string[] = [];

  const repository: ScimDirectoryRepository = {
    findGroup: vi.fn(
      async (input: { organizationId: string; id: string }) => groups.get(input.id) ?? null,
    ),
    findGroupByExternalId: vi.fn(async () => null),
    listGroups: vi.fn(async () => ({ rows: [], total: 0 })),
    createGroup: vi.fn(async () => administrators),
    renameGroup: vi.fn(async () => undefined),
    deleteGroup: vi.fn(async (input: { id: string }) => {
      writes.push("deleteGroup");
      groups.delete(input.id);
    }),
    listGroupMembers: vi.fn(async (input: { groupId: string }) =>
      [...members].map((userId) => ({
        userId,
        groupId: input.groupId,
        user: { id: userId, email: `${userId}@acme.test`, name: null },
      })),
    ),
    listGroupMemberIds: vi.fn(async () => [...members]),
    addGroupMember: vi.fn(async () => undefined),
    removeGroupMembers: vi.fn(async (input: { groupId: string; userIds: string[] }) => {
      writes.push("removeGroupMembers");
      for (const userId of input.userIds) members.delete(userId);
    }),
    groupSlugExists: vi.fn(async () => false),
    listRoleBindings: vi.fn(async (scope: ScimGrantBindingScope) =>
      scope.kind === "group" ? [groupBinding] : [manualBinding],
    ),
  };

  const grants = new GrantsFake();
  grants.revokeBindings.mockImplementation(async () => {
    writes.push("revokeBindings");
  });

  const service = ScimDirectoryService.create({
    prisma: repository,
    grants: ScimGrantsService.create({ repository, grants }),
    identities: { assertWritable: vi.fn(async () => undefined) },
  });

  return { service, grants, members, writes };
}

type Removal = "remove" | "replace" | "delete";

async function takeMemberOut(service: ScimDirectoryService, operation: Removal): Promise<void> {
  const target = { externalScimId: GROUP, organizationId: ORGANIZATION, connectionId: OKTA };
  if (operation === "delete") {
    await service.deleteGroup(target);

    return;
  }

  await service.updateGroup({
    ...target,
    patchRequest: {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
      Operations:
        operation === "remove"
          ? [{ op: "remove", path: `members[value eq "${MEMBER}"]` }]
          : [{ op: "replace", path: "members", value: [] }],
    },
  });
}

const revoking = (bindingId: string) =>
  expect.objectContaining({ bindingIds: expect.arrayContaining([bindingId]) });

describe("SCIM group access removal", () => {
  let directory: ReturnType<typeof directoryOver>;

  beforeEach(() => {
    directory = directoryOver();
  });

  it.each(["remove", "replace", "delete"] as const)(
    "takes the member out of the group on %s",
    async (operation) => {
      await takeMemberOut(directory.service, operation);

      expect(directory.members.has(MEMBER)).toBe(false);
    },
  );

  it.each(["remove", "replace", "delete"] as const)(
    "leaves the grant an administrator made by hand alone on %s",
    async (operation) => {
      await takeMemberOut(directory.service, operation);

      expect(directory.grants.revokeBindings).not.toHaveBeenCalledWith(revoking(MANUAL_BINDING));
    },
  );

  it("keeps the colleague the removal did not name", async () => {
    await takeMemberOut(directory.service, "remove");

    expect([...directory.members]).toEqual([COLLEAGUE]);
  });

  it("empties the group when the directory replaces its list with nobody", async () => {
    await takeMemberOut(directory.service, "replace");

    expect([...directory.members]).toEqual([]);
  });

  it("retires the access the deleted group carried, as the directory", async () => {
    await takeMemberOut(directory.service, "delete");

    expect(directory.grants.revokeBindings).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORGANIZATION,
        bindingIds: [GROUP_BINDING],
        actor: { type: "system", id: "system:scim" },
      }),
    );
  });

  it("takes that access away before the memberships or the group go", async () => {
    await takeMemberOut(directory.service, "delete");

    expect(directory.writes).toEqual(["revokeBindings", "removeGroupMembers", "deleteGroup"]);
  });

  it("revokes nothing the group still carries when one member is taken out", async () => {
    await takeMemberOut(directory.service, "remove");

    expect(directory.grants.revokeBindings).not.toHaveBeenCalledWith(revoking(GROUP_BINDING));
  });
});
