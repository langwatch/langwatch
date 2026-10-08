/**
 * @vitest-environment node
 * The judge places a project from project's and organization's rows through their shares (R40).
 * Spec: modules/instant-eval-judge/specs/instant-eval-judge-project-placement.feature
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

import { PrismaInstantEvalJudgeProjectRepository } from "../prisma.instant-eval-judge-placement.repository.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const namespace = `test-judge-placement-${randomUUID()}`;
const organizationId = `${namespace}-organization`;
const teamId = `${namespace}-team`;
const projectId = `${namespace}-project`;

describe.skipIf(!databaseUrl)("given project's and organization's tables", () => {
  let connection: PrismaConnection;
  let repository: PrismaInstantEvalJudgeProjectRepository;

  beforeAll(async () => {
    if (!databaseUrl) throw new Error("LANGWATCH_TEST_DATABASE_URL is required here");
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:instant-eval-judge:test:placement"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
    const prisma = connection.client;
    repository = PrismaInstantEvalJudgeProjectRepository.create({ prisma });
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
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.team.deleteMany({ where: { id: teamId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await connection.closeOnce();
  });

  describe("when the judge places a project it never folded a created fact for", () => {
    /** @scenario "The judge reads a project's organization through its team" */
    it("knows the team's organization", async () => {
      await expect(repository.getPlacement({ projectId })).resolves.toEqual({
        outcome: "known",
        organizationId,
      });
    });
  });

  describe("when the judge places a project id its owner does not hold", () => {
    /** @scenario "A project its owner does not hold is unknown to the judge" */
    it("answers unknown", async () => {
      await expect(repository.getPlacement({ projectId: `${namespace}-absent` })).resolves.toEqual({
        outcome: "unknown",
      });
    });
  });
});
