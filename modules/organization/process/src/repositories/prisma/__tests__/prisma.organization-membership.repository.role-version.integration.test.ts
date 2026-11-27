/**
 * A role write moves the member's role version, and one expecting an older version writes nothing.
 * @vitest-environment node
 * @see specs/licensing/role-change-seat.feature
 */
import type { AuthzGrantsService } from "@langwatch/authz-contract";
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import { OrganizationUserRole, type PrismaClient } from "@langwatch/prisma-client/generated";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { cleanupTestRows } from "@langwatch/test-harness/prisma";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { RoleVersionMovedError } from "../../organization-membership.repository.ts";
import { PrismaOrganizationMembershipRepository } from "../prisma.organization-membership.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

const noopGrantsWriter = createApiFixture<AuthzGrantsService>({
  attachBindings: async () => ({ attached: [], duplicates: [] }),
  revokeBindingsWhere: async () => 0,
});

describe.skipIf(!DB_URL)("PrismaOrganizationMembershipRepository role version", () => {
  const testNamespace = `role-version-${nanoid(8)}`;
  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:organization:test:organization-membership-role-version"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client as PrismaClient;
  const repository = PrismaOrganizationMembershipRepository.create({
    database: prisma,
    cipher: { encrypt: (value: string) => value, decrypt: (value: string) => value },
    grants: noopGrantsWriter,
  });

  let organizationId = "";
  const userIds: string[] = [];
  let samId = "";

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: "Role Version Org", slug: `--test-org-${testNamespace}` },
    });
    organizationId = organization.id;
    for (const [name, role] of [
      ["Ada", OrganizationUserRole.ADMIN],
      ["Sam", OrganizationUserRole.MEMBER],
    ] as const) {
      const user = await prisma.user.create({
        data: { name, email: `${name.toLowerCase()}-${testNamespace}@example.com` },
      });
      userIds.push(user.id);
      await prisma.organizationUser.create({ data: { userId: user.id, organizationId, role } });
    }
    samId = userIds[1]!;
  });

  afterAll(async () => {
    await cleanupTestRows(prisma, [
      ["organizationUser", { organizationId }],
      ["organization", { id: organizationId }],
      ...userIds.map((id) => ["user", { id }] as ["user", { id: string }]),
    ]);
    await prisma.$disconnect();
  });

  const changeSam = (role: OrganizationUserRole, expectedRoleVersion?: number) =>
    repository.updateMemberRole({
      caller: { type: "system" },
      organizationId,
      userId: samId,
      role,
      effectiveTeamRoleUpdates: [],
      currentUserId: null,
      ...(expectedRoleVersion === undefined ? {} : { expectedRoleVersion }),
    });

  describe("when a paid change expects the version it was asked at", () => {
    /** @scenario "A replaced change whose settling failed never applies its older role" */
    it("writes while no other role write came first, and moves the version", async () => {
      const asked = await repository.getRoleVersion({ organizationId, userId: samId });

      await changeSam(OrganizationUserRole.ADMIN, asked);

      expect(await repository.getRoleVersion({ organizationId, userId: samId })).toBe(asked + 1);
    });

    /** @scenario "A replaced change whose settling failed never applies its older role" */
    it("refuses and writes nothing once a later role write moved the version", async () => {
      const asked = await repository.getRoleVersion({ organizationId, userId: samId });
      await changeSam(OrganizationUserRole.MEMBER);

      await expect(changeSam(OrganizationUserRole.ADMIN, asked)).rejects.toBeInstanceOf(
        RoleVersionMovedError,
      );

      const row = await prisma.organizationUser.findUniqueOrThrow({
        where: { userId_organizationId: { userId: samId, organizationId } },
        select: { role: true, roleVersion: true },
      });
      expect(row).toEqual({ role: OrganizationUserRole.MEMBER, roleVersion: asked + 1 });
    });
  });
});
