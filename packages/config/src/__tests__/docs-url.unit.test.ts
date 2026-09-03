/**
 * Where a docs link points, driven by explicit inputs rather than by a runtime.
 *
 * The five family-local copies this replaces each read `import.meta.env.DEV`,
 * so their tests could only pin a branch by passing an override that shadowed
 * the read. The branch is now the argument, which is why every case below is a
 * plain function call with no environment arranged around it.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  canonicalDocsBaseUrl,
  configureDocsRuntime,
  currentDocsRuntime,
  docsBaseUrl,
  docsUrl,
  resolveDocsBaseUrl,
} from "../docs-url";

/** The module's own default, so one case cannot leak into the next. */
afterEach(() => {
  configureDocsRuntime({ mode: "production" });
});

describe("resolveDocsBaseUrl", () => {
  describe("when resolving for a development runtime", () => {
    /** @scenario A contributor's local checkout links to their own local docs */
    it("returns localhost docs when the control plane is on localhost", () => {
      expect(resolveDocsBaseUrl({ mode: "development", hostname: "localhost" })).toBe(
        "http://localhost:3000",
      );
    });

    it("returns localhost docs when on 127.0.0.1", () => {
      expect(resolveDocsBaseUrl({ mode: "development", hostname: "127.0.0.1" })).toBe(
        "http://localhost:3000",
      );
    });

    it("returns localhost docs when on 0.0.0.0", () => {
      expect(resolveDocsBaseUrl({ mode: "development", hostname: "0.0.0.0" })).toBe(
        "http://localhost:3000",
      );
    });

    it("returns production docs on a non-local hostname", () => {
      expect(resolveDocsBaseUrl({ mode: "development", hostname: "app.langwatch.ai" })).toBe(
        "https://docs.langwatch.ai",
      );
    });
  });

  describe("when resolving for a production runtime", () => {
    /** @scenario A packaged self-hosted install links to real documentation */
    it("returns production docs when a self-hosted server is on localhost", () => {
      expect(resolveDocsBaseUrl({ mode: "production", hostname: "localhost" })).toBe(
        "https://docs.langwatch.ai",
      );
    });

    it("returns production docs on app.langwatch.ai", () => {
      expect(resolveDocsBaseUrl({ mode: "production", hostname: "app.langwatch.ai" })).toBe(
        "https://docs.langwatch.ai",
      );
    });

    it("returns production docs on a customer's self-hosted DNS", () => {
      expect(resolveDocsBaseUrl({ mode: "production", hostname: "langwatch.acme.internal" })).toBe(
        "https://docs.langwatch.ai",
      );
    });
  });

  /**
   * A suite is not a deployment anybody opens links from. Were `test` local,
   * every jsdom suite served from `localhost` would silently admit
   * `http://localhost:3000` to the docs-origin allowlist that
   * `read-handled-error` derives from this module.
   */
  it("returns production docs for a test runtime on a local host", () => {
    expect(resolveDocsBaseUrl({ mode: "test", hostname: "localhost" })).toBe(
      "https://docs.langwatch.ai",
    );
  });

  it("returns production docs when no hostname is known", () => {
    expect(resolveDocsBaseUrl({ mode: "development" })).toBe("https://docs.langwatch.ai");
  });
});

describe("the configured runtime", () => {
  describe("when no application has configured one", () => {
    it("resolves as production", () => {
      expect(currentDocsRuntime()).toEqual({ mode: "production" });
      expect(docsBaseUrl()).toBe("https://docs.langwatch.ai");
    });
  });

  describe("when the composition root configures a local development runtime", () => {
    it("resolves to the contributor's own docs", () => {
      configureDocsRuntime({ mode: "development", hostname: "localhost" });
      expect(docsBaseUrl()).toBe("http://localhost:3000");
      expect(docsUrl("/integration/cli")).toBe("http://localhost:3000/integration/cli");
    });
  });
});

describe("canonicalDocsBaseUrl", () => {
  it("stays the production docs site whatever runtime is configured", () => {
    configureDocsRuntime({ mode: "development", hostname: "localhost" });
    expect(canonicalDocsBaseUrl()).toBe("https://docs.langwatch.ai");
  });
});

describe("docsUrl", () => {
  it("joins the configured base with a leading-slash path", () => {
    expect(docsUrl("/ai-governance/anomaly-rules")).toBe(
      "https://docs.langwatch.ai/ai-governance/anomaly-rules",
    );
  });
});
