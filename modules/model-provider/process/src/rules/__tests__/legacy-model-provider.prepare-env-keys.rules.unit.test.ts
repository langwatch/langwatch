import { describe, expect, it } from "vitest";

import type { LegacyModelProviderExecution } from "../legacy-model-provider.rules.ts";
import { prepareEnvKeys } from "../legacy-model-provider.rules.ts";

// prepareEnvKeys reads the credential names off the provider's keysSchema. Providers whose
// credentials are valid in more than one combination wrap their object in
// `.superRefine(...)` (openai and anthropic: either an API key or a base URL), which moves
// the zod shape one level down. A shape reader that does not unwrap it returns no keys at
// all and the provider dispatches with no credentials.
describe("prepareEnvKeys", () => {
  // A whole execution row, the shape `prepareEnvKeys` takes, not the editor value.
  const providerRow = (
    provider: string,
    customKeys: Record<string, string>,
  ): LegacyModelProviderExecution => ({
    id: `provider-${provider}`,
    organizationId: "organization-1",
    provider,
    name: provider,
    enabled: true,
    routingHandle: null,
    scopes: [],
    customKeys,
    customModels: [],
    customEmbeddingsModels: [],
    extraHeaders: [],
    rateLimitRpm: null,
    rateLimitTpm: null,
    rateLimitRpd: null,
    fallbackPriorityGlobal: null,
    providerConfig: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    isSystem: false,
    embeddingsUnsupported: false,
  });

  describe("given a provider whose credentials allow either a key or a base URL", () => {
    it("returns the anthropic credentials stored on the row", () => {
      expect(
        prepareEnvKeys({
          modelProvider: providerRow("anthropic", {
            ANTHROPIC_API_KEY: "sk-ant-row",
            ANTHROPIC_BASE_URL: "http://vllm:8000",
          }),
          environment: {},
        }),
      ).toEqual({
        ANTHROPIC_API_KEY: "sk-ant-row",
        ANTHROPIC_BASE_URL: "http://vllm:8000",
      });
    });

    it("returns the openai credentials stored on the row", () => {
      expect(
        prepareEnvKeys({
          modelProvider: providerRow("openai", { OPENAI_API_KEY: "sk-openai-row" }),
          environment: {},
        }),
      ).toEqual({
        OPENAI_API_KEY: "sk-openai-row",
      });
    });
  });

  describe("given a provider with a plain credentials object", () => {
    it("returns the credentials stored on the row", () => {
      expect(
        prepareEnvKeys({
          modelProvider: providerRow("groq", { GROQ_API_KEY: "gsk-row" }),
          environment: {},
        }),
      ).toEqual({
        GROQ_API_KEY: "gsk-row",
      });
    });
  });

  describe("given an unknown provider", () => {
    it("returns no keys", () => {
      expect(
        prepareEnvKeys({ modelProvider: providerRow("not-a-provider", {}), environment: {} }),
      ).toEqual({});
    });
  });
});
