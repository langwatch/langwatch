import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@prisma/client";
import type { ModelProviderService } from "~/server/modelProviders/modelProvider.service";
import type { MaybeStoredModelProvider } from "~/server/modelProviders/registry";
import { ProjectService } from "../project.service";
import type { ProjectRepository } from "../repositories/project.repository";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "proj_test",
    name: "Test Project",
    slug: "test-project",
    apiKey: "test-api-key",
    defaultModel: null,
    embeddingsModel: null,
    language: "en",
    framework: null,
    firstMessage: false,
    integrated: false,
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    teamId: "team_1",
    topicClusteringModel: null,
    s3Bucket: null,
    archivedAt: null,
    ...overrides,
  } as unknown as Project;
}

function makeProvider(
  provider: string,
  enabled: boolean,
): MaybeStoredModelProvider {
  return {
    provider,
    enabled,
    customKeys: null,
    deploymentMapping: null,
    extraHeaders: [],
  } as MaybeStoredModelProvider;
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

function makeRepo(project: Project | null): ProjectRepository {
  return {
    getById: vi.fn().mockResolvedValue(project),
    getWithTeam: vi.fn(),
    updateMetadata: vi.fn(),
    getWithOrgAdmin: vi.fn(),
    searchByQuery: vi.fn(),
  };
}

function makeModelProviderService(
  providers: Record<string, MaybeStoredModelProvider>,
): Pick<ModelProviderService, "getProjectModelProviders"> {
  return {
    getProjectModelProviders: vi.fn().mockResolvedValue(providers),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ProjectService", () => {
  describe("resolveDefaultModel", () => {
    describe("given project.defaultModel is set AND its provider is enabled", () => {
      it("returns project.defaultModel (user override wins)", async () => {
        const project = makeProject({ defaultModel: "openai/gpt-4-turbo" });
        const repo = makeRepo(project);
        const mpService = makeModelProviderService({
          openai: makeProvider("openai", true),
        });

        const service = new ProjectService(
          repo,
          mpService as unknown as ModelProviderService,
        );

        const result = await service.resolveDefaultModel("proj_test");

        expect(result).toBe("openai/gpt-4-turbo");
      });
    });

    describe("given project.defaultModel is set BUT its provider is disabled", () => {
      it("falls through to the first enabled provider's canonical default", async () => {
        const project = makeProject({
          defaultModel: "anthropic/claude-3-opus",
        });
        const repo = makeRepo(project);
        // anthropic is disabled; openai is enabled
        const mpService = makeModelProviderService({
          anthropic: makeProvider("anthropic", false),
          openai: makeProvider("openai", true),
        });

        const service = new ProjectService(
          repo,
          mpService as unknown as ModelProviderService,
        );

        const result = await service.resolveDefaultModel("proj_test");

        // Falls through to openai's canonical default
        expect(result).toBe("openai/gpt-5.2");
      });
    });

    describe("given project.defaultModel is null", () => {
      it("returns first usable provider's canonical default when enabled", async () => {
        const project = makeProject({ defaultModel: null });
        const repo = makeRepo(project);
        const mpService = makeModelProviderService({
          openai: makeProvider("openai", true),
        });

        const service = new ProjectService(
          repo,
          mpService as unknown as ModelProviderService,
        );

        const result = await service.resolveDefaultModel("proj_test");

        expect(result).toBe("openai/gpt-5.2");
      });

      it("skips providers with no entry in PROVIDER_DEFAULT_MODELS (e.g. bedrock) and returns next match", async () => {
        const project = makeProject({ defaultModel: null });
        const repo = makeRepo(project);
        // Only bedrock is enabled — has no canonical default
        const mpService = makeModelProviderService({
          bedrock: makeProvider("bedrock", true),
        });

        const service = new ProjectService(
          repo,
          mpService as unknown as ModelProviderService,
        );

        const result = await service.resolveDefaultModel("proj_test");

        // bedrock has no entry in PROVIDER_DEFAULT_MODELS → falls through to null
        expect(result).toBeNull();
      });

      it("skips bedrock and returns anthropic when both are enabled", async () => {
        const project = makeProject({ defaultModel: null });
        const repo = makeRepo(project);
        const mpService = makeModelProviderService({
          bedrock: makeProvider("bedrock", true),
          anthropic: makeProvider("anthropic", true),
        });

        const service = new ProjectService(
          repo,
          mpService as unknown as ModelProviderService,
        );

        const result = await service.resolveDefaultModel("proj_test");

        // anthropic appears before bedrock in PROVIDER_RESOLUTION_ORDER
        expect(result).toBe("anthropic/claude-sonnet-4-5");
      });
    });

    describe("given no usable providers are available", () => {
      it("returns null", async () => {
        const project = makeProject({ defaultModel: null });
        const repo = makeRepo(project);
        const mpService = makeModelProviderService({
          openai: makeProvider("openai", false),
          anthropic: makeProvider("anthropic", false),
        });

        const service = new ProjectService(
          repo,
          mpService as unknown as ModelProviderService,
        );

        const result = await service.resolveDefaultModel("proj_test");

        expect(result).toBeNull();
      });
    });

    describe("given project does not exist", () => {
      it("returns null", async () => {
        const repo = makeRepo(null);
        const mpService = makeModelProviderService({});

        const service = new ProjectService(
          repo,
          mpService as unknown as ModelProviderService,
        );

        const result = await service.resolveDefaultModel("proj_missing");

        expect(result).toBeNull();
      });
    });

    describe("given no modelProviderService is injected (null preset)", () => {
      it("returns null without throwing", async () => {
        const repo = makeRepo(makeProject());

        const service = new ProjectService(repo);

        const result = await service.resolveDefaultModel("proj_test");

        expect(result).toBeNull();
      });
    });
  });
});
