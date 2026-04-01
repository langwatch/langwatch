import type { Organization, Project, Team } from "@prisma/client";
import { nanoid } from "nanoid";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import { projectFactory } from "~/factories/project.factory";
import { PromptService } from "../prompt.service";

describe("Feature: Prompt version labels", () => {
  let testOrganization: Organization;
  let testTeam: Team;
  let testProject: Project;
  let otherProject: Project;
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

    otherProject = await prisma.project.create({
      data: {
        ...projectFactory.build({ slug: nanoid() }),
        teamId: testTeam.id,
      },
    });

    service = new PromptService(prisma);
  });

  afterEach(async () => {
    // Clean up labels/versions/configs for both projects
    await prisma.promptVersionLabel.deleteMany({
      where: { projectId: { in: [testProject.id, otherProject.id] } },
    });
    await prisma.llmPromptConfigVersion.deleteMany({
      where: { projectId: { in: [testProject.id, otherProject.id] } },
    });
    await prisma.llmPromptConfig.deleteMany({
      where: { projectId: { in: [testProject.id, otherProject.id] } },
    });
    await prisma.project.deleteMany({
      where: { id: { in: [testProject.id, otherProject.id] } },
    });
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

    const latest = versions[versions.length - 1];
    if (!latest) throw new Error("test setup failed: no versions created");

    return { prompt: latest, allVersions: versions };
  }

  describe("when assigning a label to a specific version", () => {
    it("creates a PromptVersionLabel record with configId, label, and versionId", async () => {
      const { allVersions } = await createPromptWithVersions({
        handle: `pizza-prompt-${nanoid()}`,
        versionCount: 3,
      });

      const firstVersion = allVersions[0];
      if (!firstVersion) throw new Error("test setup failed: missing version 0");
      const configId = firstVersion.id;
      const v2 = allVersions[1];
      if (!v2) throw new Error("test setup failed: missing version 1");

      const label = await service.assignTag({
        configId,
        versionId: v2.versionId,
        label: "production",
        projectId: testProject.id,
      });

      expect(label.label).toBe("production");
      expect(label.versionId).toBe(v2.versionId);
      expect(label.configId).toBe(configId);
    });
  });

  describe("when reassigning a label to a different version", () => {
    it("returns the new version when fetching by label", async () => {
      const { allVersions } = await createPromptWithVersions({
        handle: `pizza-prompt-${nanoid()}`,
        versionCount: 3,
      });

      const firstVersion = allVersions[0];
      if (!firstVersion) throw new Error("test setup failed: missing version 0");
      const configId = firstVersion.id;
      const v2 = allVersions[1];
      if (!v2) throw new Error("test setup failed: missing version 1");
      const v3 = allVersions[2];
      if (!v3) throw new Error("test setup failed: missing version 2");

      await service.assignTag({
        configId,
        versionId: v2.versionId,
        label: "production",
        projectId: testProject.id,
      });

      await service.assignTag({
        configId,
        versionId: v3.versionId,
        label: "production",
        projectId: testProject.id,
      });

      const result = await service.getPromptByIdOrHandle({
        idOrHandle: configId,
        projectId: testProject.id,
        label: "production",
      });

      expect(result?.version).toBe(3);
    });
  });

  describe("when two prompts each have the same label name", () => {
    it("returns the correct version for each prompt independently", async () => {
      const { allVersions: pizzaVersions } = await createPromptWithVersions({
        handle: `pizza-prompt-${nanoid()}`,
        versionCount: 3,
      });

      const { allVersions: emailVersions } = await createPromptWithVersions({
        handle: `email-prompt-${nanoid()}`,
        versionCount: 5,
      });

      const pizzaFirst = pizzaVersions[0];
      if (!pizzaFirst) throw new Error("test setup failed: missing pizza version 0");
      const pizzaConfigId = pizzaFirst.id;
      const pizzaV2 = pizzaVersions[1];
      if (!pizzaV2) throw new Error("test setup failed: missing pizza version 1");
      const emailFirst = emailVersions[0];
      if (!emailFirst) throw new Error("test setup failed: missing email version 0");
      const emailConfigId = emailFirst.id;
      const emailV5 = emailVersions[4];
      if (!emailV5) throw new Error("test setup failed: missing email version 4");

      await service.assignTag({
        configId: pizzaConfigId,
        versionId: pizzaV2.versionId,
        label: "production",
        projectId: testProject.id,
      });

      await service.assignTag({
        configId: emailConfigId,
        versionId: emailV5.versionId,
        label: "production",
        projectId: testProject.id,
      });

      const pizzaResult = await service.getPromptByIdOrHandle({
        idOrHandle: pizzaConfigId,
        projectId: testProject.id,
        label: "production",
      });

      const emailResult = await service.getPromptByIdOrHandle({
        idOrHandle: emailConfigId,
        projectId: testProject.id,
        label: "production",
      });

      expect(pizzaResult?.version).toBe(2);
      expect(emailResult?.version).toBe(5);
    });
  });

  describe("when fetching a prompt via service with a label parameter", () => {
    it("returns the version pointed to by the label", async () => {
      const { allVersions } = await createPromptWithVersions({
        handle: `pizza-prompt-${nanoid()}`,
        versionCount: 3,
      });

      const firstVersion = allVersions[0];
      if (!firstVersion) throw new Error("test setup failed: missing version 0");
      const configId = firstVersion.id;
      const v2 = allVersions[1];
      if (!v2) throw new Error("test setup failed: missing version 1");
      const v3 = allVersions[2];
      if (!v3) throw new Error("test setup failed: missing version 2");

      await service.assignTag({
        configId,
        versionId: v2.versionId,
        label: "production",
        projectId: testProject.id,
      });

      await service.assignTag({
        configId,
        versionId: v3.versionId,
        label: "staging",
        projectId: testProject.id,
      });

      const result = await service.getPromptByIdOrHandle({
        idOrHandle: configId,
        projectId: testProject.id,
        label: "production",
      });

      expect(result?.version).toBe(2);
    });
  });

  describe("when fetching with both version and label", () => {
    it("rejects with a validation error for version + label", async () => {
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

    it("rejects with a validation error for versionId + label", async () => {
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

  describe("when fetching with an unassigned label", () => {
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
          label: "production",
        }),
      ).rejects.toThrow(
        expect.objectContaining({
          name: "NotFoundError",
          message: expect.stringContaining('Label "production" not found'),
        }),
      );
    });
  });

  describe("when assigning a label to an organization-scoped prompt", () => {
    it("succeeds even when the requesting project differs from the config project", async () => {
      // Create an org-scoped prompt owned by testProject
      const prompt = await service.createPrompt({
        projectId: testProject.id,
        organizationId: testOrganization.id,
        handle: `org-prompt-${nanoid()}`,
        prompt: "You are an org-wide assistant",
        model: "openai/gpt-5-mini",
        scope: "ORGANIZATION",
      });

      // Simulate the API handler scenario: the auth context project (otherProject)
      // differs from the config's actual projectId (testProject).
      // The bug was passing project.id (otherProject) instead of config.projectId (testProject).
      const label = await service.assignTag({
        configId: prompt.id,
        versionId: prompt.versionId,
        label: "production",
        projectId: prompt.projectId, // correct: use the config's own projectId
      });

      expect(label.label).toBe("production");
      expect(label.versionId).toBe(prompt.versionId);
      expect(label.configId).toBe(prompt.id);

      // Verify the label is NOT found when using the wrong projectId
      // (this is what the bug caused — using project.id from auth context)
      await expect(
        service.assignTag({
          configId: prompt.id,
          versionId: prompt.versionId,
          label: "staging",
          projectId: otherProject.id, // wrong: different project than the config's
        }),
      ).rejects.toThrow("Version does not belong to this prompt config");
    });
  });
});
