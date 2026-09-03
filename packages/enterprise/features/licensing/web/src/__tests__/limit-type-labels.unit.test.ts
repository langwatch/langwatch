import { describe, expect, it } from "vitest";
import { type LimitType, limitTypes } from "@langwatch/enterprise-licensing-contract";
import { LIMIT_TYPE_DISPLAY_LABELS } from "../limit-type-labels";

describe("LIMIT_TYPE_DISPLAY_LABELS", () => {
  it("provides a display label for every LimitType", () => {
    for (const limitType of limitTypes) {
      expect(LIMIT_TYPE_DISPLAY_LABELS[limitType]).toBeDefined();
      expect(typeof LIMIT_TYPE_DISPLAY_LABELS[limitType]).toBe("string");
      expect(LIMIT_TYPE_DISPLAY_LABELS[limitType].length).toBeGreaterThan(0);
    }
  });

  it("has the expected display labels for each limit type (title case)", () => {
    expect(LIMIT_TYPE_DISPLAY_LABELS.members).toBe("Team Members");
    expect(LIMIT_TYPE_DISPLAY_LABELS.membersLite).toBe("Lite Members");
  });

  it("is a complete Record with no missing keys", () => {
    const labelKeys = Object.keys(LIMIT_TYPE_DISPLAY_LABELS) as LimitType[];
    expect(labelKeys.sort()).toEqual([...limitTypes].sort());
  });
});
