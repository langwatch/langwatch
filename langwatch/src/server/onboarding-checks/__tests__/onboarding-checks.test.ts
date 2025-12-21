/**
 * @vitest-environment node
 *
 * Integration tests for Onboarding Checks service.
 * Tests the actual getCheckStatus method with real database queries.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getTestUser } from "../../../utils/testUtils";
import { prisma } from "../../db";
import { OnboardingChecksService } from "../onboarding-checks.service";

describe("OnboardingChecksService Integration", () => {
  const projectId = "test-project-id";
  let organizationId: string;
  let service: OnboardingChecksService;
  const createdEntityIds: {
    modelProviders: string[];
    prompts: string[];
    promptVersions: string[];
  } = {
    modelProviders: [],
    prompts: [],
    promptVersions: [],
  };

  beforeAll(async () => {
    await getTestUser(); // Ensure test project exists

    // Get the organization ID from the test project's team
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { team: true },
    });
    organizationId = project?.team.organizationId ?? "";

    service = new OnboardingChecksService();
  });

  afterAll(async () => {
    // Clean up created entities
    if (createdEntityIds.promptVersions.length > 0) {
      await prisma.llmPromptConfigVersion.deleteMany({
        where: { id: { in: createdEntityIds.promptVersions }, projectId },
      });
    }
    if (createdEntityIds.prompts.length > 0) {
      await prisma.llmPromptConfig.deleteMany({
        where: { id: { in: createdEntityIds.prompts }, projectId },
      });
    }
    if (createdEntityIds.modelProviders.length > 0) {
      await prisma.modelProvider.deleteMany({
        where: { id: { in: createdEntityIds.modelProviders }, projectId },
      });
    }
  });

  describe("getCheckStatus", () => {
    it("returns all expected fields", async () => {
      const result = await service.getCheckStatus(projectId);

      expect(result).toHaveProperty("modelProviders");
      expect(result).toHaveProperty("prompts");
      expect(result).toHaveProperty("workflows");
      expect(result).toHaveProperty("datasets");
      expect(result).toHaveProperty("evaluations");
      expect(result).toHaveProperty("simulations");
      expect(result).toHaveProperty("firstMessage");
      expect(result).toHaveProperty("integrated");
    });

    it("returns numeric counts for modelProviders and prompts", async () => {
      const result = await service.getCheckStatus(projectId);

      expect(typeof result.modelProviders).toBe("number");
      expect(typeof result.prompts).toBe("number");
    });

    it("detects enabled model providers", async () => {
      // Create an enabled model provider with unique ID
      const providerId = `test-provider-${Date.now()}-${Math.random()}`;
      const modelProvider = await prisma.modelProvider.create({
        data: {
          id: providerId,
          projectId,
          provider: "openai",
          enabled: true,
        },
      });
      createdEntityIds.modelProviders.push(modelProvider.id);

      const result = await service.getCheckStatus(projectId);

      // Should detect at least 1 enabled provider
      expect(result.modelProviders).toBeGreaterThanOrEqual(1);
    });

    it("detects versioned prompts", async () => {
      // Create a prompt with a version
      const promptId = `test-prompt-versioned-${Date.now()}-${Math.random()}`;
      const prompt = await prisma.llmPromptConfig.create({
        data: {
          id: promptId,
          name: "Versioned Prompt",
          projectId,
          organizationId,
        },
      });
      createdEntityIds.prompts.push(prompt.id);

      // Create a version for the prompt
      const versionId = `test-version-${Date.now()}-${Math.random()}`;
      const version = await prisma.llmPromptConfigVersion.create({
        data: {
          id: versionId,
          configId: prompt.id,
          projectId,
          version: 1,
          configData: {},
          schemaVersion: "1.0",
          commitMessage: "Initial version",
        },
      });
      createdEntityIds.promptVersions.push(version.id);

      const result = await service.getCheckStatus(projectId);

      // Should detect at least 1 versioned prompt
      expect(result.prompts).toBeGreaterThanOrEqual(1);
    });
  });
});
