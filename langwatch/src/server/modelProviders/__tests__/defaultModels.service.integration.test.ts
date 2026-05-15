/**
 * @vitest-environment node
 *
 * Integration tests for DefaultModelsService — verifies the project → team →
 * organization → constant resolution order against a real database and that
 * writes route to the correct table per scope.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DefaultModelsService } from "../defaultModels.service";
import { prisma } from "../../db";
import { getTestProject } from "../../../utils/testUtils";

const namespace = "default-models-hier";

describe("DefaultModelsService Integration", () => {
  let projectId: string;
  let teamId: string;
  let organizationId: string;
  const service = DefaultModelsService.create(prisma);

  beforeAll(async () => {
    const project = await getTestProject(namespace);
    projectId = project.id;
    teamId = project.teamId;
    const team = await prisma.team.findUniqueOrThrow({
      where: { id: teamId },
      select: { organizationId: true },
    });
    organizationId = team.organizationId;
  });

  afterAll(async () => {
    // Reset to a clean slate so re-runs don't see stale state.
    await prisma.project.update({
      where: { id: projectId },
      data: {
        defaultModel: null,
        topicClusteringModel: null,
        embeddingsModel: null,
      },
    });
    await prisma.team.update({
      where: { id: teamId },
      data: {
        defaultModel: null,
        topicClusteringModel: null,
        embeddingsModel: null,
      },
    });
    await prisma.organization.update({
      where: { id: organizationId },
      data: {
        defaultModel: null,
        topicClusteringModel: null,
        embeddingsModel: null,
      },
    });
  });

  describe("given a clean scope tree (no defaults set anywhere)", () => {
    /** @scenario Setting an org-level default applies to every project in that organization */
    it("an org-level default flows down to a project with no overrides", async () => {
      await service.setForScope({
        scopeType: "ORGANIZATION",
        scopeId: organizationId,
        values: { defaultModel: "openai/gpt-5.5" },
      });
      // Clear team + project to make the inheritance assertion unambiguous.
      await service.setForScope({
        scopeType: "TEAM",
        scopeId: teamId,
        values: {
          defaultModel: null,
          topicClusteringModel: null,
          embeddingsModel: null,
        },
      });
      await service.setForScope({
        scopeType: "PROJECT",
        scopeId: projectId,
        values: {
          defaultModel: null,
          topicClusteringModel: null,
          embeddingsModel: null,
        },
      });

      const resolved = await service.getForProject(projectId);
      expect(resolved.effective.defaultModel.value).toBe("openai/gpt-5.5");
      expect(resolved.effective.defaultModel.source).toBe("organization");
    });
  });

  describe("given a project-level override", () => {
    /** @scenario Project-level default overrides the org default for that project only */
    it("the project value wins over both team and org", async () => {
      await service.setForScope({
        scopeType: "ORGANIZATION",
        scopeId: organizationId,
        values: { defaultModel: "openai/gpt-5.5" },
      });
      await service.setForScope({
        scopeType: "TEAM",
        scopeId: teamId,
        values: { defaultModel: "openai/gpt-4o" },
      });
      await service.setForScope({
        scopeType: "PROJECT",
        scopeId: projectId,
        values: { defaultModel: "anthropic/claude-sonnet-4-6" },
      });

      const resolved = await service.getForProject(projectId);
      expect(resolved.effective.defaultModel.value).toBe(
        "anthropic/claude-sonnet-4-6",
      );
      expect(resolved.effective.defaultModel.source).toBe("project");
    });
  });

  describe("given a team default and no project override", () => {
    /** @scenario Team default sits between org and project in the resolution order */
    it("the team value beats the org when the project field is null", async () => {
      await service.setForScope({
        scopeType: "ORGANIZATION",
        scopeId: organizationId,
        values: { defaultModel: "openai/gpt-5.5" },
      });
      await service.setForScope({
        scopeType: "TEAM",
        scopeId: teamId,
        values: { defaultModel: "openai/gpt-4o" },
      });
      await service.setForScope({
        scopeType: "PROJECT",
        scopeId: projectId,
        values: { defaultModel: null },
      });

      const resolved = await service.getForProject(projectId);
      expect(resolved.effective.defaultModel.value).toBe("openai/gpt-4o");
      expect(resolved.effective.defaultModel.source).toBe("team");
    });
  });

  describe("clearing a scope", () => {
    /** @scenario Clearing a scope falls back to the next level up */
    it("clearing the project default restores inheritance from the team", async () => {
      // Set up: org=A, team=B, project=C
      await service.setForScope({
        scopeType: "ORGANIZATION",
        scopeId: organizationId,
        values: { defaultModel: "openai/gpt-5.5" },
      });
      await service.setForScope({
        scopeType: "TEAM",
        scopeId: teamId,
        values: { defaultModel: "openai/gpt-4o" },
      });
      await service.setForScope({
        scopeType: "PROJECT",
        scopeId: projectId,
        values: { defaultModel: "anthropic/claude-sonnet-4-6" },
      });

      // Clear the project override.
      await service.setForScope({
        scopeType: "PROJECT",
        scopeId: projectId,
        values: { defaultModel: null },
      });

      const resolved = await service.getForProject(projectId);
      expect(resolved.effective.defaultModel.value).toBe("openai/gpt-4o");
      expect(resolved.effective.defaultModel.source).toBe("team");
    });
  });
});
