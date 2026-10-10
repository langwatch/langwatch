/**
 * An agent's copy count comes from one grouped count over the listed agents,
 * not a per-row `_count`, and still counts copies in every project, archived
 * or not.
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

import { PrismaAgentRepository } from "../prisma.agent.repository.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const namespace = `test-agent-copy-count-${randomUUID()}`;
const projectId = `${namespace}-project`;
const otherProjectId = `${namespace}-other`;
const teamId = `${namespace}-team`;
const organizationId = `${namespace}-organization`;
const sourceId = `${namespace}-source`;
const loneId = `${namespace}-lone`;

describe.skipIf(!databaseUrl)("Prisma Agent copy counts", () => {
  let connection: PrismaConnection;
  let repository: PrismaAgentRepository;

  beforeAll(async () => {
    if (!databaseUrl) throw new Error("Test database URL is required");
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:agent:test:copy-count"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
    const prisma = connection.client;
    repository = PrismaAgentRepository.create({ prisma });

    await prisma.organization.create({
      data: { id: organizationId, name: namespace, slug: namespace },
    });
    await prisma.team.create({
      data: { id: teamId, organizationId, name: namespace, slug: namespace },
    });
    for (const id of [projectId, otherProjectId]) {
      await prisma.project.create({
        data: {
          id,
          teamId,
          name: id,
          slug: id,
          apiKey: id,
          language: "typescript",
          framework: "test",
        },
      });
    }
    const agent = (id: string, project: string) => ({
      id,
      projectId: project,
      name: id,
      type: "signature",
      config: {
        prompt: "Answer clearly",
        inputs: [{ identifier: "question", type: "str" }],
        outputs: [{ identifier: "answer", type: "str" }],
      },
    });
    await prisma.agent.create({ data: agent(sourceId, projectId) });
    await prisma.agent.create({ data: agent(loneId, projectId) });
    await prisma.agent.create({
      data: { ...agent(`${namespace}-copy-here`, projectId), copiedFromAgentId: sourceId },
    });
    await prisma.agent.create({
      data: { ...agent(`${namespace}-copy-there`, otherProjectId), copiedFromAgentId: sourceId },
    });
    await prisma.agent.create({
      data: {
        ...agent(`${namespace}-copy-archived`, otherProjectId),
        copiedFromAgentId: sourceId,
        archivedAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    if (!connection) return;
    const prisma = connection.client;
    const projects = { projectId: { in: [projectId, otherProjectId] } };
    await prisma.agent.deleteMany({ where: { ...projects, copiedFromAgentId: { not: null } } });
    await prisma.agent.deleteMany({ where: projects });
    await prisma.project.deleteMany({ where: { id: { in: [projectId, otherProjectId] } } });
    await prisma.team.deleteMany({ where: { id: teamId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await connection.closeOnce();
  });

  describe("when a project's agents are listed", () => {
    it("counts every copy of an agent across projects, and zero for an agent never copied", async () => {
      const listed = await repository.findAll({ projectId });
      const copyCountOf = (id: string) => listed.find((agent) => agent.id === id)?.copyCount;

      expect(copyCountOf(sourceId)).toBe(3);
      expect(copyCountOf(loneId)).toBe(0);
      expect(copyCountOf(`${namespace}-copy-here`)).toBe(0);
    });
  });
});
