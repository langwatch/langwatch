/**
 * @vitest-environment node
 * @see specs/identity/join-before-create.feature
 */
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import { OrganizationUserRole } from "@langwatch/prisma-client/generated";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaTeamRepository } from "../prisma.team.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("PrismaTeamRepository.organizationIdsForMember", () => {
  const namespace = `org-ids-for-member-${nanoid(8)}`;
  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:organization:test:team-repository-organization-ids"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client;
  const repository = PrismaTeamRepository.create(prisma);

  const organizationIds: string[] = [];
  let userId = "";
  let activeOrganizationId = "";
  let disabledOrganizationId = "";

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `${namespace}@test.com`, name: "Member" },
    });
    userId = user.id;
    const [active, disabled] = await Promise.all(
      ["active", "disabled"].map((kind) =>
        prisma.organization.create({
          data: { name: `${kind} org`, slug: `--test-${namespace}-${kind}` },
        }),
      ),
    );
    activeOrganizationId = active!.id;
    disabledOrganizationId = disabled!.id;
    organizationIds.push(activeOrganizationId, disabledOrganizationId);
    await prisma.organizationUser.create({
      data: { userId, organizationId: activeOrganizationId, role: OrganizationUserRole.MEMBER },
    });
    await prisma.organizationUser.create({
      data: {
        userId,
        organizationId: disabledOrganizationId,
        role: OrganizationUserRole.MEMBER,
        disabledAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    for (const organizationId of organizationIds) {
      await prisma.organizationUser.deleteMany({ where: { organizationId } });
    }
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  describe("given a person in two organizations, one membership disabled", () => {
    /** @scenario "A person's organizations are read across tenants through the guarded client" */
    it("answers the active membership through the org-tenancy guard", async () => {
      await expect(repository.organizationIdsForMember({ userId })).resolves.toEqual([
        activeOrganizationId,
      ]);
    });

    it("answers both when disabled memberships count", async () => {
      const found = await repository.organizationIdsForMember({ userId, activeOnly: false });
      expect(found.toSorted()).toEqual(organizationIds.toSorted());
    });
  });
});
