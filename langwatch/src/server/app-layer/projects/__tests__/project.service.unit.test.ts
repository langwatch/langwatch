import { describe, expect, it, vi } from "vitest";
import type { ModelProviderService } from "~/server/modelProviders/modelProvider.service";
import type { MaybeStoredModelProvider } from "~/server/modelProviders/registry";
import { ProjectService } from "../project.service";
import { NullProjectRepository } from "../repositories/project.repository";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    describe("given openai is the only enabled provider", () => {
      it("returns openai canonical default", async () => {
        const mpService = makeModelProviderService({
          openai: makeProvider("openai", true),
        });

        const service = new ProjectService(
          new NullProjectRepository(),
          mpService as unknown as ModelProviderService,
        );

        const result = await service.resolveDefaultModel("proj_test");

        expect(result).toBe("openai/latest");
      });
    });

    describe("given only bedrock is enabled (no canonical default in PROVIDER_DEFAULT_MODELS)", () => {
      it("returns null", async () => {
        const mpService = makeModelProviderService({
          bedrock: makeProvider("bedrock", true),
        });

        const service = new ProjectService(
          new NullProjectRepository(),
          mpService as unknown as ModelProviderService,
        );

        const result = await service.resolveDefaultModel("proj_test");

        expect(result).toBeNull();
      });
    });

    describe("given bedrock and anthropic are both enabled", () => {
      it("returns anthropic (higher priority in PROVIDER_RESOLUTION_ORDER)", async () => {
        const mpService = makeModelProviderService({
          bedrock: makeProvider("bedrock", true),
          anthropic: makeProvider("anthropic", true),
        });

        const service = new ProjectService(
          new NullProjectRepository(),
          mpService as unknown as ModelProviderService,
        );

        const result = await service.resolveDefaultModel("proj_test");

        // bedrock is not a member of PROVIDER_RESOLUTION_ORDER so it is never
        // iterated; anthropic is the only candidate evaluated here.
        expect(result).toBe("anthropic/latest");
      });
    });

    describe("given all providers are disabled", () => {
      it("returns null", async () => {
        const mpService = makeModelProviderService({
          openai: makeProvider("openai", false),
          anthropic: makeProvider("anthropic", false),
        });

        const service = new ProjectService(
          new NullProjectRepository(),
          mpService as unknown as ModelProviderService,
        );

        const result = await service.resolveDefaultModel("proj_test");

        expect(result).toBeNull();
      });
    });

    describe("given no modelProviderService is injected (null preset)", () => {
      it("returns null without throwing", async () => {
        const service = new ProjectService(new NullProjectRepository());

        const result = await service.resolveDefaultModel("proj_test");

        expect(result).toBeNull();
      });
    });
  });
});
