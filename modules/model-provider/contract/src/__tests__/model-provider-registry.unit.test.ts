import { describe, expect, it } from "vitest";

import { modelProviders } from "../model-provider-registry.ts";

describe("Model Provider registry", () => {
  /** @scenario "Azure Safety appears in the Add Model Provider list" */
  /** @scenario "Azure Safety form only shows credentials and extra headers" */
  it("defines Azure Safety as a non-LLM provider with its supported credentials", () => {
    const provider = modelProviders.azure_safety;

    expect(provider).toMatchObject({
      name: "Azure Safety",
      type: "safety",
      apiKey: "AZURE_CONTENT_SAFETY_KEY",
      endpointKey: "AZURE_CONTENT_SAFETY_ENDPOINT",
    });
    expect(provider.blurb).toMatch(/content moderation/i);
    expect(provider.blurb).toMatch(/prompt injection/i);
    expect(provider.blurb).toMatch(/jailbreak/i);
  });

  /** @scenario "Azure Safety validates endpoint is a URL" */
  /** @scenario "Azure Safety validates subscription key is non-empty" */
  it("validates the Azure Safety endpoint and subscription key", () => {
    const schema = modelProviders.azure_safety.keysSchema;

    expect(
      schema.validate({
        AZURE_CONTENT_SAFETY_ENDPOINT: "https://my-account.cognitiveservices.azure.com/",
        AZURE_CONTENT_SAFETY_KEY: "my-subscription-key",
      }),
    ).toBe(true);
    expect(
      schema.validate({
        AZURE_CONTENT_SAFETY_ENDPOINT: "not-a-url",
        AZURE_CONTENT_SAFETY_KEY: "key",
      }),
    ).toBe(false);
    expect(
      schema.validate({
        AZURE_CONTENT_SAFETY_ENDPOINT: "https://my-account.cognitiveservices.azure.com/",
      }),
    ).toBe(false);
    expect(
      schema.validate({
        AZURE_CONTENT_SAFETY_ENDPOINT: "https://my-account.cognitiveservices.azure.com/",
        AZURE_CONTENT_SAFETY_KEY: "",
      }),
    ).toBe(false);
    expect(schema.validate({ AZURE_CONTENT_SAFETY_KEY: "key" })).toBe(false);
  });

  it("classifies every registered provider and the established LLM providers", () => {
    expect(modelProviders.openai.type).toBe("llm");
    expect(modelProviders.anthropic.type).toBe("llm");
    expect(modelProviders.azure.type).toBe("llm");

    for (const [providerId, provider] of Object.entries(modelProviders)) {
      expect(provider.type, `${providerId} must have a provider type`).toMatch(/^(llm|safety)$/);
    }
  });
});
