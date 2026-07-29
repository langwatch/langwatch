import { describe, expect, it } from "vitest";

import { assertPlatformHasNoLangwatchApiKey } from "./langwatchPlatformGuard";

describe("assertPlatformHasNoLangwatchApiKey", () => {
  describe("given LANGWATCH_API_KEY is unset", () => {
    it("allows boot", () => {
      expect(() => assertPlatformHasNoLangwatchApiKey({})).not.toThrow();
    });
  });

  describe("given LANGWATCH_API_KEY is set", () => {
    it("refuses to boot", () => {
      expect(() =>
        assertPlatformHasNoLangwatchApiKey({ LANGWATCH_API_KEY: "sk-lw-real-key" }),
      ).toThrow(/must not be set on a langwatch platform/);
    });
  });

  describe("given a non-trigger credential is set (e.g. haven's HAVEN_SEED_LANGWATCH_API_KEY)", () => {
    it("allows boot, because only LANGWATCH_API_KEY is the SDK trigger", () => {
      expect(() =>
        assertPlatformHasNoLangwatchApiKey({
          HAVEN_SEED_LANGWATCH_API_KEY: "sk-lw-local-development-key",
        }),
      ).not.toThrow();
    });
  });

  describe("given LANGWATCH_API_KEY is set to an empty string", () => {
    it("allows boot, treating empty as unset", () => {
      expect(() =>
        assertPlatformHasNoLangwatchApiKey({ LANGWATCH_API_KEY: "" }),
      ).not.toThrow();
    });
  });
});
