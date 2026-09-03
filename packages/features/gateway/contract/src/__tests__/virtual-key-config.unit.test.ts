/**
 * @vitest-environment node
 *
 * VK tags stopped being inert storage the moment the gateway started stamping
 * them on every customer span as `langwatch.labels`: they now land in the
 * ClickHouse trace attribute map on each request and feed the Trace Explorer's
 * Label facet, which aggregates every distinct value. The normalisation below
 * is what keeps that a bounded surface, and it has to hold for tags written
 * through the REST API just as much as for tags typed into the drawer.
 *
 * Spec: specs/ai-gateway/span-shape.feature § VK tags land on customer spans as labels
 */
import { describe, expect, it } from "vitest";

import {
  normalizeVkTags,
  parseVirtualKeyConfig,
  VK_TAG_MAX_LENGTH,
  VK_TAGS_MAX_COUNT,
} from "@langwatch/gateway-contract";

function isWellFormed(value: string): boolean {
  try {
    encodeURIComponent(value);
    return true;
  } catch {
    return false;
  }
}

describe("normalizeVkTags", () => {
  describe("given tags a user could plausibly type", () => {
    it("keeps them in the order they were written", () => {
      expect(normalizeVkTags(["tier=enterprise", "team=ml"])).toEqual([
        "tier=enterprise",
        "team=ml",
      ]);
    });

    it("trims surrounding whitespace", () => {
      expect(normalizeVkTags(["  team=ml  "])).toEqual(["team=ml"]);
    });
  });

  describe("given tags that would add cardinality without adding meaning", () => {
    it("drops empty and whitespace-only entries", () => {
      expect(normalizeVkTags(["", "   ", "team=ml"])).toEqual(["team=ml"]);
    });

    it("collapses duplicates, including ones that differ only by padding", () => {
      expect(normalizeVkTags(["team=ml", " team=ml ", "team=ml"])).toEqual(["team=ml"]);
    });
  });

  describe("given a tag list large enough to be a cardinality problem", () => {
    it("caps the number of tags", () => {
      const many = Array.from({ length: VK_TAGS_MAX_COUNT + 50 }, (_, i) => `tag-${i}`);

      const normalized = normalizeVkTags(many);

      expect(normalized).toHaveLength(VK_TAGS_MAX_COUNT);
      expect(normalized[0]).toBe("tag-0");
      expect(normalized.at(-1)).toBe(`tag-${VK_TAGS_MAX_COUNT - 1}`);
    });

    it("caps the length of a single tag", () => {
      const normalized = normalizeVkTags(["x".repeat(10_000)]);

      expect(normalized).toEqual(["x".repeat(VK_TAG_MAX_LENGTH)]);
    });

    it("truncates on code points so a surrogate pair is never split", () => {
      // Emoji are two UTF-16 code units each, so the leading "a" puts a
      // code-unit slice at an odd offset: it would cut one emoji in half and
      // leave a lone surrogate, which is invalid UTF-8 on the way into
      // ClickHouse.
      const tag = "a" + "🙂".repeat(VK_TAG_MAX_LENGTH);

      const normalized = normalizeVkTags([tag]);

      expect(normalized[0]).toBe("a" + "🙂".repeat(VK_TAG_MAX_LENGTH - 1));
      expect(isWellFormed(normalized[0]!)).toBe(true);
      expect(isWellFormed(tag.slice(0, VK_TAG_MAX_LENGTH))).toBe(false);
    });
  });

  describe("given values that are not strings at all", () => {
    it("skips them instead of stamping [object Object] on every span", () => {
      expect(normalizeVkTags([null, 42, { team: "ml" }, "team=ml"])).toEqual(["team=ml"]);
    });
  });
});

describe("parseVirtualKeyConfig", () => {
  describe("given a stored config whose tags predate the bounds", () => {
    it("normalises them instead of throwing, so the VK stays servable", () => {
      const config = parseVirtualKeyConfig({
        metadata: {
          tags: [
            "team=ml",
            "team=ml",
            "",
            ...Array.from({ length: VK_TAGS_MAX_COUNT }, (_, i) => `t${i}`),
          ],
        },
      });

      expect(config.metadata.tags).toHaveLength(VK_TAGS_MAX_COUNT);
      expect(config.metadata.tags[0]).toBe("team=ml");
    });
  });

  describe("given a config with no metadata at all", () => {
    it("defaults tags to an empty list", () => {
      expect(parseVirtualKeyConfig({}).metadata.tags).toEqual([]);
    });
  });
});
