import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MODEL, DEFAULT_EMBEDDINGS_MODEL, DEFAULT_TOPIC_CLUSTERING_MODEL } from "~/utils/constants";
import { ProjectRepository } from "../project.repository";

describe("ProjectRepository", () => {
  let prisma: PrismaClient;
  let repository: ProjectRepository;

  beforeEach(() => {
    prisma = {
      project: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    } as unknown as PrismaClient;
    repository = new ProjectRepository(prisma);
  });

  describe("getProjectConfig", () => {
    it("returns null when project not found", async () => {
      prisma.project.findUnique = vi.fn().mockResolvedValue(null);

      const result = await repository.getProjectConfig("non-existent-id");

      expect(result).toBeNull();
      expect(prisma.project.findUnique).toHaveBeenCalledWith({
        where: { id: "non-existent-id" },
      });
    });

    describe("default resolution", () => {
      it("uses DEFAULT_MODEL when project.defaultModel is null", async () => {
        prisma.project.findUnique = vi.fn().mockResolvedValue({
          id: "project-1",
          apiKey: "lw_api_key",
          defaultModel: null,
          embeddingsModel: null,
          topicClusteringModel: null,
        });

        const result = await repository.getProjectConfig("project-1");

        expect(result?.defaultModel).toBe(DEFAULT_MODEL);
      });

      it("uses project.defaultModel when set", async () => {
        prisma.project.findUnique = vi.fn().mockResolvedValue({
          id: "project-1",
          apiKey: "lw_api_key",
          defaultModel: "anthropic/claude-3-opus",
          embeddingsModel: null,
          topicClusteringModel: null,
        });

        const result = await repository.getProjectConfig("project-1");

        expect(result?.defaultModel).toBe("anthropic/claude-3-opus");
      });

      it("uses DEFAULT_EMBEDDINGS_MODEL when project.embeddingsModel is null", async () => {
        prisma.project.findUnique = vi.fn().mockResolvedValue({
          id: "project-1",
          apiKey: "lw_api_key",
          defaultModel: null,
          embeddingsModel: null,
          topicClusteringModel: null,
        });

        const result = await repository.getProjectConfig("project-1");

        expect(result?.embeddingsModel).toBe(DEFAULT_EMBEDDINGS_MODEL);
      });

      it("uses project.embeddingsModel when set", async () => {
        prisma.project.findUnique = vi.fn().mockResolvedValue({
          id: "project-1",
          apiKey: "lw_api_key",
          defaultModel: null,
          embeddingsModel: "openai/text-embedding-ada-002",
          topicClusteringModel: null,
        });

        const result = await repository.getProjectConfig("project-1");

        expect(result?.embeddingsModel).toBe("openai/text-embedding-ada-002");
      });

      it("uses DEFAULT_TOPIC_CLUSTERING_MODEL when project.topicClusteringModel is null", async () => {
        prisma.project.findUnique = vi.fn().mockResolvedValue({
          id: "project-1",
          apiKey: "lw_api_key",
          defaultModel: null,
          embeddingsModel: null,
          topicClusteringModel: null,
        });

        const result = await repository.getProjectConfig("project-1");

        expect(result?.topicClusteringModel).toBe(DEFAULT_TOPIC_CLUSTERING_MODEL);
      });

      it("uses project.topicClusteringModel when set", async () => {
        prisma.project.findUnique = vi.fn().mockResolvedValue({
          id: "project-1",
          apiKey: "lw_api_key",
          defaultModel: null,
          embeddingsModel: null,
          topicClusteringModel: "anthropic/claude-3-haiku",
        });

        const result = await repository.getProjectConfig("project-1");

        expect(result?.topicClusteringModel).toBe("anthropic/claude-3-haiku");
      });
    });

    describe("returns all project fields", () => {
      it("includes id and apiKey from project", async () => {
        prisma.project.findUnique = vi.fn().mockResolvedValue({
          id: "project-1",
          name: "Test Project",
          slug: "test-project",
          apiKey: "lw_api_key_123",
          teamId: "team-1",
          defaultModel: "openai/gpt-4",
          embeddingsModel: "openai/text-embedding-3-small",
          topicClusteringModel: "openai/gpt-4",
          language: "typescript",
          framework: "nextjs",
          piiRedactionLevel: "ESSENTIAL",
          capturedInputVisibility: "VISIBLE_TO_ALL",
          capturedOutputVisibility: "VISIBLE_TO_ALL",
          traceSharingEnabled: true,
        });

        const result = await repository.getProjectConfig("project-1");

        expect(result?.id).toBe("project-1");
        expect(result?.name).toBe("Test Project");
        expect(result?.slug).toBe("test-project");
        expect(result?.apiKey).toBe("lw_api_key_123");
        expect(result?.teamId).toBe("team-1");
        expect(result?.language).toBe("typescript");
        expect(result?.framework).toBe("nextjs");
      });
    });
  });
});
