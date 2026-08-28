import { describe, expect, it } from "vitest";
import type { ModelProviderEditorValue as MaybeStoredModelProvider } from "@langwatch/model-provider-contract";
import { prepareEnvKeys } from "../src/adapters/legacy-model-provider.adapter";

// prepareEnvKeys reads the credential names off the provider's keysSchema.
// Providers whose credentials are valid in more than one combination wrap
// their object in `.superRefine(...)` (openai and anthropic: either an API key
// or a base URL), which moves the zod shape one level down. A shape reader
// that does not unwrap it returns no keys at all and the provider dispatches
// with no credentials.
describe("prepareEnvKeys", () => {
  const providerRow = (
    provider: string,
    customKeys: Record<string, string>,
  ): MaybeStoredModelProvider =>
    ({ provider, customKeys }) as unknown as MaybeStoredModelProvider;

  describe("given a provider whose credentials allow either a key or a base URL", () => {
    it("returns the anthropic credentials stored on the row", () => {
      expect(
        prepareEnvKeys(
          providerRow("anthropic", {
            ANTHROPIC_API_KEY: "sk-ant-row",
            ANTHROPIC_BASE_URL: "http://vllm:8000",
          }),
        ),
      ).toEqual({
        ANTHROPIC_API_KEY: "sk-ant-row",
        ANTHROPIC_BASE_URL: "http://vllm:8000",
      });
    });

    it("returns the openai credentials stored on the row", () => {
      expect(
        prepareEnvKeys(providerRow("openai", { OPENAI_API_KEY: "sk-openai-row" })),
      ).toEqual({ OPENAI_API_KEY: "sk-openai-row" });
    });
  });

  describe("given a provider with a plain credentials object", () => {
    it("returns the credentials stored on the row", () => {
      expect(prepareEnvKeys(providerRow("groq", { GROQ_API_KEY: "gsk-row" }))).toEqual({
        GROQ_API_KEY: "gsk-row",
      });
    });
  });

  describe("given an unknown provider", () => {
    it("returns no keys", () => {
      expect(prepareEnvKeys(providerRow("not-a-provider", {}))).toEqual({});
    });
  });
});
