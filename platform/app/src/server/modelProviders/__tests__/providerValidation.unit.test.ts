import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The probe goes out through the SSRF-validated fetch, not `global.fetch`, so
// that is what these tests stand in for; mocking the global would leave the
// real validator in the path and every assertion here would be about DNS.
// Only the fetch is replaced — the rest of the module stays real, so the
// error types these tests reject with are the ones production actually sees.
const mockFetch = vi.fn();
vi.mock("../../../utils/ssrfProtection", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/ssrfProtection")>()),
  ssrfSafeFetch: (...args: unknown[]) => mockFetch(...args),
}));

import { MASKED_KEY_PLACEHOLDER } from "../../../utils/constants";
import { RedirectRefusedError } from "../../../utils/ssrfProtection";
import {
  ProviderUnreachableError,
  type ValidationResult,
  validateProviderApiKey,
} from "../providerValidation";

/**
 * The code a refusal carries, or `undefined` when the key was accepted.
 *
 * Asserted on instead of prose throughout: the code is the contract, while the
 * sentence a customer reads is the registry's and is free to be reworded
 * without any of these tests being about it.
 */
const codeOf = (result: ValidationResult): string | undefined =>
  result.valid ? undefined : result.domainError.code;

/** Everything a refusal puts on the wire, for the tests that assert absence. */
const wireOf = (result: ValidationResult): string =>
  result.valid ? "" : JSON.stringify(result.domainError);

describe("validateProviderApiKey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Not just clearAllMocks: that leaves unconsumed one-shot responses
    // queued, so a test whose probing stops early leaks the remainder into
    // whichever test runs next.
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Skip validation scenarios", () => {
    it("returns valid for unknown provider", async () => {
      const result = await validateProviderApiKey("unknown_provider", {
        SOME_API_KEY: "test-key",
      });
      expect(result.outcome).toBe("unchecked");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("skips validation for bedrock provider", async () => {
      const result = await validateProviderApiKey("bedrock", {
        AWS_ACCESS_KEY_ID: "test-id",
        AWS_SECRET_ACCESS_KEY: "test-secret",
      });
      expect(result.outcome).toBe("unchecked");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("skips validation for vertex_ai provider", async () => {
      const result = await validateProviderApiKey("vertex_ai", {
        VERTEXAI_PROJECT: "test-project",
      });
      expect(result.outcome).toBe("unchecked");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("skips validation for azure provider", async () => {
      const result = await validateProviderApiKey("azure", {
        AZURE_OPENAI_API_KEY: "test-key",
        AZURE_OPENAI_ENDPOINT: "https://test.openai.azure.com",
      });
      expect(result.outcome).toBe("unchecked");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    /** @scenario "Skip validation for masked placeholder in validation function" */
    it("skips validation when API key is masked placeholder", async () => {
      const result = await validateProviderApiKey("openai", {
        OPENAI_API_KEY: MASKED_KEY_PLACEHOLDER,
      });
      expect(result.outcome).toBe("unchecked");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    /** @scenario "Skip validation when no API key provided" */
    it("skips validation when no API key provided", async () => {
      const result = await validateProviderApiKey("openai", {
        OPENAI_API_KEY: "",
      });
      expect(result.outcome).toBe("unchecked");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("skips validation when API key field is missing", async () => {
      const result = await validateProviderApiKey("openai", {});
      expect(result.outcome).toBe("unchecked");
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

      expect(result.outcome).toBe("verified");
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
      expect(codeOf(result)).toBe("provider_key_invalid");
      expect(codeOf(result)).not.toBe("provider_unreachable");
    });

    it("raises an unreachable-provider error only when the fetch itself fails", async () => {
      mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

      // A refused key is an answer; an unreachable provider is the absence of
      // one, so it travels the handled-error channel rather than posing as a
      // verdict on the key.
      await expect(
        validateProviderApiKey("elevenlabs", {
          ELEVENLABS_API_KEY: "sk_test",
        }),
      ).rejects.toBeInstanceOf(ProviderUnreachableError);
    });
  });

  describe("Providers without a validation endpoint", () => {
    /** @scenario "Providers with no known validation endpoint skip validation" */
    it("skips validation instead of fetching a relative URL", async () => {
      const result = await validateProviderApiKey("voyage", {
        VOYAGE_API_KEY: "pa-test",
      });

      expect(result).toMatchObject({
        outcome: "unchecked",
        reason: "no_endpoint",
      });
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

      expect(result.outcome).toBe("verified");
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
      expect(codeOf(result)).toBe("provider_key_invalid");
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
      expect(codeOf(result)).toBe("provider_key_invalid");
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
      expect(codeOf(result)).toBe("provider_refused");
    });

    it("raises an unreachable-provider error on network failure", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      await expect(
        validateProviderApiKey("openai", {
          OPENAI_API_KEY: "sk-valid-key",
        }),
      ).rejects.toMatchObject({
        code: "provider_unreachable",
        fault: "provider",
      });
    });

    it("tells a provider with a custom endpoint to check the base URL too", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      await expect(
        validateProviderApiKey("openai", {
          OPENAI_API_KEY: "sk-valid-key",
        }),
      ).rejects.toMatchObject({
        tips: expect.arrayContaining([expect.stringContaining("base URL")]),
      });
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

      expect(result.outcome).toBe("verified");
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
      expect(codeOf(result)).toBe("provider_key_invalid");
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

      expect(result.outcome).toBe("verified");
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("key=gemini-valid-key"),
        expect.anything(),
      );
    });

    it("returns error for 400 (invalid key) from Gemini", async () => {
      // Persistent: a bare 400 carries no reason, so it does not end the walk
      // and every remaining shape is asked the same question.
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
      });

      const result = await validateProviderApiKey("gemini", {
        GEMINI_API_KEY: "gemini-invalid-key",
      });

      expect(result.valid).toBe(false);
      expect(codeOf(result)).toBe("provider_key_invalid");
    });
  });

  describe("when the provider explains why it refused the key", () => {
    /**
     * Google returns a machine-readable `reason` in `error.details[]`. Only
     * API_KEY_INVALID actually means the key is wrong; the rest are project
     * or restriction problems that regenerating the key will never fix.
     */
    const googleError = (status: number, reason: string, message: string): unknown => ({
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

    // Persistent, not one-shot: a refusal that is not `API_KEY_INVALID` does
    // not stop the walk, so Gemini goes on to probe every remaining shape —
    // and a key the provider refuses is refused on all of them. Queuing a
    // single response left the later shapes resolving `undefined`, which the
    // probe loop used to swallow as "unreachable" and outrank with the real
    // refusal, so these tests passed without ever exercising the walk.
    const respondWith = (status: number, body: unknown) => {
      mockFetch.mockResolvedValue({
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
        expect(codeOf(result)).toBe("provider_service_disabled");
        // With the Generative Language API disabled on the project, this key
        // cannot answer here until it is enabled — and the alternative is a
        // separate Vertex AI provider, which takes a service account rather
        // than this key.
        expect(codeOf(result)).not.toBe("provider_key_invalid");
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
        expect(codeOf(result)).toBe("provider_key_restricted");
        expect(codeOf(result)).not.toBe("provider_key_invalid");
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
        expect(codeOf(result)).toBe("provider_key_restricted");
        expect(codeOf(result)).not.toBe("provider_key_invalid");
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
              methodName: "google.cloud.translate.v2.TranslateService.TranslateText",
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
        expect(codeOf(result)).toBe("provider_key_restricted");
        expect(codeOf(result)).not.toBe("provider_key_invalid");
        // "forbidden" is what a details[]-blind parser would surface.
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
        expect(codeOf(result)).toBe("provider_key_invalid");
      });
    });

    describe("given a non-Gemini provider explains the refusal", () => {
      /**
       * The provider's sentence is read — it still decides how a refusal
       * ranks — but it is logged and dropped, never carried. A
       * rejected-credential body is exactly where the credential turns up:
       * OpenAI writes the key it rejected into this field. `llm_upstream_error`
       * once relayed it and was reversed for that reason; see the note on
       * `ALLOWED_PER_CODE` in `features/errors/.../presentation.unit.test.ts`.
       */
      /** @scenario "A refusal is explained in our own words, not the provider's" */
      it("does not put OpenAI's sentence on the wire", async () => {
        respondWith(401, {
          error: {
            message: "Incorrect API key provided. You can find your API key at",
            type: "invalid_request_error",
          },
        });

        const result = await validateProviderApiKey("openai", {
          OPENAI_API_KEY: "sk-wrong",
        });

        expect(codeOf(result)).toBe("provider_key_invalid");
        expect(wireOf(result)).not.toContain("Incorrect API key provided");
      });

      /** @scenario "A refusal is explained in our own words, not the provider's" */
      it("does not put Anthropic's sentence on the wire", async () => {
        respondWith(401, {
          type: "error",
          error: { type: "authentication_error", message: "invalid x-api-key" },
        });

        const result = await validateProviderApiKey("anthropic", {
          ANTHROPIC_API_KEY: "sk-ant-wrong",
        });

        expect(codeOf(result)).toBe("provider_key_invalid");
        expect(wireOf(result)).not.toContain("invalid x-api-key");
      });

      /** @scenario "A refusal is explained in our own words, not the provider's" */
      it("does not put the ElevenLabs sentence on the wire", async () => {
        // `detail` rather than `error`: ElevenLabs nests its message
        // differently, and this is the branch that proves the reader handles
        // that shape without the sentence then escaping.
        respondWith(401, {
          detail: {
            status: "invalid_api_key",
            message: "The xi-api-key you supplied is not associated with a workspace",
          },
        });

        const result = await validateProviderApiKey("elevenlabs", {
          ELEVENLABS_API_KEY: "sk_wrong",
        });

        expect(codeOf(result)).toBe("provider_key_invalid");
        expect(wireOf(result)).not.toContain("not associated with a workspace");
      });

      /** @scenario A provider server error is not reported as a bad key */
      it("blames the provider, not the key, when the provider is failing", async () => {
        respondWith(500, { error: { message: "upstream is on fire" } });

        const result = await validateProviderApiKey("openai", {
          OPENAI_API_KEY: "sk-valid",
        });

        expect(result.valid).toBe(false);
        expect(codeOf(result)).toBe("provider_refused");
        expect(codeOf(result)).not.toBe("provider_key_invalid");
        // The status is a fact from a known set, so it travels; the
        // provider's prose beside it does not.
        expect(wireOf(result)).toContain("500");
        expect(wireOf(result)).not.toContain("upstream is on fire");
      });
    });

    describe("given the refusal has no readable explanation", () => {
      /** @scenario "A refusal with no readable explanation says the same thing" */
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
        expect(codeOf(result)).toBe("provider_key_invalid");
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
        expect(codeOf(result)).toBe("provider_key_invalid");
      });
    });

    describe("given the provider echoes the submitted key back", () => {
      /** @scenario "A refusal never repeats the submitted API key" */
      it("hides the key from everything the customer's browser receives", async () => {
        const apiKey = "AIzaSySuperSecretKeyValue123456789";
        respondWith(400, {
          error: { message: `API key not valid: ${apiKey} was rejected` },
        });

        const result = await validateProviderApiKey("gemini", {
          GEMINI_API_KEY: apiKey,
        });

        expect(result.valid).toBe(false);
        // The whole serialized payload, not one field: the key must not be in
        // `meta`, in `tips`, or in a `reasons` entry either.
        expect(wireOf(result)).not.toContain(apiKey);
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
            ...(reason ? { details: [{ reason, domain: "googleapis.com" }] } : {}),
          },
        }),
    });

    /**
     * Google issues Gemini keys from AI Studio, the Cloud console and Agent
     * Platform, and they do not all answer the same way. A key is only
     * unusable once every shape has refused it — anything less reports our
     * own narrow guess as the customer's problem.
     */
    /** @scenario A key any supported auth shape accepts is valid */
    it("accepts a key the first shapes refuse but a later one answers", async () => {
      mockFetch
        .mockResolvedValueOnce(refuse(403, "API_KEY_SERVICE_BLOCKED"))
        .mockResolvedValueOnce(refuse(403, "API_KEY_SERVICE_BLOCKED"))
        .mockResolvedValueOnce(refuse(403, "API_KEY_SERVICE_BLOCKED"))
        .mockResolvedValueOnce({ ok: true, status: 200 });

      const result = await validateProviderApiKey("gemini", {
        GEMINI_API_KEY: "AIzaSyKeyThatOnlyTheOpenAiSurfaceAccepts",
      });

      expect(result.outcome).toBe("verified");
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    /** @scenario Every auth shape the provider supports is tried */
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
      expect(urls.some((url) => url.includes("/v1beta/models?key="))).toBe(true);
      expect(urls.some((url) => url.includes("/v1beta/openai/models"))).toBe(true);
      expect(headers.some((h) => "x-goog-api-key" in h)).toBe(true);
      expect(headers.some((h) => h.Authorization?.startsWith("Bearer "))).toBe(true);
    });

    /** @scenario Probing stops at the first shape that answers */
    /**
     * A timeout per shape multiplies: four shapes at ten seconds each would
     * let one black-holed host hold a request thread for forty. Sharing the
     * signal is what makes the budget a ceiling on the walk rather than on
     * each step of it.
     */
    it("gives the whole walk one deadline rather than one per shape", async () => {
      mockFetch.mockResolvedValue(refuse(403, "API_KEY_SERVICE_BLOCKED"));

      await validateProviderApiKey("gemini", {
        GEMINI_API_KEY: "AIzaSyRefusedEverywhere",
      });

      const signals = mockFetch.mock.calls.map(
        (call) => (call[1] as { signal?: AbortSignal }).signal,
      );

      expect(signals.length).toBeGreaterThan(1);
      expect(signals.every((signal) => signal !== undefined)).toBe(true);
      expect(new Set(signals).size).toBe(1);
    });

    it("stops at the first shape that answers", async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 200 });

      const result = await validateProviderApiKey("gemini", {
        GEMINI_API_KEY: "AIzaSyAcceptedImmediately",
      });

      expect(result.outcome).toBe("verified");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    /**
     * Found end to end, not by a mock. Asked about a plainly invalid key the
     * primary endpoints return Google's canonical API_KEY_INVALID, while the
     * OpenAI-compatible surface answers "Please pass a valid API key" with no
     * reason at all. Preferring whichever refusal merely differed from our own
     * wording picked that vaguer one and appended it, producing "Invalid API
     * key. Please check your API key and try again. Please pass a valid API
     * key" against a live key.
     */
    it("prefers the provider's verdict over a vaguer fallback message", async () => {
      const canonical = {
        ok: false,
        status: 400,
        text: async () =>
          JSON.stringify({
            error: {
              message: "API key not valid. Please pass a valid API key.",
              details: [{ reason: "API_KEY_INVALID", domain: "googleapis.com" }],
            },
          }),
      };
      const vague = {
        ok: false,
        status: 400,
        text: async () =>
          JSON.stringify({
            error: { code: 400, message: "Please pass a valid API key" },
          }),
      };
      // Vague first, so the walk continues and both answers are in hand when
      // one has to be chosen — the definitive verdict must win regardless of
      // which shape happened to produce it.
      mockFetch
        .mockResolvedValueOnce(vague)
        .mockResolvedValueOnce(canonical)
        .mockResolvedValueOnce(canonical)
        .mockResolvedValueOnce(canonical);

      const result = await validateProviderApiKey("gemini", {
        GEMINI_API_KEY: "AIzaSyPlainlyInvalid",
      });

      expect(codeOf(result)).toBe("provider_key_invalid");
      // The vaguer surface answered first and said nothing mappable; the
      // canonical `API_KEY_INVALID` still decides the verdict.
      expect(wireOf(result)).not.toContain("Please pass a valid API key");
    });

    /**
     * The provider has already settled it. Asking the remaining shapes cannot
     * change the answer and each one is another outbound request on the
     * request thread — which is also what stopped the vaguer sentence from
     * being reached in the first place.
     */
    it("stops asking once the provider calls the key invalid", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        text: async () =>
          JSON.stringify({
            error: {
              message: "API key not valid. Please pass a valid API key.",
              details: [{ reason: "API_KEY_INVALID", domain: "googleapis.com" }],
            },
          }),
      });

      const result = await validateProviderApiKey("gemini", {
        GEMINI_API_KEY: "AIzaSyPlainlyInvalid",
      });

      expect(result.valid).toBe(false);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("reports the actionable refusal once every shape has failed", async () => {
      mockFetch.mockResolvedValue(refuse(403, "SERVICE_DISABLED"));

      const result = await validateProviderApiKey("gemini", {
        GEMINI_API_KEY: "AIzaSyRefusedEverywhere",
      });

      expect(result.valid).toBe(false);
      expect(codeOf(result)).toBe("provider_service_disabled");
      expect(codeOf(result)).not.toBe("provider_key_invalid");
    });

    /** @scenario A provider with one documented auth shape is probed once */
    it("leaves a provider with one documented auth shape probed once", async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 401 });

      const result = await validateProviderApiKey("openai", {
        OPENAI_API_KEY: "sk-wrong",
      });

      expect(result.valid).toBe(false);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the provider quotes the request back", () => {
    /**
     * Gemini carries the key in a query string, so a provider echoing the
     * request it rejected can hand back the percent-encoded form rather than
     * the key as typed. Matching only the literal would walk straight past it.
     */
    it("hides the key even when it comes back percent-encoded", async () => {
      const apiKey = "AIzaSy+Secret/Key=With+Specials";
      const encoded = encodeURIComponent(apiKey);

      expect(encoded).not.toBe(apiKey);

      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        text: async () =>
          JSON.stringify({
            error: { message: `rejected request to /models?key=${encoded}` },
          }),
      });

      const result = await validateProviderApiKey("gemini", {
        GEMINI_API_KEY: apiKey,
      });

      expect(result.valid).toBe(false);
      expect(wireOf(result)).not.toContain(encoded);
      expect(wireOf(result)).not.toContain(apiKey);
    });
  });

  describe("Custom provider validation", () => {
    it("skips validation when no API key and no base URL", async () => {
      const result = await validateProviderApiKey("custom", {
        CUSTOM_API_KEY: "",
        CUSTOM_BASE_URL: "",
      });

      expect(result.outcome).toBe("unchecked");
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

/**
 * The third answer.
 *
 * For most of this file's life a check had two outcomes, and a check that
 * never ran returned the same value as one that succeeded. That is harmless
 * while the answer only decides whether a save may proceed — a skip should
 * not block a save — and it becomes a false statement the moment a customer
 * reads it. Six of the sixteen registered providers reach one of these
 * paths, so a control that reported them as working would be wrong on more
 * than a third of the list.
 */
describe("given a check that never reached the provider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("when the provider uses credentials we cannot probe", () => {
    /** @scenario "Every reason a check does not run is reported as unchecked" */
    it.each(["bedrock", "vertex_ai", "azure"])(
      "reports %s as unchecked rather than working",
      async (provider) => {
        const result = await validateProviderApiKey(provider, {
          SOME_KEY: "whatever",
        });

        expect(result).toMatchObject({
          outcome: "unchecked",
          reason: "provider_not_probeable",
        });
        expect(mockFetch).not.toHaveBeenCalled();
      },
    );

    /** @scenario "Content safety credentials are never probed as a language model" */
    it("never probes a content safety credential as a language model", async () => {
      // azure_safety is not in the complex-auth set and carries an endpoint,
      // so it would otherwise clear the base-url check and be probed with a
      // bearer GET /models — against a service that authenticates with a
      // subscription-key header and has no /models route at all. A working
      // credential would come back refused.
      const result = await validateProviderApiKey("azure_safety", {
        AZURE_CONTENT_SAFETY_KEY: "a-good-key",
        AZURE_CONTENT_SAFETY_ENDPOINT: "https://example.cognitiveservices.azure.com",
      });

      expect(result).toMatchObject({
        outcome: "unchecked",
        reason: "provider_not_probeable",
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("when the credential is not one we can send", () => {
    /** @scenario "Every reason a check does not run is reported as unchecked" */
    it("reports a masked credential as unchecked", async () => {
      const result = await validateProviderApiKey("openai", {
        OPENAI_API_KEY: MASKED_KEY_PLACEHOLDER,
      });

      expect(result).toMatchObject({
        outcome: "unchecked",
        reason: "credential_masked",
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    /** @scenario "Every reason a check does not run is reported as unchecked" */
    it("reports an absent credential as unchecked", async () => {
      const result = await validateProviderApiKey("openai", {
        OPENAI_API_KEY: "",
      });

      expect(result).toMatchObject({
        outcome: "unchecked",
        reason: "no_credential",
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("when there is nowhere to send it", () => {
    /** @scenario "Every reason a check does not run is reported as unchecked" */
    it("reports a provider with no endpoint as unchecked", async () => {
      const result = await validateProviderApiKey("voyage", {
        VOYAGE_API_KEY: "pa-test",
      });

      expect(result.outcome).toBe("unchecked");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    /** @scenario "Every reason a check does not run is reported as unchecked" */
    it("reports an unrecognized provider as unchecked", async () => {
      const result = await validateProviderApiKey("not_a_provider", {
        SOME_API_KEY: "test-key",
      });

      expect(result).toMatchObject({
        outcome: "unchecked",
        reason: "unknown_provider",
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  /**
   * Where the probe is allowed to go.
   *
   * Several providers expose a configurable endpoint, so the address a probe
   * dials is a customer-supplied value however it got there — typed on this
   * request, or saved on a provider row earlier and picked up by a later
   * check. The credential rides along either way, which makes every probe an
   * outbound request to an untrusted host carrying a secret.
   */
  describe("when deciding where the credential may be sent", () => {
    /** @scenario "A credential is never carried to an address we have not vetted" */
    it("goes out through the validated fetch, and nothing slips past it", async () => {
      const bareFetch = vi.fn();
      const originalFetch = global.fetch;
      global.fetch = bareFetch as unknown as typeof global.fetch;
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

      try {
        await validateProviderApiKey("openai", { OPENAI_API_KEY: "sk-test" });

        expect(mockFetch).toHaveBeenCalled();
        expect(bareFetch).not.toHaveBeenCalled();
      } finally {
        global.fetch = originalFetch;
      }
    });

    /** @scenario "A redirect is reported as a redirect, not as unreachable" */
    it("says the endpoint redirected rather than that it could not be reached", async () => {
      // The helper's own error type. An earlier version of this test rejected
      // with a bare Error carrying the same text, which passed while the real
      // thing did not work at all: the helper's catch rewrites a plain Error
      // into "Connection failed to host:port: …", so the production matcher was
      // comparing against a string it never receives. The type survives that
      // catch, and asserting on it is what makes this test about the real path.
      mockFetch.mockRejectedValueOnce(new RedirectRefusedError());

      const result = await validateProviderApiKey("custom", {
        CUSTOM_API_KEY: "sk-test",
        CUSTOM_BASE_URL: "http://redirects.example.com/v1",
      });

      expect(codeOf(result)).toBe("provider_endpoint_redirected");
      expect(codeOf(result)).not.toBe("provider_unreachable");
    });

    /** @scenario "A redirect never carries the credential onward" */
    it("refuses to follow a redirect", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

      await validateProviderApiKey("openai", { OPENAI_API_KEY: "sk-test" });

      // Hop re-validation falls back to the weaker default policy, and a
      // cross-origin redirect strips `Authorization` while carrying
      // `x-api-key`, `x-goog-api-key` and `xi-api-key` through to the new
      // host. A models listing has no need of a redirect.
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ followRedirects: false }),
      );
    });
  });

  describe("when the answer is read by the save path", () => {
    /** @scenario "Saving is unaffected by the third answer" */
    it("still reports valid, so a skip does not block a save", async () => {
      // The save path asks `valid`, and a skip has always meant "do not
      // stand in the way". Widening the result must not change that: the
      // new information is carried alongside, not instead.
      const result = await validateProviderApiKey("bedrock", {
        AWS_ACCESS_KEY_ID: "test-id",
      });

      expect(result.valid).toBe(true);
    });
  });

  describe("when the provider did answer", () => {
    /** @scenario "A skipped check is distinguishable from a successful one" */
    it("marks a real round trip as verified, not unchecked", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

      const result = await validateProviderApiKey("openai", {
        OPENAI_API_KEY: "sk-valid-key",
      });

      expect(result.outcome).toBe("verified");
      expect(mockFetch).toHaveBeenCalled();
    });

    /** @scenario "A skipped check is distinguishable from a successful one" */
    it("marks a refusal as refused, not unchecked", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });

      const result = await validateProviderApiKey("openai", {
        OPENAI_API_KEY: "sk-wrong",
      });

      expect(result.outcome).toBe("refused");
    });
  });
});
