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
import { PrismaNurturingProjectDirectoryRepository } from "../prisma.nurturing-project-directory.repository.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const namespace = `test-nurturing-placement-${randomUUID()}`;
const organizationId = `${namespace}-organization`;
const teamId = `${namespace}-team`;
const projectId = `${namespace}-project`;
const archivedProjectId = `${namespace}-archived`;
const earliest = new Date("2020-01-01T00:00:00.000Z");

describe.skipIf(!databaseUrl)("given project's and organization's tables", () => {
  let connection: PrismaConnection;
  let repository: PrismaNurturingProjectDirectoryRepository;
  let milestones: PrismaNurturingMilestonesRepository;

  beforeAll(async () => {
    if (!databaseUrl) throw new Error("LANGWATCH_TEST_DATABASE_URL is required here");
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:nurturing:test:placement"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
    const prisma = connection.client;
    repository = PrismaNurturingProjectDirectoryRepository.create({ prisma });
    milestones = PrismaNurturingMilestonesRepository.create({ prisma });
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
    await prisma.project.create({
      data: {
        id: archivedProjectId,
        teamId,
        name: archivedProjectId,
        slug: archivedProjectId,
        apiKey: archivedProjectId,
        language: "typescript",
        framework: "test",
        createdAt: earliest,
        archivedAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    if (!connection) return;
    const prisma = connection.client;
    await prisma.nurturingOrganization.deleteMany({ where: { organizationId } });
    await prisma.project.deleteMany({ where: { id: { in: [projectId, archivedProjectId] } } });
    await prisma.team.deleteMany({ where: { id: teamId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await connection.closeOnce();
  });

  describe("when an evaluation in a project of an organization nurturing learned is counted", () => {
    /** @scenario "Nurturing reads a project's organization through its team" */
    it("places the project in its team's organization, whose count rises by one", async () => {
      await milestones.recordOrganization({ organizationId, adminUserId: null, seeded: false });

      const placement = await repository.getPlacement({ projectId });

      expect(placement).toEqual({ outcome: "known", organizationId });
      await expect(milestones.countEvaluation({ organizationId })).resolves.toMatchObject([
        { organizationId, evaluationCount: 1 },
      ]);
    });
  });

  describe("when an organization holding an archived older project is read", () => {
    /** @scenario "Nurturing reads an organization's earliest project through its teams" */
    it("answers the earliest project's creation, archived included", async () => {
      await expect(repository.getFirstProjectCreatedAt({ organizationId })).resolves.toEqual({
        firstProjectCreatedAt: earliest.getTime(),
      });
    });
  });

  describe("when the project is one its owners do not hold", () => {
    it("answers unknown", async () => {
      await expect(repository.getPlacement({ projectId: `${namespace}-absent` })).resolves.toEqual({
        outcome: "unknown",
      });
    });
  });
});
