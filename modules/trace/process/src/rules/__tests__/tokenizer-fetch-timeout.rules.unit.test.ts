import { describe, expect, it } from "vitest";

import { resolveTokenizerFetchTimeoutMs } from "../tokenizer-fetch-timeout.rules.ts";

describe("resolveTokenizerFetchTimeoutMs", () => {
  describe("given a fetch timeout that is not a positive number", () => {
    /** @scenario "An unparseable fetch timeout falls back rather than refusing to boot" */
    it.each([undefined, "", "soon", "0", "-5", 0, Number.NaN])("uses ten seconds for %s", (raw) => {
      expect(resolveTokenizerFetchTimeoutMs(raw)).toBe(10_000);
    });
  });

  describe("given a positive timeout", () => {
    it("uses it, written as text or as a number", () => {
      expect(resolveTokenizerFetchTimeoutMs("2500")).toBe(2500);
      expect(resolveTokenizerFetchTimeoutMs(300)).toBe(300);
    });
  });
});
