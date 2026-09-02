/**
 * @vitest-environment node
 * @unit
 *
 * Token counts as a reader meets them in a table cell.
 *
 * @see specs/coding-agent/pull-request-linkage.feature
 */
import { describe, expect, it } from "vitest";

import { formatTokens } from "../../../index";

describe("formatTokens", () => {
  describe("given nothing counted", () => {
    it("reads as the empty placeholder", () => {
      expect(formatTokens(0)).toBe("—");
    });
  });

  describe("given fewer than a thousand tokens", () => {
    it("reads as a plain count", () => {
      expect(formatTokens(1)).toBe("1");
      expect(formatTokens(999)).toBe("999");
    });
  });

  describe("given thousands of tokens", () => {
    it("reads in thousands", () => {
      expect(formatTokens(1_000)).toBe("1.0K");
      expect(formatTokens(156_800)).toBe("156.8K");
      expect(formatTokens(999_900)).toBe("999.9K");
    });
  });

  describe("given millions of tokens", () => {
    /** @scenario "Millions of tokens read as millions" */
    it("reads in millions rather than thousands", () => {
      expect(formatTokens(1_100_000)).toBe("1.1M");
      expect(formatTokens(2_400_000)).toBe("2.4M");
      expect(formatTokens(6_000_000)).toBe("6.0M");
    });
  });
});
