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

import { PrismaJoinCandidateRepository } from "../prisma.join-request.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("PrismaJoinCandidateRepository.findCandidateOrganizations", () => {
  const namespace = `join-candidates-${nanoid(8)}`.toLowerCase();
  const domain = `${namespace}.test`;
  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:identity:test:join-candidate-repository"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client;
  const repository = PrismaJoinCandidateRepository.create(prisma);

  const organizationIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    for (const name of ["first", "second"]) {
      const organization = await prisma.organization.create({
        data: { name: `${name} org`, slug: `--test-${namespace}-${name}` },
      });
      const user = await prisma.user.create({
        data: { email: `${name}@${domain}`, name },
      });
      organizationIds.push(organization.id);
      userIds.push(user.id);
      await prisma.organizationUser.create({
        data: {
          userId: user.id,
          organizationId: organization.id,
          role: OrganizationUserRole.ADMIN,
        },
      });
      await prisma.identifier.create({
        data: {
          id: `ident-${nanoid(10)}`,
          userId: user.id,
          provider: "email",
          value: `${name}@${domain}`,
          domain,
          state: "VERIFIED",
          verifiedAt: new Date(),
          attachedAt: new Date(),
        },
      });
    }
  });

  afterAll(async () => {
    await prisma.identifier.deleteMany({ where: { userId: { in: userIds } } });
    for (const organizationId of organizationIds) {
      await prisma.organizationUser.deleteMany({ where: { organizationId } });
    }
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  describe("given verified colleagues on a domain across two organizations", () => {
    /** @scenario "A domain's candidate organizations are read across tenants through the guarded client" */
    it("finds both organizations through the org-tenancy guard", async () => {
      const candidates = await repository.findCandidateOrganizations({ domain });
      expect(candidates.map((candidate) => candidate.organizationId).toSorted()).toEqual(
        organizationIds.toSorted(),
      );
    });
  });
});
