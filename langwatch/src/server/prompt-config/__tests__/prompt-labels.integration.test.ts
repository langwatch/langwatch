import type { Organization, Project, Team } from "@prisma/client";
import { nanoid } from "nanoid";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import { projectFactory } from "~/factories/project.factory";
import { PromptService } from "../prompt.service";
import { NotFoundError } from "../errors";

describe("Feature: Prompt labels", () => {
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

    service = new PromptService(prisma);
  });

  afterEach(async () => {
    await prisma.llmPromptConfigLabel.deleteMany({
      where: { projectId: testProject.id },
    });
    await prisma.llmPromptConfigVersion.deleteMany({
      where: { projectId: testProject.id },
    });
    await prisma.llmPromptConfig.deleteMany({
      where: { projectId: testProject.id },
    });
    await prisma.project.delete({ where: { id: testProject.id } });
    await prisma.team.delete({ where: { id: testTeam.id } });
    await prisma.organization.delete({
      where: { id: testOrganization.id },
    });
  });

  async function createPromptWithVersions({
    handle,
    versionCount,
  }: {
    handle: string;
    versionCount: number;
  }) {
    const prompt = await service.createPrompt({
      projectId: testProject.id,
      organizationId: testOrganization.id,
      handle,
      prompt: "You are a helpful assistant",
      model: "openai/gpt-5",
    });

    const versions = [prompt];

    for (let i = 2; i <= versionCount; i++) {
      const updated = await service.updatePrompt({
        idOrHandle: prompt.id,
        projectId: testProject.id,
        data: {
          commitMessage: `Version ${i}`,
          prompt: `You are assistant v${i}`,
        },
      });
      versions.push(updated);
    }

    return { prompt: versions[versions.length - 1]!, allVersions: versions };
  }

  // --- Data Model ---

  describe("Creating a label pointing to a specific version", () => {
    it("creates a label record with the correct name and versionId", async () => {
      const { allVersions } = await createPromptWithVersions({
        handle: `pizza-prompt-${nanoid()}`,
        versionCount: 3,
      });

      const v2 = allVersions[1]!;

      const label = await service.createLabel({
        configId: v2.id,
        name: "custom-release",
        versionId: v2.versionId,
        projectId: testProject.id,
      });

      expect(label.name).toBe("custom-release");
      expect(label.versionId).toBe(v2.versionId);
      expect(label.configId).toBe(v2.id);
    });
  });

  describe("Labels are scoped to their own prompt", () => {
    it("returns different versions for same label name on different prompts", async () => {
      const { allVersions: pizzaVersions } = await createPromptWithVersions({
        handle: `pizza-prompt-${nanoid()}`,
        versionCount: 3,
      });

      const { allVersions: emailVersions } = await createPromptWithVersions({
        handle: `email-prompt-${nanoid()}`,
        versionCount: 5,
      });

      // The built-in "production" labels are already created.
      // Update them to point to specific versions.
      const pizzaV2 = pizzaVersions[1]!;
      await service.updateLabel({
        configId: pizzaV2.id,
        name: "production",
        versionId: pizzaV2.versionId,
        projectId: testProject.id,
      });

      const emailV5 = emailVersions[4]!;
      await service.updateLabel({
        configId: emailV5.id,
        name: "production",
        versionId: emailV5.versionId,
        projectId: testProject.id,
      });

      // Fetch via label
      const pizzaResult = await service.getPromptByIdOrHandle({
        idOrHandle: pizzaV2.id,
        projectId: testProject.id,
        label: "production",
      });

      const emailResult = await service.getPromptByIdOrHandle({
        idOrHandle: emailV5.id,
        projectId: testProject.id,
        label: "production",
      });

      expect(pizzaResult?.version).toBe(2);
      expect(emailResult?.version).toBe(5);
    });
  });

  // --- Built-in Label Lifecycle ---

  describe("Built-in labels are created with a new prompt", () => {
    it("creates production and staging labels pointing to v1", async () => {
      const prompt = await service.createPrompt({
        projectId: testProject.id,
        organizationId: testOrganization.id,
        handle: `new-prompt-${nanoid()}`,
        prompt: "You are a helpful assistant",
        model: "openai/gpt-5",
      });

      const labels = await service.listLabels({
        configId: prompt.id,
        projectId: testProject.id,
      });

      expect(labels).toHaveLength(2);

      const productionLabel = labels.find((l) => l.name === "production");
      const stagingLabel = labels.find((l) => l.name === "staging");

      expect(productionLabel).toBeDefined();
      expect(stagingLabel).toBeDefined();
      expect(productionLabel?.versionId).toBe(prompt.versionId);
      expect(stagingLabel?.versionId).toBe(prompt.versionId);
    });
  });

  // --- Update ---

  describe("Updating a label to point to a different version", () => {
    it("returns the new version when fetching by label", async () => {
      const { allVersions } = await createPromptWithVersions({
        handle: `pizza-prompt-${nanoid()}`,
        versionCount: 3,
      });

      const promptId = allVersions[0]!.id;
      const v3 = allVersions[2]!;

      // Update production to point to v3
      await service.updateLabel({
        configId: promptId,
        name: "production",
        versionId: v3.versionId,
        projectId: testProject.id,
      });

      const result = await service.getPromptByIdOrHandle({
        idOrHandle: promptId,
        projectId: testProject.id,
        label: "production",
      });

      expect(result?.version).toBe(3);
    });
  });

  // --- Fetch by Label (tRPC) ---

  describe("Fetching a prompt via tRPC with a label parameter", () => {
    it("returns the version pointed to by the label", async () => {
      const { allVersions } = await createPromptWithVersions({
        handle: `pizza-prompt-${nanoid()}`,
        versionCount: 3,
      });

      const promptId = allVersions[0]!.id;
      const v2 = allVersions[1]!;
      const v3 = allVersions[2]!;

      // Update production to v2, staging to v3
      await service.updateLabel({
        configId: promptId,
        name: "production",
        versionId: v2.versionId,
        projectId: testProject.id,
      });

      await service.updateLabel({
        configId: promptId,
        name: "staging",
        versionId: v3.versionId,
        projectId: testProject.id,
      });

      const result = await service.getPromptByIdOrHandle({
        idOrHandle: promptId,
        projectId: testProject.id,
        label: "production",
      });

      expect(result?.version).toBe(2);
    });
  });

  // --- CRUD ---

  describe("Listing all labels for a prompt", () => {
    it("returns all labels for the prompt", async () => {
      const { allVersions } = await createPromptWithVersions({
        handle: `pizza-prompt-${nanoid()}`,
        versionCount: 3,
      });

      const promptId = allVersions[0]!.id;
      const v2 = allVersions[1]!;
      const v3 = allVersions[2]!;

      // Update built-in labels
      await service.updateLabel({
        configId: promptId,
        name: "production",
        versionId: v2.versionId,
        projectId: testProject.id,
      });

      await service.updateLabel({
        configId: promptId,
        name: "staging",
        versionId: v3.versionId,
        projectId: testProject.id,
      });

      const labels = await service.listLabels({
        configId: promptId,
        projectId: testProject.id,
      });

      const labelNames = labels.map((l) => l.name);
      expect(labelNames).toContain("production");
      expect(labelNames).toContain("staging");
    });
  });

  describe("Deleting a custom label", () => {
    it("removes the label", async () => {
      const { allVersions } = await createPromptWithVersions({
        handle: `pizza-prompt-${nanoid()}`,
        versionCount: 3,
      });

      const promptId = allVersions[0]!.id;
      const v3 = allVersions[2]!;

      // Create a custom label
      await service.createLabel({
        configId: promptId,
        name: "canary",
        versionId: v3.versionId,
        projectId: testProject.id,
      });

      // Delete it
      await service.deleteLabel({
        configId: promptId,
        name: "canary",
        projectId: testProject.id,
      });

      // Verify it's gone
      const labels = await service.listLabels({
        configId: promptId,
        projectId: testProject.id,
      });
      const canaryLabel = labels.find((l) => l.name === "canary");

      expect(canaryLabel).toBeUndefined();
    });
  });

  // --- Mutual Exclusion ---

  describe("Fetching with both version and label", () => {
    it("rejects when both version and label are provided", async () => {
      const prompt = await service.createPrompt({
        projectId: testProject.id,
        organizationId: testOrganization.id,
        handle: `pizza-prompt-${nanoid()}`,
        prompt: "You are a helpful assistant",
        model: "openai/gpt-5",
      });

      await expect(
        service.getPromptByIdOrHandle({
          idOrHandle: prompt.id,
          projectId: testProject.id,
          version: 1,
          label: "production",
        }),
      ).rejects.toThrow("Cannot specify both 'version'/'versionId' and 'label'");
    });

    it("rejects when both versionId and label are provided", async () => {
      const prompt = await service.createPrompt({
        projectId: testProject.id,
        organizationId: testOrganization.id,
        handle: `pizza-prompt-${nanoid()}`,
        prompt: "You are a helpful assistant",
        model: "openai/gpt-5",
      });

      await expect(
        service.getPromptByIdOrHandle({
          idOrHandle: prompt.id,
          projectId: testProject.id,
          versionId: prompt.versionId,
          label: "production",
        }),
      ).rejects.toThrow("Cannot specify both 'version'/'versionId' and 'label'");
    });
  });

  // --- Error Handling ---

  describe("Fetching with a nonexistent label", () => {
    it("throws a not-found error", async () => {
      const prompt = await service.createPrompt({
        projectId: testProject.id,
        organizationId: testOrganization.id,
        handle: `pizza-prompt-${nanoid()}`,
        prompt: "You are a helpful assistant",
        model: "openai/gpt-5",
      });

      await expect(
        service.getPromptByIdOrHandle({
          idOrHandle: prompt.id,
          projectId: testProject.id,
          label: "canary",
        }),
      ).rejects.toThrow(NotFoundError);

      await expect(
        service.getPromptByIdOrHandle({
          idOrHandle: prompt.id,
          projectId: testProject.id,
          label: "canary",
        }),
      ).rejects.toThrow('Label "canary" not found');
    });
  });
});
