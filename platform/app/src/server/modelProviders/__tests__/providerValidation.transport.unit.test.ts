/**
 * What actually reaches the wire.
 *
 * Every other test of this module stands in for `ssrfSafeFetch`, which is the
 * right seam for asking what the probe decides. It is the wrong seam for asking
 * what the probe *sends*, and those are different questions: the SSRF path
 * tears a URL down to (protocol, hostname, port, path) and rebuilds it, so a
 * credential that rides anywhere other than a header could be dropped between
 * the two without a single mocked test noticing.
 *
 * Gemini is the case that makes this worth its own file — its key travels in
 * the query string. Nothing else here would catch that going missing.
 *
 * Mocks undici, one layer further out than everywhere else, so the real
 * validator and the real URL rebuild both run.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const undiciFetchMock = vi.fn();
vi.mock("undici", async (importOriginal) => ({
  ...(await importOriginal<typeof import("undici")>()),
  fetch: (...args: unknown[]) => undiciFetchMock(...args),
}));

import { validateProviderApiKey } from "../providerValidation";

const requestFor = (call: unknown[] | undefined) => ({
  url: String(call?.[0] ?? ""),
  init: (call?.[1] ?? {}) as {
    method?: string;
    body?: unknown;
    headers?: Headers;
  },
});

beforeEach(() => {
  undiciFetchMock.mockReset();
  undiciFetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    headers: new Headers(),
  });
});

describe("given the probe goes out through the SSRF-validated path", () => {
  describe("when the credential rides in the query string", () => {
    it("still carries the Gemini key after the URL is rebuilt", async () => {
      await validateProviderApiKey("gemini", { GEMINI_API_KEY: "AIza-secret" });

      const urls = undiciFetchMock.mock.calls.map(([u]) => String(u));
      expect(urls.some((u) => u.includes("key=AIza-secret"))).toBe(true);
    });
  });

  describe("when the credential rides in a header", () => {
    it("still carries the bearer token", async () => {
      await validateProviderApiKey("openai", { OPENAI_API_KEY: "sk-secret" });

      const { init } = requestFor(undiciFetchMock.mock.calls[0]);
      expect(init.headers?.get("authorization")).toBe("Bearer sk-secret");
    });
  });

  describe("when the probe has to POST", () => {
    it("still carries the method and the body", async () => {
      await validateProviderApiKey("google_agent_platform", {
        GOOGLE_AGENT_PLATFORM_API_KEY: "k",
        GOOGLE_AGENT_PLATFORM_PROJECT: "p",
        GOOGLE_AGENT_PLATFORM_LOCATION: "global",
      });

      const { init } = requestFor(undiciFetchMock.mock.calls[0]);
      expect(init.method).toBe("POST");
      expect(String(init.body)).toContain("ping");
    });
  });

  describe("when the endpoint names a non-standard port", () => {
    it("still dials that port", async () => {
      // A self-hosted model server on :8000 is the ordinary shape of a custom
      // provider, and the port is one of the parts the rebuild has to put back.
      await validateProviderApiKey("custom", {
        CUSTOM_API_KEY: "k",
        CUSTOM_BASE_URL: "https://example.com:8000/v1",
      });

      const { url } = requestFor(undiciFetchMock.mock.calls[0]);
      expect(url).toContain(":8000");
    });
  });
});
