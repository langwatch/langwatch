/**
 * @vitest-environment node
 *
 * The copy counts on the prompt list are computed from the listed prompts
 * only. They count the copies that still exist.
 *
 * Requires LANGWATCH_TEST_DATABASE_URL (or DATABASE_URL). Skips cleanly
 * without one.
 *
 * Ported from platform/app/src/server/prompt-config/__tests__/prompt-list-copy-counts.integration.test.ts.
 *
 * @see specs/prompts/prompt-list-copy-counts.feature
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
import { LlmConfigRepository } from "../../repositories/prisma/prisma.prompt.repository";
import { PromptTagAssignmentRepository } from "../../repositories/prisma/prisma.prompt-tag-assignment.repository";
import { PromptTagRepository } from "../../repositories/prisma/prisma.prompt-tag.repository";
import { PromptTagService } from "../prompt-tag.service";
import { PromptService } from "../prompt.service";
import { PromptVersionService } from "../prompt-version.service";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;

describe.skipIf(!DB_URL)("Feature: The prompt list reports live copy counts", () => {
  const connection: PrismaConnection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client as PrismaClient;

  const tagRepository = new PromptTagRepository(prisma);
  const service = PromptService.create({
    repository: new LlmConfigRepository(prisma),
    versionService: PromptVersionService.create(),
    tagRepository: new PromptTagAssignmentRepository(prisma),
    promptTagRepository: tagRepository,
    tagService: PromptTagService.create(tagRepository),
  });

  let organizationId: string;
  let teamId: string;
  let sourceProjectId: string;
  let copyProjectAId: string;
  let copyProjectBId: string;

  const projectIds = () => [sourceProjectId, copyProjectAId, copyProjectBId];

  beforeEach(async () => {
    const namespace = `copycounts-${nanoid(8)}`;
    const organization = await prisma.organization.create({
      data: { name: namespace, slug: `${namespace}-org` },
    });
    organizationId = organization.id;

    const team = await prisma.team.create({
      data: { name: namespace, slug: `${namespace}-team`, organizationId },
    });
    teamId = team.id;

    const makeProject = async (suffix: string) => {
      const project = await prisma.project.create({
        data: {
          id: `${namespace}-${suffix}`,
          name: `${namespace}-${suffix}`,
          slug: `${namespace}-${suffix}`,
          apiKey: `sk-lw-test-${nanoid(16)}`,
          teamId,
          language: "python",
          framework: "openai",
          personalFeatures: {},
        },
      });
      return project.id;
    };
    sourceProjectId = await makeProject("source");
    copyProjectAId = await makeProject("copy-a");
    copyProjectBId = await makeProject("copy-b");
  });

  afterEach(async () => {
    await prisma.promptTagAssignment.deleteMany({ where: { projectId: { in: projectIds() } } });
    await prisma.llmPromptConfigVersion.deleteMany({ where: { projectId: { in: projectIds() } } });
    await prisma.llmPromptConfig.deleteMany({
      where: { projectId: { in: projectIds() }, copiedFromPromptId: { not: null } },
    });
    await prisma.llmPromptConfig.deleteMany({ where: { projectId: { in: projectIds() } } });
    await prisma.project.deleteMany({ where: { id: { in: projectIds() } } });
    await prisma.team.delete({ where: { id: teamId } });
    await prisma.organization.delete({ where: { id: organizationId } });
  });

  async function createSourcePrompt(handle: string) {
    return await service.createPrompt({
      projectId: sourceProjectId,
      organizationId,
      handle,
      prompt: "You are a helpful assistant",
      model: "openai/gpt-5-mini",
    });
  }

  async function listSourceProjectPrompts() {
    return await service.getAllPrompts({ projectId: sourceProjectId, organizationId });
  }

  describe("given a prompt with a copy in each of two other projects", () => {
    /** @scenario "A prompt with copies reports their number" */
    it("reports two copies", async () => {
      const source = await createSourcePrompt("copied-twice");
      await service.copyPrompt({
        idOrHandle: source.id,
        sourceProjectId,
        targetProjectId: copyProjectAId,
      });
      await service.copyPrompt({
        idOrHandle: source.id,
        sourceProjectId,
        targetProjectId: copyProjectBId,
      });

      const listed = await listSourceProjectPrompts();

      const prompt = listed.find((p) => p.id === source.id);
      expect(prompt?._count?.copiedPrompts).toBe(2);
    });
  });

  describe("given a prompt with two copies and one of them deleted", () => {
    /** @scenario "A deleted copy is not counted" */
    it("reports one copy", async () => {
      const source = await createSourcePrompt("copied-then-deleted");
      const copyA = await service.copyPrompt({
        idOrHandle: source.id,
        sourceProjectId,
        targetProjectId: copyProjectAId,
      });
      await service.copyPrompt({
        idOrHandle: source.id,
        sourceProjectId,
        targetProjectId: copyProjectBId,
      });
      await service.deletePrompt({ idOrHandle: copyA.id, projectId: copyProjectAId });

      const listed = await listSourceProjectPrompts();

      const prompt = listed.find((p) => p.id === source.id);
      expect(prompt?._count?.copiedPrompts).toBe(1);
    });
  });

  describe("given a prompt that was never copied", () => {
    /** @scenario "A prompt without copies reports zero" */
    it("reports zero copies", async () => {
      const source = await createSourcePrompt("never-copied");

      const listed = await listSourceProjectPrompts();

      const prompt = listed.find((p) => p.id === source.id);
      expect(prompt?._count?.copiedPrompts).toBe(0);
    });
  });
});
