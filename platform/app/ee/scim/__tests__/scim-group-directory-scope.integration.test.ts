// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { nanoid } from "nanoid";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";

import { ScimGroupService } from "../scim-group.service";

const groupSchema = "urn:ietf:params:scim:schemas:core:2.0:Group";

describe("SCIM group directory scope", () => {
  const ns = `scim-group-scope-${nanoid(8)}`;
  const organizationId = `${ns}-org`;
  const otherOrganizationId = `${ns}-other-org`;
  const connectionA = `${ns}-a`;
  const connectionB = `${ns}-b`;
  const service = ScimGroupService.create({ prisma });

  beforeEach(async () => {
    await prisma.organization.createMany({
      data: [organizationId, otherOrganizationId].map((id) => ({
        id,
        name: id,
        slug: `--test-${id}`,
      })),
    });
    await prisma.group.createMany({
      data: [
        { id: `${ns}-a`, organizationId, scimConnectionId: connectionA },
        { id: `${ns}-b`, organizationId, scimConnectionId: connectionB },
        { id: `${ns}-legacy`, organizationId, scimConnectionId: null },
        {
          id: `${ns}-foreign`,
          organizationId: otherOrganizationId,
          scimConnectionId: null,
        },
      ].map((group) => ({
        ...group,
        name: group.id,
        slug: group.id,
        externalId: group.id,
        scimSource: "scim",
      })),
    });
  });

  afterEach(async () => {
    await cleanupTestRows(prisma, [
      [
        "group",
        { organizationId: { in: [organizationId, otherOrganizationId] } },
      ],
      ["organization", { id: { in: [organizationId, otherOrganizationId] } }],
    ]);
  });

  /** @scenario "Legacy SCIM tokens retain organization-wide group reads" */
  it("lets a legacy token read all its organization's groups and match their names", async () => {
    const listed = await service.listGroups({
      organizationId,
      connectionId: null,
    });
    expect(listed).toMatchObject({ totalResults: 3 });
    if (!("Resources" in listed)) throw new Error("Expected a group listing");
    expect(listed.Resources.map((group) => group.id).sort()).toEqual(
      [`${ns}-a`, `${ns}-b`, `${ns}-legacy`].sort(),
    );
    for (const id of [`${ns}-a`, `${ns}-b`, `${ns}-legacy`]) {
      await expect(
        service.getGroup({
          organizationId,
          connectionId: null,
          scimResourceId: id,
        }),
      ).resolves.toMatchObject({ id });
    }
    await expect(
      service.getGroup({
        organizationId,
        connectionId: null,
        scimResourceId: `${ns}-foreign`,
      }),
    ).resolves.toMatchObject({ status: "404" });
    await expect(
      service.listGroups({
        organizationId,
        connectionId: null,
        filter: `externalId eq "${ns}-b"`,
      }),
    ).resolves.toMatchObject({
      totalResults: 1,
      Resources: [{ id: `${ns}-b` }],
    });
    await expect(
      service.createGroup({
        organizationId,
        connectionId: null,
        request: { schemas: [groupSchema], displayName: `${ns}-b` },
      }),
    ).resolves.toMatchObject({ status: "409" });
  });

  /** @scenario "Concrete SCIM tokens keep sibling groups outside their reads" */
  it("shows a concrete token its own and legacy groups while isolating sibling names", async () => {
    const listed = await service.listGroups({
      organizationId,
      connectionId: connectionA,
    });
    expect(listed).toMatchObject({ totalResults: 2 });
    if (!("Resources" in listed)) throw new Error("Expected a group listing");
    expect(listed.Resources.map((group) => group.id).sort()).toEqual(
      [`${ns}-a`, `${ns}-legacy`].sort(),
    );
    await expect(
      service.getGroup({
        organizationId,
        connectionId: connectionA,
        scimResourceId: `${ns}-b`,
      }),
    ).resolves.toMatchObject({ status: "404" });
    await expect(
      service.createGroup({
        organizationId,
        connectionId: connectionA,
        request: { schemas: [groupSchema], displayName: `${ns}-b` },
      }),
    ).resolves.toMatchObject({ displayName: `${ns}-b` });
  });

  /** @scenario "Group external identifiers belong to their directory namespace" */
  it("accepts identical external IDs across directories and rejects duplicates within each namespace", async () => {
    const externalId = `${ns}-shared-external`;
    for (const [label, connectionId] of [
      ["first", connectionA],
      ["second", connectionB],
      ["legacy", null],
    ] as const) {
      await expect(
        service.createGroup({
          organizationId,
          connectionId,
          request: {
            schemas: [groupSchema],
            displayName: `${ns}-${label}-shared`,
            externalId,
          },
        }),
      ).resolves.toMatchObject({ externalId });
    }
    expect(
      await prisma.group.count({ where: { organizationId, externalId } }),
    ).toBe(3);
    for (const [label, scimConnectionId] of [
      ["concrete", connectionA],
      ["legacy", null],
    ] as const) {
      await expect(
        service.createGroup({
          organizationId,
          connectionId: scimConnectionId,
          request: {
            schemas: [groupSchema],
            displayName: `${ns}-${label}-duplicate`,
            externalId,
          },
        }),
      ).resolves.toMatchObject({ status: "409" });
      await expect(
        prisma.group.create({
          data: {
            organizationId,
            name: `${ns}-${label}-duplicate`,
            slug: `${ns}-${label}-duplicate`,
            externalId,
            scimConnectionId,
          },
        }),
      ).rejects.toMatchObject({ code: "P2002" });
    }
    await expect(
      prisma.group.create({
        data: {
          organizationId: otherOrganizationId,
          name: `${ns}-other-legacy`,
          slug: `${ns}-other-legacy`,
          externalId,
        },
      }),
    ).resolves.toMatchObject({ externalId });
  });
});
