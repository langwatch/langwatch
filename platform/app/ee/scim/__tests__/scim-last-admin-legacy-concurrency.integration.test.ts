// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The legacy SCIM write path still has to serialize deactivation. Its user
 * flag is written through a separate client while the membership transaction
 * holds the organization lock, so this exercises the real database boundary.
 */
import { generate } from "@langwatch/ksuid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { OrganizationUserRole } from "~/generated/prisma/client";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { wireDefaultTestApp } from "~/test-utils/wireDefaultTestApp";
import { KSUID_RESOURCES } from "~/utils/constants";
import { ScimService } from "../scim.service";
import type { ScimCreateUserRequest } from "../scim.types";

vi.mock("~/env.mjs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/env.mjs")>();
  return { ...actual, env: { ...actual.env, SCIM_V2_GRANTS: "off" } };
});

wireDefaultTestApp();

const namespace = `scim-legacy-last-admin-${generate(KSUID_RESOURCES.ORGANIZATION).toString()}`;
const organizationId = `${namespace}-org`;
const firstAdminId = `${namespace}-first`;
const secondAdminId = `${namespace}-second`;

class TwoCallBarrier {
  private arrived = 0;
  private release: (() => void) | undefined;
  private readonly released = new Promise<void>((resolve) => {
    this.release = resolve;
  });

  async wait(): Promise<void> {
    this.arrived += 1;
    if (this.arrived === 2) this.release?.();
    await this.released;
  }
}

const deactivation = (email: string): ScimCreateUserRequest => ({
  schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
  userName: email,
  active: false,
});

describe("legacy SCIM last-admin deactivation concurrency", () => {
  beforeAll(async () => {
    await prisma.organization.create({
      data: { id: organizationId, name: namespace, slug: namespace },
    });
    await prisma.user.createMany({
      data: [
        {
          id: firstAdminId,
          email: `${namespace}-first@example.com`,
          name: "First Admin",
        },
        {
          id: secondAdminId,
          email: `${namespace}-second@example.com`,
          name: "Second Admin",
        },
      ],
    });
    await prisma.organizationUser.createMany({
      data: [
        {
          userId: firstAdminId,
          organizationId,
          role: OrganizationUserRole.ADMIN,
        },
        {
          userId: secondAdminId,
          organizationId,
          role: OrganizationUserRole.ADMIN,
        },
      ],
    });
  });

  afterAll(async () => {
    await cleanupTestRows(prisma, [
      ["roleBinding", { organizationId }],
      ["organizationUser", { organizationId }],
      ["user", { id: { in: [firstAdminId, secondAdminId] } }],
      ["organization", { id: organizationId }],
    ]);
  });

  it("rejects one contender after the other user's deactivation commits", async () => {
    const barrier = new TwoCallBarrier();
    const requests = [
      { id: firstAdminId, email: `${namespace}-first@example.com` },
      { id: secondAdminId, email: `${namespace}-second@example.com` },
    ];

    const outcomes = await Promise.allSettled(
      requests.map(({ id, email }) =>
        (async () => {
          await barrier.wait();
          return new ScimService({ prisma }).replaceUser({
            id,
            organizationId,
            request: deactivation(email),
          });
        })(),
      ),
    );

    const refused = outcomes.filter(
      (outcome): outcome is PromiseRejectedResult =>
        outcome.status === "rejected",
    );
    expect(refused).toHaveLength(1);
    expect(refused[0]?.reason).toMatchObject({
      code: "cannot_disable_last_admin",
    });

    const activeAdmins = await prisma.organizationUser.count({
      where: {
        organizationId,
        role: OrganizationUserRole.ADMIN,
        disabledAt: null,
        user: { deactivatedAt: null },
      },
    });
    expect(activeAdmins).toBe(1);

    const refusedIndex = outcomes.findIndex(
      (outcome) => outcome.status === "rejected",
    );
    const refusedUserId = requests[refusedIndex]?.id;
    expect(refusedUserId).toBeDefined();
    await expect(
      prisma.organizationUser.findUnique({
        where: {
          userId_organizationId: {
            userId: refusedUserId ?? "",
            organizationId,
          },
        },
      }),
    ).resolves.toMatchObject({ role: OrganizationUserRole.ADMIN });
    await expect(
      prisma.user.findUnique({
        where: { id: refusedUserId ?? "" },
        select: { deactivatedAt: true },
      }),
    ).resolves.toMatchObject({ deactivatedAt: null });
  });
});
