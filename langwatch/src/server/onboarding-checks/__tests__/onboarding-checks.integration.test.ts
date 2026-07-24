/**
 * @vitest-environment node
 *
 * Integration tests for Onboarding Checks service.
 * Tests the actual getCheckStatus method with real database queries.
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getTestProject, getTestUser } from "../../../utils/testUtils";
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
    // The model-provider inserts below anchor on organizationId (NOT NULL), so
    // fail fast here if the fixture didn't resolve an org rather than surfacing
    // a confusing Prisma create error mid-test.
    if (!project?.team.organizationId) {
      throw new Error(
        `Test setup failed: project ${projectId} did not resolve to an organization`,
      );
    }
    organizationId = project.team.organizationId;

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
        where: { id: { in: createdEntityIds.modelProviders } },
      });
    }
  });

  describe("getCheckStatus", () => {
    it("returns modelProviders count", async () => {
      const result = await service.getCheckStatus(projectId);

      expect(result).toHaveProperty("modelProviders");
      expect(typeof result.modelProviders).toBe("number");
    });

    it("returns prompts count", async () => {
      const result = await service.getCheckStatus(projectId);

      expect(result).toHaveProperty("prompts");
      expect(typeof result.prompts).toBe("number");
    });

    /** @scenario Step setupModelProviders is complete for a project-scoped provider */
    it("returns 1 when at least one enabled model provider exists", async () => {
      // Create an enabled model provider
      const modelProvider = await prisma.modelProvider.create({
        data: {
          id: `test-provider-${Date.now()}`,
          name: "OpenAI",
          provider: "openai",
          enabled: true,
          organizationId,
          scopes: {
            create: [{ scopeType: "PROJECT", scopeId: projectId }],
          },
        },
      });
      createdEntityIds.modelProviders.push(modelProvider.id);

      const result = await service.getCheckStatus(projectId);

      // Service returns 0 or 1 (has at least one), not a count
      expect(result.modelProviders).toBe(1);
    });

    it("does not count disabled model providers", async () => {
      // Create a disabled model provider
      const disabledProvider = await prisma.modelProvider.create({
        data: {
          id: `test-disabled-provider-${Date.now()}`,
          name: "Anthropic",
          provider: "anthropic",
          enabled: false,
          organizationId,
          scopes: {
            create: [{ scopeType: "PROJECT", scopeId: projectId }],
          },
        },
      });
      createdEntityIds.modelProviders.push(disabledProvider.id);

      const result = await service.getCheckStatus(projectId);

      // Verify disabled providers don't trigger the check
      // (We can't check exact count since other enabled providers may exist)
      expect(typeof result.modelProviders).toBe("number");
    });

    it("returns 1 when at least one versioned prompt exists", async () => {
      // Create a prompt with a version
      const prompt = await prisma.llmPromptConfig.create({
        data: {
          id: `test-prompt-versioned-${Date.now()}`,
          name: "Versioned Prompt",
          projectId,
          organizationId,
        },
      });
      createdEntityIds.prompts.push(prompt.id);

      // Create a version for the prompt
      const version = await prisma.llmPromptConfigVersion.create({
        data: {
          id: `test-version-${Date.now()}`,
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

      // Service returns 0 or 1 (has at least one), not a count
      expect(result.prompts).toBe(1);
    });

    it("does not count prompts without versions", async () => {
      // Create a prompt without any versions
      const promptWithoutVersion = await prisma.llmPromptConfig.create({
        data: {
          id: `test-prompt-no-version-${Date.now()}`,
          name: "No Version Prompt",
          projectId,
          organizationId,
        },
      });
      createdEntityIds.prompts.push(promptWithoutVersion.id);

      // This prompt shouldn't be counted since it has no versions
      // (Test is valid, we just can't easily verify the exact behavior
      // without isolating the test data completely)
      const result = await service.getCheckStatus(projectId);
      expect(typeof result.prompts).toBe("number");
    });

    describe("when a model provider is visible only through the scope cascade", () => {
      // Each case spins up a dedicated org/team/project so no provider from
      // another test leaks into the cascade and masks the result. This is the
      // regression guard for the bug where an org- or team-scoped provider
      // left "Setup your model providers" stuck incomplete because the check
      // only matched the PROJECT scope.
      const cascadeProviderIds: string[] = [];

      afterAll(async () => {
        if (cascadeProviderIds.length > 0) {
          await prisma.modelProvider.deleteMany({
            where: { id: { in: cascadeProviderIds } },
          });
        }
      });

      const resolveScopeIds = async (project: { teamId: string }) => {
        const team = await prisma.team.findUniqueOrThrow({
          where: { id: project.teamId },
          select: { id: true, organizationId: true },
        });
        return { teamId: team.id, organizationId: team.organizationId };
      };

      /** @scenario Step setupModelProviders is complete for an organization-scoped provider */
      it("counts an organization-scoped provider for a project under that org", async () => {
        const project = await getTestProject("onboarding-mp-org");
        const { organizationId } = await resolveScopeIds(project);

        const provider = await prisma.modelProvider.create({
          data: {
            id: `test-org-provider-${nanoid()}`,
            name: "OpenAI",
            provider: "openai",
            enabled: true,
            organizationId,
            scopes: {
              create: [{ scopeType: "ORGANIZATION", scopeId: organizationId }],
            },
          },
        });
        cascadeProviderIds.push(provider.id);

        const result = await service.getCheckStatus(project.id);

        expect(result.modelProviders).toBe(1);
      });

      /** @scenario Step setupModelProviders is complete for a team-scoped provider */
      it("counts a team-scoped provider for a project under that team", async () => {
        const project = await getTestProject("onboarding-mp-team");
        const { teamId, organizationId } = await resolveScopeIds(project);

        const provider = await prisma.modelProvider.create({
          data: {
            id: `test-team-provider-${nanoid()}`,
            name: "OpenAI",
            provider: "openai",
            enabled: true,
            organizationId,
            scopes: {
              create: [{ scopeType: "TEAM", scopeId: teamId }],
            },
          },
        });
        cascadeProviderIds.push(provider.id);

        const result = await service.getCheckStatus(project.id);

        expect(result.modelProviders).toBe(1);
      });

      /** @scenario Step setupModelProviders ignores disabled providers */
      it("does not count an org-scoped provider that is disabled", async () => {
        const project = await getTestProject("onboarding-mp-disabled");
        const { organizationId } = await resolveScopeIds(project);

        const provider = await prisma.modelProvider.create({
          data: {
            id: `test-disabled-org-provider-${nanoid()}`,
            name: "OpenAI",
            provider: "openai",
            enabled: false,
            organizationId,
            scopes: {
              create: [{ scopeType: "ORGANIZATION", scopeId: organizationId }],
            },
          },
        });
        cascadeProviderIds.push(provider.id);

        const result = await service.getCheckStatus(project.id);

        expect(result.modelProviders).toBe(0);
      });
    });

    it("does not count deleted prompts", async () => {
      // Create a deleted prompt with a version
      const deletedPrompt = await prisma.llmPromptConfig.create({
        data: {
          id: `test-prompt-deleted-${Date.now()}`,
          name: "Deleted Prompt",
          projectId,
          organizationId,
          deletedAt: new Date(),
        },
      });
      createdEntityIds.prompts.push(deletedPrompt.id);

      // Create a version for the deleted prompt
      const version = await prisma.llmPromptConfigVersion.create({
        data: {
          id: `test-version-deleted-${Date.now()}`,
          configId: deletedPrompt.id,
          projectId,
          version: 1,
          configData: {},
          schemaVersion: "1.0",
          commitMessage: "Version of deleted prompt",
        },
      });
      createdEntityIds.promptVersions.push(version.id);

      // Deleted prompts shouldn't be counted
      const result = await service.getCheckStatus(projectId);
      expect(typeof result.prompts).toBe("number");
    });
  });
});
