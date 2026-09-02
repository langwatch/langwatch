import { describe, expect, it } from "vitest";
import { LIMIT_TYPE_LABELS } from "../license-limit-labels";
import {
  type LimitType,
  limitTypes,
} from "@langwatch/enterprise-licensing-contract";

describe("LIMIT_TYPE_LABELS", () => {
  it("provides a label for every LimitType", () => {
    for (const limitType of limitTypes) {
      expect(LIMIT_TYPE_LABELS[limitType]).toBeDefined();
      expect(typeof LIMIT_TYPE_LABELS[limitType]).toBe("string");
      expect(LIMIT_TYPE_LABELS[limitType].length).toBeGreaterThan(0);
    }
  });

  it("has the expected labels for each limit type", () => {
    expect(LIMIT_TYPE_LABELS.members).toBe("team members");
    expect(LIMIT_TYPE_LABELS.membersLite).toBe("lite members");
  });

  it("is a complete Record with no missing keys", () => {
    const labelKeys = Object.keys(LIMIT_TYPE_LABELS) as LimitType[];
    expect(labelKeys.sort()).toEqual([...limitTypes].sort());
  });
});
