import { describe, it, expect } from "vitest";

import { docsUrl, getDocsBaseUrl } from "../docsUrl";

describe("getDocsBaseUrl", () => {
  it("returns localhost docs when control plane is on localhost", () => {
    expect(getDocsBaseUrl("localhost")).toBe("http://localhost:3000");
  });

  it("returns localhost docs when on 127.0.0.1", () => {
    expect(getDocsBaseUrl("127.0.0.1")).toBe("http://localhost:3000");
  });

  it("returns localhost docs when on 0.0.0.0", () => {
    expect(getDocsBaseUrl("0.0.0.0")).toBe("http://localhost:3000");
  });

  it("returns production docs on app.langwatch.ai", () => {
    expect(getDocsBaseUrl("app.langwatch.ai")).toBe("https://docs.langwatch.ai");
  });

  it("returns production docs on a customer's self-hosted DNS", () => {
    expect(getDocsBaseUrl("langwatch.acme.internal")).toBe(
      "https://docs.langwatch.ai",
    );
  });

  it("returns production docs in a no-window environment (Node, future SSR)", () => {
    expect(getDocsBaseUrl(undefined)).toBe("https://docs.langwatch.ai");
  });
});

describe("docsUrl", () => {
  it("joins the base with a leading-slash path", () => {
    // No hostname injection; relies on the no-window fallback returning
    // the production base. Production callers omit the hostname arg.
    expect(docsUrl("/ai-governance/anomaly-rules")).toBe(
      "https://docs.langwatch.ai/ai-governance/anomaly-rules",
    );
  });
});
