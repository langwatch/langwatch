/**
 * Doubleword is credentialed with an API key only, and its catalog ids carry
 * the vendor's own slash. The config assembly is where both leave the control
 * plane for the gateway. Covers specs/model-providers/doubleword-provider.feature.
 */

import type { ModelProvider } from "@langwatch/gateway-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { PrismaGatewayScopeResolutionRepository } from "../repositories/prisma/prisma.gateway-scope-resolution.repository.ts";
import type { GatewayModelProviderCredentials } from "../rules/gateway-config-wire.rules.ts";
import { GatewayConfigAssemblyService } from "../services/gateway-config-assembly.service.ts";

const assembly = GatewayConfigAssemblyService.create({
  repository: PrismaGatewayScopeResolutionRepository.create({ database: {} as never }),
  platformProviders: createApiFixture<ModelProviderApi>({
    platformProviderChain: () => Promise.resolve([]),
  }),
  projects: createApiFixture<ProjectApi>(),
});

const credentialsPort: GatewayModelProviderCredentials = {
  readCustomKeys: (stored: unknown) => stored as Record<string, unknown>,
};

const doublewordRow = (customKeys: Record<string, string>): ModelProvider =>
  ({ id: "mp_doubleword", provider: "doubleword", customKeys }) as unknown as ModelProvider;

describe("buildCredentials for doubleword", () => {
  describe("given a credential saved with an API key", () => {
    /** @scenario A Doubleword credential reaches the gateway with its API key */
    it("carries the API key", () => {
      const credentials = assembly.buildCredentials(
        doublewordRow({ DOUBLEWORD_API_KEY: "sk-dw-test" }),
        credentialsPort,
      );

      expect(credentials).toEqual({ api_key: "sk-dw-test" });
    });
  });
});

describe("findDeclaredModelsForProvider", () => {
  describe("when the provider is Doubleword", () => {
    /** @scenario The gateway knows which models a Doubleword key serves */
    it("declares its catalog models with the vendor slash kept", () => {
      const declared = assembly.findDeclaredModelsForProvider({
        provider: "doubleword",
        customModels: null,
        customEmbeddingsModels: null,
      });

      expect(declared).toContain("deepseek-ai/DeepSeek-V4.1-Flash");
      expect(declared).toContain("Qwen/Qwen3-Embedding-8B");
      expect(declared.some((id) => id.startsWith("doubleword/"))).toBe(false);
    });
  });
});
