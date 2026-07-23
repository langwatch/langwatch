import { describe, expect, it } from "vitest";
import { isPreciseResourceHref, toRelativeSameOriginHref } from "./platformHref";

describe("toRelativeSameOriginHref", () => {
  describe("given a url on the same origin", () => {
    it("strips the origin to a relative path", () => {
      expect(
        toRelativeSameOriginHref({
          url: "https://app.langwatch.ai/demo/simulations/set_1/batch_1?openRun=run_1",
          origin: "https://app.langwatch.ai",
        }),
      ).toBe("/demo/simulations/set_1/batch_1?openRun=run_1");
    });

    it("preserves a hash fragment alongside the query", () => {
      expect(
        toRelativeSameOriginHref({
          url: "https://app.langwatch.ai/demo/messages/t1?tab=spans#span-2",
          origin: "https://app.langwatch.ai",
        }),
      ).toBe("/demo/messages/t1?tab=spans#span-2");
    });
  });

  describe("given a url that does not belong to this LangWatch instance", () => {
    /** @scenario "A link pointing outside this LangWatch instance is not adopted" */
    it("returns null instead of adopting the foreign link", () => {
      expect(
        toRelativeSameOriginHref({
          url: "https://evil.example.com/demo/simulations",
          origin: "https://app.langwatch.ai",
        }),
      ).toBeNull();
    });

    it("returns null when the origin has no scheme, rather than matching every opaque origin", () => {
      // A scheme-less BASE_HOST (`localhost:3000`, which is what CI and a
      // misconfigured deploy carry) parses with the opaque origin "null" —
      // and so does any other non-http url, so a plain equality check would
      // call them same-origin and hand back a path that isn't app-absolute.
      expect(
        toRelativeSameOriginHref({
          url: "localhost:3000/demo/simulations/set_1/batch_1",
          origin: "localhost:3000",
        }),
      ).toBeNull();
      expect(
        toRelativeSameOriginHref({
          url: "evil:9999/demo/simulations",
          origin: "localhost:3000",
        }),
      ).toBeNull();
    });

    it("returns null for a same-path different-scheme host", () => {
      expect(
        toRelativeSameOriginHref({
          url: "http://app.langwatch.ai/demo/simulations",
          origin: "https://app.langwatch.ai",
        }),
      ).toBeNull();
    });
  });

  describe("given input that cannot be parsed as a url", () => {
    it("returns null rather than throwing", () => {
      expect(
        toRelativeSameOriginHref({ url: "not a url", origin: "https://app.langwatch.ai" }),
      ).toBeNull();
    });

    it("returns null when there is no origin to compare against", () => {
      expect(
        toRelativeSameOriginHref({
          url: "https://app.langwatch.ai/demo/simulations",
          origin: "",
        }),
      ).toBeNull();
    });
  });
});

describe("isPreciseResourceHref", () => {
  describe("given a bare surface index (no extra path, no query)", () => {
    it("is not precise", () => {
      expect(isPreciseResourceHref("https://app.langwatch.ai/demo/simulations")).toBe(
        false,
      );
      expect(isPreciseResourceHref("/demo/simulations")).toBe(false);
    });
  });

  describe("given a resource address with an extra path segment", () => {
    it("is precise", () => {
      expect(isPreciseResourceHref("/demo/datasets/ds_123")).toBe(true);
    });
  });

  describe("given a resource address carried entirely in the query string", () => {
    it("is precise", () => {
      expect(
        isPreciseResourceHref(
          "/demo/simulations/set_1/batch_1?openRun=run_1",
        ),
      ).toBe(true);
      expect(
        isPreciseResourceHref("/demo/agents?drawer.open=agentCodeEditor&drawer.agentId=ag_1"),
      ).toBe(true);
    });
  });
});
