// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { generate } from "@langwatch/ksuid";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { wireDefaultTestApp } from "~/test-utils/wireDefaultTestApp";

import { ScimService } from "../scim.service";
import { isScimError, SCIM_ENTERPRISE_USER_SCHEMA } from "../scim.types";

vi.mock("~/env.mjs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/env.mjs")>();
  return { ...actual, env: { ...actual.env, SCIM_V2_GRANTS: "off" } };
});
wireDefaultTestApp();

const userSchema = "urn:ietf:params:scim:schemas:core:2.0:User";
const patchSchema = "urn:ietf:params:scim:api:messages:2.0:PatchOp";
const namespace = `scim-resource-${generate("organization").toString()}`;
const organizationId = `${namespace}-a`;
const otherOrganizationId = `${namespace}-b`;
const userId = generate("user").toString();
const userEmail = `${namespace.toLowerCase()}@example.test`;
const service = ScimService.create({ prisma });

beforeEach(async () => {
  await prisma.organization.createMany({
    data: [organizationId, otherOrganizationId].map((id) => ({
      id,
      name: id,
      slug: id,
    })),
  });
  await prisma.user.create({
    data: {
      id: userId,
      email: userEmail,
      emailVerified: true,
      name: "Shared Account",
    },
  });
  await prisma.organizationUser.createMany({
    data: [organizationId, otherOrganizationId].map((id) => ({
      organizationId: id,
      userId,
      role: "MEMBER",
    })),
  });
  await prisma.session.createMany({
    data: ["a", "b"].map((label) => ({
      userId,
      sessionToken: `${namespace}-${label}`,
      expires: new Date(Date.now() + 60_000),
    })),
  });
});

afterEach(async () => {
  await cleanupTestRows(prisma, [
    [
      "scimUserResource",
      { organizationId: { in: [organizationId, otherOrganizationId] } },
    ],
    [
      "organizationUser",
      { organizationId: { in: [organizationId, otherOrganizationId] } },
    ],
    ["user", { email: { contains: namespace.toLowerCase() } }],
    ["organization", { id: { in: [organizationId, otherOrganizationId] } }],
  ]);
});

describe("organization-owned SCIM user state", () => {
  /** @scenario "Directory usernames stay unique without mutating a conflicting resource" */
  it("refuses conflicting PUT and PATCH before offboarding and releases deleted aliases", async () => {
    const second = await prisma.user.create({
      data: { email: `second-${userEmail}`, name: "Second Account" },
    });
    await prisma.organizationUser.create({
      data: { organizationId, userId: second.id, role: "MEMBER" },
    });
    const original = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    await expect(
      service.replaceUser({
        id: userId,
        organizationId,
        request: {
          schemas: [userSchema],
          userName: (second.email ?? "").toUpperCase(),
          active: false,
        },
      }),
    ).resolves.toMatchObject({ status: "409", scimType: "uniqueness" });
    expect(
      await prisma.scimUserResource.count({ where: { organizationId } }),
    ).toBe(0);
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    ).toEqual(original);
    expect(
      await prisma.organizationUser.count({
        where: { organizationId, userId },
      }),
    ).toBe(1);
    const alias = `alias-${userEmail}`;
    for (const [id, userName] of [
      [userId, alias],
      [second.id, second.email ?? ""],
    ] as const) {
      await service.replaceUser({
        id,
        organizationId,
        request: { schemas: [userSchema], userName, active: true },
      });
    }
    const where = {
      organizationId_userId: { organizationId, userId: second.id },
    };
    const before = await prisma.scimUserResource.findUniqueOrThrow({ where });
    await expect(
      service.replaceUser({
        id: second.id,
        organizationId,
        request: {
          schemas: [userSchema],
          userName: alias,
          active: false,
          [SCIM_ENTERPRISE_USER_SCHEMA]: { costCenter: "Must not assign" },
        },
      }),
    ).resolves.toMatchObject({ status: "409", scimType: "uniqueness" });
    await expect(
      service.updateUser({
        id: second.id,
        organizationId,
        patchRequest: {
          schemas: [patchSchema],
          Operations: [
            { op: "replace", path: "active", value: false },
            { op: "replace", path: "userName", value: alias.toUpperCase() },
          ],
        },
      }),
    ).resolves.toMatchObject({ status: "409", scimType: "uniqueness" });
    expect(await prisma.scimUserResource.findUniqueOrThrow({ where })).toEqual(
      before,
    );
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: second.id } }),
    ).toEqual(second);
    expect(
      await prisma.organizationUser.count({
        where: { organizationId, userId: second.id },
      }),
    ).toBe(1);
    expect(await prisma.department.count({ where: { organizationId } })).toBe(
      0,
    );
    await expect(
      prisma.scimUserResource.update({
        where,
        data: { userName: alias.toUpperCase() },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
    await expect(
      service.deleteUser({ id: userId, organizationId }),
    ).resolves.toBeNull();
    await expect(
      service.replaceUser({
        id: second.id,
        organizationId,
        request: { schemas: [userSchema], userName: alias, active: true },
      }),
    ).resolves.toMatchObject({ userName: alias });
  });

  /** @scenario "Directory lifecycle and profile changes affect only their organization" */
  it("renames and deactivates one tenant resource without changing the shared account or sessions", async () => {
    const before = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    const sessions = await prisma.session.findMany({
      where: { userId },
      orderBy: { id: "asc" },
    });
    const alias = `alias-${userEmail}`;
    await expect(
      service.replaceUser({
        id: userId,
        organizationId,
        request: {
          schemas: [userSchema],
          userName: alias,
          name: { givenName: "Tenant", familyName: "Profile" },
          active: true,
        },
      }),
    ).resolves.toMatchObject({
      userName: alias,
      name: { givenName: "Tenant", familyName: "Profile" },
    });
    await expect(
      service.getUser({ id: userId, organizationId: otherOrganizationId }),
    ).resolves.toMatchObject({
      userName: userEmail,
      name: { givenName: "Shared", familyName: "Account" },
    });
    await expect(
      service.listUsers({
        organizationId,
        filter: `userName eq "${userEmail}"`,
      }),
    ).resolves.toMatchObject({ totalResults: 0 });
    await expect(
      service.listUsers({ organizationId, filter: `userName eq "${alias}"` }),
    ).resolves.toMatchObject({ totalResults: 1, Resources: [{ id: userId }] });
    await expect(
      service.createUser({
        organizationId,
        request: { schemas: [userSchema], userName: alias },
      }),
    ).resolves.toMatchObject({ status: "409" });
    expect(await prisma.user.count({ where: { email: alias } })).toBe(0);

    await expect(
      service.updateUser({
        id: userId,
        organizationId,
        patchRequest: {
          schemas: [patchSchema],
          Operations: [
            { op: "replace", path: "active", value: false },
            { op: "replace", path: "name.givenName", value: "Inactive" },
            {
              op: "replace",
              path: `${SCIM_ENTERPRISE_USER_SCHEMA}:costCenter`,
              value: "No access",
            },
          ],
        },
      }),
    ).resolves.toMatchObject({ active: false });
    expect(
      await prisma.organizationUser.count({
        where: { organizationId, userId },
      }),
    ).toBe(0);
    expect(
      await prisma.organizationUser.count({
        where: { organizationId: otherOrganizationId, userId },
      }),
    ).toBe(1);
    expect(await prisma.department.count({ where: { organizationId } })).toBe(
      0,
    );
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    ).toEqual(before);
    expect(
      await prisma.session.findMany({
        where: { userId },
        orderBy: { id: "asc" },
      }),
    ).toEqual(sessions);

    const disabledAt = new Date("2026-09-01T00:00:00Z");
    await prisma.user.update({
      where: { id: userId },
      data: { deactivatedAt: disabledAt },
    });
    await expect(
      service.updateUser({
        id: userId,
        organizationId,
        patchRequest: {
          schemas: [patchSchema],
          Operations: [{ op: "replace", path: "active", value: true }],
        },
      }),
    ).resolves.toMatchObject({ active: true });
    expect(
      await prisma.organizationUser.count({
        where: { organizationId, userId },
      }),
    ).toBe(0);
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    ).toMatchObject({
      deactivatedAt: disabledAt,
      email: userEmail,
      emailVerified: true,
    });
    expect(
      await prisma.session.findMany({
        where: { userId },
        orderBy: { id: "asc" },
      }),
    ).toEqual(sessions);
  });

  /** @scenario "Inactive directory resources remain readable without granting access" */
  it("keeps inactive resources readable, editable and deletable without membership", async () => {
    const email = `inactive-${userEmail}`;
    const created = await service.createUser({
      organizationId,
      request: {
        schemas: [userSchema],
        userName: email,
        active: false,
        [SCIM_ENTERPRISE_USER_SCHEMA]: { costCenter: "No access" },
      },
    });
    if (isScimError(created)) throw new Error(created.detail);
    await expect(
      service.getUser({ organizationId, id: created.id }),
    ).resolves.toMatchObject({
      id: created.id,
      active: false,
    });
    await expect(
      service.listUsers({
        organizationId,
        filter: `userName eq "${email}"`,
        count: 1,
      }),
    ).resolves.toMatchObject({
      totalResults: 1,
      Resources: [{ id: created.id, active: false }],
    });
    const first = await service.listUsers({ organizationId, count: 1 });
    const second = await service.listUsers({
      organizationId,
      startIndex: 2,
      count: 1,
    });
    if (isScimError(first) || isScimError(second))
      throw new Error("Expected pages");
    expect(
      [...first.Resources, ...second.Resources]
        .map((resource) => resource.id)
        .sort(),
    ).toEqual([userId, created.id].sort());
    expect(first.totalResults).toBe(2);
    const alias = `renamed-${email}`;
    await expect(
      service.replaceUser({
        organizationId,
        id: created.id,
        request: { schemas: [userSchema], userName: alias, active: false },
      }),
    ).resolves.toMatchObject({ userName: alias, active: false });
    await expect(
      service.createUser({
        organizationId,
        request: { schemas: [userSchema], userName: alias, active: false },
      }),
    ).resolves.toMatchObject({ id: created.id });
    expect(await prisma.user.count({ where: { email: alias } })).toBe(0);
    expect(
      await prisma.organizationUser.count({
        where: { organizationId, userId: created.id },
      }),
    ).toBe(0);
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: created.id } }),
    ).toMatchObject({
      deactivatedAt: null,
      email,
    });
    await expect(
      service.deleteUser({ organizationId, id: created.id }),
    ).resolves.toBeNull();
    await expect(
      service.getUser({ organizationId, id: created.id }),
    ).resolves.toMatchObject({
      status: "404",
    });
    await expect(
      service.listUsers({ organizationId, filter: `userName eq "${alias}"` }),
    ).resolves.toMatchObject({ totalResults: 0 });
    await expect(
      service.replaceUser({
        organizationId,
        id: created.id,
        request: { schemas: [userSchema], userName: email, active: true },
      }),
    ).resolves.toMatchObject({ status: "404" });
    await expect(
      service.updateUser({
        organizationId,
        id: created.id,
        patchRequest: {
          schemas: [patchSchema],
          Operations: [{ op: "replace", path: "active", value: true }],
        },
      }),
    ).resolves.toMatchObject({ status: "404" });
    expect(
      await prisma.scimUserResource.findUniqueOrThrow({
        where: {
          organizationId_userId: { organizationId, userId: created.id },
        },
      }),
    ).toMatchObject({ active: false, deletedAt: expect.any(Date) });
    expect(await prisma.user.count({ where: { id: created.id } })).toBe(1);
    await expect(
      service.createUser({
        organizationId,
        request: { schemas: [userSchema], userName: email, active: false },
      }),
    ).resolves.toMatchObject({ id: created.id, active: false });
    expect(
      await prisma.scimUserResource.findUniqueOrThrow({
        where: {
          organizationId_userId: { organizationId, userId: created.id },
        },
      }),
    ).toMatchObject({ deletedAt: null });
  });
});
