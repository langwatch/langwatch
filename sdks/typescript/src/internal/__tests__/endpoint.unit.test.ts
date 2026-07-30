import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DEFAULT_ENDPOINT } from "../constants";
import { normalizeEndpoint, resolveEndpoint } from "../endpoint";

describe("resolveEndpoint", () => {
  const previousEndpoint = process.env.LANGWATCH_ENDPOINT;

  beforeEach(() => {
    delete process.env.LANGWATCH_ENDPOINT;
  });

  afterEach(() => {
    if (previousEndpoint === undefined) delete process.env.LANGWATCH_ENDPOINT;
    else process.env.LANGWATCH_ENDPOINT = previousEndpoint;
  });

  describe("given an explicit endpoint", () => {
    describe("when it carries a trailing slash", () => {
      it("strips the slash", () => {
        expect(resolveEndpoint("https://app.langwatch.ai/")).toBe(
          "https://app.langwatch.ai",
        );
      });
    });

    describe("when it carries repeated trailing slashes", () => {
      it("strips all of them", () => {
        expect(resolveEndpoint("http://localhost:5560///")).toBe(
          "http://localhost:5560",
        );
      });
    });

    describe("when the environment also sets an endpoint", () => {
      /** @scenario An explicitly configured endpoint wins over the environment */
      it("prefers the explicit value", () => {
        process.env.LANGWATCH_ENDPOINT = "https://env.langwatch.test/";

        expect(resolveEndpoint("https://explicit.langwatch.test/")).toBe(
          "https://explicit.langwatch.test",
        );
      });
    });

    describe("when it is blank", () => {
      it("falls through to the environment", () => {
        process.env.LANGWATCH_ENDPOINT = "https://env.langwatch.test";

        expect(resolveEndpoint("   ")).toBe("https://env.langwatch.test");
      });
    });
  });

  describe("given no explicit endpoint", () => {
    describe("when LANGWATCH_ENDPOINT carries a trailing slash", () => {
      it("strips the slash", () => {
        process.env.LANGWATCH_ENDPOINT = "https://app.langwatch.ai/";

        expect(resolveEndpoint()).toBe("https://app.langwatch.ai");
      });
    });

    describe("when LANGWATCH_ENDPOINT is empty", () => {
      /** @scenario A blank environment endpoint falls back to the cloud default */
      it("falls back to the cloud default", () => {
        process.env.LANGWATCH_ENDPOINT = "";

        expect(resolveEndpoint()).toBe(DEFAULT_ENDPOINT);
      });
    });

    describe("when LANGWATCH_ENDPOINT is unset", () => {
      it("falls back to the cloud default", () => {
        expect(resolveEndpoint()).toBe(DEFAULT_ENDPOINT);
      });
    });
  });
});

describe("normalizeEndpoint", () => {
  describe("when the value has surrounding whitespace", () => {
    it("trims it", () => {
      expect(normalizeEndpoint("  https://app.langwatch.ai/  ")).toBe(
        "https://app.langwatch.ai",
      );
    });
  });

  describe("when the value has no trailing slash", () => {
    it("leaves it untouched", () => {
      expect(normalizeEndpoint("https://app.langwatch.ai")).toBe(
        "https://app.langwatch.ai",
      );
    });
  });
});
