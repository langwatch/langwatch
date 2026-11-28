/**
 * Which saves import from a provider's model listing.
 * @see specs/model-providers/custom-provider-model-import.feature
 */
import { describe, expect, it } from "vitest";

import { importsModelListing, isSameEndpoint } from "../model-listing-import.ts";

describe("importsModelListing", () => {
  /** @scenario Only custom providers and OpenAI on another base URL import */
  it("imports for custom and for OpenAI on another base URL only", () => {
    expect(importsModelListing({ provider: "custom", baseUrl: "https://llm.example.com/v1" })).toBe(
      true,
    );
    expect(importsModelListing({ provider: "openai", baseUrl: "https://llm.example.com/v1" })).toBe(
      true,
    );
    expect(importsModelListing({ provider: "openai", baseUrl: "https://api.openai.com/" })).toBe(
      false,
    );
    expect(importsModelListing({ provider: "openai", baseUrl: "" })).toBe(false);
    expect(importsModelListing({ provider: "openai", baseUrl: undefined })).toBe(false);
    expect(importsModelListing({ provider: "anthropic", baseUrl: "https://llm.example.com" })).toBe(
      false,
    );
  });
});

describe("isSameEndpoint", () => {
  describe("when two base URLs differ only in host case, trailing slash or /v1", () => {
    it("treats them as the same endpoint", () => {
      expect(
        isSameEndpoint("https://LLM.example.com/tenant/v1/", "https://llm.example.com/tenant"),
      ).toBe(true);
    });
  });

  describe("when two base URLs differ in path case", () => {
    it("treats them as different endpoints", () => {
      expect(
        isSameEndpoint("https://llm.example.com/TenantA/v1", "https://llm.example.com/tenanta/v1"),
      ).toBe(false);
    });
  });
});
