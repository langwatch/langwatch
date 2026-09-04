/**
 * @vitest-environment node
 *
 * Runtime parameters (search_iterations, confidence_threshold, and anything
 * else a prompt author wants echoed back to the caller) travel with a prompt
 * version the same way its content does: stored on create, versioned on
 * update, carried through fetch/list/restore/sync.
 *
 * Requires LANGWATCH_TEST_DATABASE_URL (or DATABASE_URL). Skips cleanly
 * without one.
 *
 * Ported from platform/app/src/server/prompt-config/__tests__/runtimeParameters.integration.test.ts.
 *
 * @see specs/prompts/prompt-runtime-parameters.feature
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
import { PromptService, type VersionedPrompt } from "../prompt.service";
import { PromptVersionService } from "../prompt-version.service";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;

describe.skipIf(!DB_URL)("Feature: Prompt runtime parameters", () => {
  const connection: PrismaConnection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client as PrismaClient;

  const tagRepository = new PromptTagRepository(prisma);
  const tags = PromptTagService.create(tagRepository);
  const service = PromptService.create({
    repository: new LlmConfigRepository(prisma),
    versionService: PromptVersionService.create(),
    tagRepository: new PromptTagAssignmentRepository(prisma),
    promptTagRepository: tagRepository,
    tagService: tags,
  });

  let organizationId: string;
  let teamId: string;
  let projectId: string;

  beforeEach(async () => {
    const namespace = `rtparams-${nanoid(8)}`;
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

  async function createPrompt({
    handle,
    parameters,
  }: {
    handle?: string;
    parameters?: Record<string, unknown>;
  } = {}): Promise<VersionedPrompt> {
    return service.createPrompt({
      projectId,
      organizationId,
      handle: handle ?? `prompt-${nanoid()}`,
      prompt: "You are a helpful assistant",
      model: "openai/gpt-5-mini",
      parameters,
    });
  }

  describe("when creating a prompt with runtime parameters", () => {
    /** @scenario Creating a prompt stores the supplied runtime parameters */
    it("stores the supplied runtime parameters", async () => {
      const params = { search_iterations: 3, confidence_threshold: 0.85 };

      const prompt = await createPrompt({ parameters: params });

      expect(prompt.parameters).toEqual(params);
      expect(prompt.version).toBe(1);
    });
  });

  describe("when creating a prompt without runtime parameters", () => {
    /** @scenario Creating a prompt without runtime parameters returns an empty parameters object */
    it("returns an empty parameters object", async () => {
      const prompt = await createPrompt();

      expect(prompt.parameters).toEqual({});
    });
  });

  describe("when updating only runtime parameters", () => {
    /** @scenario Updating only runtime parameters creates a new prompt version */
    it("creates a new prompt version", async () => {
      const prompt = await createPrompt({ parameters: { search_iterations: 3 } });

      const updated = await service.updatePrompt({
        idOrHandle: prompt.id,
        projectId,
        data: { commitMessage: "Tune search", parameters: { search_iterations: 5 } },
      });

      expect(updated.version).toBe(2);
      expect(updated.parameters).toEqual({ search_iterations: 5 });
    });
  });

  describe("when updating prompt content without runtime parameters", () => {
    /** @scenario Updating prompt content without runtime parameters preserves the previous parameters */
    it("preserves the previous parameters", async () => {
      const prompt = await createPrompt({ parameters: { confidence_threshold: 0.9 } });

      const updated = await service.updatePrompt({
        idOrHandle: prompt.id,
        projectId,
        data: { commitMessage: "Change prompt content", prompt: "You are a specialized assistant" },
      });

      expect(updated.version).toBe(2);
      expect(updated.parameters).toEqual({ confidence_threshold: 0.9 });
    });
  });

  describe("when fetching prompts by tag and version", () => {
    /** @scenario Fetching prompts returns the selected version parameters */
    it("returns the parameters for the tagged version", async () => {
      const handle = `tagged-prompt-${nanoid()}`;
      const prompt = await createPrompt({ handle, parameters: { environment: "production" } });

      await service.updatePrompt({
        idOrHandle: prompt.id,
        projectId,
        data: { commitMessage: "v2", parameters: { environment: "staging" } },
      });

      await service.assignTag({
        configId: prompt.id,
        versionId: prompt.versionId,
        tag: "production",
        projectId,
      });

      const fetched = await service.tryGetPromptByIdOrHandle({
        idOrHandle: handle,
        projectId,
        organizationId,
        tag: "production",
      });

      expect(fetched?.version).toBe(1);
      expect(fetched?.parameters).toEqual({ environment: "production" });
    });
  });

  describe("when listing prompt versions", () => {
    /** @scenario Listing prompt versions returns each version parameters */
    it("returns each version with its own parameters", async () => {
      const handle = `multi-version-${nanoid()}`;
      await createPrompt({ handle, parameters: { schema: "v1" } });
      const prompt = await service.tryGetPromptByIdOrHandle({
        idOrHandle: handle,
        projectId,
        organizationId,
      });

      await service.updatePrompt({
        idOrHandle: prompt!.id,
        projectId,
        data: { commitMessage: "Schema v2", parameters: { schema: "v2" } },
      });

      const versions = await service.getAllVersions({ idOrHandle: handle, projectId, organizationId });

      const v1 = versions.find((v) => v.version === 1);
      const v2 = versions.find((v) => v.version === 2);

      expect(v1?.parameters).toEqual({ schema: "v1" });
      expect(v2?.parameters).toEqual({ schema: "v2" });
    });
  });

  describe("when restoring a prompt version", () => {
    /** @scenario Restoring a prompt version carries forward that version parameters */
    it("carries forward that version parameters", async () => {
      const handle = `restore-prompt-${nanoid()}`;
      const prompt = await createPrompt({ handle, parameters: { restored: true } });
      const v1VersionId = prompt.versionId;

      await service.updatePrompt({
        idOrHandle: prompt.id,
        projectId,
        data: { commitMessage: "v2", parameters: { restored: false } },
      });

      const restored = await service.restoreVersion({
        versionId: v1VersionId,
        projectId,
        organizationId,
      });

      expect(restored.version).toBe(3);
      expect(restored.parameters).toEqual({ restored: true });
    });
  });

  describe("when syncing a local prompt with runtime parameters", () => {
    /** @scenario Syncing a local prompt includes runtime parameters in the remote version */
    it("includes runtime parameters in the created version", async () => {
      const handle = `sync-prompt-${nanoid()}`;

      const result = await service.syncPrompt({
        idOrHandle: handle,
        projectId,
        organizationId,
        localConfigData: {
          prompt: "You are a sync assistant",
          model: "openai/gpt-5-mini",
          messages: [{ role: "user", content: "{{input}}" }],
          inputs: [{ identifier: "input", type: "str" as const }],
          outputs: [{ identifier: "output", type: "str" as const }],
        },
        parameters: { local: true },
      });

      expect(result.action).toBe("created");
      expect(result.prompt!.parameters).toEqual({ local: true });
    });
  });

  describe("when syncing a local prompt detects parameters conflicts", () => {
    /** @scenario Syncing a local prompt detects runtime parameters conflicts */
    it("creates a new version when parameters differ at the same version", async () => {
      const handle = `conflict-prompt-${nanoid()}`;
      const localConfigData = {
        prompt: "You are a conflict assistant",
        model: "openai/gpt-5-mini",
        messages: [{ role: "user" as const, content: "{{input}}" }],
        inputs: [{ identifier: "input", type: "str" as const }],
        outputs: [{ identifier: "output", type: "str" as const }],
      };

      await service.syncPrompt({
        idOrHandle: handle,
        projectId,
        organizationId,
        localConfigData,
        parameters: { remote: true },
      });

      const result = await service.syncPrompt({
        idOrHandle: handle,
        projectId,
        organizationId,
        localConfigData,
        localVersion: 1,
        parameters: { local: true },
      });

      expect(result.action).toBe("updated");
      expect(result.prompt!.parameters).toEqual({ local: true });
    });
  });
});
