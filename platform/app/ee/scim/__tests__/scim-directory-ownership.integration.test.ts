// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { PrismaScimReconciliationRepository } from "@ee/scim/scim-reconciliation.prisma.repository";
import { nanoid } from "nanoid";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type AuthzGrantsCommandSenders,
  GrantsLedgerWriter,
} from "~/server/app-layer/authz/ledger";
import { PrismaMemberProvenanceRepository } from "~/server/app-layer/identity/repositories/member-provenance.prisma.repository";
import { prisma } from "~/server/db";
import { wireDefaultTestApp } from "~/test-utils/wireDefaultTestApp";
import { ScimService } from "../scim.service";
import {
  isScimError,
  SCIM_ENTERPRISE_USER_SCHEMA,
  scimCreateUserRequestSchema,
} from "../scim.types";
import { ScimDirectoryIdentityService } from "../scim-directory-identity.service";
import { ScimSyncLifecycle } from "../scim-sync.service";
import { ScimSyncGuards } from "../scim-sync-guards";

wireDefaultTestApp();

vi.mock("~/env.mjs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/env.mjs")>();
  return { ...actual, env: { ...actual.env, SCIM_V2_GRANTS: "on" } };
});

const namespace = `scim-ownership-${nanoid(8)}`;
const organizationId = `${namespace}-org`;
const otherOrganizationId = `${namespace}-other-org`;
const connectionId = `${namespace}-connection`;
const otherConnectionId = `${namespace}-other-connection`;
const connectionIds = [connectionId, otherConnectionId];
const organizationIds = [organizationId, otherOrganizationId];
const userPushed = vi.fn();

function roleFor(roleKey: string | null): "ADMIN" | "MEMBER" | "VIEWER" | null {
  if (roleKey === "admin") return "ADMIN";
  if (roleKey === "member") return "MEMBER";
  if (roleKey === "viewer") return "VIEWER";
  return null;
}

function projectionCommands(): AuthzGrantsCommandSenders {
  const noop = { send: async () => undefined };
  return {
    attachGrant: {
      send: async ({ organizationId, grant }) => {
        const role = roleFor(grant.roleKey);
        if (
          !role ||
          grant.scope.type === "RESOURCE" ||
          grant.scope.type === "PLATFORM"
        )
          return;
        const principal = grant.principal;
        if (principal.type !== "user") return;
        await prisma.roleBinding.create({
          data: {
            id: grant.grantId,
            organizationId,
            userId: principal.id,
            groupId: null,
            apiKeyId: null,
            role,
            customRoleId: null,
            scopeType: grant.scope.type,
            scopeId: grant.scope.id,
          },
        });
      },
    },
    changeGrantRole: noop,
    revokeGrant: noop,
    defineRole: noop,
    changeRolePermissions: noop,
    deleteRole: noop,
  };
}

const service = new ScimService({
  prisma,
  writer: new GrantsLedgerWriter(prisma, {
    commands: async () => ({ commands: projectionCommands() }),
  }),
  syncLifecycle: new ScimSyncLifecycle({
    guards: new ScimSyncGuards({ syncs: { findSync: async () => null } }),
    ledger: { commit: userPushed },
  }),
});
const directory = ScimDirectoryIdentityService.create(prisma);
const reconciliation = new PrismaScimReconciliationRepository(prisma);
const provenance = new PrismaMemberProvenanceRepository(prisma);

beforeEach(async () => {
  userPushed.mockClear();
  await prisma.organization.createMany({
    data: organizationIds.map((id) => ({ id, name: id, slug: id })),
  });
  await prisma.ssoConnection.createMany({
    data: connectionIds.map((id, index) => ({
      id,
      organizationId: organizationIds[index] ?? organizationId,
      type: "oidc",
      state: "ACTIVE",
      idpMetadata: { providerId: id },
      source: "self-serve",
      occurredAt: new Date(),
      lastEventId: `${id}-created`,
      acceptedAt: new Date(),
      projectionVersion: "1",
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
  });
});

afterEach(async () => {
  await prisma.scimDirectoryUser.deleteMany({
    where: { connectionId: { in: connectionIds } },
  });
  await prisma.scimExternalId.deleteMany({
    where: { connectionId: { in: connectionIds } },
  });
  await prisma.roleBinding.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await prisma.grant.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await prisma.departmentMembershipHistory.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await prisma.organizationUser.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await prisma.department.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await prisma.user.deleteMany({
    where: { email: { contains: namespace } },
  });
  await prisma.ssoConnection.deleteMany({
    where: { id: { in: connectionIds } },
  });
  await prisma.organization.deleteMany({
    where: { id: { in: organizationIds } },
  });
});

async function provision(externalId?: string) {
  const request = scimCreateUserRequestSchema.parse({
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
    userName: `${nanoid(6)}-${namespace}@example.com`,
    externalId,
    active: true,
  });
  const resource = await service.createUser({
    request,
    organizationId,
    connectionId,
  });
  if (isScimError(resource)) throw new Error(resource.detail);
  return resource;
}

const activePatch = (active: boolean) => ({
  schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  Operations: [{ op: "replace" as const, path: "active", value: active }],
});

function inactiveRequest(userName: string) {
  return scimCreateUserRequestSchema.parse({
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
    userName,
    active: false,
    [SCIM_ENTERPRISE_USER_SCHEMA]: { costCenter: "Inactive department" },
  });
}

async function accessCounts(userId: string) {
  const where = { organizationId, userId };
  return Promise.all([
    prisma.organizationUser.count({ where }),
    prisma.roleBinding.count({ where }),
    prisma.departmentMembershipHistory.count({ where }),
  ]);
}

async function formerMemberWithSession() {
  const resource = await provision();
  await prisma.organizationUser.deleteMany({
    where: { organizationId, userId: resource.id },
  });
  await prisma.roleBinding.deleteMany({
    where: { organizationId, userId: resource.id },
  });
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: resource.id },
  });
  const membership = await prisma.organizationUser.create({
    data: {
      userId: resource.id,
      organizationId: otherOrganizationId,
      role: "ADMIN",
    },
  });
  const session = await prisma.session.create({
    data: {
      userId: resource.id,
      sessionToken: `${namespace}-retained-session`,
      expires: new Date(Date.now() + 60_000),
    },
  });
  return { resource, user, membership, session };
}

describe("SCIM ownership without an external identifier", () => {
  /** @scenario "A directory manages a person even when externalId is absent" */
  it.each([void 0, ""])("claims the person (%s)", async (externalId) => {
    const resource = await provision(externalId);
    await service.replaceUser({
      id: resource.id,
      organizationId,
      connectionId,
      request: scimCreateUserRequestSchema.parse(resource),
    });

    expect(
      await prisma.scimDirectoryUser.findMany({ where: { connectionId } }),
    ).toEqual([{ organizationId, connectionId, userId: resource.id }]);
    expect(await prisma.scimExternalId.count({ where: { connectionId } })).toBe(
      0,
    );
    expect(await reconciliation.countManagedPeople({ connectionIds })).toEqual(
      new Map([[connectionId, 1]]),
    );
    expect(
      await provenance.directoryProvisioned({
        organizationId,
        userIds: [resource.id],
      }),
    ).toEqual([{ userId: resource.id, providerId: connectionId }]);
    expect(
      await provenance.directoryProvisioned({
        organizationId: otherOrganizationId,
        userIds: [resource.id],
      }),
    ).toEqual([]);
  });

  /** @scenario "Omitting externalId does not let another connection change the person" */
  it("refuses a different connection without changing the persisted user", async () => {
    const resource = await provision();
    const before = await prisma.user.findUniqueOrThrow({
      where: { id: resource.id },
    });

    await expect(
      service.updateUser({
        id: resource.id,
        organizationId,
        connectionId: otherConnectionId,
        patchRequest: activePatch(false),
      }),
    ).rejects.toMatchObject({ code: "scim_connection_not_found" });
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: resource.id } }),
    ).toEqual(before);
  });

  /** @scenario "A directory can reactivate its person without an externalId" */
  it("retains ownership on deactivation and restores sign-in without access", async () => {
    const resource = await provision();
    await service.updateUser({
      id: resource.id,
      organizationId,
      connectionId,
      patchRequest: activePatch(false),
    });
    expect(
      await prisma.scimDirectoryUser.count({ where: { connectionId } }),
    ).toBe(1);
    // Model the membership-free state after a completed deprovision.
    await prisma.organizationUser.deleteMany({
      where: { userId: resource.id, organizationId },
    });

    const returned = await service.updateUser({
      id: resource.id,
      organizationId,
      connectionId,
      patchRequest: activePatch(true),
    });

    expect(returned).toMatchObject({ id: resource.id, active: true });
    expect(
      await prisma.organizationUser.count({
        where: { organizationId, userId: resource.id },
      }),
    ).toBe(0);
    expect(
      await prisma.roleBinding.count({
        where: { organizationId, userId: resource.id },
      }),
    ).toBe(0);
  });

  /** @scenario "Deleting a directory person forgets ownership without reclaiming it" */
  it.each([void 0, "external-real"])("forgets (%s)", async (externalId) => {
    const resource = await provision(externalId);
    await directory.remember({
      organizationId: otherOrganizationId,
      connectionId: otherConnectionId,
      userId: resource.id,
      externalId: "other-real",
    });

    expect(
      await service.deleteUser({
        id: resource.id,
        organizationId,
        connectionId,
      }),
    ).toBeNull();

    expect(
      await prisma.scimDirectoryUser.findMany({
        where: { organizationId: { in: organizationIds }, userId: resource.id },
      }),
    ).toEqual([
      {
        organizationId: otherOrganizationId,
        connectionId: otherConnectionId,
        userId: resource.id,
      },
    ]);
    expect(
      await prisma.scimExternalId.count({
        where: { connectionId, userId: resource.id },
      }),
    ).toBe(0);
    expect(
      await directory.getUserId({
        connectionId: otherConnectionId,
        externalId: "other-real",
      }),
    ).toBe(resource.id);
    expect(
      await service.updateUser({
        id: resource.id,
        organizationId,
        connectionId,
        patchRequest: activePatch(true),
      }),
    ).toMatchObject({ status: "404" });
  });

  it("counts multiple real identifiers for one person once and omits erased users", async () => {
    const resource = await provision("first-external");
    await directory.remember({
      organizationId,
      connectionId,
      userId: resource.id,
      externalId: "second-external",
    });
    expect(
      await directory.getUserId({ connectionId, externalId: "first-external" }),
    ).toBe(resource.id);
    expect(await reconciliation.countManagedPeople({ connectionIds })).toEqual(
      new Map([[connectionId, 1]]),
    );

    await prisma.organizationUser.deleteMany({
      where: { organizationId, userId: resource.id },
    });
    await prisma.user.delete({ where: { id: resource.id } });

    expect(await reconciliation.countManagedPeople({ connectionIds })).toEqual(
      new Map(),
    );
    expect(
      await provenance.directoryProvisioned({
        organizationId,
        userIds: [resource.id],
      }),
    ).toEqual([]);
  });
});

describe("SCIM inactive provisioning", () => {
  /** @scenario "Creating an inactive directory person grants no access" */
  it("stores an inactive person and repeats without creating access or a second user", async () => {
    const request = inactiveRequest(`inactive-${namespace}@example.com`);
    const input = { request, organizationId, connectionId };

    const resource = await service.createUser(input);
    if (isScimError(resource)) throw new Error(resource.detail);
    const first = await prisma.user.findUniqueOrThrow({
      where: { id: resource.id },
    });

    expect(resource.active).toBe(false);
    expect(first.deactivatedAt).toBeNull();
    expect(await service.createUser(input)).toMatchObject({
      id: resource.id,
      active: false,
    });
    expect(
      await prisma.user.count({ where: { email: request.userName } }),
    ).toBe(1);
    expect(await accessCounts(resource.id)).toEqual([0, 0, 0]);
    expect(await prisma.department.count({ where: { organizationId } })).toBe(
      0,
    );
    expect(await directory.manages({ connectionId, userId: resource.id })).toBe(
      true,
    );
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: resource.id } }),
    ).toEqual(first);
  });

  /** @scenario "An inactive directory resource can be deleted without a membership" */
  it("forgets an inactive resource and refuses subsequent reactivation", async () => {
    const resource = await service.createUser({
      request: {
        ...inactiveRequest(`inactive-delete-${namespace}@example.com`),
        externalId: "inactive-external",
      },
      organizationId,
      connectionId,
    });
    if (isScimError(resource)) throw new Error(resource.detail);

    await expect(
      service.getUser({ organizationId, id: resource.id }),
    ).resolves.toMatchObject({
      active: false,
    });
    await expect(
      service.listUsers({
        organizationId,
        connectionId,
        filter: 'externalId eq "inactive-external"',
      }),
    ).resolves.toMatchObject({
      totalResults: 1,
      Resources: [{ id: resource.id, active: false }],
    });
    expect(
      await service.deleteUser({
        id: resource.id,
        organizationId,
        connectionId,
      }),
    ).toBeNull();
    expect(await directory.manages({ connectionId, userId: resource.id })).toBe(
      false,
    );
    expect(
      await directory.getUserId({
        connectionId,
        externalId: "inactive-external",
      }),
    ).toBeNull();
    expect(
      await service.updateUser({
        id: resource.id,
        organizationId,
        connectionId,
        patchRequest: activePatch(true),
      }),
    ).toMatchObject({ status: "404" });
    expect(
      await service.deleteUser({
        id: resource.id,
        organizationId,
        connectionId,
      }),
    ).toMatchObject({ status: "404" });
  });

  /** @scenario "Deleting a former directory resource preserves access in other organizations" */
  it("forgets only directory ownership after the person has moved elsewhere", async () => {
    const { resource, user, membership, session } =
      await formerMemberWithSession();
    await directory.remember({
      organizationId: otherOrganizationId,
      connectionId: otherConnectionId,
      userId: resource.id,
      externalId: "other-directory",
    });

    expect(
      await service.deleteUser({
        id: resource.id,
        organizationId,
        connectionId,
      }),
    ).toBeNull();
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: resource.id } }),
    ).toEqual(user);
    expect(
      await prisma.organizationUser.findUniqueOrThrow({
        where: {
          userId_organizationId: {
            userId: resource.id,
            organizationId: otherOrganizationId,
          },
        },
      }),
    ).toEqual(membership);
    expect(
      await prisma.session.findUniqueOrThrow({ where: { id: session.id } }),
    ).toEqual(session);
    expect(await directory.manages({ connectionId, userId: resource.id })).toBe(
      false,
    );
    expect(
      await directory.getUserId({
        connectionId: otherConnectionId,
        externalId: "other-directory",
      }),
    ).toBe(resource.id);
  });

  /** @scenario "Repeating an inactive creation does not restore a departed person's access" */
  it("keeps a departed person inactive on repeated creation", async () => {
    const resource = await provision();
    await service.updateUser({
      id: resource.id,
      organizationId,
      connectionId,
      patchRequest: activePatch(false),
    });
    await prisma.organizationUser.deleteMany({
      where: { organizationId, userId: resource.id },
    });
    const first = await prisma.user.findUniqueOrThrow({
      where: { id: resource.id },
    });
    const input = {
      request: inactiveRequest(resource.userName),
      organizationId,
      connectionId,
    };

    expect(await service.createUser(input)).toMatchObject({
      id: resource.id,
      active: false,
    });
    expect(await service.createUser(input)).toMatchObject({
      id: resource.id,
      active: false,
    });
    expect(await accessCounts(resource.id)).toEqual([0, 0, 0]);
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: resource.id } }),
    ).toEqual(first);
  });

  /** @scenario "Retained directory ownership cannot deactivate an account that has left the organization" */
  it("preserves an active former member's other organization and session", async () => {
    const { resource, user, membership, session } =
      await formerMemberWithSession();

    expect(
      await service.createUser({
        request: inactiveRequest(resource.userName),
        organizationId,
        connectionId,
      }),
    ).toMatchObject({ id: resource.id, active: false });
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: resource.id } }),
    ).toEqual(user);
    expect(
      await prisma.organizationUser.findUniqueOrThrow({
        where: {
          userId_organizationId: {
            userId: resource.id,
            organizationId: otherOrganizationId,
          },
        },
      }),
    ).toEqual(membership);
    expect(
      await prisma.session.findUniqueOrThrow({ where: { id: session.id } }),
    ).toEqual(session);
    expect(await accessCounts(resource.id)).toEqual([0, 0, 0]);
    expect(await directory.manages({ connectionId, userId: resource.id })).toBe(
      true,
    );
  });

  /** @scenario "Inactive provisioning cannot deactivate an unowned account in another organization" */
  it("records inactive tenant state without changing the other tenant", async () => {
    const user = await prisma.user.create({
      data: { email: `other-active-${namespace}@example.com` },
    });
    const membership = await prisma.organizationUser.create({
      data: {
        userId: user.id,
        organizationId: otherOrganizationId,
        role: "MEMBER",
      },
    });

    expect(
      await service.createUser({
        request: inactiveRequest(user.email ?? ""),
        organizationId,
        connectionId,
      }),
    ).toMatchObject({ id: user.id, active: false });
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
    ).toEqual(user);
    expect(
      await prisma.organizationUser.findUniqueOrThrow({
        where: {
          userId_organizationId: {
            userId: user.id,
            organizationId: otherOrganizationId,
          },
        },
      }),
    ).toEqual(membership);
    expect(await accessCounts(user.id)).toEqual([0, 0, 0]);
    expect(await directory.manages({ connectionId, userId: user.id })).toBe(
      true,
    );
  });
});
