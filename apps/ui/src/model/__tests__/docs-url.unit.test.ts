/**
 * @vitest-environment node
 *
 * `docsUrl` reads `window.location` when it is there, so the no-window branch
 * — the production docs URL every packaged build links to — is only reachable
 * without a DOM. The overriding cases below pin the other branches explicitly.
 */
import { describe, expect, it } from "vitest";

import { docsUrl, getDocsBaseUrl } from "../docs-url";

describe("getDocsBaseUrl", () => {
  describe("when resolving in a development build", () => {
    /** @scenario A contributor's local checkout links to their own local docs */
    it("returns localhost docs when control plane is on localhost", () => {
      expect(getDocsBaseUrl({ hostname: "localhost", isDev: true })).toBe("http://localhost:3000");
    });

    it("returns localhost docs when on 127.0.0.1", () => {
      expect(getDocsBaseUrl({ hostname: "127.0.0.1", isDev: true })).toBe("http://localhost:3000");
    });

    it("returns localhost docs when on 0.0.0.0", () => {
      expect(getDocsBaseUrl({ hostname: "0.0.0.0", isDev: true })).toBe("http://localhost:3000");
    });

    it("returns production docs on a non-local hostname", () => {
      expect(getDocsBaseUrl({ hostname: "app.langwatch.ai", isDev: true })).toBe(
        "https://docs.langwatch.ai",
      );
    });
  });

  describe("when resolving in a production build", () => {
    /** @scenario A packaged self-hosted install links to real documentation */
    it("returns production docs when a self-hosted server is on localhost", () => {
      expect(getDocsBaseUrl({ hostname: "localhost", isDev: false })).toBe(
        "https://docs.langwatch.ai",
      );
    });

    it("returns production docs on app.langwatch.ai", () => {
      expect(getDocsBaseUrl({ hostname: "app.langwatch.ai", isDev: false })).toBe(
        "https://docs.langwatch.ai",
      );
    });

    it("returns production docs on a customer's self-hosted DNS", () => {
      expect(getDocsBaseUrl({ hostname: "langwatch.acme.internal", isDev: false })).toBe(
        "https://docs.langwatch.ai",
      );
    });
  });

  it("returns production docs in a no-window environment (Node, future SSR)", () => {
    expect(getDocsBaseUrl({ hostname: undefined, isDev: false })).toBe("https://docs.langwatch.ai");
  });
});

describe("docsUrl", () => {
  it("joins the base with a leading-slash path", () => {
    // No overrides; relies on the no-window fallback returning the
    // production base. Production callers omit them entirely.
    expect(docsUrl("/ai-governance/anomaly-rules")).toBe(
      "https://docs.langwatch.ai/ai-governance/anomaly-rules",
    );
  });
});
