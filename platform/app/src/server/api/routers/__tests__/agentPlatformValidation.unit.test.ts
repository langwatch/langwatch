/**
 * Gemini is one provider with two Google doors: an AI Studio key answers on
 * generativelanguage.googleapis.com, an Agent Platform key on
 * aiplatform.googleapis.com at a path naming the project and location. The
 * credential's shape — pair present or absent — decides which door is asked,
 * so what these tests pin is mostly *which request goes out*.
 *
 * Agent Platform also cannot be validated by listing models: `GET .../models`
 * answers 401 "API keys are not supported by this API" however good the key
 * is, while `:generateContent` accepts one. Established against real keys of
 * both kinds, not from documentation.
 *
 * Covers @unit scenarios from
 * specs/model-providers/google-agent-platform.feature.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { validateProviderApiKey } from "../providerValidation";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const AGENT_PLATFORM_CREDENTIALS = {
  GEMINI_API_KEY: "AQ.AnAgentPlatformKey",
  GEMINI_PROJECT: "acme-123",
  GEMINI_LOCATION: "global",
};

const AI_STUDIO_CREDENTIALS = {
  GEMINI_API_KEY: "AIzaAnAiStudioKey",
};

/** The requests the probe walk actually made. */
const sentRequests = () =>
  mockFetch.mock.calls.map(([url, init]) => ({
    url: String(url ?? ""),
    init: (init ?? {}) as RequestInit,
  }));

const sentRequest = () => {
  const [first] = sentRequests();
  return first ?? { url: "", init: {} as RequestInit };
};

const generated = () => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify({ candidates: [{ content: {} }] }),
});

const codeOf = (result: { valid: boolean; domainError?: { code: string } }) =>
  result.valid ? undefined : result.domainError?.code;

describe("validateProviderApiKey for gemini's two Google doors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  describe("given a credential with only an API key", () => {
    /** @scenario An AI Studio key validates through the Gemini API door */
    it("asks the Gemini API host and never the Agent Platform one", async () => {
      mockFetch.mockResolvedValue(generated());

      await validateProviderApiKey("gemini", AI_STUDIO_CREDENTIALS);

      const urls = sentRequests().map((r) => r.url);
      expect(urls.length).toBeGreaterThan(0);
      for (const url of urls) {
        expect(url).toContain("generativelanguage.googleapis.com");
        expect(url).not.toContain("aiplatform.googleapis.com");
      }
    });

    /** @scenario An Agent Platform key without project and location is told what is missing, not that it is invalid */
    it("names the key's restriction rather than calling it invalid", async () => {
      // Google's live answer for an Agent Platform key on the Gemini API
      // host, verified with a real key: the key is fine, the door is wrong.
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        text: async () =>
          JSON.stringify({
            error: {
              message: "Requests to this API are blocked.",
              details: [
                {
                  "@type": "type.googleapis.com/google.rpc.ErrorInfo",
                  reason: "API_KEY_SERVICE_BLOCKED",
                },
              ],
            },
          }),
      });

      const result = await validateProviderApiKey(
        "gemini",
        AI_STUDIO_CREDENTIALS,
      );

      expect(codeOf(result)).toBe("provider_key_restricted");
      expect(codeOf(result)).not.toBe("provider_key_invalid");
    });
  });

  describe("given a credential carrying a project and location", () => {
    /** @scenario A credential carrying project and location is checked through the Agent Platform door */
    it("builds the Agent Platform path from the project and location and skips the Gemini API", async () => {
      mockFetch.mockResolvedValue(generated());

      await validateProviderApiKey("gemini", {
        ...AGENT_PLATFORM_CREDENTIALS,
        GEMINI_LOCATION: "us-central1",
      });

      const requests = sentRequests();
      expect(requests).toHaveLength(1);
      expect(requests[0]!.url).toContain("aiplatform.googleapis.com");
      expect(requests[0]!.url).toContain(
        "/projects/acme-123/locations/us-central1/",
      );
      expect(requests[0]!.url).not.toContain("generativelanguage");
    });

    /** @scenario A credential carrying project and location is checked through the Agent Platform door */
    it("asks the provider to generate content rather than to list models", async () => {
      mockFetch.mockResolvedValue(generated());

      await validateProviderApiKey("gemini", AGENT_PLATFORM_CREDENTIALS);

      const { url, init } = sentRequest();
      expect(url).toContain(":generateContent");
      expect(url).not.toMatch(/\/models(\?|$)/);
      expect(init.method).toBe("POST");
      // Pinned, not just truthy: a body of `"x"` would pass a truthiness
      // check while sending garbage, and `maxOutputTokens: 1` is what keeps
      // this probe cheap rather than generating a full response on every
      // credential check.
      const body = JSON.parse(String(init.body));
      expect(body.contents[0].parts[0].text).toBeTruthy();
      expect(body.generationConfig.maxOutputTokens).toBe(1);
    });

    /** @scenario The credential is not exposed where logs or browser history could retain it */
    it("sends the key as a header and keeps it out of the URL", async () => {
      mockFetch.mockResolvedValue(generated());

      await validateProviderApiKey("gemini", AGENT_PLATFORM_CREDENTIALS);

      const { url, init } = sentRequest();
      const headers = init.headers as Record<string, string>;
      expect(headers["x-goog-api-key"]).toBe(
        AGENT_PLATFORM_CREDENTIALS.GEMINI_API_KEY,
      );
      // `?key=` is also accepted by Agent Platform, which is exactly why this
      // is pinned: a credential in a URL reaches access logs and history.
      expect(url).not.toContain(AGENT_PLATFORM_CREDENTIALS.GEMINI_API_KEY);
      expect(url).not.toContain("key=");
    });
  });

  describe("given a credential carrying only half the pair", () => {
    /**
     * A lone project (or lone location) names no door. The walk falls back
     * to the Gemini API rather than probing a path it cannot build —
     * where a restricted key still gets its named, actionable refusal.
     */
    it("asks the Gemini API rather than a path it cannot build", async () => {
      mockFetch.mockResolvedValue(generated());

      await validateProviderApiKey("gemini", {
        GEMINI_API_KEY: AGENT_PLATFORM_CREDENTIALS.GEMINI_API_KEY,
        GEMINI_PROJECT: AGENT_PLATFORM_CREDENTIALS.GEMINI_PROJECT,
      });

      const urls = sentRequests().map((r) => r.url);
      expect(urls.length).toBeGreaterThan(0);
      for (const url of urls) {
        expect(url).toContain("generativelanguage.googleapis.com");
      }
    });
  });

  describe("when Agent Platform accepts the credential", () => {
    /** @scenario A key Agent Platform accepts is valid */
    it("reports the credential as valid", async () => {
      mockFetch.mockResolvedValue(generated());

      const result = await validateProviderApiKey(
        "gemini",
        AGENT_PLATFORM_CREDENTIALS,
      );

      expect(result.outcome).toBe("verified");
    });
  });

  describe("when Agent Platform refuses the credential", () => {
    /** @scenario A key the platform refuses is explained, not just rejected */
    it("names the refusal without quoting the provider back", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        text: async () =>
          JSON.stringify({
            error: { message: "API key not valid, sk-leaked-looking-text" },
          }),
      });

      const result = await validateProviderApiKey(
        "gemini",
        AGENT_PLATFORM_CREDENTIALS,
      );

      expect(codeOf(result)).toBe("provider_key_invalid");
      expect(JSON.stringify(result)).not.toContain("sk-leaked-looking-text");
    });

    /**
     * A 404 here means the project cannot reach that published model, which a
     * different key would not fix. Reporting it as an invalid key is the
     * misdiagnosis this whole area exists to remove.
     */
    /** @scenario A model the project cannot reach is not reported as a bad key */
    it("does not blame the key when the model is the thing missing", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        text: async () =>
          JSON.stringify({
            error: { message: "Publisher model ... was not found", code: 404 },
          }),
      });

      const result = await validateProviderApiKey(
        "gemini",
        AGENT_PLATFORM_CREDENTIALS,
      );

      expect(codeOf(result)).not.toBe("provider_key_invalid");
      expect(codeOf(result)).toBe("provider_refused");
    });

    /**
     * The doors disagree on 400: the Gemini API rejects a bad key with it,
     * while on Agent Platform's generate-content probe it means a malformed
     * request. Blaming the key here would revive the exact misdiagnosis the
     * fold exists to remove — through the other door.
     */
    it("does not read an Agent Platform 400 as a key verdict", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        text: async () =>
          JSON.stringify({
            error: { message: "Please use a valid role: user, model." },
          }),
      });

      const result = await validateProviderApiKey(
        "gemini",
        AGENT_PLATFORM_CREDENTIALS,
      );

      expect(codeOf(result)).not.toBe("provider_key_invalid");
      expect(codeOf(result)).toBe("provider_refused");
    });
  });

  describe("when the platform never answers", () => {
    /** @scenario A provider that never answers is not a verdict on the key */
    it("raises unreachable rather than returning a verdict", async () => {
      mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

      await expect(
        validateProviderApiKey("gemini", AGENT_PLATFORM_CREDENTIALS),
      ).rejects.toMatchObject({ code: "provider_unreachable" });
    });
  });

  describe("given a legacy google_agent_platform row from the fold window", () => {
    /**
     * The retired provider has no onboarding tile any more, so it resolves
     * no default base URL — and the no-endpoint skip must not read that as
     * "nothing to probe". The Agent Platform door builds its own URL; a
     * green check without a request would pass a revoked key.
     */
    /** @scenario A legacy row still validates through the Agent Platform door during the fold window */
    it("probes the Agent Platform door instead of skipping validation", async () => {
      mockFetch.mockResolvedValue(generated());

      const result = await validateProviderApiKey("google_agent_platform", {
        GOOGLE_AGENT_PLATFORM_API_KEY: "AQ.LegacyKey",
        GOOGLE_AGENT_PLATFORM_PROJECT: "acme-123",
        GOOGLE_AGENT_PLATFORM_LOCATION: "global",
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(sentRequest().url).toContain("aiplatform.googleapis.com");
      expect(sentRequest().url).toContain(
        "/projects/acme-123/locations/global/",
      );
      expect(result).toEqual({ valid: true });
    });

    /** @scenario A legacy row still validates through the Agent Platform door during the fold window */
    it("still reports a refused legacy key as refused", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ error: { message: "nope" } }),
      });

      const result = await validateProviderApiKey("google_agent_platform", {
        GOOGLE_AGENT_PLATFORM_API_KEY: "AQ.RevokedKey",
        GOOGLE_AGENT_PLATFORM_PROJECT: "acme-123",
        GOOGLE_AGENT_PLATFORM_LOCATION: "global",
      });

      expect(mockFetch).toHaveBeenCalled();
      expect(codeOf(result)).toBe("provider_key_invalid");
    });
  });
});
