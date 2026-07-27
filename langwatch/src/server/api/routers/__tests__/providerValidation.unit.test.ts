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

    /** @scenario "Skip validation for masked placeholder in validation function" */
    it("skips validation when API key is masked placeholder", async () => {
      const result = await validateProviderApiKey("openai", {
        OPENAI_API_KEY: MASKED_KEY_PLACEHOLDER,
      });
      expect(result).toEqual({ valid: true });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    /** @scenario "Skip validation when no API key provided" */
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

  describe("ElevenLabs validation", () => {
    /** @scenario "ElevenLabs keys validate with the xi-api-key header" */
    it("uses xi-api-key header against the ElevenLabs models endpoint", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

      const result = await validateProviderApiKey("elevenlabs", {
        ELEVENLABS_API_KEY: "sk_test",
      });

      expect(result).toEqual({ valid: true });
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.elevenlabs.io/v1/models",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({ "xi-api-key": "sk_test" }),
        }),
      );
    });

    it("reports an invalid key on 401, not a network problem", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });

      const result = await validateProviderApiKey("elevenlabs", {
        ELEVENLABS_API_KEY: "sk_wrong",
      });

      expect(result.valid).toBe(false);
      expect(result.error).toContain("Invalid API key");
      expect(result.error).not.toContain("network");
    });

    it("reports a network error only when the fetch itself fails", async () => {
      mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

      const result = await validateProviderApiKey("elevenlabs", {
        ELEVENLABS_API_KEY: "sk_test",
      });

      expect(result.valid).toBe(false);
      expect(result.error).toContain("network");
    });
  });

  describe("Providers without a validation endpoint", () => {
    /** @scenario "Providers with no known validation endpoint skip validation" */
    it("skips validation instead of fetching a relative URL", async () => {
      const result = await validateProviderApiKey("voyage", {
        VOYAGE_API_KEY: "pa-test",
      });

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

  describe("when the provider explains why it refused the key", () => {
    /**
     * Google returns a machine-readable `reason` in `error.details[]`. Only
     * API_KEY_INVALID actually means the key is wrong; the rest are project
     * or restriction problems that regenerating the key will never fix.
     */
    const googleError = (
      status: number,
      reason: string,
      message: string,
    ): unknown => ({
      error: {
        code: status,
        message,
        status: status === 400 ? "INVALID_ARGUMENT" : "PERMISSION_DENIED",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.ErrorInfo",
            reason,
            domain: "googleapis.com",
          },
        ],
      },
    });

    const respondWith = (status: number, body: unknown) => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status,
        text: async () => JSON.stringify(body),
      });
    };

    describe("given the Generative Language API is disabled on the project", () => {
      /** @scenario "Gemini reports a disabled Generative Language API, not a bad key" */
      it("tells the customer to enable the API instead of blaming the key", async () => {
        respondWith(
          403,
          googleError(
            403,
            "SERVICE_DISABLED",
            "Generative Language API has not been used in project 12345 before or it is disabled.",
          ),
        );

        const result = await validateProviderApiKey("gemini", {
          GEMINI_API_KEY: "AIzaSyValidKeyFromGoogleCloudConsole",
        });

        expect(result.valid).toBe(false);
        expect(result.error).toContain("Generative Language API");
        expect(result.error).toContain("enable");
        // A Google Cloud key cannot work against Google AI Studio at all, so
        // the only real way out is the provider that takes a service account.
        expect(result.error).toContain("Vertex AI");
        expect(result.error).not.toContain("Invalid API key");
      });
    });

    describe("given the key's API restrictions exclude Gemini", () => {
      /** @scenario "Gemini reports a key restricted away from the API, not a bad key" */
      it("points at the restriction instead of blaming the key", async () => {
        respondWith(
          403,
          googleError(
            403,
            "API_KEY_SERVICE_BLOCKED",
            "Requests to this API generativelanguage.googleapis.com method are blocked.",
          ),
        );

        const result = await validateProviderApiKey("gemini", {
          GEMINI_API_KEY: "AIzaSyRestrictedKey",
        });

        expect(result.valid).toBe(false);
        expect(result.error).toContain("restriction");
        expect(result.error).toContain("Vertex AI");
        expect(result.error).not.toContain("Invalid API key");
      });
    });

    describe("given the key is locked to other callers", () => {
      /** @scenario "Gemini reports a key restricted to other callers, not a bad key" */
      it.each([
        "API_KEY_HTTP_REFERRER_BLOCKED",
        "API_KEY_IP_ADDRESS_BLOCKED",
        "API_KEY_ANDROID_APP_BLOCKED",
        "API_KEY_IOS_APP_BLOCKED",
      ])("explains the restriction for %s", async (reason) => {
        respondWith(403, googleError(403, reason, "Requests are blocked."));

        const result = await validateProviderApiKey("gemini", {
          GEMINI_API_KEY: "AIzaSyRestrictedKey",
        });

        expect(result.valid).toBe(false);
        expect(result.error).toContain("restriction");
        expect(result.error).not.toContain("Invalid API key");
      });
    });

    /**
     * Captured verbatim from Google (translate.googleapis.com, 2026-07-27)
     * by calling a restricted API with a live key. Kept whole rather than
     * hand-written, because the shape is the thing under test: the reason we
     * act on sits in `error.details[]`, while `error.errors[0].reason` holds
     * an unrelated "forbidden". Reading the wrong one silently loses the
     * diagnosis, and only a real payload proves which is which.
     */
    const CAPTURED_GOOGLE_403 = {
      error: {
        code: 403,
        message:
          "Requests to this API translate method google.cloud.translate.v2.TranslateService.TranslateText are blocked.",
        errors: [
          {
            message:
              "Requests to this API translate method google.cloud.translate.v2.TranslateService.TranslateText are blocked.",
            domain: "global",
            reason: "forbidden",
          },
        ],
        status: "PERMISSION_DENIED",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.ErrorInfo",
            reason: "API_KEY_SERVICE_BLOCKED",
            domain: "googleapis.com",
            metadata: {
              consumer: "projects/000000000000",
              methodName:
                "google.cloud.translate.v2.TranslateService.TranslateText",
              apiName: "translate",
              service: "translate.googleapis.com",
            },
          },
          {
            "@type": "type.googleapis.com/google.rpc.LocalizedMessage",
            locale: "en-US",
            message:
              "Requests to this API translate method google.cloud.translate.v2.TranslateService.TranslateText are blocked.",
          },
        ],
      },
    };

    describe("given a refusal Google actually sent", () => {
      /** @scenario Gemini reports a key restricted away from the API, not a bad key */
      it("reads the reason out of a real payload, not the decoy in errors[]", async () => {
        respondWith(403, CAPTURED_GOOGLE_403);

        const result = await validateProviderApiKey("gemini", {
          GEMINI_API_KEY: "AIzaSyRestrictedKey",
        });

        expect(result.valid).toBe(false);
        expect(result.error).toContain("restriction");
        expect(result.error).toContain("Vertex AI");
        expect(result.error).not.toContain("Invalid API key");
        // "forbidden" is what a details[]-blind parser would surface.
        expect(result.error).not.toContain("forbidden");
      });
    });

    describe("given the key really is wrong", () => {
      /** @scenario "Gemini reports a genuinely invalid key as invalid" */
      it("still reports an invalid key", async () => {
        respondWith(
          400,
          googleError(
            400,
            "API_KEY_INVALID",
            "API key not valid. Please pass a valid API key.",
          ),
        );

        const result = await validateProviderApiKey("gemini", {
          GEMINI_API_KEY: "not-a-real-key",
        });

        expect(result.valid).toBe(false);
        expect(result.error).toContain("Invalid API key");
      });
    });

    describe("given a non-Gemini provider explains the refusal", () => {
      /** @scenario "A refusal carries the provider's own explanation" */
      it("surfaces the OpenAI message", async () => {
        respondWith(401, {
          error: {
            message: "Incorrect API key provided. You can find your API key at",
            type: "invalid_request_error",
          },
        });

        const result = await validateProviderApiKey("openai", {
          OPENAI_API_KEY: "sk-wrong",
        });

        expect(result.valid).toBe(false);
        expect(result.error).toContain("Incorrect API key provided");
      });

      it("surfaces the Anthropic message", async () => {
        respondWith(401, {
          type: "error",
          error: { type: "authentication_error", message: "invalid x-api-key" },
        });

        const result = await validateProviderApiKey("anthropic", {
          ANTHROPIC_API_KEY: "sk-ant-wrong",
        });

        expect(result.valid).toBe(false);
        expect(result.error).toContain("invalid x-api-key");
      });

      it("surfaces the ElevenLabs message", async () => {
        respondWith(401, {
          detail: { status: "invalid_api_key", message: "Invalid API key" },
        });

        const result = await validateProviderApiKey("elevenlabs", {
          ELEVENLABS_API_KEY: "sk_wrong",
        });

        expect(result.valid).toBe(false);
        expect(result.error).toContain("Invalid API key");
      });

      it("keeps the status code when the provider is failing", async () => {
        respondWith(500, { error: { message: "upstream is on fire" } });

        const result = await validateProviderApiKey("openai", {
          OPENAI_API_KEY: "sk-valid",
        });

        expect(result.valid).toBe(false);
        expect(result.error).toContain("API validation failed (500)");
        expect(result.error).toContain("upstream is on fire");
        expect(result.error).not.toContain("Invalid API key");
      });
    });

    describe("given the refusal has no readable explanation", () => {
      /** @scenario "A refusal with no readable explanation falls back to the generic message" */
      it("falls back to the invalid key message when the body is not JSON", async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 401,
          text: async () => "<html>Gateway error</html>",
        });

        const result = await validateProviderApiKey("openai", {
          OPENAI_API_KEY: "sk-wrong",
        });

        expect(result.valid).toBe(false);
        expect(result.error).toContain("Invalid API key");
      });

      it("falls back when the body cannot be read at all", async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 401,
          text: async () => {
            throw new Error("body already consumed");
          },
        });

        const result = await validateProviderApiKey("openai", {
          OPENAI_API_KEY: "sk-wrong",
        });

        expect(result.valid).toBe(false);
        expect(result.error).toContain("Invalid API key");
      });
    });

    describe("given the provider echoes the submitted key back", () => {
      /** @scenario "A refusal never repeats the submitted API key" */
      it("hides the key from the message shown to the customer", async () => {
        const apiKey = "AIzaSySuperSecretKeyValue123456789";
        respondWith(400, {
          error: { message: `API key not valid: ${apiKey} was rejected` },
        });

        const result = await validateProviderApiKey("gemini", {
          GEMINI_API_KEY: apiKey,
        });

        expect(result.valid).toBe(false);
        expect(result.error).not.toContain(apiKey);
      });
    });
  });

  describe("when a credential answers on more than one auth shape", () => {
    const refuse = (status: number, reason?: string) => ({
      ok: false,
      status,
      text: async () =>
        JSON.stringify({
          error: {
            code: status,
            message: "blocked",
            ...(reason
              ? { details: [{ reason, domain: "googleapis.com" }] }
              : {}),
          },
        }),
    });

    /**
     * Google issues Gemini keys from AI Studio, the Cloud console and Agent
     * Platform, and they do not all answer the same way. A key is only
     * unusable once every shape has refused it — anything less reports our
     * own narrow guess as the customer's problem.
     */
    it("accepts a key the first shapes refuse but a later one answers", async () => {
      mockFetch
        .mockResolvedValueOnce(refuse(403, "API_KEY_SERVICE_BLOCKED"))
        .mockResolvedValueOnce(refuse(403, "API_KEY_SERVICE_BLOCKED"))
        .mockResolvedValueOnce(refuse(403, "API_KEY_SERVICE_BLOCKED"))
        .mockResolvedValueOnce({ ok: true, status: 200 });

      const result = await validateProviderApiKey("gemini", {
        GEMINI_API_KEY: "AIzaSyKeyThatOnlyTheOpenAiSurfaceAccepts",
      });

      expect(result).toEqual({ valid: true });
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    it("tries the query, header and OpenAI-compatible shapes", async () => {
      mockFetch.mockResolvedValue(refuse(403, "API_KEY_SERVICE_BLOCKED"));

      await validateProviderApiKey("gemini", {
        GEMINI_API_KEY: "AIzaSyRefusedEverywhere",
      });

      const urls = mockFetch.mock.calls.map((call) => String(call[0]));
      const headers = mockFetch.mock.calls.map(
        (call) => (call[1] as { headers: Record<string, string> }).headers,
      );

      expect(urls.some((url) => url.includes("/v1/models?key="))).toBe(true);
      expect(urls.some((url) => url.includes("/v1beta/models?key="))).toBe(
        true,
      );
      expect(urls.some((url) => url.includes("/v1beta/openai/models"))).toBe(
        true,
      );
      expect(headers.some((h) => "x-goog-api-key" in h)).toBe(true);
      expect(
        headers.some((h) => h.Authorization?.startsWith("Bearer ")),
      ).toBe(true);
    });

    it("stops at the first shape that answers", async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 200 });

      const result = await validateProviderApiKey("gemini", {
        GEMINI_API_KEY: "AIzaSyAcceptedImmediately",
      });

      expect(result).toEqual({ valid: true });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("reports the actionable refusal once every shape has failed", async () => {
      mockFetch.mockResolvedValue(refuse(403, "SERVICE_DISABLED"));

      const result = await validateProviderApiKey("gemini", {
        GEMINI_API_KEY: "AIzaSyRefusedEverywhere",
      });

      expect(result.valid).toBe(false);
      expect(result.error).toContain("Generative Language API");
      expect(result.error).not.toContain("Invalid API key");
    });

    it("leaves a provider with one documented auth shape probed once", async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 401 });

      const result = await validateProviderApiKey("openai", {
        OPENAI_API_KEY: "sk-wrong",
      });

      expect(result.valid).toBe(false);
      expect(mockFetch).toHaveBeenCalledTimes(1);
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
