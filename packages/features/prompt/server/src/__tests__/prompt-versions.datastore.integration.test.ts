/**
 * @vitest-environment node
 *
 * Versions are the Prompt service's own history: it hands back what a prompt
 * has been, and a version write it refuses leaves the prompt reading exactly
 * as it did before.
 *
 * @see packages/features/prompt/specs/prompt.feature
 */
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { nanoid } from "nanoid";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PrismaLlmConfigRepository } from "../repositories/prisma/prisma.prompt.repository";
import { PrismaPromptTagAssignmentRepository } from "../repositories/prisma/prisma.prompt-tag-assignment.repository";
import { PrismaPromptTagRepository } from "../repositories/prisma/prisma.prompt-tag.repository";
import { PromptTagService } from "../services/prompt-tag.service";
import { PromptService, type VersionedPrompt } from "../services/prompt.service";
import { PromptVersionService } from "../services/prompt-version.service";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;

describe.skipIf(!DB_URL)("Feature: Prompt version history", () => {
  const connection: PrismaConnection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client as PrismaClient;

  const tagRepository = PrismaPromptTagRepository.create({ prisma });
  const tags = PromptTagService.create(tagRepository);
  const service = PromptService.create({
    repository: PrismaLlmConfigRepository.create({ prisma }),
    versionService: PromptVersionService.create(),
    tagRepository: PrismaPromptTagAssignmentRepository.create({ prisma }),
    promptTagRepository: tagRepository,
    tagService: tags,
  });

  let organizationId: string;
  let teamId: string;
  let projectId: string;

  beforeEach(async () => {
    const namespace = `versions-${nanoid(8)}`;
    const organization = await prisma.organization.create({
      data: { name: namespace, slug: `${namespace}-org` },
    });
    organizationId = organization.id;

    const team = await prisma.team.create({
      data: { name: namespace, slug: `${namespace}-team`, organizationId },
    });
    teamId = team.id;

    const project = await prisma.project.create({
      data: {
        id: `${namespace}-project`,
        name: namespace,
        slug: `${namespace}-project`,
        apiKey: `sk-lw-test-${nanoid(16)}`,
        teamId,
        language: "python",
        framework: "openai",
        personalFeatures: {},
      },
    });
    projectId = project.id;

    await tags.seedForOrganization({ organizationId });
  });

  afterEach(async () => {
    await prisma.promptTagAssignment.deleteMany({ where: { projectId } });
    await prisma.llmPromptConfigVersion.deleteMany({ where: { projectId } });
    await prisma.llmPromptConfig.deleteMany({ where: { projectId } });
    await prisma.promptTag.deleteMany({ where: { organizationId } });
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.team.delete({ where: { id: teamId } });
    await prisma.organization.delete({ where: { id: organizationId } });
  });

  function createPrompt(): Promise<VersionedPrompt> {
    return service.createPrompt({
      projectId,
      organizationId,
      handle: `prompt-${nanoid()}`,
      prompt: "You are a helpful assistant",
      model: "openai/gpt-5-mini",
    });
  }

  describe("when a prompt has more than one version", () => {
    /** @scenario prompt versions remain part of one Prompt service */
    it("returns the version history from the same service that wrote it", async () => {
      const prompt = await createPrompt();
      await service.updatePrompt({
        idOrHandle: prompt.id,
        projectId,
        data: { commitMessage: "Say it warmer", prompt: "You are a warm assistant" },
      });

      const versions = await service.getAllVersions({ idOrHandle: prompt.id, projectId });

      expect(versions.map((one) => one.version).sort()).toEqual([1, 2]);
      expect(versions.map((one) => one.prompt)).toEqual(
        expect.arrayContaining(["You are a helpful assistant", "You are a warm assistant"]),
      );
    });
  });
});
