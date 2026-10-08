// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Nurturing places a project through project's and organization's shares (round 46 E1, R40).
 * Spec: enterprise/modules/nurturing/specs/nurturing.feature
 */
import { randomUUID } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaNurturingMilestonesRepository } from "../prisma.nurturing-milestones.repository.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const namespace = `test-nurturing-placement-${randomUUID()}`;
const organizationId = `${namespace}-organization`;
const teamId = `${namespace}-team`;
const projectId = `${namespace}-project`;

describe.skipIf(!databaseUrl)("given project's and organization's tables", () => {
  let connection: PrismaConnection;
  let repository: PrismaNurturingMilestonesRepository;

  beforeAll(async () => {
    if (!databaseUrl) throw new Error("LANGWATCH_TEST_DATABASE_URL is required here");
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:nurturing:test:placement"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
    const prisma = connection.client;
    repository = PrismaNurturingMilestonesRepository.create({ prisma });
    await prisma.organization.create({
      data: { id: organizationId, name: namespace, slug: namespace },
    });
    await prisma.team.create({
      data: { id: teamId, organizationId, name: namespace, slug: namespace },
    });
    await prisma.project.create({
      data: {
        id: projectId,
        teamId,
        name: projectId,
        slug: projectId,
        apiKey: projectId,
        language: "typescript",
        framework: "test",
      },
    });
  });

  afterAll(async () => {
    if (!connection) return;
    const prisma = connection.client;
    await prisma.nurturingOrganization.deleteMany({ where: { organizationId } });
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.team.deleteMany({ where: { id: teamId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await connection.closeOnce();
  });

  describe("when an evaluation in a project of an organization nurturing learned is counted", () => {
    /** @scenario "Nurturing reads a project's organization through its team" */
    it("raises the organization's evaluation count by one", async () => {
      await repository.recordOrganization({ organizationId, adminUserId: null, seeded: false });

      await expect(repository.countEvaluation({ projectId })).resolves.toMatchObject([
        { organizationId, evaluationCount: 1 },
      ]);
    });
  });

  describe("when the project is one its owners do not hold", () => {
    it("counts nothing", async () => {
      await expect(
        repository.countEvaluation({ projectId: `${namespace}-absent` }),
      ).resolves.toEqual([]);
    });
  });
});
