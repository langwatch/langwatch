import { describe, it, expect } from "vitest";

import { docsUrl, getDocsBaseUrl } from "../docsUrl";

describe("getDocsBaseUrl", () => {
  describe("given a development build", () => {
    /** @scenario A contributor's local dev server links to the local docs server */
    it("returns localhost docs when control plane is on localhost", () => {
      expect(getDocsBaseUrl("localhost", true)).toBe("http://localhost:3000");
    });

    it("returns localhost docs when on 127.0.0.1", () => {
      expect(getDocsBaseUrl("127.0.0.1", true)).toBe("http://localhost:3000");
    });

    it("returns localhost docs when on 0.0.0.0", () => {
      expect(getDocsBaseUrl("0.0.0.0", true)).toBe("http://localhost:3000");
    });

    it("returns production docs on a non-local hostname", () => {
      expect(getDocsBaseUrl("app.langwatch.ai", true)).toBe(
        "https://docs.langwatch.ai",
      );
    });
  });

  describe("given a production build", () => {
    /** @scenario A packaged self-hosted server on localhost links to production docs */
    it("returns production docs when a self-hosted server is on localhost", () => {
      expect(getDocsBaseUrl("localhost", false)).toBe(
        "https://docs.langwatch.ai",
      );
    });

    it("returns production docs on app.langwatch.ai", () => {
      expect(getDocsBaseUrl("app.langwatch.ai", false)).toBe(
        "https://docs.langwatch.ai",
      );
    });

    it("returns production docs on a customer's self-hosted DNS", () => {
      expect(getDocsBaseUrl("langwatch.acme.internal", false)).toBe(
        "https://docs.langwatch.ai",
      );
    });
  });

  it("returns production docs in a no-window environment (Node, future SSR)", () => {
    expect(getDocsBaseUrl(undefined, false)).toBe("https://docs.langwatch.ai");
  });
});

describe("docsUrl", () => {
  it("joins the base with a leading-slash path", () => {
    // No hostname/isDev injection; relies on the no-window fallback
    // returning the production base. Production callers omit both args.
    expect(docsUrl("/ai-governance/anomaly-rules")).toBe(
      "https://docs.langwatch.ai/ai-governance/anomaly-rules",
    );
  });
});
