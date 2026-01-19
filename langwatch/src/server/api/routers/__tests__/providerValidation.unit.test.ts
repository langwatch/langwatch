import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MASKED_KEY_PLACEHOLDER } from "../../../../utils/constants";
import { validateProviderApiKey } from "../providerValidation";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("validateProviderApiKey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Skip validation scenarios", () => {
    it("returns valid for unknown provider", async () => {
      const result = await validateProviderApiKey("unknown_provider", {
        SOME_API_KEY: "test-key",
      });
      expect(result).toEqual({ valid: true });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("skips validation for bedrock provider", async () => {
      const result = await validateProviderApiKey("bedrock", {
        AWS_ACCESS_KEY_ID: "test-id",
        AWS_SECRET_ACCESS_KEY: "test-secret",
      });
      expect(result).toEqual({ valid: true });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("skips validation for vertex_ai provider", async () => {
      const result = await validateProviderApiKey("vertex_ai", {
        VERTEXAI_PROJECT: "test-project",
      });
      expect(result).toEqual({ valid: true });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("skips validation for azure provider", async () => {
      const result = await validateProviderApiKey("azure", {
        AZURE_OPENAI_API_KEY: "test-key",
        AZURE_OPENAI_ENDPOINT: "https://test.openai.azure.com",
      });
      expect(result).toEqual({ valid: true });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("skips validation when API key is masked placeholder", async () => {
      const result = await validateProviderApiKey("openai", {
        OPENAI_API_KEY: MASKED_KEY_PLACEHOLDER,
      });
      expect(result).toEqual({ valid: true });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("skips validation when no API key provided", async () => {
      const result = await validateProviderApiKey("openai", {
        OPENAI_API_KEY: "",
      });
      expect(result).toEqual({ valid: true });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("skips validation when API key field is missing", async () => {
      const result = await validateProviderApiKey("openai", {});
      expect(result).toEqual({ valid: true });
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("Bearer token validation (OpenAI)", () => {
    it("returns valid when API key is accepted", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      });

      const result = await validateProviderApiKey("openai", {
        OPENAI_API_KEY: "sk-valid-key",
      });

      expect(result).toEqual({ valid: true });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/models"),
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: "Bearer sk-valid-key",
          }),
        }),
      );
    });

    it("returns error for 401 unauthorized", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

      const result = await validateProviderApiKey("openai", {
        OPENAI_API_KEY: "sk-invalid-key",
      });

      expect(result.valid).toBe(false);
      expect(result.error).toContain("Invalid API key");
    });

    it("returns error for 403 forbidden", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
      });

      const result = await validateProviderApiKey("openai", {
        OPENAI_API_KEY: "sk-invalid-key",
      });

      expect(result.valid).toBe(false);
      expect(result.error).toContain("Invalid API key");
    });

    it("returns error for other HTTP errors", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const result = await validateProviderApiKey("openai", {
        OPENAI_API_KEY: "sk-valid-key",
      });

      expect(result.valid).toBe(false);
      expect(result.error).toContain("API validation failed (500)");
    });

    it("returns error on network failure", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const result = await validateProviderApiKey("openai", {
        OPENAI_API_KEY: "sk-valid-key",
      });

      expect(result.valid).toBe(false);
      expect(result.error).toContain("Failed to validate API key");
    });

    it("uses custom base URL when provided", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      });

      await validateProviderApiKey("openai", {
        OPENAI_API_KEY: "sk-valid-key",
        OPENAI_BASE_URL: "https://custom.openai.com/v1",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://custom.openai.com/v1/models",
        expect.anything(),
      );
    });
  });

  describe("Anthropic validation", () => {
    it("uses x-api-key header for Anthropic", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      });

      const result = await validateProviderApiKey("anthropic", {
        ANTHROPIC_API_KEY: "sk-ant-valid-key",
      });

      expect(result).toEqual({ valid: true });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/models"),
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            "x-api-key": "sk-ant-valid-key",
            "anthropic-version": "2023-06-01",
          }),
        }),
      );
    });

    it("returns error for invalid Anthropic key", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

      const result = await validateProviderApiKey("anthropic", {
        ANTHROPIC_API_KEY: "sk-ant-invalid-key",
      });

      expect(result.valid).toBe(false);
      expect(result.error).toContain("Invalid API key");
    });

    it("uses custom base URL when provided", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      });

      await validateProviderApiKey("anthropic", {
        ANTHROPIC_API_KEY: "sk-ant-valid-key",
        ANTHROPIC_BASE_URL: "https://custom-anthropic.example.com",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://custom-anthropic.example.com/models",
        expect.anything(),
      );
    });
  });

  describe("Gemini validation", () => {
    it("uses query parameter for Gemini", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      });

      const result = await validateProviderApiKey("gemini", {
        GEMINI_API_KEY: "gemini-valid-key",
      });

      expect(result).toEqual({ valid: true });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("key=gemini-valid-key"),
        expect.anything(),
      );
    });

    it("returns error for 400 (invalid key) from Gemini", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
      });

      const result = await validateProviderApiKey("gemini", {
        GEMINI_API_KEY: "gemini-invalid-key",
      });

      expect(result.valid).toBe(false);
      expect(result.error).toContain("Invalid API key");
    });
  });

  describe("Custom provider validation", () => {
    it("skips validation when no API key and no base URL", async () => {
      const result = await validateProviderApiKey("custom", {
        CUSTOM_API_KEY: "",
        CUSTOM_BASE_URL: "",
      });

      expect(result).toEqual({ valid: true });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("validates when base URL is provided even without API key", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      });

      const _result = await validateProviderApiKey("custom", {
        CUSTOM_API_KEY: "",
        CUSTOM_BASE_URL: "https://custom-llm.example.com/v1",
      });

      // Custom provider with only base URL should still attempt validation
      expect(mockFetch).toHaveBeenCalled();
    });
  });
});
