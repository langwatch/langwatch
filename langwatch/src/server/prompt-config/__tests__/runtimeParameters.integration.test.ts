import type { Organization, Project, Team } from "@prisma/client";
import { nanoid } from "nanoid";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import { projectFactory } from "~/factories/project.factory";
import { PromptService, type VersionedPrompt } from "../prompt.service";
import { SEEDED_TAGS } from "~/prompts/constants/tags";

describe("Feature: Prompt runtime parameters", () => {
  let testOrganization: Organization;
  let testTeam: Team;
  let testProject: Project;
  let service: PromptService;

  beforeEach(async () => {
    testOrganization = await prisma.organization.create({
      data: {
        name: "Test Organization",
        slug: `test-org-${nanoid()}`,
      },
    });

    testTeam = await prisma.team.create({
      data: {
        name: "Test Team",
        slug: `test-team-${nanoid()}`,
        organizationId: testOrganization.id,
      },
    });

    testProject = await prisma.project.create({
      data: {
        ...projectFactory.build({ slug: nanoid() }),
        teamId: testTeam.id,
      },
    });

    await prisma.promptTag.createMany({
      data: SEEDED_TAGS.map((tag) => ({
        id: `ptag_${nanoid()}`,
        organizationId: testOrganization.id,
        name: tag,
      })),
      skipDuplicates: true,
    });

    service = new PromptService(prisma);
  });

  afterEach(async () => {
    await prisma.promptTagAssignment.deleteMany({
      where: { projectId: testProject.id },
    });
    await prisma.llmPromptConfigVersion.deleteMany({
      where: { projectId: testProject.id },
    });
    await prisma.llmPromptConfig.deleteMany({
      where: { projectId: testProject.id },
    });
    await prisma.promptTag.deleteMany({
      where: { organizationId: testOrganization.id },
    });
    await prisma.project.deleteMany({
      where: { id: testProject.id },
    });
    await prisma.team.delete({ where: { id: testTeam.id } });
    await prisma.organization.delete({
      where: { id: testOrganization.id },
    });
  });

  async function createPrompt({
    handle,
    parameters,
  }: {
    handle?: string;
    parameters?: Record<string, unknown>;
  } = {}): Promise<VersionedPrompt> {
    return service.createPrompt({
      projectId: testProject.id,
      organizationId: testOrganization.id,
      handle: handle ?? `prompt-${nanoid()}`,
      prompt: "You are a helpful assistant",
      model: "openai/gpt-5-mini",
      parameters,
    });
  }

  describe("when creating a prompt with runtime parameters", () => {
    /** @scenario Creating a prompt stores the supplied runtime parameters */
    it("stores the supplied runtime parameters", async () => {
      const params = {
        search_iterations: 3,
        confidence_threshold: 0.85,
      };

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
      const prompt = await createPrompt({
        parameters: { search_iterations: 3 },
      });

      const updated = await service.updatePrompt({
        idOrHandle: prompt.id,
        projectId: testProject.id,
        data: {
          commitMessage: "Tune search",
          parameters: { search_iterations: 5 },
        },
      });

      expect(updated.version).toBe(2);
      expect(updated.parameters).toEqual({ search_iterations: 5 });
    });
  });

  describe("when updating prompt content without runtime parameters", () => {
    /** @scenario Updating prompt content without runtime parameters preserves the previous parameters */
    it("preserves the previous parameters", async () => {
      const prompt = await createPrompt({
        parameters: { confidence_threshold: 0.9 },
      });

      const updated = await service.updatePrompt({
        idOrHandle: prompt.id,
        projectId: testProject.id,
        data: {
          commitMessage: "Change prompt content",
          prompt: "You are a specialized assistant",
        },
      });

      expect(updated.version).toBe(2);
      expect(updated.parameters).toEqual({ confidence_threshold: 0.9 });
    });
  });

  describe("when fetching prompts by tag and version", () => {
    /** @scenario Fetching prompts returns the selected version parameters */
    it("returns the parameters for the tagged version", async () => {
      const handle = `tagged-prompt-${nanoid()}`;
      const prompt = await createPrompt({
        handle,
        parameters: { environment: "production" },
      });

      await service.updatePrompt({
        idOrHandle: prompt.id,
        projectId: testProject.id,
        data: {
          commitMessage: "v2",
          parameters: { environment: "staging" },
        },
      });

      await service.assignTag({
        configId: prompt.id,
        versionId: prompt.versionId,
        tag: "production",
        projectId: testProject.id,
      });

      const fetched = await service.getPromptByIdOrHandle({
        idOrHandle: handle,
        projectId: testProject.id,
        organizationId: testOrganization.id,
        tag: "production",
      });

      expect(fetched?.version).toBe(1);
      expect(fetched?.parameters).toEqual({ environment: "production" });
    });

    it("returns the parameters for a specific version number", async () => {
      const handle = `versioned-prompt-${nanoid()}`;
      const prompt = await createPrompt({
        handle,
        parameters: { environment: "production" },
      });

      await service.updatePrompt({
        idOrHandle: prompt.id,
        projectId: testProject.id,
        data: {
          commitMessage: "v2",
          parameters: { environment: "staging" },
        },
      });

      const fetched = await service.getPromptByIdOrHandle({
        idOrHandle: handle,
        projectId: testProject.id,
        organizationId: testOrganization.id,
        version: 2,
      });

      expect(fetched?.version).toBe(2);
      expect(fetched?.parameters).toEqual({ environment: "staging" });
    });
  });

  describe("when listing prompt versions", () => {
    /** @scenario Listing prompt versions returns each version parameters */
    it("returns each version with its own parameters", async () => {
      const handle = `multi-version-${nanoid()}`;
      const prompt = await createPrompt({
        handle,
        parameters: { schema: "v1" },
      });

      await service.updatePrompt({
        idOrHandle: prompt.id,
        projectId: testProject.id,
        data: {
          commitMessage: "Schema v2",
          parameters: { schema: "v2" },
        },
      });

      const versions = await service.getAllVersions({
        idOrHandle: handle,
        projectId: testProject.id,
        organizationId: testOrganization.id,
      });

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
      const prompt = await createPrompt({
        handle,
        parameters: { restored: true },
      });

      const v1VersionId = prompt.versionId;

      await service.updatePrompt({
        idOrHandle: prompt.id,
        projectId: testProject.id,
        data: {
          commitMessage: "v2",
          parameters: { restored: false },
        },
      });

      const restored = await service.restoreVersion({
        versionId: v1VersionId,
        projectId: testProject.id,
        organizationId: testOrganization.id,
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
        projectId: testProject.id,
        organizationId: testOrganization.id,
        localConfigData: {
          prompt: "You are a sync assistant",
          model: "openai/gpt-5-mini",
          messages: [
            { role: "user", content: "{{input}}" },
          ],
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
        messages: [
          { role: "user" as const, content: "{{input}}" },
        ],
        inputs: [{ identifier: "input", type: "str" as const }],
        outputs: [{ identifier: "output", type: "str" as const }],
      };

      await service.syncPrompt({
        idOrHandle: handle,
        projectId: testProject.id,
        organizationId: testOrganization.id,
        localConfigData,
        parameters: { remote: true },
      });

      const result = await service.syncPrompt({
        idOrHandle: handle,
        projectId: testProject.id,
        organizationId: testOrganization.id,
        localConfigData,
        localVersion: 1,
        parameters: { local: true },
      });

      expect(result.action).toBe("updated");
      expect(result.prompt!.parameters).toEqual({ local: true });
    });
  });

  describe("when parameters contain deeply nested values", () => {
    it("preserves nested structure through create and fetch", async () => {
      const params = {
        nested: {
          array: [1, true, { leaf: "value" }],
        },
        output_schema: {
          type: "object",
          properties: {
            result: { type: "string" },
          },
        },
      };

      const prompt = await createPrompt({ parameters: params });

      const fetched = await service.getPromptByIdOrHandle({
        idOrHandle: prompt.id,
        projectId: testProject.id,
        organizationId: testOrganization.id,
      });

      expect(fetched?.parameters).toEqual(params);
    });
  });
});
