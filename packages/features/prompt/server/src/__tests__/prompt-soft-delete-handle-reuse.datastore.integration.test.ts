/**
 * @vitest-environment node
 *
 * @see specs/prompts/prompt-soft-delete.feature
 *
 * A prompt's handle used to stay unique forever: `@@unique([handle])` on
 * `LlmPromptConfig` counted archived rows, so deleting a prompt and creating
 * a fresh one with the same handle — or the CLI's sync flow doing the same —
 * threw "Prompt handle already exists". `PrismaLlmConfigRepository.
 * deleteConfig` nulls the handle out on archive now, and Postgres treats
 * NULL as distinct per row under a plain unique constraint, so the handle
 * is free for a new prompt to claim.
 *
 * Requires LANGWATCH_TEST_DATABASE_URL (or DATABASE_URL). Skips cleanly
 * without one.
 */
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaLlmConfigRepository } from "../repositories/prisma/prisma.prompt.repository";
import { PrismaPromptTagAssignmentRepository } from "../repositories/prisma/prisma.prompt-tag-assignment.repository";
import { PrismaPromptTagRepository } from "../repositories/prisma/prisma.prompt-tag.repository";
import { PromptTagService } from "../services/prompt-tag.service";
import { PromptService } from "../services/prompt.service";
import type { PromptVersionService } from "../services/prompt-version.service";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const namespace = `psd-${nanoid(8)}`;
const versions = { assertNoSystemPromptConflict: () => {} } as unknown as PromptVersionService;

describe.skipIf(!DB_URL)("given a prompt handle after the prompt is archived", () => {
  const connection: PrismaConnection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client as PrismaClient;

  const tagRepository = PrismaPromptTagRepository.create({ prisma });
  const tags = PromptTagService.create(tagRepository);
  const prompts = PromptService.create({
    repository: PrismaLlmConfigRepository.create({ prisma }),
    versionService: versions,
    tagRepository: PrismaPromptTagAssignmentRepository.create({ prisma }),
    promptTagRepository: tagRepository,
    tagService: tags,
  });

  let organizationId: string;
  let teamId: string;
  let projectId: string;

  beforeAll(async () => {
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
  });

  afterAll(async () => {
    await prisma.llmPromptConfigVersion.deleteMany({ where: { projectId } });
    await prisma.llmPromptConfig.deleteMany({ where: { projectId } });
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.team.deleteMany({ where: { id: teamId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
  });

  describe("when a prompt was previously created and then archived", () => {
    /** @scenario "A user can reuse the handle of an archived prompt for a new prompt" */
    it("allows creating a new prompt with the same handle", async () => {
      const handle = `reuse-handle-${nanoid(6).toLowerCase().replace(/[^a-z0-9_-]/g, "x")}`;

      const original = await prompts.createPrompt({
        projectId,
        organizationId,
        handle,
        prompt: "Original prompt",
      });

      await prompts.deletePrompt({ idOrHandle: original.id, projectId, organizationId });

      const recreated = await prompts.createPrompt({
        projectId,
        organizationId,
        handle,
        prompt: "Reincarnated prompt",
      });

      expect(recreated.id).not.toBe(original.id);
      expect(recreated.handle).toBe(handle);
    });

    /** @scenario "A user can sync a fresh prompt from the CLI after the previous one was archived" */
    it("allows the CLI sync flow to recreate a prompt with the same handle", async () => {
      const handle = `sync-reuse-${nanoid(6).toLowerCase().replace(/[^a-z0-9_-]/g, "x")}`;
      const configData = {
        prompt: "v1",
        messages: [],
        inputs: [{ identifier: "input", type: "str" as const }],
        outputs: [{ identifier: "output", type: "str" as const }],
        model: "openai/gpt-5-mini",
      };

      const initialSync = await prompts.syncPrompt({
        idOrHandle: handle,
        localConfigData: configData,
        projectId,
        organizationId,
      });
      expect(initialSync.action).toBe("created");
      const initialPromptId = initialSync.prompt!.id;

      await prompts.deletePrompt({ idOrHandle: initialPromptId, projectId, organizationId });

      const reSync = await prompts.syncPrompt({
        idOrHandle: handle,
        localConfigData: { ...configData, prompt: "v2" },
        projectId,
        organizationId,
      });

      expect(reSync.action).toBe("created");
      expect(reSync.prompt!.id).not.toBe(initialPromptId);
    });
  });
});
