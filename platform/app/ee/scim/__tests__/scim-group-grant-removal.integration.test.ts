// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { SYSTEM_ACTORS } from "@langwatch/actor";
import { AuthzCollectorService } from "@langwatch/authz-server";
import { nanoid } from "nanoid";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GrantsLedgerWriter } from "~/server/app-layer/authz/ledger";
import { GrantsAuthzReadRepository } from "~/server/app-layer/authz/repositories/authz-read.grants.repository";
import { prisma } from "~/server/db";
import { createAuthzTestEventSourcing } from "~/test-utils/authz-test-event-sourcing";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";

import { ScimGroupService } from "../scim-group.service";

vi.mock("../scim-grants-flag", () => ({
  scimGrantsWritePathEnabled: () => true,
}));

const id = nanoid(10);
const organizationId = `org-${id}`;
const userId = `user-${id}`;
const groupId = `group-${id}`;
const manualId = `manual-${id}`;
const directoryId = `directory-${id}`;
const groupGrantId = `group-grant-${id}`;
let events: ReturnType<typeof createAuthzTestEventSourcing>;
let groups: ScimGroupService;
const collector = new AuthzCollectorService(
  new GrantsAuthzReadRepository(prisma),
);

beforeEach(async () => {
  await prisma.organization.create({
    data: { id: organizationId, name: "ACME", slug: organizationId },
  });
  await prisma.user.create({ data: { id: userId, email: `${id}@acme.test` } });
  await prisma.organizationUser.create({
    data: { userId, organizationId, role: "MEMBER" },
  });
  await prisma.group.create({
    data: {
      id: groupId,
      organizationId,
      name: "Administrators",
      slug: groupId,
      scimSource: "scim",
    },
  });
  await prisma.groupMembership.create({ data: { userId, groupId } });
  events = createAuthzTestEventSourcing(prisma);
  const writer = new GrantsLedgerWriter(prisma, {
    commands: async () => ({
      commands: events.getPipeline("authz_grant").commands,
    }),
  });
  const scope = {
    scopeType: "ORGANIZATION" as const,
    scopeId: organizationId,
    customRoleId: null,
  };
  const actor = { type: "system" as const, id: SYSTEM_ACTORS.scim };
  await writer.attachBindings({
    organizationId,
    actor,
    source: "grants-service",
    onDuplicate: "reject",
    bindings: [
      {
        ...scope,
        bindingId: groupGrantId,
        principal: { groupId },
        role: "ADMIN",
      },
      { ...scope, bindingId: manualId, principal: { userId }, role: "VIEWER" },
    ],
  });
  await writer.attachBindings({
    organizationId,
    actor,
    source: "scim",
    onDuplicate: "reject",
    bindings: [
      {
        ...scope,
        bindingId: directoryId,
        principal: { userId },
        role: "ADMIN",
      },
    ],
  });
  groups = ScimGroupService.create({ prisma, writer });
});

afterEach(async () => {
  await events?.close();
  await cleanupTestRows(prisma, [
    ["auditLog", { organizationId }],
    ["grant", { organizationId }],
    ["roleBinding", { organizationId }],
    ["groupMembership", { groupId }],
    ["group", { id: groupId }],
    ["organizationUser", { organizationId }],
    ["organization", { id: organizationId }],
    ["user", { id: userId }],
  ]);
});

describe("SCIM group access removal", () => {
  it.each([
    "remove",
    "replace",
    "delete",
  ] as const)("retires duplicate directory access on %s and preserves a manual grant", async (operation) => {
    const before = await collector.collectGrants({
      principal: { type: "user", id: userId },
      organizationId,
    });
    expect(before.bindings.some(({ roleKey }) => roleKey === "admin")).toBe(
      true,
    );

    if (operation === "delete") {
      await groups.deleteGroup({ scimResourceId: groupId, organizationId });
    } else {
      await groups.updateGroup({
        scimResourceId: groupId,
        organizationId,
        patchRequest: {
          schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
          Operations:
            operation === "remove"
              ? [{ op: "remove", path: `members[value eq "${userId}"]` }]
              : [{ op: "replace", path: "members", value: [] }],
        },
      });
    }

    const after = await collector.collectGrants({
      principal: { type: "user", id: userId },
      organizationId,
    });
    expect(after.bindings.map(({ roleKey }) => roleKey)).toEqual(["viewer"]);
    expect(
      await prisma.grant.findUniqueOrThrow({ where: { id: manualId } }),
    ).toMatchObject({
      revokedAt: null,
    });
    expect(
      (await prisma.grant.findUniqueOrThrow({ where: { id: directoryId } }))
        .revokedAt,
    ).not.toBeNull();
    expect(
      await prisma.groupMembership.count({ where: { groupId, userId } }),
    ).toBe(0);
  });
});
