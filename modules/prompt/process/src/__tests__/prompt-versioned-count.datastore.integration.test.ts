/**
 * @vitest-environment node
 * @see modules/prompt/specs/prompt-versioned-count.feature
 */
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaLlmConfigRepository } from "../repositories/prisma/prisma.prompt.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const namespace = `pvc-${nanoid(8)}`;

describe.skipIf(!DB_URL)("given a project's prompts", () => {
  const prisma = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:prompt:test"),
  }).connect(
    PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }),
  ).client;
  const repository = PrismaLlmConfigRepository.create({ prisma });
  const ids = { organizationId: "", teamId: "", projectId: "" };

  function addVersion(configId: string) {
    return prisma.llmPromptConfigVersion.create({
      data: {
        configId,
        projectId: ids.projectId,
        version: 1,
        configData: {},
        schemaVersion: "1.0",
      },
    });
  }

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: namespace, slug: `${namespace}-org` },
    });
    ids.organizationId = organization.id;
    const team = await prisma.team.create({
      data: { name: namespace, slug: `${namespace}-team`, organizationId: organization.id },
    });
    ids.teamId = team.id;
    const project = await prisma.project.create({
      data: {
        id: `${namespace}-project`,
        name: namespace,
        slug: `${namespace}-project`,
        apiKey: `sk-lw-test-${nanoid(16)}`,
        teamId: team.id,
        language: "python",
        framework: "openai",
        personalFeatures: {},
      },
    });
    ids.projectId = project.id;
  });

  afterAll(async () => {
    await prisma.llmPromptConfigVersion.deleteMany({ where: { projectId: ids.projectId } });
    await prisma.llmPromptConfig.deleteMany({ where: { projectId: ids.projectId } });
    await prisma.project.deleteMany({ where: { id: ids.projectId } });
    await prisma.team.deleteMany({ where: { id: ids.teamId } });
    await prisma.organization.deleteMany({ where: { id: ids.organizationId } });
  });

  /** @scenario "Only live prompts holding a version count toward the prompt step" */
  it("counts only the live prompts that hold a version", async () => {
    const base = { projectId: ids.projectId, organizationId: ids.organizationId };
    const deleted = await prisma.llmPromptConfig.create({
      data: { ...base, name: "deleted", deletedAt: new Date() },
    });
    await addVersion(deleted.id);
    const unversioned = await prisma.llmPromptConfig.create({
      data: { ...base, name: "unversioned" },
    });

    await expect(repository.countVersioned({ projectId: ids.projectId })).resolves.toBe(0);

    await addVersion(unversioned.id);

    await expect(repository.countVersioned({ projectId: ids.projectId })).resolves.toBe(1);
  });
});
