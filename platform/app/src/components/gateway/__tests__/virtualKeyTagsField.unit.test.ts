/**
 * The Tags field's copy and caps, pinned to the limits the server actually
 * applies. Copy that quotes a number has to be derived from the code that
 * enforces it, or it drifts into a promise we do not keep
 * (dev/docs/best_practices/copywriting.md).
 */
import { describe, expect, it } from "vitest";

import {
  normalizeVkTags,
  VK_TAG_MAX_LENGTH,
  VK_TAGS_MAX_COUNT,
} from "@langwatch/gateway-contract";

import {
  parseTagsCsv,
  TAGS_CSV_MAX_LENGTH,
  tagsBeyondLimitsNotice,
  VK_TAGS_FIELD_DESCRIPTION,
} from "../virtualKeyTagsField";

describe("given the Tags field description", () => {
  it("quotes the limits the server enforces", () => {
    expect(VK_TAGS_FIELD_DESCRIPTION).toContain(
      `keeps the first ${VK_TAGS_MAX_COUNT} tags`,
    );
    expect(VK_TAGS_FIELD_DESCRIPTION).toContain(
      `trims each to ${VK_TAG_MAX_LENGTH} characters`,
    );
  });

  it("covers every way saving changes what was typed", () => {
    const kept = normalizeVkTags([
      "team=ml",
      " team=ml ",
      "",
      "x".repeat(VK_TAG_MAX_LENGTH + 1),
    ]);

    expect(kept).toEqual(["team=ml", "x".repeat(VK_TAG_MAX_LENGTH)]);
    expect(VK_TAGS_FIELD_DESCRIPTION).toMatch(/drops blanks and repeats/);
    expect(VK_TAGS_FIELD_DESCRIPTION).toMatch(/trims each to/);
  });

  it("says the tags become labels others can see", () => {
    expect(VK_TAGS_FIELD_DESCRIPTION).toMatch(
      /carries its tags as labels, so anyone with access to the project can see them/,
    );
  });

  it("keeps internal vocabulary out of the customer's way", () => {
    expect(VK_TAGS_FIELD_DESCRIPTION).not.toMatch(
      /AND-subset|vk_tags|metadata\.tags|\bVKs?\b/,
    );
  });

  it("uses no em dash", () => {
    expect(VK_TAGS_FIELD_DESCRIPTION).not.toContain("—");
  });
});

describe("given the field's own length cap", () => {
  describe("when a full tag list is typed at the per-tag limit", () => {
    it("fits, so the cap never clips a list the server would keep", () => {
      const fullList = Array.from({ length: VK_TAGS_MAX_COUNT }, (_, i) =>
        `${i}`.padEnd(VK_TAG_MAX_LENGTH, "x"),
      ).join(", ");

      expect(fullList.length).toBeLessThanOrEqual(TAGS_CSV_MAX_LENGTH);
      expect(normalizeVkTags(parseTagsCsv(fullList))).toHaveLength(VK_TAGS_MAX_COUNT);
    });
  });

  describe("when the tags are made of astral-plane characters", () => {
    it("still fits, because the cap counts UTF-16 units and the server counts code points", () => {
      const emojiTag = "🙂".repeat(VK_TAG_MAX_LENGTH);
      const fullList = Array.from({ length: VK_TAGS_MAX_COUNT }, () => emojiTag).join(
        ", ",
      );

      expect([...emojiTag]).toHaveLength(VK_TAG_MAX_LENGTH);
      expect(emojiTag.length).toBeGreaterThan(VK_TAG_MAX_LENGTH);
      expect(fullList.length).toBeLessThanOrEqual(TAGS_CSV_MAX_LENGTH);
    });
  });
});

describe("given a line of typed tags", () => {
  describe("when it is within the limits", () => {
    it("raises no notice", () => {
      expect(tagsBeyondLimitsNotice("tier=enterprise, team=ml")).toBeNull();
      expect(tagsBeyondLimitsNotice("")).toBeNull();
    });
  });

  describe("when it holds more distinct tags than the key keeps", () => {
    it("says only the first ones will be saved", () => {
      const tooMany = Array.from(
        { length: VK_TAGS_MAX_COUNT + 1 },
        (_, i) => `team=${i}`,
      ).join(",");

      expect(tagsBeyondLimitsNotice(tooMany)).toBe(
        `Only the first ${VK_TAGS_MAX_COUNT} tags will be saved.`,
      );
    });

    it("counts repeats once, the way saving does", () => {
      const withRepeats = Array.from({ length: VK_TAGS_MAX_COUNT }, (_, i) => `team=${i}`)
        .concat("team=0", "team=1")
        .join(",");

      expect(tagsBeyondLimitsNotice(withRepeats)).toBeNull();
      expect(normalizeVkTags(parseTagsCsv(withRepeats))).toHaveLength(VK_TAGS_MAX_COUNT);
    });
  });

  describe("when a tag runs past the per-tag limit", () => {
    it("says it will be shortened", () => {
      expect(tagsBeyondLimitsNotice("x".repeat(VK_TAG_MAX_LENGTH + 1))).toBe(
        `Tags longer than ${VK_TAG_MAX_LENGTH} characters will be shortened.`,
      );
    });

    it("measures it in code points, the way saving does", () => {
      const atTheLimit = "🙂".repeat(VK_TAG_MAX_LENGTH);
      const overTheLimit = "🙂".repeat(VK_TAG_MAX_LENGTH + 1);

      expect(tagsBeyondLimitsNotice(atTheLimit)).toBeNull();
      expect(tagsBeyondLimitsNotice(overTheLimit)).toMatch(/will be shortened/);
    });
  });

  describe("when it breaks both limits at once", () => {
    it("says both", () => {
      const tooManyAndTooLong = Array.from(
        { length: VK_TAGS_MAX_COUNT + 1 },
        (_, i) => `team=${i}${"x".repeat(VK_TAG_MAX_LENGTH)}`,
      ).join(",");

      expect(tagsBeyondLimitsNotice(tooManyAndTooLong)).toBe(
        `Only the first ${VK_TAGS_MAX_COUNT} tags will be saved. ` +
          `Tags longer than ${VK_TAG_MAX_LENGTH} characters will be shortened.`,
      );
    });
  });
});

describe("given the line is split into tags on save", () => {
  it("trims each and drops the blanks", () => {
    expect(parseTagsCsv(" tier=enterprise ,, team=ml , ")).toEqual([
      "tier=enterprise",
      "team=ml",
    ]);
  });
});
