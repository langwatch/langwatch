import type { Project } from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import {
  DEFAULT_EMBEDDINGS_MODEL,
  DEFAULT_MODEL,
  DEFAULT_TOPIC_CLUSTERING_MODEL,
} from "~/utils/constants";
import { getTestProject } from "~/utils/testUtils";
import { ProjectRepository } from "../project.repository";

/**
 * Integration tests for ProjectRepository with real database.
 * Tests actual database behavior with resolved defaults.
 */
describe("ProjectRepository Integration", () => {
  let repository: ProjectRepository;
  let testProject: Project;
  const createdProjectIds: string[] = [];

  beforeAll(async () => {
    repository = new ProjectRepository(prisma);
    testProject = await getTestProject("project-repo-integration");
  });

  afterAll(async () => {
    // Clean up created projects
    for (const projectId of createdProjectIds) {
      try {
        await prisma.project.delete({
          where: { id: projectId },
        });
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  describe("getProjectConfig", () => {
    it("returns project config for existing project", async () => {
      const result = await repository.getProjectConfig(testProject.id);

      expect(result).not.toBeNull();
      expect(result?.id).toBe(testProject.id);
      expect(result?.name).toBe(testProject.name);
      expect(result?.slug).toBe(testProject.slug);
      expect(result?.apiKey).toBe(testProject.apiKey);
      expect(result?.teamId).toBe(testProject.teamId);
    });

    it("returns null for non-existent project", async () => {
      const result = await repository.getProjectConfig("non-existent-id");

      expect(result).toBeNull();
    });

    it("resolves defaultModel to DEFAULT_MODEL when null", async () => {
      // Test project from getTestProject has null defaultModel
      const result = await repository.getProjectConfig(testProject.id);

      expect(result?.defaultModel).toBe(DEFAULT_MODEL);
    });

    it("resolves embeddingsModel to DEFAULT_EMBEDDINGS_MODEL when null", async () => {
      const result = await repository.getProjectConfig(testProject.id);

      expect(result?.embeddingsModel).toBe(DEFAULT_EMBEDDINGS_MODEL);
    });

    it("resolves topicClusteringModel to DEFAULT_TOPIC_CLUSTERING_MODEL when null", async () => {
      const result = await repository.getProjectConfig(testProject.id);

      expect(result?.topicClusteringModel).toBe(DEFAULT_TOPIC_CLUSTERING_MODEL);
    });

    it("uses custom model values when set", async () => {
      // Create a project with custom model values
      const projectId = `test-project-${nanoid()}`;
      const customProject = await prisma.project.create({
        data: {
          id: projectId,
          name: "Custom Model Project",
          slug: `--custom-model-project-${nanoid()}`,
          apiKey: `test-api-key-${nanoid()}`,
          teamId: testProject.teamId,
          language: "python",
          framework: "langchain",
          defaultModel: "anthropic/claude-3-opus",
          embeddingsModel: "openai/text-embedding-3-large",
          topicClusteringModel: "openai/gpt-4-turbo",
        },
      });
      createdProjectIds.push(customProject.id);

      const result = await repository.getProjectConfig(projectId);

      expect(result?.defaultModel).toBe("anthropic/claude-3-opus");
      expect(result?.embeddingsModel).toBe("openai/text-embedding-3-large");
      expect(result?.topicClusteringModel).toBe("openai/gpt-4-turbo");
    });

    it("includes all required project fields", async () => {
      const result = await repository.getProjectConfig(testProject.id);

      // Verify all fields from ProjectConfig interface are present
      expect(result).toMatchObject({
        id: expect.any(String),
        name: expect.any(String),
        slug: expect.any(String),
        apiKey: expect.any(String),
        teamId: expect.any(String),
        language: expect.any(String),
        framework: expect.any(String),
        defaultModel: expect.any(String),
        embeddingsModel: expect.any(String),
        topicClusteringModel: expect.any(String),
        piiRedactionLevel: expect.any(String),
        capturedInputVisibility: expect.any(String),
        capturedOutputVisibility: expect.any(String),
        traceSharingEnabled: expect.any(Boolean),
        firstMessage: expect.any(Boolean),
        integrated: expect.any(Boolean),
      });
    });

    it("handles project with userLinkTemplate", async () => {
      const projectId = `test-project-${nanoid()}`;
      const projectWithTemplate = await prisma.project.create({
        data: {
          id: projectId,
          name: "Template Project",
          slug: `--template-project-${nanoid()}`,
          apiKey: `test-api-key-${nanoid()}`,
          teamId: testProject.teamId,
          language: "python",
          framework: "openai",
          userLinkTemplate: "https://example.com/users/{{userId}}",
        },
      });
      createdProjectIds.push(projectWithTemplate.id);

      const result = await repository.getProjectConfig(projectId);

      expect(result?.userLinkTemplate).toBe(
        "https://example.com/users/{{userId}}",
      );
    });

    it("returns null userLinkTemplate when not set", async () => {
      const result = await repository.getProjectConfig(testProject.id);

      expect(result?.userLinkTemplate).toBeNull();
    });
  });
});
