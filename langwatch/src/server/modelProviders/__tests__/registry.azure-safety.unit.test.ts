/**
 * Unit tests for the azure_safety provider definition.
 *
 * Covers @integration scenarios from specs/model-providers/azure-safety-provider.feature:
 * - "Azure Safety appears in the Add Model Provider list"
 * - "Azure Safety validates endpoint is a URL"
 * - "Azure Safety validates subscription key is non-empty"
 *
 * The azure_safety provider is a non-LLM provider; its registry entry must use
 * `type: "safety"` so the form can hide LLM-only sections (Custom Models,
 * Default Model, API Gateway).
 */
import { describe, expect, it } from "vitest";
import { modelProviders } from "../registry";

describe("Feature: azure_safety model provider registry entry", () => {
  describe("given the registry is imported", () => {
    describe("when accessing the azure_safety entry", () => {
      const entry = modelProviders.azure_safety;

      it("exposes the azure_safety provider", () => {
        expect(entry).toBeDefined();
      });

      it("names the provider Azure Safety", () => {
        expect(entry.name).toBe("Azure Safety");
      });

      it("marks the provider as type safety", () => {
        expect(entry.type).toBe("safety");
      });

      it("uses AZURE_CONTENT_SAFETY_KEY as the apiKey field", () => {
        expect(entry.apiKey).toBe("AZURE_CONTENT_SAFETY_KEY");
      });

      it("uses AZURE_CONTENT_SAFETY_ENDPOINT as the endpointKey field", () => {
        expect(entry.endpointKey).toBe("AZURE_CONTENT_SAFETY_ENDPOINT");
      });

      it("declares a blurb describing content safety coverage", () => {
        expect(entry.blurb).toBeDefined();
        expect(entry.blurb).toMatch(/content moderation/i);
        expect(entry.blurb).toMatch(/prompt injection/i);
        expect(entry.blurb).toMatch(/jailbreak/i);
      });
    });
  });

  describe("given the azure_safety keysSchema", () => {
    const schema = modelProviders.azure_safety.keysSchema;

    describe("when validating a valid endpoint URL and non-empty key", () => {
      it("passes validation", () => {
        const result = schema.safeParse({
          AZURE_CONTENT_SAFETY_ENDPOINT:
            "https://my-account.cognitiveservices.azure.com/",
          AZURE_CONTENT_SAFETY_KEY: "my-subscription-key",
        });
        expect(result.success).toBe(true);
      });
    });

    describe("when the endpoint is not a URL", () => {
      it("fails validation", () => {
        const result = schema.safeParse({
          AZURE_CONTENT_SAFETY_ENDPOINT: "not-a-url",
          AZURE_CONTENT_SAFETY_KEY: "key",
        });
        expect(result.success).toBe(false);
      });
    });

    describe("when the subscription key is missing", () => {
      it("fails validation", () => {
        const result = schema.safeParse({
          AZURE_CONTENT_SAFETY_ENDPOINT:
            "https://my-account.cognitiveservices.azure.com/",
        });
        expect(result.success).toBe(false);
      });
    });

    describe("when the subscription key is empty string", () => {
      it("fails validation", () => {
        const result = schema.safeParse({
          AZURE_CONTENT_SAFETY_ENDPOINT:
            "https://my-account.cognitiveservices.azure.com/",
          AZURE_CONTENT_SAFETY_KEY: "",
        });
        expect(result.success).toBe(false);
      });
    });

    describe("when the endpoint is missing", () => {
      it("fails validation", () => {
        const result = schema.safeParse({
          AZURE_CONTENT_SAFETY_KEY: "key",
        });
        expect(result.success).toBe(false);
      });
    });
  });

  describe("given the broader registry", () => {
    describe("when checking existing LLM providers", () => {
      it("marks openai as type llm", () => {
        expect(modelProviders.openai.type).toBe("llm");
      });

      it("marks anthropic as type llm", () => {
        expect(modelProviders.anthropic.type).toBe("llm");
      });

      it("marks azure as type llm", () => {
        expect(modelProviders.azure.type).toBe("llm");
      });

      it("marks every entry with a type field", () => {
        for (const [key, provider] of Object.entries(modelProviders)) {
          expect(
            (provider as { type?: "llm" | "safety" }).type,
            `provider ${key} should have a type`,
          ).toMatch(/^(llm|safety)$/);
        }
      });
    });
  });
});
