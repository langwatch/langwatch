/**
 * @vitest-environment node
 * The spend rollup names each project, and never carries its credentials.
 * @see ../../../../../specs/organization-spend.feature
 */
import { randomUUID } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaOrganizationSpendRepository } from "../prisma.organization-spend.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("PrismaOrganizationSpendRepository", () => {
  const ns = `spend-credentials-${randomUUID().slice(0, 8)}`;
  const projectApiKey = `test-project-key-${ns}`;
  let connection: PrismaConnection | undefined;
  let prisma: PrismaClient;
  let organizationId: string;
  let teamId: string;
  let projectId: string;
  let userId: string;
  let lwqlKey: string;

  beforeAll(async () => {
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:entitlement:test:organization-spend-repository"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
    prisma = connection.client as PrismaClient;

    organizationId = (
      await prisma.organization.create({ data: { name: `Org ${ns}`, slug: `org-${ns}` } })
    ).id;
    teamId = (
      await prisma.team.create({ data: { name: `Team ${ns}`, slug: `team-${ns}`, organizationId } })
    ).id;
    const project = await prisma.project.create({
      data: {
        name: `Project ${ns}`,
        slug: `project-${ns}`,
        apiKey: projectApiKey,
        teamId,
        language: "python",
        framework: "openai",
        s3AccessKeyId: `access-${ns}`,
        s3SecretAccessKey: `secret-${ns}`,
      },
    });
    projectId = project.id;
    lwqlKey = project.lwqlKey;
    userId = (await prisma.user.create({ data: { name: ns, email: `${ns}@example.com` } })).id;
    await prisma.organizationUser.create({ data: { userId, organizationId, role: "MEMBER" } });
    await prisma.teamUser.create({ data: { userId, teamId, role: "VIEWER" } });
    await prisma.cost.create({
      data: {
        projectId,
        costType: "CLUSTERING",
        referenceType: "PROJECT",
        referenceId: projectId,
        amount: 0.01,
        currency: "USD",
      },
    });
  });

  afterAll(async () => {
    if (!connection) return;
    await prisma.cost.deleteMany({ where: { projectId } });
    await prisma.teamUser.deleteMany({ where: { teamId } });
    await prisma.organizationUser.deleteMany({ where: { organizationId } });
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.team.deleteMany({ where: { id: teamId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  describe("when a team viewer reads the organization's spend", () => {
    /** @scenario Spend rollups never carry project credentials */
    it("names the project without any of its credentials", async () => {
      const rollups = await PrismaOrganizationSpendRepository.create(prisma).findSpendRollups({
        organizationId,
        userId,
        startDate: Date.now() - 24 * 60 * 60 * 1000,
        endDate: Date.now(),
      });

      expect(rollups.map(({ project }) => project.id)).toEqual([projectId]);
      const serialized = JSON.stringify(rollups);
      for (const credential of [projectApiKey, lwqlKey, `access-${ns}`, `secret-${ns}`]) {
        expect(serialized).not.toContain(credential);
      }
    });
  });
});
