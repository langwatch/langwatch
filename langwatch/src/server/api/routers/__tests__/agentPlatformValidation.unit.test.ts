/**
 * Agent Platform is the one provider here that cannot be validated by listing
 * models: `GET .../models` answers 401 "API keys are not supported by this
 * API" however good the key is, while `:generateContent` accepts one. Probing
 * the usual way would report a working credential as unusable, so what these
 * tests pin is mostly *which request goes out*.
 *
 * Established against a real Agent Platform key, not from documentation —
 * the two endpoints on that host disagree and the docs do not mention it.
 *
 * Covers @unit scenarios from
 * specs/model-providers/google-agent-platform.feature.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { validateProviderApiKey } from "../providerValidation";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const CREDENTIALS = {
  GOOGLE_AGENT_PLATFORM_API_KEY: "AQ.AnAgentPlatformKey",
  GOOGLE_AGENT_PLATFORM_PROJECT: "acme-123",
  GOOGLE_AGENT_PLATFORM_LOCATION: "global",
};

/** The request the probe actually made. */
const sentRequest = () => {
  const [url, init] = mockFetch.mock.calls[0] ?? [];
  return { url: String(url ?? ""), init: (init ?? {}) as RequestInit };
};

const generated = () => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify({ candidates: [{ content: {} }] }),
});

const codeOf = (result: { valid: boolean; domainError?: { code: string } }) =>
  result.valid ? undefined : result.domainError?.code;

describe("validateProviderApiKey for google_agent_platform", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  describe("given a credential to check", () => {
    /** @scenario A key the platform accepts is valid */
    it("asks the provider to generate content rather than to list models", async () => {
      mockFetch.mockResolvedValue(generated());

      await validateProviderApiKey("google_agent_platform", CREDENTIALS);

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

      await validateProviderApiKey("google_agent_platform", CREDENTIALS);

      const { url, init } = sentRequest();
      const headers = init.headers as Record<string, string>;
      expect(headers["x-goog-api-key"]).toBe(
        CREDENTIALS.GOOGLE_AGENT_PLATFORM_API_KEY,
      );
      // `?key=` is also accepted by Agent Platform, which is exactly why this
      // is pinned: a credential in a URL reaches access logs and history.
      expect(url).not.toContain(CREDENTIALS.GOOGLE_AGENT_PLATFORM_API_KEY);
      expect(url).not.toContain("key=");
    });

    /** @scenario The project and location I entered are the ones actually checked */
    it("builds the path from the project and location given", async () => {
      mockFetch.mockResolvedValue(generated());

      await validateProviderApiKey("google_agent_platform", {
        ...CREDENTIALS,
        GOOGLE_AGENT_PLATFORM_PROJECT: "acme-123",
        GOOGLE_AGENT_PLATFORM_LOCATION: "us-central1",
      });

      expect(sentRequest().url).toContain(
        "/projects/acme-123/locations/us-central1/",
      );
    });
  });

  describe("given a credential missing its project or location", () => {
    /**
     * This is the shape `validateKeyWithCustomUrl` produced before it was
     * fixed to preserve stored credentials rather than rebuild them from
     * just the key and endpoint: project and location silently dropped,
     * leaving only the key. Asserting on it here pins the walk's behavior
     * directly, without needing a Prisma-backed test for that caller.
     */
    // Three separate cases, not one covering both fields at once: an `||`
    // guard degrading to `&&` would still return no candidates when BOTH
    // are missing, and only a case with exactly one present catches that.
    const expectUnreachable = async (
      credentials: Record<string, string>,
    ) => {
      mockFetch.mockResolvedValue(generated());

      await expect(
        validateProviderApiKey("google_agent_platform", credentials),
      ).rejects.toMatchObject({ code: "provider_unreachable" });

      // Nothing to ask without both a project and a location, so nothing
      // was sent — true whichever one is the one missing.
      expect(mockFetch).not.toHaveBeenCalled();
    };

    /** @scenario A credential missing its project or location is not probed at all */
    it("is unreachable when both project and location are missing", async () => {
      await expectUnreachable({
        GOOGLE_AGENT_PLATFORM_API_KEY: CREDENTIALS.GOOGLE_AGENT_PLATFORM_API_KEY,
      });
    });

    /** @scenario A credential missing its project or location is not probed at all */
    it("is unreachable when only the location is missing", async () => {
      await expectUnreachable({
        GOOGLE_AGENT_PLATFORM_API_KEY: CREDENTIALS.GOOGLE_AGENT_PLATFORM_API_KEY,
        GOOGLE_AGENT_PLATFORM_PROJECT:
          CREDENTIALS.GOOGLE_AGENT_PLATFORM_PROJECT,
      });
    });

    /** @scenario A credential missing its project or location is not probed at all */
    it("is unreachable when only the project is missing", async () => {
      await expectUnreachable({
        GOOGLE_AGENT_PLATFORM_API_KEY: CREDENTIALS.GOOGLE_AGENT_PLATFORM_API_KEY,
        GOOGLE_AGENT_PLATFORM_LOCATION:
          CREDENTIALS.GOOGLE_AGENT_PLATFORM_LOCATION,
      });
    });
  });

  describe("when the platform accepts the credential", () => {
    /** @scenario A key the platform accepts is valid */
    it("reports the credential as valid", async () => {
      mockFetch.mockResolvedValue(generated());

      const result = await validateProviderApiKey(
        "google_agent_platform",
        CREDENTIALS,
      );

      expect(result).toEqual({ valid: true });
    });
  });

  describe("when the platform refuses the credential", () => {
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
        "google_agent_platform",
        CREDENTIALS,
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
        "google_agent_platform",
        CREDENTIALS,
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
        validateProviderApiKey("google_agent_platform", CREDENTIALS),
      ).rejects.toMatchObject({ code: "provider_unreachable" });
    });
  });
});
